// frontend/lib/supabase-server.ts
//
// Клиент Supabase для server components и route handlers. Читает/пишет
// сессию через cookies() из next/headers, чтобы SSR-запросы тоже видели
// авторизованного пользователя (иначе RLS отдавал бы пустые данные при
// первой загрузке страницы).

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // set() из server component (не route handler/middleware) может
            // упасть — это ожидаемо, если у Next.js уже есть middleware,
            // которое обновляет сессию отдельно (см. middleware.ts).
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // см. комментарий выше
          }
        },
      },
    },
  );
}
