-- ============================================================
-- Вход через Telegram: deep-link + бот-вебхук
-- ============================================================
-- Заменяет JS-виджет (oauth.telegram.org popup), который оказался
-- ненадёжным — код на телефон не доходил, подтверждение через
-- приложение недоступно в нашем случае, ни на демо-странице Telegram,
-- ни на нашем боте.
--
-- Новая схема: фронтенд создаёт короткоживущий токен, открывает
-- t.me/<bot>?start=<token> (обычное открытие бота, без OAuth), бот
-- получает апдейт через вебхук, подтверждает вайтлист и готовит сессию.
-- Фронтенд в это время опрашивает статус токена (polling).

create table telegram_login_tokens (
  token text primary key,
  token_status text not null default 'pending'
    check (token_status in ('pending', 'verified', 'denied', 'expired')),

  telegram_id bigint,
  telegram_username text,

  -- одноразовый magic-link токен GoTrue, сгенерированный вебхуком после
  -- успешной проверки вайтлиста — фронтенд обменивает его на сессию
  -- через supabase.auth.verifyOtp() напрямую в браузере.
  session_hashed_token text,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

-- Таблица короткоживущая (токены протухают за 10 минут), объём всегда мал —
-- периодическая очистка старых строк не критична для MVP, но можно добавить
-- позже cron-джобой (delete where expires_at < now() - interval '1 day').

alter table telegram_login_tokens enable row level security;

-- Намеренно НЕТ ни одной policy на саму таблицу: ни anon, ни authenticated
-- не получают прямого select/insert/update. Единственный доступ — через
-- security definer функции ниже (для фронтенда) и service role (для
-- вебхука, который обходит RLS полностью). Контроль доступа к конкретному
-- токену обеспечивается тем, что нужно ЗНАТЬ точное значение token —
-- он непредсказуем (24 случайных байта), а функции его не перечисляют.


-- ---------- create_login_token ----------
-- Вызывается ещё не залогиненным фронтендом (anon) при клике
-- "Войти через Telegram". Генерирует токен, создаёт pending-запись.

create or replace function create_login_token()
returns text
language plpgsql
security definer
as $$
declare
  v_token text;
begin
  v_token := encode(gen_random_bytes(24), 'hex');
  insert into telegram_login_tokens (token) values (v_token);
  return v_token;
end;
$$;

grant execute on function create_login_token() to anon, authenticated;


-- ---------- check_login_token ----------
-- Опрашивается фронтендом (каждые ~2 сек) пока пользователь подтверждает
-- вход в Telegram. Отдаёт статус и, если verified, hashed_token для обмена
-- на сессию. Попутно помечает протухшие токены как expired.

create or replace function check_login_token(p_token text)
returns table (token_status text, session_hashed_token text)
language plpgsql
security definer
as $$
begin
  -- Fix: Explicitly qualify the table name in the WHERE clause
  update telegram_login_tokens
  set token_status = 'expired'
  where telegram_login_tokens.token = p_token
    and telegram_login_tokens.token_status = 'pending'
    and telegram_login_tokens.expires_at < now();

  return query
  select t.token_status, t.session_hashed_token
  from telegram_login_tokens t
  where t.token = p_token;
end;
$$;

grant execute on function check_login_token(text) to anon, authenticated;

comment on function check_login_token(text) is
  'Возвращает session_hashed_token только тому, кто знает точное значение '
  'token (передал его как аргумент) — это и есть контроль доступа здесь, '
  'отдельных RLS-policy на select для таблицы нет намеренно.';
