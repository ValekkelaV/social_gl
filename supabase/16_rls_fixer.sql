-- ============================================================
-- RLS: исправления (после ревью 02 и 10)
-- ============================================================
-- Применять после 02_rls_policies.sql и 10_communications_rls.sql.

-- ------------------------------------------------------------
-- ИСПРАВЛЕНИЕ 1: people — самоповышение до owner
-- ------------------------------------------------------------
-- Postgres комбинирует несколько permissive-политик на одну команду через
-- OR — отдельно для USING и отдельно для WITH CHECK, а не парами
-- "своя политика целиком". В паре people_update_self / people_update_owner
-- это давало дыру:
--   USING:      (id = auth.uid()) OR is_owner(auth.uid())
--   WITH CHECK: (is_owner не менялся) OR true
-- Второй WITH CHECK был безусловным true, поэтому ЛЮБОЙ пользователь,
-- обновляющий свою же строку (проходит USING первой политики), автоматически
-- проходил общий WITH CHECK благодаря "true" из второй политики — то есть
-- мог выставить себе is_owner = true в обход защиты people_update_self.
--
-- Фикс: people_update_owner получает содержательный WITH CHECK
-- (переподтверждает, что действующий пользователь — владелец), вместо
-- безусловного true.

drop policy if exists people_update_owner on people;

create policy people_update_owner
  on people for update
  to authenticated
  using (is_owner(auth.uid()))
  with check (is_owner(auth.uid()));


-- ------------------------------------------------------------
-- ИСПРАВЛЕНИЕ 2: email_templates — update заблокирован для всех, кроме автора
-- ------------------------------------------------------------
-- Старая политика email_templates_write_org была одна на все команды (for all)
-- с with check (created_by = auth.uid() ...). Для UPDATE это означает: если
-- created_by в обновляемой строке не auth.uid() (т.е. правит не автор),
-- new-версия строки всё равно содержит старый created_by (это поле обычно
-- не трогают при редактировании текста) — и with check проваливается для
-- всех, кроме исходного автора. Итог противоречил намерению "пишет весь
-- оргкомитет": на практике редактировать шаблон мог только его создатель.
--
-- Фикс: разделяем insert и update. created_by = auth.uid() остаётся
-- обязательным условием только при создании; при редактировании чужого
-- существующего шаблона проверяем лишь членство в оргкомитете.

drop policy if exists email_templates_write_org on email_templates;

create policy email_templates_insert_org
  on email_templates for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (select 1 from people where id = auth.uid())
  );

create policy email_templates_update_org
  on email_templates for update
  to authenticated
  using (exists (select 1 from people where id = auth.uid()))
  with check (exists (select 1 from people where id = auth.uid()));

create policy email_templates_delete_org
  on email_templates for delete
  to authenticated
  using (exists (select 1 from people where id = auth.uid()));
