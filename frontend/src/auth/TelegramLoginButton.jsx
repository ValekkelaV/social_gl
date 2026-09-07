import { useEffect, useRef } from "react";

// Редирект-режим вместо popup+callback. В popup-режиме (data-onauth) наш
// бот почему-то не предлагает мгновенное подтверждение через Telegram
// Desktop/приложение — только ввод номера телефона. Пробуем режим
// полноценного редиректа (data-auth-url): Telegram делает полную навигацию
// на страницу подтверждения, а затем редиректит браузер обратно на наш
// /login с данными пользователя в query-параметрах.
export default function TelegramLoginButton() {
  const containerRef = useRef(null);

  useEffect(() => {
    const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;
    if (!botUsername) {
      console.error("Не задан VITE_TELEGRAM_BOT_USERNAME в .env");
      return;
    }

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-auth-url", window.location.origin + "/login");

    const container = containerRef.current;
    container?.appendChild(script);

    return () => {
      if (container) container.innerHTML = "";
    };
  }, []);

  return <div ref={containerRef} />;
}
