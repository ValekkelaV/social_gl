// supabase/functions/telegram-webhook/index.ts
//
// Принимает апдейты от Telegram Bot API (webhook), когда пользователь
// открывает t.me/<bot>?start=<token> и жмёт Start. Проверяет вайтлист,
// создаёт/находит people, готовит одноразовый magic-link токен и кладёт
// его в telegram_login_tokens — фронтенд, который в это время опрашивает
// check_login_token(), подхватит его и обменяет на сессию сам.
//
// Деплой (ОБЯЗАТЕЛЬНО с --no-verify-jwt — Telegram не шлёт Supabase JWT):
//   supabase functions deploy telegram-webhook --no-verify-jwt
//
// Секреты (в дополнение к уже заданным для telegram-login):
//   supabase secrets set TELEGRAM_WEBHOOK_SECRET=<любая случайная строка>
//
// Затем один раз зарегистрировать вебхук у Telegram (замените плейсхолдеры):
//   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<SUPABASE_URL>/functions/v1/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
//
// secret_token — механизм Telegram для подтверждения, что запрос на вебхук
// действительно от них: они кладут его в заголовок
// X-Telegram-Bot-Api-Secret-Token на каждый запрос, мы сверяем ниже.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sendTelegramMessage(chatId: number, text: string) {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error("Не удалось отправить сообщение в Telegram:", err);
  }
}

serve(async (req: Request) => {
  // Всегда отвечаем 200, даже при внутренних ошибках — иначе Telegram будет
  // повторять доставку одного и того же апдейта много раз подряд.
  const ok = () => new Response("ok", { status: 200 });

  if (req.method !== "POST") return ok();

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
    console.error("Не заданы TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET");
    return ok();
  }

  // Подтверждаем, что запрос действительно от Telegram.
  const secretHeader = req.headers.get("X-Telegram-Bot-Api-Secret-Token");

  // ВРЕМЕННЫЙ ДЕБАГ: печатаем точные значения (в кавычках JSON.stringify,
  // чтобы видно было скрытые пробелы/переносы строк) — убрать после того,
  // как разберёмся с несовпадением secret_token.
  console.log("DEBUG secretHeader:", JSON.stringify(secretHeader));
  console.log("DEBUG TELEGRAM_WEBHOOK_SECRET:", JSON.stringify(TELEGRAM_WEBHOOK_SECRET));

  if (secretHeader !== TELEGRAM_WEBHOOK_SECRET) {
    console.error("Неверный secret_token в заголовке вебхука");
    return new Response("unauthorized", { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return ok();
  }

  const message = update?.message;
  const text: string | undefined = message?.text;
  const from = message?.from;

  if (!message || !text || !from) return ok();

  // Нас интересует только "/start <token>" — обычные сообщения боту
  // (если кто-то напишет что-то ещё) игнорируем молча.
  const match = text.match(/^\/start\s+([a-f0-9]{48})$/);
  if (!match) {
    if (text.startsWith("/start")) {
      await sendTelegramMessage(
        from.id,
        "Так пока что нельзя... Зайдите на сайт social-gl.vercel.app и найдите там кнопку \"Войти через Telegram\". Она откроет бота с правильной ссылкой.",
      );
    }
    return ok();
  }

  const token = match[1];
  const telegramId: number = from.id;
  const telegramUsername: string | undefined = from.username;

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Токен должен существовать и быть ещё pending (не протухшим/использованным).
  const { data: tokenRow, error: tokenError } = await supabaseAdmin
    .from("telegram_login_tokens")
    .select("token, token_status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (tokenError || !tokenRow) {
    await sendTelegramMessage(telegramId, "Ссылка для входа не найдена. Попробуйте начать вход заново на сайте.");
    return ok();
  }

  if (tokenRow.token_status !== "pending" || new Date(tokenRow.expires_at) < new Date()) {
    await sendTelegramMessage(telegramId, "Ссылка для входа устарела. Попробуйте начать вход заново на сайте.");
    return ok();
  }

  // 2. Username обязателен — вайтлист построен по username.
  if (!telegramUsername) {
    await sendTelegramMessage(
      telegramId,
      "У вашего аккаунта не задан @username. Установите его в настройках Telegram и попробуйте снова.",
    );
    return ok();
  }

  // 3. Проверка вайтлиста (регистронезависимо).
  const { data: whitelistEntry, error: whitelistError } = await supabaseAdmin
    .from("whitelisted_usernames")
    .select("username")
    .ilike("username", telegramUsername)
    .maybeSingle();

  if (whitelistError) {
    console.error("Ошибка проверки вайтлиста:", whitelistError);
    await sendTelegramMessage(telegramId, "Внутренняя ошибка проверки доступа, попробуйте позже или обратитесь в поддержку.");
    return ok();
  }

  if (!whitelistEntry) {
    await supabaseAdmin.from("telegram_login_tokens").update({ token_status: "denied" }).eq("token", token);
    await sendTelegramMessage(
      telegramId,
      `Доступ запрещен: @${telegramUsername} нету в списке оргкомитета. Обратитесь в поддержку, если думаете, что это ошибка.`,
    );
    return ok();
  }

  // 4. Находим существующего пользователя по telegram_id, либо создаём нового
  //    (та же логика, что раньше была в telegram-login/index.ts).
  const { data: existingPerson, error: findError } = await supabaseAdmin
    .from("people")
    .select("id")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (findError) {
    console.error("Ошибка поиска пользователя:", findError);
    await sendTelegramMessage(telegramId, "Внутренняя ошибка, попробуйте позже.");
    return ok();
  }

  let userId: string;
  const syntheticEmail = `tg${telegramId}@telegram.local`;

  if (existingPerson) {
    userId = existingPerson.id;
    await supabaseAdmin.from("people").update({ telegram_username: telegramUsername }).eq("id", userId);
  } else {
    const { data: newAuthUser, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
      email: syntheticEmail,
      email_confirm: true,
      user_metadata: { telegram_id: telegramId, telegram_username: telegramUsername },
    });

    if (createAuthError || !newAuthUser.user) {
      console.error("Ошибка создания auth-пользователя:", createAuthError);
      await sendTelegramMessage(telegramId, "Не удалось создать учетную запись, попробуйте позже.");
      return ok();
    }

    userId = newAuthUser.user.id;
    const fullName = [from.first_name, from.last_name].filter(Boolean).join(" ") || telegramUsername;

    const { error: insertPersonError } = await supabaseAdmin.from("people").insert({
      id: userId,
      full_name: fullName,
      telegram_id: telegramId,
      telegram_username: telegramUsername,
    });

    if (insertPersonError) {
      console.error("Ошибка создания записи people:", insertPersonError);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      await sendTelegramMessage(telegramId, "Не удалось создать профиль пользователя, попробуйте позже.");
      return ok();
    }
  }

  // 5. Помечаем приглашение как использованное (первый раз).
  await supabaseAdmin
    .from("whitelisted_usernames")
    .update({ used_at: new Date().toISOString() })
    .ilike("username", telegramUsername)
    .is("used_at", null);

  // 6. Готовим одноразовый magic-link токен — фронтенд обменяет его на
  //    сессию сам, вызовом supabase.auth.verifyOtp() напрямую в браузере.
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: syntheticEmail,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("Ошибка генерации одноразового токена:", linkError);
    await sendTelegramMessage(telegramId, "Не удалось подготовить сессию, попробуйте позже.");
    return ok();
  }

  // 7. Записываем результат — фронтенд подхватит его через check_login_token().
  const { error: updateTokenError } = await supabaseAdmin
    .from("telegram_login_tokens")
    .update({
      token_status: "verified",
      telegram_id: telegramId,
      telegram_username: telegramUsername,
      session_hashed_token: linkData.properties.hashed_token,
    })
    .eq("token", token);

  if (updateTokenError) {
    console.error("Ошибка обновления telegram_login_tokens:", updateTokenError);
    await sendTelegramMessage(telegramId, "Не удалось завершить вход, попробуйте позже.");
    return ok();
  }

  await sendTelegramMessage(telegramId, "Готово! Возвращайтесь на сайт, там вход завершится автоматически.");

  return ok();
});
