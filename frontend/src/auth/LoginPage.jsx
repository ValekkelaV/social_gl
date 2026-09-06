import { useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "./AuthContext";
import TelegramLoginButton from "./TelegramLoginButton";

// Поток входа:
// 1. Telegram widget возвращает подписанный payload (id, username, hash, ...).
// 2. Отправляем его в Edge Function telegram-login (supabase/functions/telegram-login),
//    которая проверяет подпись + вайтлист и возвращает access/refresh_token.
// 3. supabase.auth.setSession(...) кладёт токены в клиент — дальше обычная
//    сессия Supabase Auth, AuthContext подхватит её через onAuthStateChange.

export default function LoginPage() {
  const { session, loading } = useAuth();
  const [status, setStatus] = useState("idle"); // idle | verifying | error
  const [errorMessage, setErrorMessage] = useState("");

  if (!loading && session) {
    return <Navigate to="/" replace />;
  }

  async function handleTelegramAuth(telegramUser) {
    setStatus("verifying");
    setErrorMessage("");

    try {
      const functionsUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;
      if (!functionsUrl) {
        throw new Error("Не задан VITE_SUPABASE_FUNCTIONS_URL в .env");
      }

      const response = await fetch(`${functionsUrl}/telegram-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(telegramUser),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Не удалось войти");
      }

      const { error: setSessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });

      if (setSessionError) throw setSessionError;

      // Успех — AuthContext сам подхватит новую сессию через onAuthStateChange,
      // редирект произойдёт автоматически (session станет не-null выше).
    } catch (err) {
      console.error("Ошибка входа через Telegram:", err);
      setStatus("error");
      setErrorMessage(err.message || "Что-то пошло не так, попробуйте ещё раз");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">СоцПоляна — админка</h1>
        <p className="text-sm text-gray-600">Вход только для членов оргкомитета, через Telegram.</p>

        <div className="flex justify-center">
          <TelegramLoginButton onAuth={handleTelegramAuth} />
        </div>

        {status === "verifying" && <p className="text-sm text-gray-500">Проверяем доступ…</p>}
        {status === "error" && <p className="text-sm text-red-600">{errorMessage}</p>}
      </div>
    </div>
  );
}
