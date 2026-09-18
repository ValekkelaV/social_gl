// frontend/components/TelegramLoginWidget.tsx
//
// Обёртка над официальным Telegram Login Widget (сторонний <script>,
// который рендерит кнопку и вызывает наш колбэк с подписанными данными
// пользователя после успешного входа в Telegram).
//
// Требует, чтобы бот был привязан к текущему домену через BotFather:
// /setdomain → выбрать бота → указать домен, на котором крутится фронтенд.
// На localhost виджет Telegram не работает — тестировать можно только на
// реальном задеплоенном домене (или через ngrok/аналог для локальной разработки).

"use client";

import { useEffect, useRef } from "react";

// Структура данных, которую Telegram передаёт в колбэк — совпадает с тем,
// что проверяет наша Edge Function telegram-login.
export interface TelegramAuthData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthData) => void;
  }
}

interface TelegramLoginWidgetProps {
  botUsername: string; // имя бота БЕЗ @, напр. "SocPolyanaBot"
  onAuth: (data: TelegramAuthData) => void;
}

export function TelegramLoginWidget({ botUsername, onAuth }: TelegramLoginWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.onTelegramAuth = onAuth;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");

    containerRef.current?.appendChild(script);

    return () => {
      // очистка при размонтировании, чтобы не плодить глобальный колбэк
      delete window.onTelegramAuth;
    };
  }, [botUsername, onAuth]);

  return <div ref={containerRef} />;
}
