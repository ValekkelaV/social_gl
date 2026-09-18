// frontend/middleware.ts
//
// Обновляет сессию Supabase на каждый запрос (проверяет/освежает access
// token через refresh token в cookies). Без этого middleware сессия может
// "протухать" между запросами на сервере, даже если она валидна в браузере.

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: "", ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: "", ...options });
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Незалогиненный человек, который лезет не на /login — отправляем на /login.
  // /login сам не защищён (иначе никто бы не смог залогиниться).
  const isLoginPage = request.nextUrl.pathname.startsWith("/login");
  if (!user && !isLoginPage) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Применяем middleware ко всем путям кроме статики Next.js и файлов
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
