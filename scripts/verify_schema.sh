#!/usr/bin/env bash
#
# verify_schema.sh — проверяет, что плоские миграции supabase/NN_name.sql
# действительно накатываются с нуля и дают рабочую схему.
#
# Зачем отдельный скрипт: миграции лежат плоскими файлами с человеческой
# нумерацией (01..20) — так они совпадают с GitHub и так их удобно вставлять
# в SQL Editor. Но `supabase db reset` умеет читать только
# supabase/migrations/<timestamp>_name.sql, поэтому проверить накат «как есть»
# им нельзя. Этот скрипт применяет плоские файлы по порядку напрямую через
# psql — без переименования и без создания supabase/migrations/.
#
# Требует запущенного локального стека: `supabase start`.
# База всегда основная (postgres) — потому что миграции ссылаются на
# auth.users и storage.objects, которых в свежей базе не будет.
#
# Использование:
#   scripts/verify_schema.sh              # свежий прогон (сносит public)
#   scripts/verify_schema.sh --keep       # не сносить public (только докат)
#
# Код возврата: 0 — всё накатилось, 1 — первая же ошибка с указанием файла.

set -uo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
SQL_DIR="${SQL_DIR:-supabase}"
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

psql_q() { psql "$DB_URL" -v ON_ERROR_STOP=1 --quiet --no-psqlrc "$@"; }

if ! psql_q -c 'select 1' >/dev/null 2>&1; then
  echo "НЕ МОГУ подключиться к $DB_URL"
  echo "Запустите локальный стек:  supabase start"
  exit 1
fi

if [[ $KEEP -eq 0 ]]; then
  echo "== сношу public и политики storage, созданные этими миграциями =="
  psql_q <<'SQL' >/dev/null
drop schema if exists public cascade;
create schema public;

-- ВАЖНО: восстановление дефолтных привилегий Supabase.
--
-- `drop schema ... cascade` уничтожает не только таблицы, но и запись
-- pg_default_acl для схемы public — а именно она в Supabase раздаёт права
-- ролям anon/authenticated/service_role на каждую новую таблицу. Без этого
-- блока все созданные миграциями таблицы оказываются без грантов вообще:
-- схема накатывается и линт проходит, но PostgREST отдаёт permission denied
-- на любой запрос из приложения, потому что роль authenticated не имеет прав
-- ни на одну таблицу. То есть локальная база выглядит рабочей, но приложение
-- против неё мертво — и это ровно тот случай, когда проверка врёт в
-- успокаивающую сторону.
--
-- На проде эти права есть (их выдают дефолтные привилегии Supabase при
-- создании проекта), поэтому восстановление обязательно для того, чтобы
-- локальный накат воспроизводил прод, а не свою собственную урезанную версию.
-- Обнаружено сверкой с supabase/_pulled/remote_schema_20260918.sql: там
-- гранты для anon/authenticated перечислены, а локально их не было.
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on all tables in schema public to postgres, anon, authenticated, service_role;
grant all on all routines in schema public to postgres, anon, authenticated, service_role;
grant all on all sequences in schema public to postgres, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on routines to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;

do $$
declare p text;
begin
  for p in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and (policyname like 'application_files_%'
               or policyname like 'content_media_%'
               or policyname like 'generated_documents_files_%')
  loop
    execute format('drop policy if exists %I on storage.objects', p);
  end loop;
end $$;
SQL
fi

fail=0
applied=0
for f in $(ls "$SQL_DIR"/[0-9][0-9]_*.sql | sort); do
  printf '  %-42s' "$(basename "$f")"
  if out=$(psql_q -f "$f" 2>&1); then
    echo "OK"
    applied=$((applied + 1))
  else
    echo "ОШИБКА"
    echo "$out" | sed 's/^/      /'
    fail=1
    break
  fi
done

if [[ $fail -eq 0 && -f "$SQL_DIR/seed_whitelist.sql" ]]; then
  printf '  %-42s' "seed_whitelist.sql"
  if out=$(psql_q -f "$SQL_DIR/seed_whitelist.sql" 2>&1); then echo "OK"; else echo "ОШИБКА"; echo "$out" | sed 's/^/      /'; fail=1; fi
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "Накат успешен: $applied файлов + seed."
  echo
  echo "== итог: объекты в public =="
  psql "$DB_URL" --no-psqlrc --quiet -c "
    select 'таблиц: ' || count(*) from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE'
    union all
    select 'вьюх: ' || count(*) from information_schema.views where table_schema='public'
    union all
    select 'типов: ' || count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace
      where n.nspname='public' and t.typtype='e'
    union all
    select 'функций: ' || count(*) from information_schema.routines where routine_schema='public'
    union all
    select 'политик: ' || count(*) from pg_policies where schemaname='public'"

  # Права для authenticated/anon — отдельная проверка, а не строка в списке
  # выше. Без грантов схема накатывается и линт проходит, но приложение
  # получает permission denied: молчаливо сломанное состояние, которое по
  # одному количеству объектов не видно. Проверяем ровно то, от чего зависит
  # работоспособность фронтенда.
  #
  # Именно эти две таблицы, а не telegram_login_tokens: на неё права намеренно
  # отзываются (см. 24_*), поэтому как индикатор она не годится.
  echo
  if [[ "$(psql "$DB_URL" --no-psqlrc -At -c "
        select has_table_privilege('authenticated', 'public.applications', 'select')
           and has_table_privilege('authenticated', 'public.people', 'select')
           and has_schema_privilege('anon', 'public', 'usage')")" == "t" ]]; then
    echo "== права ролей: OK (гранты authenticated/anon на месте) =="
  else
    echo "== права ролей: ПРОБЛЕМА — у authenticated/anon нет грантов =="
    echo "   Схема накатилась, но приложение против неё не заработает: PostgREST"
    echo "   вернёт permission denied. Проверьте блок восстановления"
    echo "   pg_default_acl в этом скрипте (после 'create schema public')."
    fail=1
  fi
else
  echo "Накат ПРОВАЛЕН на файле выше."
fi
exit $fail
