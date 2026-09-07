import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "./AuthContext";

// Вход через Telegram-бота (deep-link), а не через JS-виджет — виджет
// оказался ненадёжным (см. историю отладки: код на телефон не доходил ни
// на нашем боте, ни на официальной демо-странице Telegram).
//
// Поток:
// 1. Жмём "Войти через Telegram" -> create_login_token() создаёт токен.
// 2. Открываем t.me/<bot>?start=<token> в новой вкладке — обычное открытие
//    бота, без OAuth-попапа.
// 3. Пользователь жмёт Start в Telegram; бот получает апдейт через вебхук
//    (supabase/functions/telegram-webhook), проверяет вайтлист, готовит
//    magic-link токен, кладёт в telegram_login_tokens.
// 4. Мы в это время опрашиваем check_login_token() каждые 2 сек.
// 5. Как только status = 'verified', обмениваем session_hashed_token на
//    сессию через supabase.auth.verifyOtp() прямо в браузере.

const POLL_INTERVAL_MS = 2000;
const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;

export default function LoginPage() {
  const { session, loading } = useAuth();
  const [phase, setPhase] = useState("idle"); // idle | waiting | verified | denied | expired | error
  const [errorMessage, setErrorMessage] = useState("");
  const pollRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  if (!loading && session) {
    return <Navigate to="/" replace />;
  }

  async function startLogin() {
    setErrorMessage("");

    if (!BOT_USERNAME) {
      setPhase("error");
      setErrorMessage("Не задан VITE_TELEGRAM_BOT_USERNAME");
      return;
    }

    const { data: token, error } = await supabase.rpc("create_login_token");
    if (error || !token) {
      console.error("Не удалось создать токен входа:", error);
      setPhase("error");
      setErrorMessage("Не удалось начать вход, попробуйте ещё раз");
      return;
    }

    window.open(`https://t.me/${BOT_USERNAME}?start=${token}`, "_blank", "noopener,noreferrer");
    setPhase("waiting");

    pollRef.current = setInterval(async () => {
      const { data, error: pollError } = await supabase
        .rpc("check_login_token", { p_token: token })
        .maybeSingle();

      if (pollError) {
        console.error("Ошибка проверки статуса входа:", pollError);
        return; // не останавливаем polling из-за единичной сетевой ошибки
      }
      if (!data) return;

      if (data.token_status === "verified" && data.session_hashed_token) {
        clearInterval(pollRef.current);
        setPhase("exchanging");

        const { error: verifyError } = await supabase.auth.verifyOtp({
          type: "magiclink",
          token_hash: data.session_hashed_token,
        });

        if (verifyError) {
          console.error("Ошибка обмена токена на сессию:", verifyError);
          setPhase("error");
          setErrorMessage("Не удалось завершить вход, попробуйте ещё раз");
          return;
        }
        // Успех — AuthContext подхватит новую сессию сам, произойдёт редирект.
      } else if (data.token_status === "denied") {
        clearInterval(pollRef.current);
        setPhase("denied");
      } else if (data.token_status === "expired") {
        clearInterval(pollRef.current);
        setPhase("expired");
      }
      // status === 'pending' — просто продолжаем ждать
    }, POLL_INTERVAL_MS);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">СоцПоляна — админка</h1>
        <p className="text-sm text-gray-600">Вход только для членов оргкомитета, через Telegram.</p>

        {(phase === "idle" || phase === "error") && (
          <button
            onClick={startLogin}
            className="px-4 py-2 border rounded font-medium"
          >
            Войти через Telegram
          </button>
        )}

        {phase === "waiting" && (
          <p className="text-sm text-gray-500">
            Открылся Telegram — нажмите Start в чате с ботом. Ждём подтверждения…
          </p>
        )}

        {phase === "exchanging" && <p className="text-sm text-gray-500">Входим…</p>}

        {phase === "denied" && (
          <p className="text-sm text-red-600">
            Доступ запрещён: ваш Telegram username не в списке оргкомитета.
          </p>
        )}

        {phase === "expired" && (
          <div className="space-y-2">
            <p className="text-sm text-red-600">Время ожидания истекло.</p>
            <button onClick={() => setPhase("idle")} className="text-sm underline">
              Попробовать снова
            </button>
          </div>
        )}

        {phase === "error" && errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
      </div>
    </div>
  );
}
