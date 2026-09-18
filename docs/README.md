# Документация

Индекс всего, что лежит в `docs/`. Начинать стоит с корневого
[README.md](../README.md) — он про то, как проект запускать. Здесь — про то,
как он устроен и почему.

## `design/` — как система устроена

| Документ | О чём |
|---|---|
| [schema-overview.md](design/schema-overview.md) | Все 30 таблиц по пяти блокам: что где лежит и зачем |
| [rls-model.md](design/rls-model.md) | Модель прав: комитеты, три уровня доступа, и две реальные ловушки Postgres, на которых уже спотыкались |
| [auth-telegram.md](design/auth-telegram.md) | Вход через Telegram: deep-link + бот-вебхук, вайтлист, деплой |
| [decisions.md](design/decisions.md) | **Журнал решений и расхождений с продом.** Читать перед тем, как что-то «чинить» |
| [next_year_form_design.md](design/next_year_form_design.md) | Дизайн полей формы заявки на новый сезон (Yandex Forms): отказ от делимитеров, слепое рецензирование |

⚠️ `decisions.md` — не список задач. Там записано, **почему** проект устроен
нестандартно (плоские миграции, выключенный автосид, `reset.sql` отдельно), и
что до сих пор не сходится с продом. Часть странностей — осознанный выбор,
и «починить» их значит сломать.

## `wiring/` — неприменённые патчи

Это **не документация, а инструкции «заменить строку X на Y»**, написанные в
чате. Пока файл лежит здесь — соответствующая правка в коде **не сделана**.

- [committees-page.md](wiring/committees-page.md) — подключить `CommitteesPage`
  (роут + пункт меню)
- [applications-page.md](wiring/applications-page.md) — роут `/applications/*`
  для вложенных страниц
- [telegram-webhook-preferred-name.md](wiring/telegram-webhook-preferred-name.md) —
  заставить вебхук читать `preferred_full_name`

## `ops/` — разовые настройки

- [drive_service_account_setup.md](ops/drive_service_account_setup.md) — Google
  service account для чтения файлов тезисов с Drive (~15 минут, разово)

## `archive/` — вытесненное

Хранится, чтобы был виден ход мысли, а не потому что нужно.

- `archive/raw/` — три суперседнутые версии миграций (`05`, `17`, `18`).
  Лежат рядом с актуальными для сравнения: видно, что именно поменялось
- `archive/nextjs-frontend/` — **заброшенная** попытка фронтенда на Next.js 14.
  Актуальный фронтенд — `frontend/` на Vite. Не воскрешать

## Где что искать

| Вопрос | Куда |
|---|---|
| Как поднять проект локально | [../README.md](../README.md) |
| Как устроены права доступа | [design/rls-model.md](design/rls-model.md) |
| Почему миграции не в `supabase/migrations/` | [design/decisions.md](design/decisions.md) |
| Как это вообще работает у докладчиков | [design/auth-telegram.md](design/auth-telegram.md) |
| Что ещё не доделано | [design/decisions.md](design/decisions.md), часть 3 |
