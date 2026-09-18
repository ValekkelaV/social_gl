# Свести GitHub, Supabase и артефакты Claude Web в один локальный рабочий каталог для «СоцПоляны»

**Date:** 2026-09-18
**Status:** IN PROGRESS
**Bead(s):** none
**Epic:** none
**Chain:** `standalone-cbf1cb40` seq `1`
**Parent:** `none — first in chain`
**Prior chain:** none — first in chain

---

## Reference Documents

- `CLAUDE.md` — соглашения проекта (написан в этой сессии, ~93 строки)
- `README.md` — как поднять проект без Claude (~119 строк)
- `docs/README.md` — индекс всей документации
- `docs/design/decisions.md` — **журнал решений и расхождений с продом, вырос до ~300 строк за сессию**
- `docs/design/schema-overview.md`, `docs/design/rls-model.md`, `docs/design/auth-telegram.md`
- `supabase/_pulled/remote_schema_20260918.sql` — снимок `supabase db pull`, 541 строка, **арбитр истины по продовой схеме**

---

## The Goal

Проект «СоцПоляна» (внутренняя админка оргкомитета конференции) вёлся в Claude Web: схема собиралась вставкой сгенерированных SQL-сниппетов в Supabase SQL Editor вручную (~20 штук, порядок нигде не зафиксирован), фронтенд жил отдельным репозиторием на GitHub. Три источника никогда не сверялись между собой.

Цель — свести GitHub-репозиторий, прод-базу Supabase и артефакты из чата в **один локальный рабочий каталог**, из которого владелец сможет вести проект **без Claude**. Критерий готовности: схема, фронтенд и проектная документация лежат в одном месте, самодостаточны и воспроизводимы с нуля.

Этап «консолидация + разбор расхождений» **завершён**. Осталась ручная часть на проде (накат двух миграций, удаление мёртвой функции, передеплой вебхука) — она требует доступа к Supabase Dashboard и Telegram Bot API, которых у агента нет.

---

## Where We Are

### Состояние репозитория

- Ветка `main`, рабочее дерево чистое (`git status -s` → 0 строк), всё запушено в `origin`.
- Remote переключён с HTTPS на SSH: `git@github.com:ValekkelaV/social_gl.git`.
- Последние 5 коммитов: `79e7d9e`, `6b05ed5`, `55cc81f` (merge PR #1, сделан владельцем), `dd93ec8`, `df7c42c`.
- Ветка `consolidate-workspace` **осталась лишней** — её содержимое полностью в `main` (два коммита перебазированы), но сама ветка живёт локально и на GitHub с версиями ДО перебазирования. Предложено удалить, ответа пока нет.

### Схема

- 24 файла `supabase/01..24_*.sql` + `seed_whitelist.sql` накатываются с нуля в чистую базу.
- Итог наката: **30 таблиц, 6 вьюх, 7 enum-типов, 11 функций, 67 политик**; `supabase db lint` → `No schema errors found`.
- Добавлено в этой сессии: `23_return_abstract_check.sql` (возврат CHECK на тезисы), `24_revoke_extra_grants.sql` (отзыв лишних привилегий у `anon`/`authenticated`).
- `05_applications.sql` исправлен под прод: вместо `course` → `education_level` + `course_number`.

### Скрипты

- `scripts/verify_schema.sh` — **починен в этой сессии**, см. «What We Tried» запись 0. Добавлена проверка грантов в конце.
- `scripts/strip_terminal_junk.py` — чистка SQL, сохранённого из терминала. Поддерживает `--check`, `--in-place`, stdout.
- `scripts/import_applications.py` (Google Forms, прошлый сезон), `scripts/import_applications_v2.py` (Yandex Forms, текущий). Оба генерируют SQL-файл, а не пишут в БД.
- `scripts/extract_abstract_text.py`, `scripts/backfill_file_links.py`, `scripts/archive/import_applications_v1_older.py`.

### Что работает и проверено

- Полный накат с нуля: `./scripts/verify_schema.sh` → «Накат успешен: 24 файлов + seed.» + «права ролей: OK».
- Ограничение на тезисы реально отбивает вставку: `ERROR: new row for relation "applications" violates check constraint "applications_check"`.
- Вход через Telegram как `anon` проходит целиком: `create_login_token()` вернул `37a75f4e31b5…`, затем `check_login_token()` вернул `verified / deadbeef`.
- Прямой `select` из `telegram_login_tokens` отбивается у обеих ролей: `ERROR: permission denied for table telegram_login_tokens`.
- Вебхук: вопрос «отдаёт ли 401» **закрыт владельцем вручную — вход работает**.

### Что НЕ сделано на проде (ручные шаги, у агента нет доступа)

1. Диагностический `select` на заявки без тезисов (**до** наката 23).
2. Накат `23`, затем `24` в Supabase SQL Editor.
3. `drop function if exists public.check_login_token_v2(text);`
4. `supabase functions deploy telegram-webhook --no-verify-jwt` (дебаг убран в коде, но на проде старая версия).

### Окружение

- WSL2 (`Linux 6.6.87.2-microsoft-standard-WSL2`), Docker 29.8.0, `supabase` CLI, Postgres 17.
- Локальный стек **погашен** (`supabase stop`) в конце сессии.
- Supabase project ref: `rehoflpusdlutvxfrjyh` («soc-gl»).
- SSH-ключ `~/.ssh/id_ed25519` (ed25519, **без парольной фразы**), добавлен владельцем на GitHub.
- git identity задана **локально в репозитории**: `Vale <vshelkovkin49@gmail.com>` (глобальной не было вообще).

---

## What We Tried (Chronological)

### 0. Локальная сборка не воспроизводила прод по правам (НАЙДЕНО И ПОЧИНЕНО в этой сессии)

- **Гипотеза:** после разбора грантов на `telegram_login_tokens` возник вопрос «а как вообще `anon` получил права, если миграции грантов не содержат?» — значит их раздаёт что-то неявное, и стоит проверить, работает ли это неявное локально.
- **Проверка:** `select ... from pg_default_acl where nspname='public'` → `—НЕТ—`. Создание пробной таблицы: `create table public._acl_probe(id int)` → `новая таблица сейчас: —ACL пустой—`.
- **Результат:** подтверждено. `scripts/verify_schema.sh` делал `drop schema public cascade; create schema public;`, и **это уничтожало запись `pg_default_acl`** для схемы — ту самую, которой Supabase раздаёт права ролям на новые таблицы.
- **Следствие:** в локально собранной базе у `authenticated` не было прав **ни на одну таблицу**. Схема накатывалась, `db lint` проходил, 30 таблиц на месте — а приложение против такой базы получило бы `permission denied` на любой запрос. **Проверка врала в успокаивающую сторону, что хуже всего остального.**
- **Фикс:** после `create schema public` добавлен блок восстановления — 4 `grant` + 3 `alter default privileges for role postgres in schema public`. Плюс в конец скрипта добавлена **явная проверка грантов**, чтобы дыра не вернулась молча: проверяет `has_table_privilege('authenticated','public.applications','select')`, то же для `people`, и `has_schema_privilege('anon','public','usage')`.
- **Почему это важно для следующей сессии:** это был самый серьёзный дефект сессии. Любая будущая правка `verify_schema.sh`, затрагивающая пересоздание схемы, должна сохранять этот блок.

### 1. Консолидация: клон был устаревшим на 12 дней

- **Гипотеза:** локальный `/home/vs/social_gl` — актуальная копия.
- **Проверка:** `.git/logs/HEAD` содержал ровно одну запись (первоначальный клон), `.git/FETCH_HEAD` не существовал → `git fetch` никогда не запускался. Timestamp клона `1788693139` = 6 сентября 2026 14:12 +0300, совпадает с mtime файлов.
- **Результат:** GitHub ушёл вперёд на 12 дней, 45 коммитов, изменения чисто аддитивные → reconciliation через `--ff-only`. **Критично: `frontend/` появился уже после клона** и локально отсутствовал.
- **Ошибка агента, которую владелец исправил:** агент заявил «фронтенда нет». Владелец ответил: «Wdym there is no frontend im literally looking at it rn: https://github.com/ValekkelaV/social_gl/tree/main/frontend». Причина — вывод о remote-факте из локального рабочего дерева. **Урок: не выводить состояние удалённого репозитория из локальной копии, не проверив `FETCH_HEAD`/логи.**

### 2. Дедупликация SQL-корпуса

- **Найдено и удалено:** 3 файла по 0 байт (прерванные первые попытки, вытесненные более поздними версиями), 5 побайтовых дубликатов (`md5sum` подтвердил), случайная вложенность `supabase/supabase/`, артефакты `*:Zone.Identifier` (метки Windows/WSL «скачано из интернета»).
- **Дубликаты `supabase/migrations/20260101000001–12` оказались побайтово идентичны `01–12`** — удалены вместе с самим каталогом `migrations/`, потому что выбран плоский формат.

### 3. Чистка мусора из SQL — ЧЕТЫРЕ неудачные попытки подряд

Это самая дорогая для повторного открытия часть сессии. Файлы `20260918*` были **захвачены из вида терминала, а не выгружены чисто** — каждый начинался с escape-последовательностей и кадров спиннера.

- **Попытка 1 — провал.** Предположил, что глифы спиннера лежат в braille-диапазоне `U+2800–U+28FF`. Не сработало: это **geometric shapes `U+25D0–U+25D3`** (`◐◓◑◒`), совсем другой блок.
- **Попытка 2 — провал.** Чистильщик снимал ведущие пробелы со **каждой** строки — де-индентировал весь файл.
- **Попытка 3 — провал.** Регулярка `^(--|create|alter|...)\b` **не могла совпасть с `--`**: дефис и следующий за ним пробел оба не-словесные символы, границы слова `\b` там нет. В результате шапка-комментарий молча выбрасывалась. Фикс — `--` отдельной альтернативой без `\b`:

```python
SQL_LINE_RE = re.compile(
    r"^(--"
    r"|(create|alter|drop|insert|comment|grant|revoke|set|begin|do|select|with|update|delete)\b"
    r")",
    re.IGNORECASE,
)
DRAWING_RANGES = ((0x2500, 0x257F), (0x25A0, 0x25FF), (0x2800, 0x28FF))
#                 box drawing        geometric           braille
```

- **Попытка 4 — успех.** Итог: `13/14/15/16/17` подтверждены как **ИДЕНТИЧНЫЕ** своим remote-аналогам (значит, они уже были в GitHub чистыми, а локальные замусоренные копии — дубликаты).

### 4. Ошибка в скрипте сравнения dump vs repo

- **Симптом:** каждый файл из `/dump` тривиально совпадал сам с собой.
- **Причина:** обход начинался с `.`, а `dump` лежит внутри `.` → self-match.
- **Фикс:** исключить `dump` из обхода репозитория. После исправления показались реальные различия.

### 5. `supabase start` падал на сиде

- **Ошибка:** `LegacyMigrationSeedError: relation "whitelisted_usernames" does not exist`.
- **Причина:** сид выполняется **до** создания схемы, потому что `supabase/migrations/` пуст (миграции плоские).
- **Фикс:** два действия — `seed.sql` переименован в `seed_whitelist.sql`, и в `config.toml` выставлено `[db.seed] enabled = false` с `sql_paths = []`. После этого `supabase start` прошёл.
- **Важно:** это не временный костыль, а следствие выбранного формата миграций. Задокументировано в `README.md` и в шапке `config.toml`.

### 6. Разбор «diff-документов» — агент ошибся в трактовке

- **Гипотеза:** упомянутые владельцем «diff documents» — конфликтующие версии одного документа.
- **Реальность:** `wiring_diff.md`, `applications_wiring_diff.md`, `webhook_diff_preferred_name.md` — это **инструкции по подключению** («заменить строку X на Y»), а не версии спецификации. Лежат в `docs/wiring/`.
- **Следствие:** в `docs/README.md` и `CLAUDE.md` зафиксировано: файл в `docs/wiring/` — это **патч, а не документ**; пока он лежит там, правка в коде **не сделана**.

### 7. Разбор расхождений с продом (арбитр — `supabase/_pulled/remote_schema_20260918.sql`)

Четыре спорных имени колонок разрешены в пользу прода. Дальше остались три вопроса, все закрыты решениями владельца:

- **`applications_check`** — `alter table applications drop constraint applications_check` есть в проде, миграции со снятием нет. Косвенная улика, зачем снимали: оба импортёра содержат ровно эту проверку и пишут «заявка не пройдёт check-constraint в БД». Решение владельца: **вернуть** (форма Yandex Forms тезисы требует, значит правило пришло от неё). → миграция `23`.
- **`check_login_token_v2`** — на проде есть, в файлах нет, **сломана**: параметр называется `token`, тело обращается к `p_token`; пишет в колонку `status`, которой нет (есть `token_status`); возвращает `(text,text)` при объявленном `(boolean,uuid)`. Остаток брошенного переписывания входа. Решение: **удалить с прода**, в файлы намеренно не переносить.
- **`pg_net`** — `drop extension if exists "pg_net"` на проде, в миграциях не создаётся. Действий не требует.
- **Гранты `anon`** — 21 грант (7 привилегий × 3 роли) на `telegram_login_tokens` и `whitelisted_usernames`. Решение: **сделать гигиену**. → миграция `24`.

### 8. Дебаг, печатавший секрет

- Найден `console.log("DEBUG TELEGRAM_WEBHOOK_SECRET:", ...)` в вебхуке, с комментарием «убрать после того, как разберёмся с несовпадением secret_token».
- **Оценка риска:** функция задеплоена с `--no-verify-jwt` и вызывается кем угодно из интернета; знающий секрет мог прислать поддельный апдейт и получить `session_hashed_token` → вход под чужим аккаунтом из вайтлиста. Не косметика.
- **Решение владельца:** убрать дебаг; секрет менять сейчас не надо, потому что проект на дев-тестировании и **перед итоговым запуском все секреты обновятся разом**.

### 9. Настройка git-аутентификации

- `git commit` падал: `Author identity unknown`. Глобальной identity не было вообще. Поставлена **локальная** в репозитории — та же, что в существующих коммитах: `Vale <vshelkovkin49@gmail.com>`.
- `git push` падал: `could not read Username for 'https://github.com': terminal prompts disabled`. В окружении нет ни `gh`, ни credential helper, ни `~/.git-credentials`.
- **Решение:** сгенерирован SSH-ключ `~/.ssh/id_ed25519` (`ssh-keygen -t ed25519 -C "vshelkovkin49@gmail.com" -N "" -q`), владелец добавил публичную половину на GitHub, remote переключён на SSH. Отпечаток: `SHA256:gaU/uCvdO15GXaVP0Xi2NAaJ9I2+SsRMW+adnktYE8Y`.
- **Компромисс:** ключ **без парольной фразы**. С фразой потребовался бы `ssh-agent`, живущий между вызовами инструментов, — в этом окружении он не выживает, и пушить агент бы не смог. Владелец про компромисс уведомлён.

### 10. Пуш в main отклонён — владелец сам влил PR

- Локальный `main` влил ветку через `--ff-only`, но `git push` отбился.
- **Причина:** владелец параллельно влил PR #1 на GitHub → `origin/main` стал merge-коммитом `55cc81f`, и мои два последних коммита на него не вставали (дивергенция).
- **Фикс:** `git pull --rebase origin main` → коммиты перебазированы на `55cc81f`, история линейная. Хеши сменились: `4130c87` → `6b05ed5`, `49b141c` → `79e7d9e`.
- **Урок:** перед пушем в `main` всегда делать `git fetch` — владелец активно работает через веб-интерфейс GitHub.

---

## Key Decisions

- **Плоские `NN_name.sql` вместо `supabase/migrations/`.** Формат совпадает с GitHub, и файлы удобно вставлять в SQL Editor вручную — а это основной способ наката на прод. Цена: `supabase db reset`/`db push` их не видят, нужен свой скрипт (`verify_schema.sh`). **Отвергнуто:** конвертация в CLI-формат с timestamp-именами.
- **`reset.sql` вынесен в `_maintenance/`.** `00_drop_all.sql` сносит всю схему вместе с `supabase_migrations` — в последовательности миграций уничтожил бы базу. **Никогда не входит в накат.**
- **Автосид выключен в `config.toml`.** Иначе `supabase start` падает, т.к. схема к моменту сида ещё не создана.
- **Применённую к проду миграцию не редактируют — только новая.** Поэтому `personal_email` лежит в `22`, а не дописан в `20`. То же соображение → `23` и `24` отдельными файлами.
- **Arbiter истины по схеме — `supabase db pull`, а не файлы и не память.** Расхождения разрешались в пользу прода. **Важно:** снимок `db pull` — это **дельта относительно миграций, а не полный слепок**, поэтому полный диф «прод против файлов» построить нельзя.
- **Обе версии импортёра оставлены.** Это не «v1 и v2 одного и того же», а **разные форматы формы**: у Google-варианта значения разделены запятыми внутри полей, у Yandex-варианта делимитеров нет вообще.
- **`docs/wiring/` — патчи, а не документация.** Неперенесённый патч = открытая задача.
- **`23` возвращает CHECK, а не закрепляет его отсутствие.** Обоснование: правило пришло от формы, а не выдумано в БД; снятие на проде было операционным (мешало импорту), а не смысловым.
- **`24` обрабатывает две таблицы по-разному.** `telegram_login_tokens` — политик нет вообще, отозвано всё. `whitelisted_usernames` — политики есть, поэтому у `authenticated` отозваны только `truncate`/`trigger`/`references`: снять `select`/`insert`/`update`/`delete` значило бы сломать страницу вайтлиста, потому что **грант и политика нужны вместе** (грант решает «может ли роль в принципе», политика — «какие строки»).
- **Секреты сейчас не ротируются.** Проект на дев-тестировании, доступ к дашборду только у владельца, все секреты обновятся разом перед итоговым запуском. Записано в `docs/design/decisions.md` и в память, чтобы это не выглядело недосмотром.
- **SSH-ключ без парольной фразы** — сознательный компромисс ради возможности пушить (см. What We Tried №9).

---

## Evidence & Data

### Таблица 1. Итог наката схемы

| Момент | Файлов | Таблиц | Вьюх | Типов | Функций | Политик | `db lint` |
|---|---|---|---|---|---|---|---|
| После консолидации | 22 + seed | 30 | 6 | 7 | 11 | 67 | No schema errors found |
| После миграций 23, 24 | 24 + seed | 30 | 6 | 7 | 11 | 67 | No schema errors found |

### Таблица 2. Коммиты сессии

| Хеш | Тема | Примечание |
|---|---|---|
| `df7c42c` | Свести GitHub, Supabase и артефакты чата в один рабочий каталог | 61 файл, +4208/−2 |
| `dd93ec8` | Документация: как устроен проект и что расходится с продом | |
| `55cc81f` | Merge pull request #1 from ValekkelaV/consolidate-workspace | **сделан владельцем на GitHub**, не агентом |
| `6b05ed5` | Починить расхождения с продом: ограничение тезисов, права, дебаг вебхука | был `4130c87` до rebase |
| `79e7d9e` | Зафиксировать решение по секретам: ротация перед итоговым запуском | был `49b141c` до rebase |

### Таблица 3. Гранты `anon`/`authenticated` — до и после

| Таблица | До миграции 24 | После |
|---|---|---|
| `applications` (обычная) | все 7 привилегий обеим ролям | **не тронуто** (все 7, включая MAINTAIN) |
| `telegram_login_tokens` | anon: все 7; auth: все 7 | `—нет—` для обеих |
| `whitelisted_usernames` | anon: все 7; auth: все 7 | anon: `—нет—`; auth: `DELETE,INSERT,SELECT,UPDATE` |

### Таблица 4. Дефект с `pg_default_acl` — прямые замеры

| Проверка | До починки | После починки |
|---|---|---|
| `pg_default_acl` для схемы `public` | `—НЕТ—` | восстановлен |
| ACL только что созданной таблицы | `—ACL пустой—` | 7 привилегий × 3 роли |
| `has_table_privilege('authenticated','public.applications','select')` | `false` → приложение не работает | `true` |

### Таблица 5. Проверки поведения после миграций 23 и 24

| Проверка | Команда | Результат |
|---|---|---|
| Ограничение существует и валидно | `select conname, convalidated, pg_get_constraintdef(oid) from pg_constraint where conname='applications_check'` | `applications_check \| validated=true \| CHECK (((abstract_text IS NOT NULL) OR (abstract_file_url IS NOT NULL)))` |
| Вставка без тезисов отбивается | `insert into applications (title) values ('тест без тезисов')` | `ERROR: new row for relation "applications" violates check constraint "applications_check"` |
| Вход как `anon` | `set local role anon; select create_login_token()` | токен `37a75f4e31b5…` создан |
| Опрос токена как `anon` | `select * from check_login_token('<token>')` | `verified / deadbeef` |
| Прямой доступ `anon` | `select count(*) from telegram_login_tokens` | `ERROR: permission denied for table telegram_login_tokens` |
| Прямой доступ `authenticated` | то же | `ERROR: permission denied for table telegram_login_tokens` |

### Таблица 6. Удалено при консолидации

| Что | Сколько | Почему |
|---|---|---|
| Пустые файлы (0 байт) | 3 | Прерванные первые попытки, вытеснены более поздними версиями |
| Побайтовые дубликаты | 5 | `md5sum` подтвердил идентичность |
| `supabase/supabase/migrations/` | каталог | Случайная вложенность (CLI запускали изнутри `supabase/`) |
| `supabase/migrations/20260101000001–12` | 12 файлов | Побайтово идентичны `01–12`; каталог `migrations/` не нужен при плоском формате |
| `*:Zone.Identifier` | все | Метки Windows/WSL «скачано из интернета» |
| `dump/` | каталог | Разобран и удалён с одобрения владельца |

### Таблица 7. Файлы документации, написанные в сессии

| Файл | Строк | Содержание |
|---|---|---|
| `CLAUDE.md` | 93 | Соглашения: русские комментарии, плотность комментирования SQL, `NN_name.sql`, модель RLS, `reset.sql` вне наката |
| `README.md` | 119 | Как запускать; плоские миграции и два их следствия |
| `docs/README.md` | 60 | Индекс документации |
| `docs/design/schema-overview.md` | ~137 | 30 таблиц по пяти блокам |
| `docs/design/rls-model.md` | 133 | Три уровня доступа + две реальные ловушки Postgres |
| `docs/design/auth-telegram.md` | 128 | Deep-link вход, схема потока, деплой |
| `docs/design/decisions.md` | ~300 | Журнал решений и расхождений |

### Таблица 8. Ключевые строки-улики из снимка прода

```sql
-- снятое на проде ограничение (миграции со снятием нет):
alter table "public"."applications" drop constraint "applications_check";

-- сломанный черновик функции на проде:
CREATE OR REPLACE FUNCTION public.check_login_token_v2(token text)
 RETURNS TABLE(valid boolean, user_id uuid)
 ...
  set status = 'expired'        -- колонки status нет, есть token_status
  where t.token = p_token       -- параметра p_token нет в сигнатуре
```

### Таблица 9. Все 24 миграции: что в каждой (по шапкам файлов)

Прочитано из `head -6` каждой. Это карта корпуса — восстанавливать её заново дорого.

| № | Файл | Тема | Ключевой момент из шапки |
|---|---|---|---|
| 01 | `01_committees_tickets.sql` | Комитеты, роли, тикеты | MVP-этап 1 (декабрь) |
| 02 | `02_rls_policies.sql` | RLS комитетов/членства/тикетов | **Самый крупный файл, треть — объяснения.** Здесь определены хелперы |
| 03 | `03_content_plan.sql` | Контент-план | `content_status` enum: idea/draft/ready/scheduled/published |
| 04 | `04_content_plan_rls.sql` | RLS контент-плана | «Любой член оргкомитета — полный доступ, без привязки к комитету» |
| 05 | `05_applications.sql` | Раздел «Секции» — заявки | MVP-этап 3 (к приёму заявок, конец февраля/7 марта). **Изменён под прод: `education_level` + `course_number`** |
| 06 | `06_applications_rls.sql` | RLS заявок | Читают все; массовая рассылка фидбека — только лид комитета «Отбор заявок» (имя строкой!) |
| 07 | `07_scheduling.sql` | Секции/слоты | MVP-этап 4 (к марту) |
| 08 | `08_scheduling_rls.sql` | RLS расписания | Запись ограничена по типу сущности |
| 09 | `09_communications.sql` | Коммуникации | **Только шаблоны.** Отправка — вручную через CSV → Unisender. API-интеграции нет намеренно |
| 10 | `10_communications_rls.sql` | RLS `email_templates` | К `mailing_recipients` (view) отдельных политик нет — регулируется базовыми таблицами |
| 11 | `11_document_generation.sql` | Генерация документов | MVP-этап 5 (к апрелю). **Документы на LIVE-данных, без снэпшотов** — принятый риск |
| 12 | `12_document_generation_rls.sql` | RLS генерации | Кто генерирует — в контексте не уточнено, разные типы → разные права |
| 13 | `13_storage_buckets.sql` | Storage-бакеты | **Три бакета по типу файлов**, чтобы не разбирать префиксы пути внутри одного |
| 14 | `14_auth_whitelist.sql` | Вайтлист Telegram-username | Закрытый список; вход только для внесённого заранее |
| 15 | `15_auth_whitelist_rls.sql` | RLS вайтлиста | Читают все в оргкомитете, пишет только владелец |
| 16 | `16_rls_fixer.sql` | **Исправления после ревью 02 и 10** | 20 строк кода / ~25 строк объяснения — образец стиля комментирования |
| 17 | `17_telegram-deep-link-login.sql` | Deep-link + бот-вебхук | **Заменяет JS-виджет `oauth.telegram.org`**, который оказался ненадёжным |
| 18 | `18_whitelist_display_name.sql` | `preferred_full_name` в вайтлисте | Задать имя до первого входа; у части людей из Telegram имя латиницей/ником |
| 19 | `19_abstract_file_has_images.sql` | Флаг «в файле есть картинки» | Извлечение текста не переносит встроенные изображения — читающему надо знать |
| 20 | `20_speakers_city.sql` | Город докладчика | Вынесен из свободного текста `university_raw` («НИУ ВШЭ, Москва») в отдельную колонку |
| 21 | `21_phone_required_note.sql` | Телефон обязателен для новых заявок | Прямой `set not null` упал бы на старых заявках с NULL — поэтому через note/валидацию |
| 22 | `22_personal_email.sql` | Личный email докладчика | На него идёт именной сертификат; отличается от `applications.contact_email` (общий на заявку) |
| 23 | `23_return_abstract_check.sql` | **Возврат ограничения «тезисы обязательны»** | `drop if exists` → `add ... not valid` → `validate` |
| 24 | `24_revoke_extra_grants.sql` | **Отзыв лишних грантов у `anon`/`authenticated`** | Две таблицы обработаны по-разному (см. Таблицу 3) |

Плюс `seed_whitelist.sql` — данные вайтлиста, не миграция, но входит в накат.

### Таблица 10. Патчи `docs/wiring/` — актуальный статус

**Важная поправка к более раннему выводу:** из трёх патчей **два уже применены**. Открыт только один.

| Патч | Что меняет | Статус | Доказательство |
|---|---|---|---|
| `committees-page.md` | Импорт + `<Route path="/committees" .../>` в `App.jsx`, пункт `NAV_ITEMS` в `NavShell.jsx` | **ПРИМЕНЁН** | `App.jsx:37` содержит роут; `NavShell.jsx:12` содержит `{ to: "/committees", label: "Комитеты" }`; `CommitteesPage.jsx` лежит в `pages/` (366 строк) |
| `applications-page.md` | `<Route path="/applications" .../>` → `/applications/*` | **ПРИМЕНЁН** | `App.jsx:34`: `<Route path="/applications/*" element={<ApplicationsPage />} />` |
| `telegram-webhook-preferred-name.md` | 2 правки в `supabase/functions/telegram-webhook/index.ts` | **НЕ ПРИМЕНЁН** | `grep -n preferred_full_name` по файлу → **не найдено**; строка 136 всё ещё `.select("username")` |

Содержание открытого патча (дословно, чтобы следующая сессия не открывала файл):

```ts
// 1. Проверка вайтлиста — забираем ещё и preferred_full_name:
   .select("username, preferred_full_name")     // было: .select("username")

// 2. При создании нового people — предпочитаем preferred_full_name:
const fullName =
  whitelistEntry.preferred_full_name?.trim() ||
  [from.first_name, from.last_name].filter(Boolean).join(" ") ||
  telegramUsername;
```

Найденные строки для правки: `index.ts:136` (select) и блок присвоения `fullName` ниже по файлу. После правки — `supabase functions deploy telegram-webhook --no-verify-jwt`.

### Таблица 11. Фронтенд: роуты и состояние страниц

Framework: **Vite + React 18 + Tailwind 3 + react-router-dom 6** (не Next.js — та попытка в `docs/archive/nextjs-frontend/`).

| Роут | Компонент | Строк | Состояние |
|---|---|---|---|
| `/login` | `auth/LoginPage.jsx` | — | Вне `NavShell` — не требует авторизации |
| `/` (index) | `<Navigate to="/tickets" replace />` | — | |
| `/tickets` | `TicketsPage.jsx` | 161 | Сделано |
| `/tickets/new` | `CreateTicketPage.jsx` | 213 | Сделано |
| `/tickets/:id` | `TicketDetailPage.jsx` | 234 | Сделано |
| `/content-plan` | `ContentPlanPage.jsx` | **8** | **Заглушка** |
| `/applications/*` | `ApplicationsPage.jsx` | 602 | Сделано, со вложенными роутами |
| `/scheduling` | `SchedulingPage.jsx` | **8** | **Заглушка** |
| `/documents` | `DocumentsPage.jsx` | **8** | **Заглушка** |
| `/committees` | `CommitteesPage.jsx` | 366 | Сделано |
| `*` | `<Navigate to="/" replace />` | — | |

`NAV_ITEMS` (`NavShell.jsx:6-13`) — 6 пунктов: Тикеты, Контент-план, Заявки, Секции и расписание, Документы, Комитеты.

Остальные файлы `frontend/src/`: `App.jsx`, `main.jsx`, `index.css`, `supabaseClient.js`, `auth/{AuthContext,LoginPage,RequireAuth}.jsx`, `layout/NavShell.jsx`. В корне `frontend/`: `vercel.json` (SPA-rewrite), `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `package.json`, `package-lock.json`.

**Итого три заглушки по 8 строк** — «Контент-план», «Секции и расписание», «Документы». Схема под них есть (миграции 03/04, 07/08, 11/12), UI нет. По `CLAUDE.md` их **не «улучшать» заранее**.

### Таблица 12. Хелперы RLS — сигнатуры

Все — `security definer` (чтобы проверка внутри политики не упиралась в RLS той же таблицы).

| Хелпер | Сигнатура | Способ поиска комитета |
|---|---|---|
| `is_owner` | `(p_person uuid)` | по флагу в `people` |
| `is_any_lead` | `(p_person uuid)` | по `committee_memberships` |
| `is_committee_lead` | `(p_person uuid, p_committee uuid)` | по id комитета |
| `is_committee_member` | `(p_person uuid, p_committee uuid)` | по id комитета |
| `is_selection_committee_lead` | — | **по имени строкой:** `c.name = 'Отбор заявок'` |
| `is_schedule_committee_member` | — | **по имени строкой:** `c.name = 'Расписание секций'` |
| `is_moderators_committee_member` | — | **по имени строкой:** `c.name = 'Модераторы/лекции/круглые столы'` |

Последние три — хрупкие: переименование комитета в UI **молча** ломает права. Осознанный компромисс MVP, но при работе с комитетами про это надо помнить.

### Таблица 13. Точки взаимодействия в вебхуке (для патча `preferred_full_name`)

| Строка | Что делает |
|---|---|
| `index.ts:133-138` | Проверка вайтлиста: `.from("whitelisted_usernames").select("username").ilike("username", telegramUsername).maybeSingle()` — **сюда добавляется `preferred_full_name`** |
| `index.ts:206-211` | Пометка приглашения использованным: `.update({ used_at: new Date().toISOString() }).ilike("username", ...).is("used_at", null)` |

### Таблица 14. Инвентарь `docs/` — где что лежит

| Путь | Что это | Статус |
|---|---|---|
| `docs/README.md` | Индекс всей документации | Актуален |
| `docs/design/schema-overview.md` | 30 таблиц по пяти блокам | Актуален |
| `docs/design/rls-model.md` | Три уровня доступа + две ловушки Postgres | Актуален |
| `docs/design/auth-telegram.md` | Deep-link вход: ASCII-схема потока, вайтлист, деплой | Актуален |
| `docs/design/decisions.md` | **Журнал решений и расхождений с продом** — ключевой документ сессии | Актуален |
| `docs/design/next_year_form_design.md` | Проектирование формы следующего сезона | Из артефактов, не сверялся |
| `docs/ops/drive_service_account_setup.md` | Настройка сервисного аккаунта Google Drive | Из артефактов |
| `docs/wiring/*.md` (3 шт.) | **Патчи, а не документы** (см. Таблицу 10) | 2 применены, 1 открыт |
| `docs/archive/nextjs-frontend/` (20 файлов) | Заброшенная попытка на Next.js | **Не воскрешать** — зафиксировано в `CLAUDE.md` |
| `docs/archive/raw/*.sql` (3 шт.) | Вытесненные версии миграций: `05_..._superseded_course.sql`, `17_..._superseded_status.sql`, `18_..._superseded_display_name.sql` | Архив, не накатывать |

### Таблица 15. Инвентарь `scripts/`

| Файл | Назначение | Нюанс |
|---|---|---|
| `verify_schema.sh` | Накат 24 файлов + seed в чистую базу + `db lint` + проверка грантов | **Починен в этой сессии** (блок восстановления `pg_default_acl` + ассерт прав в конце) |
| `import_applications.py` | **Google Forms** CSV → SQL INSERT. Прошлый сезон | Значения разделены запятыми **внутри** полей. Изменён: fallback `find_column(fieldnames, "ссылк")` |
| `import_applications_v2.py` | **Yandex Forms** → SQL INSERT. Текущий сезон | Делимитеров нет вообще. Не «версия 2 того же» — другой формат формы |
| `scripts/archive/import_applications_v1_older.py` | Ещё более ранняя версия | Архив |
| `strip_terminal_junk.py` | Чистка SQL, сохранённого из терминала. Режимы `--check` / `--in-place` / stdout | Результат 4 итераций, см. «What We Tried» №3 |
| `extract_abstract_text.py` | Батч-извлечение текста тезисов (docx/pdf) → `abstract_text` | Отсюда взялся `abstract_file_has_images` (миграция 19) |
| `backfill_file_links.py` | Бэкфилл ссылок на файлы | |
| `scripts/__pycache__/` | Артефакт запуска Python | **Должен быть в `.gitignore`** |

---

## Code Analysis

- **Хелперы RLS** (`02_rls_policies.sql`), все `security definer` — чтобы проверка внутри политики не упиралась в RLS той же таблицы: `is_owner(p_person)`, `is_any_lead(p_person)`, `is_committee_lead(p_person, p_committee)`, `is_committee_member(p_person, p_committee)`.
- **Три хелпера ищут комитет по имени строкой** — `is_selection_committee_lead` (`c.name = 'Отбор заявок'`), `is_schedule_committee_member` (`'Расписание секций'`), `is_moderators_committee_member` (`'Модераторы/лекции/круглые столы'`). **Хрупко:** переименование комитета в UI молча ломает права. Осознанный компромисс MVP.
- **Две ловушки Postgres, задокументированные в `docs/design/rls-model.md` и `16_rls_fixer.sql`:**
  1. Permissive-политики комбинируются через OR **отдельно для `USING` и отдельно для `WITH CHECK`**, а не парами «своя политика целиком». В паре `people_update_self` / `people_update_owner` второй `WITH CHECK` был безусловным `true` → любой пользователь, обновляющий свою же строку, проходил общий `WITH CHECK` и мог выставить себе `is_owner = true`.
  2. `for all` с `with check (created_by = auth.uid())` ломает UPDATE чужих строк: `created_by` в new-версии не меняется и не равен `auth.uid()` → редактировать шаблон мог только автор. Разделено на insert/update/delete.
- **`telegram_login_tokens` — намеренно без единой RLS-политики.** Доступ только через `security definer` функции (`create_login_token`, `check_login_token`, обе с `grant execute to anon, authenticated`) и service role вебхука. Контроль доступа построен на **знании секрета**: `check_login_token(p_token)` отдаёт `session_hashed_token` только тому, кто знает точное значение токена (24 случайных байта), а функции его не перечисляют. **Следствие для будущих правок:** любая новая `security definer` функция на этой таблице автоматически становится частью периметра безопасности.
- **RLS покрывает `SELECT`/`INSERT`/`UPDATE`/`DELETE`, но НЕ `TRUNCATE`** — отсюда смысл миграции 24. Сегодня не эксплуатируется (`anon` не может выполнить сырой SQL, PostgREST не отдаёт эндпоинта для `TRUNCATE`), взорвалось бы при появлении `security definer` функции с динамическим SQL, доступной `anon`.
- **«Весь оргкомитет» выражается как `exists (select 1 from people where id = auth.uid())`.** `people` — только оргкомитет (25–30 человек); докладчики живут в `speakers` и **никогда не логинятся**.
- **Бакеты приватные** (`public = false`), доступ через политики на `storage.objects`. `public = true` открыл бы файлы всему интернету без авторизации.

---

## Files Changed

### Документация (новая)
- `CLAUDE.md` — соглашения проекта
- `README.md` — как работать без Claude
- `docs/README.md` — индекс документации
- `docs/design/schema-overview.md` — 30 таблиц по блокам
- `docs/design/rls-model.md` — модель прав + две ловушки
- `docs/design/auth-telegram.md` — вход через Telegram
- `docs/design/decisions.md` — **журнал решений; правился многократно, ключевой документ сессии**

### Схема (новая/изменённая)
- `supabase/23_return_abstract_check.sql` — **новый.** Возврат CHECK: `drop if exists` → `add ... not valid` → `validate`. Идемпотентно для прода и чистой базы.
- `supabase/24_revoke_extra_grants.sql` — **новый.** Отзыв привилегий; две таблицы обработаны по-разному.
- `supabase/05_applications.sql` — **изменён.** `course` → `education_level` + `course_number` под прод.
- `supabase/18..22_*.sql` — новые (из артефактов дампа).
- `supabase/seed_whitelist.sql` — переименован из `seed.sql`.
- `supabase/config.toml` — `[db.seed] enabled = false`.
- `supabase/_maintenance/reset.sql`, `supabase/_pulled/remote_schema_20260918.sql`, `supabase/sql-checks/*` (5 файлов).

### Скрипты
- `scripts/verify_schema.sh` — **изменён дважды.** Добавлен блок восстановления `pg_default_acl` (после `create schema public`) и проверка грантов в конце. Второе по важности изменение сессии после миграции 23.
- `scripts/strip_terminal_junk.py` — новый.
- `scripts/import_applications.py` — **изменён:** `find_column(fieldnames, "файл", "тезис") or find_column(fieldnames, "ссылк")` — старый вариант требовал ОБА слова одновременно и пропускал заголовки вида «Файл (Google Drive)».
- `scripts/import_applications_v2.py`, `scripts/extract_abstract_text.py`, `scripts/backfill_file_links.py`, `scripts/archive/import_applications_v1_older.py`.

### Edge Function
- `supabase/functions/telegram-webhook/index.ts` — **изменён.** Убран дебаг, печатавший секрет; вместо него комментарий с объяснением, почему так делать не надо, и заметка про `JSON.stringify` для будущей отладки. **Требует передеплоя на прод.**

### Прочее
- `.gitignore`, `supabase/.gitignore`
- `docs/wiring/*.md` (3 патча), `docs/ops/drive_service_account_setup.md`, `docs/design/next_year_form_design.md`, `docs/archive/raw/*.sql` (3), `docs/archive/nextjs-frontend/` (20 файлов)
- `plans/handoffs/` — создан этой сессией

---

## User Feedback & Preferences (REQUIRED)

- **«Lets plan getting all Github, Supabase and Claude Web generated data in one place»** — владелец явно потребовал планирования ПЕРЕД действиями. Две первые попытки агента запустить bash-команды (заумные циклы сравнения md5) были **отклонены**, после чего владелец перенаправил на планирование. **Урок: начинать с плана, а команды держать простыми и читаемыми.**
- **«Wdym there is no frontend im literally looking at it rn: <ссылка на GitHub>»** — прямая и резкая поправка. Агент заявил о факте remote, не проверив remote. Признать ошибку явно, не оправдываться.
- **«i dumped all claude artifacts into /dump i think it will be useful for you to not invent the wheel»** — владелец не хочет, чтобы агент изобретал заново то, что уже сгенерировано; артефакты надо использовать, а не дублировать.
- **«Объясни расхождения и я дам решения»** — владелец хочет **объяснение с вариантами и последствиями**, а сам принимает решения. Не решать за него архитектурные и продуктовые вопросы. Формат, который сработал: «что нашли → доказательство → что это значит → варианты с плюсами/минусами → рекомендация».
- **«0 - just checked login, it works»** — владелец проверяет гипотезы сам, быстро. Стоило предложить проверку — он её сделал за минуту.
- **«1 - second option, return rstrictions, they are present in Yandex Form so it's logical»** — при выборе опирается на то, что диктует реальная форма/процесс, а не на удобство кода.
- **«3. oooohhhhh that's bad... drop debug, yup...»** — эмоционально реагирует на утечки; для него это значимо, не формальность.
- **«4. lets do hygiene yup»** — согласен на разумную гигиену, когда риск объяснён честно.
- **«1. доступ только у меня, но перед итоговым запуском я обновлю вообще все секреты, сейчас это дев-тестирование»** — **важнейшая калибровка:** сейчас дев-стадия, засвеченные секреты — принятый риск, полная ротация будет перед запуском. Не прерывать работу ради таких находок.
- **«2. можно, да»** — короткие ответы; ценит, когда варианты уже разжёваны и достаточно сказать «да».
- **Язык:** общение и вся документация — **по-русски**. Это же закреплено в `CLAUDE.md`.
- **Стиль комментариев:** владелец принял написанный агентом `CLAUDE.md`, где зафиксировано требование плотного комментирования с объяснением «почему», а не «что». Значит, этот стиль ему подходит — держаться его.
- **Владелец активно работает через веб-интерфейс GitHub** (мержил PR #1 сам, параллельно с агентом). Отсюда — всегда `git fetch` перед пушем в `main`.

---

## Where We're Going

1. **Ручная часть на проде — по порядку, шаг 0 строго первым:**
   - **0.** Диагностика ДО наката: `select id, title, contact_email, status, created_at from applications where abstract_text is null and abstract_file_url is null order by created_at;` Если строки есть — решить, что с ними, иначе `validate` упадёт и миграция оборвётся.
   - **1.** В Supabase SQL Editor накатить `23_return_abstract_check.sql`, затем `24_revoke_extra_grants.sql`.
   - **2.** `drop function if exists public.check_login_token_v2(text);`
   - **3.** `supabase functions deploy telegram-webhook --no-verify-jwt`
   - **4.** Секреты — **ничего не делать**, уйдут в общую ротацию.
2. **Подтвердить, что прод и файлы сошлись** — после наката прогнать `supabase db pull` ещё раз и сверить с `_pulled/remote_schema_20260918.sql`, что перечисленные расхождения ушли.
3. **Решить судьбу ветки `consolidate-workspace`** — предложено удалить (локально и на GitHub), ответа нет.
4. **Открыт ровно один патч из `docs/wiring/`** — остальные два уже применены (см. Таблицу 10):
   - `telegram-webhook-preferred-name.md` — **НЕ применён.** Вебхук не читает `preferred_full_name` (`grep` по `index.ts` → пусто, строка 136 всё ещё `.select("username")`). Колонка есть с миграции 18, но вебхук её игнорирует → новые люди получают имя из Telegram (у части — латиницей/ником). Правка — 2 строки, дословное содержание в Таблице 10. **Меняет поведение → требует передеплоя функции.** Логично объединить с шагом 3 ручного прогона (там всё равно передеплой).
   - `committees-page.md` — **применён**, `docs/wiring/` можно чистить.
   - `applications-page.md` — **применён**, `docs/wiring/` можно чистить.
5. **Разделы фронтенда** — **три** заглушки по 8 строк: «Контент-план» (`ContentPlanPage.jsx`), «Секции и расписание» (`SchedulingPage.jsx`), «Документы» (`DocumentsPage.jsx`). Схема под них есть (миграции 03/04, 07/08, 11/12), UI нет. Раздел `/committees` при этом **доделан** (366 строк), хотя раньше считался административным хвостом.

---

## Risks & Blockers

- **`23` может упасть на проде**, если найдутся заявки без тезисов. Это не поломка: ограничение останется `not valid` (новые строки уже отсекаются, старые не покрыты). Разобрать старые и перезапустить `validate constraint applications_check;`.
- **`24` может сломать страницу вайтлиста, если отозвать лишнее.** Именно поэтому у `authenticated` на `whitelisted_usernames` оставлены `select`/`insert`/`update`/`delete`. **Не «упрощать» эту миграцию до `revoke all` на обеих таблицах.**
- **Вебхук на проде пока со старым кодом** — дебаг убран в репозитории, но функция не передеплоена. До передеплоя секрет продолжает попадать в логи.
- **У агента нет доступа к Supabase Dashboard и Telegram Bot API** — шаги 0–3 выполняет владелец.
- **`ssh-agent` не выживает между вызовами инструментов** в этом окружении — поэтому ключ без парольной фразы. Если владелец решит добавить фразу, пушить агент больше не сможет.

---

## Open Questions

- Сколько на проде заявок без тезисов (шаг 0 покажет). От ответа зависит, пройдёт ли `validate` в миграции 23.
- Удалять ли ветку `consolidate-workspace` — предложено, ответа нет.
- `applications_check` снимали операционно или смыслово? Косвенные улики говорят «операционно» (импортёр), но прямого подтверждения нет. Решение принято (возвращаем), вопрос оставлен как исторический.

---

## Quick Start for Next Session

```bash
# Восстановить контекст
cat /home/vs/social_gl/plans/handoffs/HANDOFF_consolidate-workspace_2026-09-18.md
cat /home/vs/social_gl/plans/handoffs/PLAN_consolidate-workspace_2026-09-18.md

# Справочные документы проекта
cat /home/vs/social_gl/CLAUDE.md
cat /home/vs/social_gl/docs/design/decisions.md

# Ключевые файлы для первой фазы
#   supabase/23_return_abstract_check.sql   — что накатывать
#   supabase/24_revoke_extra_grants.sql     — что накатывать
#   supabase/_pulled/remote_schema_20260918.sql — снимок прода (арбитр)

# Данные-доказательства
#   docs/design/decisions.md — таблица расхождений
#   supabase/_pulled/remote_schema_20260918.sql

# Проверить текущее состояние (стек погашен!)
cd /home/vs/social_gl
git status -s                 # ожидается пусто
git log --oneline -3          # ожидается 79e7d9e наверху
supabase start
./scripts/verify_schema.sh    # ожидается: 24 файла + seed, права ролей: OK
supabase stop

# НАЧАТЬ ЗДЕСЬ — первое конкретное действие
# Ничего в репозитории менять не нужно: кодовая часть сделана и запушена.
# Первое действие — выдать владельцу шаг 0 (диагностический select) и
# дождаться ответа, прежде чем предлагать накат миграции 23.
# Если владелец уже ответил — проверить, что состояние репозитория
# не изменилось (git fetch && git status -s), и переходить к шагу 1.
```
