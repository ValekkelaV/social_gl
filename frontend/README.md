# СоцПоляна — админка (MVP shell)

Минимальный каркас: вход через Telegram + навигация по разделам. Каждый
раздел ("Тикеты", "Контент-план", "Заявки", "Секции и расписание",
"Документы") пока заглушка — реализуются по одному, в порядке MVP из
контекста.

Специально без визуального дизайна — только структура и функциональность.
Tailwind подключён (т.к. это часть стека), но использованы только базовые
классы разметки, без выбора цветов/шрифтов/брендинга.

## Локальный запуск

```bash
npm install
cp .env.example .env   # заполнить реальными значениями, см. ниже
npm run dev
```

## Переменные окружения (.env)

| Переменная | Где взять |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Dashboard → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API |
| `VITE_SUPABASE_FUNCTIONS_URL` | Обычно `https://<project-ref>.supabase.co/functions/v1` |
| `VITE_TELEGRAM_BOT_USERNAME` | Username бота из @BotFather, без `@` |

## Перед первым входом

1. **Edge Function** `telegram-login` (файл `index.ts`, который уже есть у
   вас отдельно) должна быть задеплоена:
   ```bash
   supabase functions deploy telegram-login
   supabase secrets set TELEGRAM_BOT_TOKEN=<токен от BotFather>
   supabase secrets set SUPABASE_ANON_KEY=<anon key>
   ```
2. У бота в @BotFather выполнить `/setdomain` и указать домен, на котором
   будет жить фронтенд (Vercel/Netlify URL) — без этого Telegram Login
   Widget не отрисуется/не сработает.
3. Ваш Telegram `@username` должен быть заранее в таблице
   `whitelisted_usernames` (добавляется вручную владельцем, см.
   `14_auth_whitelist.sql`).

## Деплой (вручную, без Claude)

Проект — обычное Vite-приложение, деплоится как на Vercel, так и на Netlify
без специфичной конфигурации.

**Vercel:**
1. Импортировать репозиторий в Vercel.
2. Build command: `npm run build`, Output directory: `dist` (Vercel обычно
   определяет это сам для Vite).
3. Добавить все 4 переменные окружения из таблицы выше в Project Settings →
   Environment Variables.
4. Deploy. После любого изменения переменных окружения — **redeploy**
   (Vite подставляет их на этапе сборки, не в рантайме).

**Netlify:** аналогично — build command `npm run build`, publish directory
`dist`, переменные окружения в Site settings → Environment variables.

## Структура

```
src/
  supabaseClient.js       — инициализация клиента Supabase
  auth/
    AuthContext.jsx       — сессия + запись people + committee_memberships
    TelegramLoginButton.jsx
    LoginPage.jsx
    RequireAuth.jsx       — обёртка защищённых роутов
  layout/
    NavShell.jsx          — шапка с навигацией по разделам
  pages/
    *Page.jsx             — заглушки разделов, по одному будем наполнять
  App.jsx                 — роутинг
  main.jsx                — точка входа
```

## Что дальше

Следующий раздел для наполнения — **TicketsPage** (шаг 1 по приоритету
MVP): список тикетов своих комитетов + создание + комментарии, используя
таблицы/политики из `01_committees_tickets.sql` + `02_rls_policies.sql`.
