import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "./AuthContext";
import TelegramLoginButton from "./TelegramLoginButton";

export default function LoginPage() {
  const { session, loading } = useAuth();
  const [status, setStatus] = useState("idle"); // idle | verifying | error
  const [errorMessage, setErrorMessage] = useState("");

  // После редиректа от Telegram данные приходят в query-параметрах текущего
  // URL (?id=...&hash=...), а не через JS-колбэк, как раньше.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("hash")) return; // обычная загрузка страницы, не редирект от Telegram

    const telegramUser = {
      id: Number(params.get("id")),
      first_name: params.get("first_name") || undefined,
      last_name: params.get("last_name") || undefined,
      username: params.get("username") || undefined,
      photo_url: params.get("photo_url") || undefined,
      auth_date: Number(params.get("auth_date")),
      hash: params.get("hash"),
    };

    // Чистим query-параметры из адресной строки сразу — чтобы их нельзя
    // было случайно переиспользовать повторно и чтобы URL выглядел чисто.
    window.history.replaceState({}, document.title, window.location.pathname);

    handleTelegramAuth(telegramUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <TelegramLoginButton />
        </div>

        {status === "verifying" && <p className="text-sm text-gray-500">Проверяем доступ…</p>}
        {status === "error" && <p className="text-sm text-red-600">{errorMessage}</p>}
      </div>
    </div>
  );
}
