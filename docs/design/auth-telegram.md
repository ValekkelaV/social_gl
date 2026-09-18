# Вход через Telegram

## Почему не Login Widget

Изначально вход делался через JS-виджет `oauth.telegram.org` (popup). Он оказался
ненадёжным: код на телефон не доходил, подтверждение через приложение в нашем
случае недоступно — ни на демо-странице Telegram, ни на нашем боте.

Схема заменена на **deep-link + бот-вебхук** (`17_telegram-deep-link-login.sql`
+ `supabase/functions/telegram-webhook/index.ts`). Старая версия миграции лежит
в `docs/archive/raw/17_telegram_deep_link_login_superseded_status.sql`.

## Как работает вход

```
Браузер                     Postgres              Telegram          Edge Function
   │                           │                     │                   │
   │ create_login_token() ────>│ токен pending       │                   │
   │<──── 48 hex-символов ─────│                     │                   │
   │                                                 │                   │
   │ открывает t.me/<bot>?start=<token> ────────────>│                   │
   │                           │                     │  /start <token>   │
   │                           │                     │──────────────────>│
   │                           │                     │                   │ проверяет вайтлист
   │                           │<── сессия + токен ──────────────────────│ создаёт people
   │                           │    verified          │                  │
   │ check_login_token() ─────>│                     │                   │
   │   (каждые ~2 сек)         │                     │                   │
   │<── session_hashed_token ──│                     │                   │
   │                                                 │                   │
   │ supabase.auth.verifyOtp() — обмен на сессию прямо в браузере         │
```

1. **Браузер ещё не залогинен** вызывает `create_login_token()` — генерируется
   48 hex-символов (24 случайных байта), создаётся запись со статусом `pending`.
2. Открывается `t.me/<bot>?start=<token>` — **обычное открытие бота, без OAuth**.
3. Пользователь жмёт Start. Telegram шлёт апдейт на вебхук.
4. Вебхук достаёт `telegram_id` и `telegram_username`, проверяет username против
   `whitelisted_usernames` (case-insensitive, через `ilike`), находит или создаёт
   `auth.users` + `people`.
5. Вебхук генерирует одноразовый magic-link токен GoTrue и кладёт его в
   `session_hashed_token`, статус → `verified`.
6. Браузер, всё это время опрашивавший `check_login_token(token)`, получает
   `session_hashed_token` и обменивает его на сессию через
   `supabase.auth.verifyOtp()`.

Токен живёт **10 минут** (`expires_at = now() + interval '10 minutes'`).
Попутно `check_login_token` помечает протухшие токены как `expired`.

## Контроль доступа к таблице токенов

На `telegram_login_tokens` **намеренно нет ни одной RLS-политики**: ни `anon`, ни
`authenticated` не получают прямого `select`/`insert`/`update`.

Единственный доступ — через `security definer` функции (`create_login_token`,
`check_login_token`, обе с `grant execute to anon, authenticated`) и через service
role вебхука, который обходит RLS целиком.

Это **не** дыра, потому что контроль здесь построен на знании секрета:
`check_login_token(p_token)` отдаёт `session_hashed_token` только тому, кто знает
точное значение токена, а функции его не перечисляют. 24 случайных байта
перебрать нельзя.

⚠️ Но учти: раз политик нет, **любая новая функция с `security definer` на этой
таблице автоматически становится частью периметра безопасности**. Если будешь
добавлять функцию — проверь, что она не отдаёт токены списком.

## Вайтлист

Закрытый список: войти может только тот, чей Telegram `@username` заранее внесён
владельцем. Закрытость — не украшение: `people.id` ссылается на `auth.users.id`,
и без вайтлиста любой человек с ботом создал бы себе запись в оргкомитете.

Хранится именно **username, а не `telegram_id`** — на момент внесения в вайтлист
человек ещё не логинился, и его `telegram_id` системе неизвестен. После первого
успешного входа `telegram_id` сохраняется в `people` (username можно сменить,
id — нет), и `used_at` проставляется в вайтлисте.

Стартовые данные — `supabase/seed_whitelist.sql` (накатывается вручную после
`14_auth_whitelist.sql`, автосид в `config.toml` выключен).

### `preferred_full_name` — реализовано

`18_whitelist_display_name.sql` добавил в вайтлист колонку `preferred_full_name`:
владелец может задать человеку нормальное имя **до** его первого входа, вместо
того, что подставится из Telegram (`first_name` + `last_name`, у части людей —
на латинице или ником).

**Вебхук её читает** (с 2026-09-18, версия функции 11). Цепочка выбора имени
при первом входе:

1. `preferred_full_name` из вайтлиста — если задано и не пустое (после `trim()`);
2. `first_name` + `last_name` из Telegram;
3. `@username`.

`preferred_full_name` может быть `NULL` — тогда шаг 1 просто проваливается
дальше, поэтому поведение для всех, кому имя не проставляли, не изменилось.

У колонки есть вторая роль: это **единственный способ починить имя у того, кто
уже вошёл**. `people.full_name` заполняется только на INSERT — при повторных
входах существующая строка не перезаписывается (иначе ручная правка имени в
админке затиралась бы при каждом логине). Так что входу это не поможет, а вот
`update people set full_name = ...` — да.

## Деплой

```bash
supabase functions deploy telegram-webhook --no-verify-jwt
```

`--no-verify-jwt` **обязателен** — Telegram не шлёт Supabase JWT, платформа
отклонила бы все запросы.

Секреты:
```bash
supabase secrets set TELEGRAM_WEBHOOK_SECRET=<случайная строка>
```
Плюс `TELEGRAM_BOT_TOKEN` и стандартные `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`.

Регистрация вебхука у Telegram (один раз):
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<SUPABASE_URL>/functions/v1/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

`secret_token` — механизм Telegram для подтверждения, что запрос действительно
от них: они кладут его в заголовок `X-Telegram-Bot-Api-Secret-Token` на каждый
запрос, функция сверяет.

## Детали реализации, о которых легко забыть

- **Функция всегда отвечает 200**, даже при внутренней ошибке. Иначе Telegram
  будет повторять доставку одного и того же апдейта много раз подряд.
- Разбирается только `/start <token>` со строгим форматом
  `/^\/start\s+([a-f0-9]{48})$/`. Обычные сообщения боту игнорируются (с
  подсказкой, если начинаются с `/start`).
- Если у пользователя нет публичного `@username` — вход невозможен, вайтлист
  работает только по username.
- **В коде остался временный дебаг**, печатающий значения заголовка и секрета
  (`console.log("DEBUG secretHeader:")`). Он писался, чтобы разобраться с
  несовпадением `secret_token`, и должен быть убран — см. `decisions.md`.
