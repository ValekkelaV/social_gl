-- ============================================================
-- Права: убрать лишние гранты у anon/authenticated на auth-таблицах
-- ============================================================
-- Supabase при создании проекта выдаёт ролям anon, authenticated и
-- service_role права НА ВСЕ таблицы схемы public (через дефолтные
-- привилегии). Разграничение доступа делается не грантами, а RLS —
-- это стандартная модель Supabase, и сама по себе она нормальна.
--
-- Проблема в том, что RLS покрывает НЕ ВСЁ. В Postgres row level security
-- применяется к SELECT / INSERT / UPDATE / DELETE, но НЕ к TRUNCATE.
-- Значит, привилегия truncate, выданная роли anon, никакими политиками не
-- перекрывается — она реальная.
--
-- Чем это грозит на практике сегодня: ничем. anon не может выполнить сырой
-- SQL (не может подключиться к базе), а PostgREST эндпоинта для TRUNCATE не
-- предоставляет. Взрывается это только если появится security definer
-- функция, исполняющая динамический SQL и доступная anon. То есть это
-- гигиена и снятая растяжка, а не тушение пожара.
--
-- То же касается TRIGGER (право вешать на таблицу свой триггер) и
-- REFERENCES (право ссылаться на таблицу внешним ключом) — доступа к данным
-- они не дают, но ролям anon/authenticated на этих таблицах не нужны.
--
-- ------------------------------------------------------------------------
-- ПОЧЕМУ ДВЕ ТАБЛИЦЫ ОБРАБАТЫВАЮТСЯ ПО-РАЗНОМУ
-- ------------------------------------------------------------------------
-- telegram_login_tokens — политик нет вообще (см. 17_telegram-deep-link-login.sql),
--   доступ идёт только через security definer функции и service role.
--   Поэтому у anon и authenticated отзывается ВСЁ: select/insert/update/delete
--   им всё равно ничего не дают без политик, а так таблица даже не попадает
--   в схему, которую отдаёт PostgREST.
--
-- whitelisted_usernames — политики ЕСТЬ (15_auth_whitelist_rls.sql): чтение
--   всему оргкомитету, запись владельцу. Отзывать у authenticated права
--   select/insert/update/delete НЕЛЬЗЯ — страница вайтлиста в админке
--   перестанет работать, потому что гранты и политики нужны вместе: грант
--   решает "может ли роль в принципе", политика — "какие строки". Поэтому
--   здесь отзываются только truncate/trigger/references, а у anon (у которого
--   политик нет вовсе) — всё.
--
-- service_role не трогаем нигде: это админская роль, вебхук ходит через неё,
-- и она обходит RLS по определению.

-- ---------- telegram_login_tokens ----------

revoke all on telegram_login_tokens from anon, authenticated;

-- MAINTAIN — привилегия, появившаяся только в PostgreSQL 17 (VACUUM/ANALYZE/
-- REINDEX по таблице). Данных не открывает, но ролям приложения не нужна.
-- Проверяем версию, иначе на PG 16 и ниже эта строка упала бы с
-- "unrecognized privilege type" и уронила бы всю миграцию ради мелочи.
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on telegram_login_tokens from anon, authenticated';
  end if;
end $$;


-- ---------- whitelisted_usernames ----------

-- anon: политик для него нет, значит не нужны и гранты
revoke all on whitelisted_usernames from anon;

-- authenticated: select/insert/update/delete оставляем — на них опираются
-- политики из 15_auth_whitelist_rls.sql. Отзываем только то, что RLS не
-- покрывает или что роли приложения не требуется.
revoke truncate, trigger, references on whitelisted_usernames from authenticated;

do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on whitelisted_usernames from authenticated';
  end if;
end $$;
