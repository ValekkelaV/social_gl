-- ============================================================
-- RLS: заявки (applications)
-- ============================================================
-- Данные заявок открыты всему оргкомитету (аналогично people) — читают все.
-- Массовая рассылка фидбека — только лид комитета "Отбор заявок" (точное имя
-- комитета фиксируется здесь; если переименуете комитет в БД, обновите константу).

alter table universities enable row level security;
alter table applications enable row level security;
alter table speakers enable row level security;
alter table application_text_revisions enable row level security;
alter table application_reads enable row level security;
alter table application_comments enable row level security;
alter table application_feedback enable row level security;
alter table application_feedback_sends enable row level security;

-- Функция-константа: лид именно комитета "Отбор заявок"
create or replace function is_selection_committee_lead(p_person uuid)
returns boolean
language sql stable security definer
as $$
  select exists (
    select 1
    from committee_memberships cm
    join committees c on c.id = cm.committee_id
    where cm.person_id = p_person
      and cm.level = 'lead'
      and c.name = 'Отбор заявок'  -- точное имя комитета в таблице committees
  );
$$;


-- ---------- UNIVERSITIES ----------
-- Общий справочник, читают все, редактируют все члены оргкомитета
-- (заполняется вручную "по мере встречи новых вузов" — не привязано к комитету)

create policy universities_select_all
  on universities for select
  to authenticated
  using (true);

create policy universities_write_org
  on universities for all
  to authenticated
  using (exists (select 1 from people where id = auth.uid()))
  with check (exists (select 1 from people where id = auth.uid()));


-- ---------- APPLICATIONS ----------
create policy applications_select_all
  on applications for select
  to authenticated
  using (exists (select 1 from people where id = auth.uid()));

-- Импорт CSV / создание — весь оргкомитет (в контексте не сказано, что это
-- эксклюзивно комитету отбора; импорт делает тот, кто настраивает приём)
create policy applications_insert_org
  on applications for insert
  to authenticated
  with check (exists (select 1 from people where id = auth.uid()));

create policy applications_update_org
  on applications for update
  to authenticated
  using (exists (select 1 from people where id = auth.uid()))
  with check (exists (select 1 from people where id = auth.uid()));


-- ---------- SPEAKERS ----------
create policy speakers_select_all
  on speakers for select
  to authenticated
  using (exists (select 1 from people where id = auth.uid()));

create policy speakers_write_org
  on speakers for all
  to authenticated
  using (exists (select 1 from people where id = auth.uid()))
  with check (exists (select 1 from people where id = auth.uid()));


-- ---------- APPLICATION_TEXT_REVISIONS ----------
create policy application_text_revisions_select_all
  on application_text_revisions for select
  to authenticated
  using (exists (select 1 from people where id = auth.uid()));

create policy application_text_revisions_insert_org
  on application_text_revisions for insert
  to authenticated
  with check (
    recorded_by = auth.uid()
    and exists (select 1 from people where id = auth.uid())
  );


-- ---------- APPLICATION_READS ----------
-- Любой член оргкомитета может отметиться "прочитал(а)", от своего имени.
create policy application_reads_select_all
  on application_reads for select
  to authenticated
  using (exists (select 1 from people where id = auth.uid()));

create policy application_reads_insert_self
  on application_reads for insert
  to authenticated
  with check (
    reader_id = auth.uid()
    and exists (select 1 from people where id = auth.uid())
  );

-- Отметку "прочитал(а)" не удаляем — нет delete-политики намеренно
-- (если понадобится отмена отметки, добавим отдельно)


-- ---------- APPLICATION_COMMENTS ----------
-- "Сырые" комментарии для внутреннего обсуждения — видны всему оргкомитету
-- (заявки открыты всем), пишет любой от своего имени.
create policy application_comments_select_all
  on application_comments for select
  to authenticated
  using (exists (select 1 from people where id = auth.uid()));

create policy application_comments_insert_self
  on application_comments for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from people where id = auth.uid())
  );


-- ---------- APPLICATION_FEEDBACK ----------
-- Читать/писать текст фидбека — весь оргкомитет (пишет прочитавший, не обязательно лид).

create policy application_feedback_select_all
  on application_feedback for select
  to authenticated
  using (exists (select 1 from people where id = auth.uid()));

create policy application_feedback_insert_org
  on application_feedback for insert
  to authenticated
  with check (
    written_by = auth.uid()
    and exists (select 1 from people where id = auth.uid())
  );

create policy application_feedback_update_org
  on application_feedback for update
  to authenticated
  using (exists (select 1 from people where id = auth.uid()))
  with check (exists (select 1 from people where id = auth.uid()));


-- ---------- APPLICATION_FEEDBACK_SENDS ----------
-- Факт массовой отправки — исключительно лид комитета "Отбор заявок".
-- Чтение — весь оргкомитет (нужно видеть, что уже отправлено, для сводки).

create policy application_feedback_sends_select_all
  on application_feedback_sends for select
  to authenticated
  using (exists (select 1 from people where id = auth.uid()));

create policy application_feedback_sends_insert_selection_lead
  on application_feedback_sends for insert
  to authenticated
  with check (
    sent_by = auth.uid()
    and is_selection_committee_lead(auth.uid())
  );

-- Намеренно нет update/delete-политики: отправка фиксируется один раз
-- и не должна редактироваться задним числом.
