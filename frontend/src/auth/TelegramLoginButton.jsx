import { useEffect, useRef } from "react";

// Обёртка над официальным Telegram Login Widget
// (https://core.telegram.org/widgets/login). Виджет — это <script>,
// который сам рисует кнопку внутри контейнера и вызывает глобальный
// callback после успешного логина в Telegram.
//
// Требует VITE_TELEGRAM_BOT_USERNAME (без @) в .env — бот должен быть
// привязан к домену через @BotFather (/setdomain), иначе виджет откажется
// работать на вашем хостинге.

export default function TelegramLoginButton({ onAuth }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;
    if (!botUsername) {
      console.error("Не задан VITE_TELEGRAM_BOT_USERNAME в .env");
      return;
    }

    // Telegram виджет вызывает функцию по глобальному имени, указанному
    // в data-onauth (без window. и скобок) — регистрируем её на window.
    window.onTelegramAuth = (telegramUser) => {
      onAuth(telegramUser);
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");

    const container = containerRef.current;
    container?.appendChild(script);

    return () => {
      if (container) container.innerHTML = "";
      delete window.onTelegramAuth;
    };
  }, [onAuth]);

  return <div ref={containerRef} />;
}
