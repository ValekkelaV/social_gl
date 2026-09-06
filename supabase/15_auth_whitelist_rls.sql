-- ============================================================
-- RLS: вайтлист Telegram-username
-- ============================================================
-- Читать могут все в оргкомитете (полезно видеть, кого уже пригласили).
-- Писать (добавлять/удалять приглашения) — только владелец.
-- Edge Function работает через service role и обходит RLS полностью,
-- так что эти политики не мешают процессу логина — они только для
-- обычных authenticated-запросов из приложения/SQL Editor.

alter table whitelisted_usernames enable row level security;

create policy whitelisted_usernames_select_all
  on whitelisted_usernames for select
  to authenticated
  using (exists (select 1 from people where id = auth.uid()));

create policy whitelisted_usernames_write_owner
  on whitelisted_usernames for all
  to authenticated
  using (is_owner(auth.uid()))
  with check (is_owner(auth.uid()));
