# СоцПоляна — админка оргкомитета

Внутренняя система для оргкомитета конференции «СоцПоляна»: комитеты и тикеты,
контент-план, заявки докладчиков, секции и расписание, генерация документов.

Репозиторий содержит **и базу, и фронтенд**: `supabase/` — схема и SQL,
`frontend/` — админка (Vite + React). Раньше схема собиралась вручную в
Supabase SQL Editor, а фронтенд жил отдельно; теперь всё лежит здесь.

## С чего начать

- **[docs/design/schema-overview.md](docs/design/schema-overview.md)** — что за таблицы и как связаны
- **[docs/design/rls-model.md](docs/design/rls-model.md)** — как устроены права доступа
- **[docs/design/auth-telegram.md](docs/design/auth-telegram.md)** — вход через Telegram (deep-link + бот)
- **[docs/design/decisions.md](docs/design/decisions.md)** — журнал решений и известных расхождений
- **[docs/README.md](docs/README.md)** — индекс всей документации
- **[plans/ROADMAP.md](plans/ROADMAP.md)** — план проекта: этапы, что сделано в схеме и в UI, что осталось

## Структура

```
social_gl/
├── supabase/
│   ├── 01..27_*.sql          схема: накатывается по порядку номеров
│   ├── seed_whitelist.sql    стартовые данные вайтлиста (вручную, после 14)
│   ├── config.toml           конфиг локального стека (supabase CLI)
│   ├── functions/
│   │   └── telegram-webhook/index.ts   Edge Function: приём апдейтов бота
│   ├── sql-checks/           одноразовые проверочные/ремонтные запросы
│   ├── _maintenance/reset.sql   снос всей схемы (НЕ часть наката)
│   └── _pulled/              снимок расхождений с продом от 2026-09-18
├── frontend/                 админка (Vite + React 18 + Tailwind)
├── scripts/
│   ├── import_applications.py     заявки из Google Forms (прошлый сезон)
│   ├── import_applications_v2.py  заявки из Yandex Forms (текущий сезон)
│   ├── extract_abstract_text.py   текст тезисов из docx/pdf
│   ├── backfill_file_links.py     дозаливка ссылок на файлы
│   ├── strip_terminal_junk.py     чистка SQL, сохранённого из терминала
│   └── verify_schema.sh           проверка наката схемы с нуля
└── docs/                     проектная документация (см. docs/README.md)
```

## Миграции: чем это необычно

Миграции — **плоские файлы `NN_name.sql` с человеческой нумерацией**, а не
`supabase/migrations/<timestamp>_name.sql`. Так они совпадают с тем, что лежит
на GitHub, и так их удобно вставлять в Supabase SQL Editor вручную.

Следствие, о котором надо знать:

- **`supabase db reset` / `db push` их не видят** — эти команды читают только
  `supabase/migrations/`. Поэтому проверка наката делается скриптом
  `scripts/verify_schema.sh` (применяет плоские файлы через psql по порядку).
- **Автосид в `config.toml` выключен** (`[db.seed] enabled = false`) — иначе
  `supabase start` падает: сид выполняется до того, как схема создана.
  Данные вайтлиста лежат в `seed_whitelist.sql` и накатываются вручную.

### Как применить схему

**Локально (проверка, что всё накатывается с нуля):**

```bash
supabase start
./scripts/verify_schema.sh
```

**На прод** — вручную: новые файлы по порядку номеров в Supabase SQL Editor.
Перед этим имеет смысл прогнать локально тем же скриптом.

`_maintenance/reset.sql` **никогда не входит в накат** — он сносит всю схему
вместе с `supabase_migrations`. Это отдельная ручная операция «начать с нуля».

Нумерация: `NN` — порядок применения. `01`–`12` — базовые разделы,
`13`+ — доработки. Пропусков быть не должно: номер = порядок, а не версия.

## Локальная разработка

### База

```bash
supabase start          # стек: Postgres :54322, API :54321, Studio :54323
./scripts/verify_schema.sh
supabase stop
```

### Фронтенд

```bash
cd frontend
npm install
cp .env.example .env    # заполнить (см. frontend/README.md)
npm run dev
```

## Деплой

- **Фронтенд** — Vercel (`frontend/vercel.json` задаёт SPA-rewrite на
  `index.html`). Подробности и список переменных окружения — в
  [frontend/README.md](frontend/README.md).
- **Edge Function** `telegram-webhook` — обязательной командой без проверки JWT,
  т.к. Telegram не шлёт Supabase JWT:
  ```bash
  supabase functions deploy telegram-webhook --no-verify-jwt
  ```
  Инструкция по секретам и регистрации вебхука — в шапке
  `supabase/functions/telegram-webhook/index.ts`.

## Что осталось недоделанным

См. [docs/design/decisions.md](docs/design/decisions.md) — там журнал решений и
открытые вопросы. Кратко, самое важное:

- **Вебхук не читает `preferred_full_name`.** Миграция `18` добавила колонку, но
  ни одна версия `index.ts` её не выбирает — правка описана в
  [docs/wiring/telegram-webhook-preferred-name.md](docs/wiring/telegram-webhook-preferred-name.md),
  но не применена. Новые люди получают имя из Telegram, а не заданное вручную.
- **Схема на проде и файлы миграций разошлись.** Расхождения зафиксированы в
  `supabase/_pulled/`, разобраны в `decisions.md`.
- Разделы «Контент-план», «Расписание», «Документы» во фронтенде — заглушки.
