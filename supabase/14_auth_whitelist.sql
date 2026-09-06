-- ============================================================
-- СоцПоляна: авторизация — вайтлист Telegram-username
-- ============================================================
-- Закрытый список: войти может только тот, чей Telegram @username заранее
-- внесён сюда владельцем. Edge Function при логине проверяет username из
-- Telegram Login Widget против этой таблицы (через service role, минуя RLS)
-- и создаёт/находит соответствующую запись в people автоматически.
--
-- Хранится именно username (не telegram_id), т.к. на момент внесения в
-- вайтлист человек ещё не логинился и его telegram_id системе неизвестен —
-- сматчить можно только по username. После первого успешного входа
-- сохраняем telegram_id в people для надёжности (username можно сменить,
-- id — нет), а username в people тоже обновляем, чтобы не разъезжался.

create table whitelisted_usernames (
  username text primary key,  -- без @, регистр как в Telegram (Telegram username регистронезависим,
                                -- сравнение в Edge Function должно быть case-insensitive)
  added_by uuid references people(id),
  note text,                    -- опционально: "Иванов, комитет СММ" — для памяти владельца
  used_at timestamptz,          -- проставляется Edge Function при первом успешном входе
  created_at timestamptz not null default now()
);

comment on table whitelisted_usernames is
  'Закрытый список username, кому разрешён вход через Telegram Login Widget. '
  'Заполняется владельцем вручную. used_at проставляется автоматически при '
  'первом успешном логине (Edge Function, service role) — помогает отличить '
  'ещё не активированные приглашения от уже использованных.';
