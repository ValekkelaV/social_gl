-- ============================================================
-- RLS: контент-план
-- ============================================================
-- Любой член оргкомитета — полный доступ (без привязки к комитету).
-- Проверка "человек вообще есть в people" достаточна (=входит в оргкомитет);
-- отдельной проверки committee_memberships не требуется, т.к. право не
-- завязано на конкретный комитет.

alter table content_posts enable row level security;
alter table content_post_media enable row level security;
alter table content_post_revisions enable row level security;

create policy content_posts_all_org
  on content_posts for all
  to authenticated
  using (exists (select 1 from people where id = auth.uid()))
  with check (exists (select 1 from people where id = auth.uid()));

create policy content_post_media_all_org
  on content_post_media for all
  to authenticated
  using (exists (select 1 from people where id = auth.uid()))
  with check (exists (select 1 from people where id = auth.uid()));

-- Ревизии — только чтение вручную (запись идёт исключительно через триггер
-- log_content_post_revision с security definer, не напрямую от пользователя)
create policy content_post_revisions_select_org
  on content_post_revisions for select
  to authenticated
  using (exists (select 1 from people where id = auth.uid()));
