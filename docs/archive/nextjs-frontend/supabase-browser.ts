// frontend/lib/supabase-browser.ts
//
// Клиент Supabase для клиентских компонентов ("use client"). Использует
// anon key — безопасно светить в браузере, доступ реально регулируется
// RLS-политиками на стороне БД, не этим ключом.

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
