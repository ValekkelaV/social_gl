// supabase/functions/telegram-login/index.ts
//
// Принимает данные от Telegram Login Widget, проверяет их подлинность
// (HMAC-подпись токеном бота), сверяет username с вайтлистом, создаёт
// или находит пользователя в auth.users + people, возвращает сессию.
//
// Деплой: supabase functions deploy telegram-login
// Секреты, которые нужно задать вручную перед деплоем:
//   supabase secrets set TELEGRAM_BOT_TOKEN=<токен от BotFather>
//   supabase secrets set PROJECT_ANON_KEY=<anon key из Settings → API>
// (не SUPABASE_ANON_KEY — CLI блокирует секреты с префиксом SUPABASE_)
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY доступны автоматически в Edge
// Functions рантайме — их задавать вручную не нужно.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { crypto } from "https://deno.land/std@0.203.0/crypto/mod.ts";
import { encodeHex } from "https://deno.land/std@0.203.0/encoding/hex.ts";

// Данные, которые присылает Telegram Login Widget в колбэк на фронтенде.
// См. https://core.telegram.org/widgets/login
interface TelegramAuthPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// anon key нужен для второго клиента, которым Edge Function сама себе
// "логинится" через verifyOtp (verifyOtp — это публичный auth-эндпоинт,
// вызывается как обычный клиент, не через admin-права).
// Названа без префикса SUPABASE_ — сам CLI блокирует секреты с этим
// префиксом (зарезервирован под автоматически прокидываемые переменные).
const SUPABASE_ANON_KEY = Deno.env.get("PROJECT_ANON_KEY")!;

// Данные от Telegram считаются просроченными, если auth_date старше этого
// порога (защита от повторного использования старого подписанного payload —
// злоумышленник не может подделать подпись, но МОЖЕТ переиграть старую
// валидную подпись, если её где-то перехватил).
const MAX_AUTH_AGE_SECONDS = 300; // 5 минут

async function hmacSha256Hex(key: Uint8Array, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return encodeHex(new Uint8Array(signature));
}

async function sha256(message: string): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return new Uint8Array(hash);
}

/**
 * Проверяет подлинность данных от Telegram Login Widget.
 * Алгоритм из офиц. документации Telegram:
 * https://core.telegram.org/widgets/login#checking-authorization
 */
async function verifyTelegramAuth(payload: TelegramAuthPayload, botToken: string): Promise<boolean> {
  const { hash, ...dataWithoutHash } = payload;

  // Строка проверки: все поля кроме hash, отсортированные по ключу,
  // в формате "key=value", склеенные через \n
  const checkString = Object.keys(dataWithoutHash)
    .sort()
    .map((key) => `${key}=${(dataWithoutHash as Record<string, unknown>)[key]}`)
    .join("\n");

  // Секретный ключ — SHA256 от токена бота
  const secretKey = await sha256(botToken);
  const computedHash = await hmacSha256Hex(secretKey, checkString);

  return computedHash === hash;
}

serve(async (req: Request) => {
  // CORS: разрешаем запросы с фронтенда. В проде замени "*" на реальный домен.
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!TELEGRAM_BOT_TOKEN) {
    return new Response(
      JSON.stringify({ error: "Сервер не настроен: отсутствует TELEGRAM_BOT_TOKEN" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const payload: TelegramAuthPayload = await req.json();

    if (!payload.id || !payload.hash || !payload.auth_date) {
      return new Response(
        JSON.stringify({ error: "Неполные данные от Telegram" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Проверка подписи
    const isValid = await verifyTelegramAuth(payload, TELEGRAM_BOT_TOKEN);
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: "Неверная подпись данных Telegram" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Проверка свежести (защита от replay-атаки со старым payload)
    const ageSeconds = Math.floor(Date.now() / 1000) - payload.auth_date;
    if (ageSeconds > MAX_AUTH_AGE_SECONDS) {
      return new Response(
        JSON.stringify({ error: "Данные авторизации устарели, попробуйте войти заново" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3. Требуем наличие username — вайтлист построен именно по username
    if (!payload.username) {
      return new Response(
        JSON.stringify({
          error: "У вашего Telegram-аккаунта не задан @username. " +
            "Установите username в настройках Telegram и попробуйте снова.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 4. Проверка вайтлиста (регистронезависимо — Telegram username сам
    // по себе регистронезависим, "Ivanov" и "ivanov" — один и тот же человек)
    const { data: whitelistEntry, error: whitelistError } = await supabaseAdmin
      .from("whitelisted_usernames")
      .select("username")
      .ilike("username", payload.username)
      .maybeSingle();

    if (whitelistError) {
      console.error("Ошибка проверки вайтлиста:", whitelistError);
      return new Response(
        JSON.stringify({ error: "Внутренняя ошибка проверки доступа" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!whitelistEntry) {
      return new Response(
        JSON.stringify({
          error: `Доступ запрещён: @${payload.username} не в списке оргкомитета. ` +
            "Обратитесь к владельцу системы.",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 5. Ищем существующего пользователя по telegram_id (надёжнее username,
    // т.к. username можно сменить, telegram_id — нет)
    const telegramId = payload.id;
    const { data: existingPerson, error: findError } = await supabaseAdmin
      .from("people")
      .select("id")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    if (findError) {
      console.error("Ошибка поиска пользователя:", findError);
      return new Response(
        JSON.stringify({ error: "Внутренняя ошибка поиска пользователя" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let userId: string;

    if (existingPerson) {
      // Уже существующий пользователь — просто обновляем username на случай,
      // если он сменился в Telegram с прошлого входа
      userId = existingPerson.id;
      await supabaseAdmin
        .from("people")
        .update({ telegram_username: payload.username })
        .eq("id", userId);
    } else {
      // Новый пользователь — создаём auth.users запись как идентификатор
      // для auth.uid() в RLS. Supabase Auth формально требует email или
      // phone на пользователя; реального email у Telegram-логина нет, так
      // что используем синтетический — пользователь никогда не увидит и не
      // будет использовать его напрямую (вход всегда идёт через Telegram).
      const syntheticEmail = `tg${telegramId}@telegram.local`;
      const { data: newAuthUser, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
        user_metadata: { telegram_id: telegramId, telegram_username: payload.username },
      });

      if (createAuthError || !newAuthUser.user) {
        console.error("Ошибка создания auth-пользователя:", createAuthError);
        return new Response(
          JSON.stringify({ error: "Не удалось создать учётную запись" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      userId = newAuthUser.user.id;

      const fullName = [payload.first_name, payload.last_name].filter(Boolean).join(" ") || payload.username;

      const { error: insertPersonError } = await supabaseAdmin.from("people").insert({
        id: userId,
        full_name: fullName,
        telegram_id: telegramId,
        telegram_username: payload.username,
      });

      if (insertPersonError) {
        console.error("Ошибка создания записи people:", insertPersonError);
        // откатываем созданного auth-пользователя, чтобы не плодить сирот
        await supabaseAdmin.auth.admin.deleteUser(userId);
        return new Response(
          JSON.stringify({ error: "Не удалось создать профиль пользователя" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // 6. Помечаем приглашение как использованное (первый раз)
    await supabaseAdmin
      .from("whitelisted_usernames")
      .update({ used_at: new Date().toISOString() })
      .ilike("username", payload.username)
      .is("used_at", null);

    // 7. Выдаём настоящую сессию (access_token + refresh_token) от GoTrue,
    // не изобретая свой JWT вручную. Схема: генерируем одноразовый magic-link
    // токен через Admin API (email никуда не отправляется — мы просто берём
    // токен из ответа), затем сама Edge Function (server-to-server, анонимным
    // клиентом) обменивает его на сессию через verifyOtp. Итог — обычная
    // сессия Supabase Auth с рабочим refresh_token, полученная официальным
    // протоколом, без ручной генерации JWT.
    const syntheticEmailForLogin = `tg${telegramId}@telegram.local`;
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: syntheticEmailForLogin,
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error("Ошибка генерации одноразового токена:", linkError);
      return new Response(
        JSON.stringify({ error: "Не удалось создать сессию входа" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: sessionData, error: verifyError } = await supabaseAnon.auth.verifyOtp({
      type: "magiclink",
      token_hash: linkData.properties.hashed_token,
    });

    if (verifyError || !sessionData.session) {
      console.error("Ошибка обмена токена на сессию:", verifyError);
      return new Response(
        JSON.stringify({ error: "Не удалось завершить вход" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
        expires_in: sessionData.session.expires_in,
        user_id: userId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Необработанная ошибка:", err);
    return new Response(
      JSON.stringify({ error: "Внутренняя ошибка сервера" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
