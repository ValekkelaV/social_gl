-- ============================================================
-- RLS: коммуникации (email_templates)
-- ============================================================
-- mailing_recipients — это view поверх applications/speakers/..., доступ
-- к ней уже регулируется RLS-политиками базовых таблиц (весь оргкомитет
-- видит эти данные, как решено ранее) — отдельных политик для view не нужно.
--
-- Права на сами шаблоны: контекст не уточняет отдельно, кто пишет шаблоны
-- писем — по аналогии с остальными данными "Секций"/рассылок (открыто всем
-- в оргкомитете) даю доступ всему оргкомитету. Если шаблоны должны быть
-- ограничены конкретным комитетом (напр. "Коммуникации") — скажите, поправлю.

alter table email_templates enable row level security;

create policy email_templates_select_all
  on email_templates for select
  to authenticated
  using (exists (select 1 from people where id = auth.uid()));

create policy email_templates_write_org
  on email_templates for all
  to authenticated
  using (exists (select 1 from people where id = auth.uid()))
  with check (
    created_by = auth.uid()
    and exists (select 1 from people where id = auth.uid())
  );
