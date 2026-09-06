// frontend/app/login/page.tsx
//
// Показывает Telegram Login Widget; после успешной авторизации в Telegram
// отправляет полученные данные в Edge Function telegram-login, которая их
// проверяет и возвращает access_token + refresh_token. Мы передаём их в
// supabase.auth.setSession(), чтобы завершить вход, и редиректим в админку.

"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { TelegramLoginWidget, type TelegramAuthData } from "@/components/TelegramLoginWidget";

// Имя бота задаётся через переменную окружения, чтобы не хардкодить —
// разные окружения (dev/prod) вполне могут использовать разных ботов.
const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME!;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleTelegramAuth = useCallback(
    async (telegramData: TelegramAuthData) => {
      setIsLoading(true);
      setError(null);

      try {
        const functionsUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/telegram-login`;
        const response = await fetch(functionsUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(telegramData),
        });

        const result = await response.json();

        if (!response.ok) {
          setError(result.error ?? "Не удалось войти. Попробуйте снова.");
          setIsLoading(false);
          return;
        }

        const supabase = createClient();
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: result.access_token,
          refresh_token: result.refresh_token,
        });

        if (sessionError) {
          setError("Вход выполнен, но не удалось сохранить сессию. Попробуйте ещё раз.");
          setIsLoading(false);
          return;
        }

        router.push("/applications");
        router.refresh();
      } catch (err) {
        console.error(err);
        setError("Произошла ошибка сети. Проверьте подключение и попробуйте снова.");
        setIsLoading(false);
      }
    },
    [router],
  );

  return (
    <div className="w-full max-w-sm rounded-lg border border-stone-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-semibold text-stone-900">СоцПоляна</h1>
      <p className="mt-1 text-sm text-stone-500">Вход для оргкомитета</p>

      <div className="mt-6 flex justify-center">
        {isLoading ? (
          <p className="text-sm text-stone-500">Выполняется вход…</p>
        ) : (
          <TelegramLoginWidget botUsername={BOT_USERNAME} onAuth={handleTelegramAuth} />
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
    </div>
  );
}
