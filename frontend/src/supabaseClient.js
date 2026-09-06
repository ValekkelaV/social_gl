import { createClient } from "@supabase/supabase-js";

// Заполняются переменными окружения на этапе деплоя (Vercel/Netlify) —
// см. .env.example. Vite подставляет их во время сборки, поэтому после
// изменения значений в панели хостинга нужен новый деплой (redeploy),
// просто перезапуска сервера недостаточно.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Явная ошибка в консоли лучше, чем непонятный сбой запросов позже.
  console.error(
    "Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. " +
      "Проверьте .env (локально) или переменные окружения хостинга (в проде)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
