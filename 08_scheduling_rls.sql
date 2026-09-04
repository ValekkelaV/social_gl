-- ============================================================
-- RLS: дни, слоты, секции, распределение, модераторы
-- ============================================================
-- Чтение — весь оргкомитет (данные открыты всем, как везде в "Секциях").
-- Запись:
--   - conference_days, time_slots, sections, section_day_numbers,
--     section_slots, talk_assignments — только члены комитета "Расписание секций"
--   - external_experts, section_slot_moderators — только члены комитета
--     "Модераторы/лекции/круглые столы"

alter table conference_days enable row level security;
alter table time_slots enable row level security;
alter table sections enable row level security;
alter table section_day_numbers enable row level security;
alter table section_slots enable row level security;
alter table external_experts enable row level security;
alter table section_slot_moderators enable row level security;
alter table talk_assignments enable row level security;

create or replace function is_schedule_committee_member(p_person uuid)
returns boolean
language sql stable security definer
as $$
  select exists (
    select 1
    from committee_memberships cm
    join committees c on c.id = cm.committee_id
    where cm.person_id = p_person
      and c.name = 'Расписание секций'
  );
$$;

create or replace function is_moderators_committee_member(p_person uuid)
returns boolean
language sql stable security definer
as $$
  select exists (
    select 1
    from committee_memberships cm
    join committees c on c.id = cm.committee_id
    where cm.person_id = p_person
      and c.name = 'Модераторы/лекции/круглые столы'
  );
$$;


-- ---------- CONFERENCE_DAYS / TIME_SLOTS / SECTIONS / SECTION_DAY_NUMBERS / SECTION_SLOTS / TALK_ASSIGNMENTS ----------

create policy conference_days_select_all on conference_days for select to authenticated
  using (exists (select 1 from people where id = auth.uid()));
create policy conference_days_write_schedule on conference_days for all to authenticated
  using (is_schedule_committee_member(auth.uid()) or is_owner(auth.uid()))
  with check (is_schedule_committee_member(auth.uid()) or is_owner(auth.uid()));

create policy time_slots_select_all on time_slots for select to authenticated
  using (exists (select 1 from people where id = auth.uid()));
create policy time_slots_write_schedule on time_slots for all to authenticated
  using (is_schedule_committee_member(auth.uid()) or is_owner(auth.uid()))
  with check (is_schedule_committee_member(auth.uid()) or is_owner(auth.uid()));

create policy sections_select_all on sections for select to authenticated
  using (exists (select 1 from people where id = auth.uid()));
create policy sections_write_schedule on sections for all to authenticated
  using (is_schedule_committee_member(auth.uid()) or is_owner(auth.uid()))
  with check (is_schedule_committee_member(auth.uid()) or is_owner(auth.uid()));

create policy section_day_numbers_select_all on section_day_numbers for select to authenticated
  using (exists (select 1 from people where id = auth.uid()));
create policy section_day_numbers_write_schedule on section_day_numbers for all to authenticated
  using (is_schedule_committee_member(auth.uid()) or is_owner(auth.uid()))
  with check (is_schedule_committee_member(auth.uid()) or is_owner(auth.uid()));

create policy section_slots_select_all on section_slots for select to authenticated
  using (exists (select 1 from people where id = auth.uid()));
create policy section_slots_write_schedule on section_slots for all to authenticated
  using (is_schedule_committee_member(auth.uid()) or is_owner(auth.uid()))
  with check (is_schedule_committee_member(auth.uid()) or is_owner(auth.uid()));

create policy talk_assignments_select_all on talk_assignments for select to authenticated
  using (exists (select 1 from people where id = auth.uid()));
create policy talk_assignments_write_schedule on talk_assignments for all to authenticated
  using (is_schedule_committee_member(auth.uid()) or is_owner(auth.uid()))
  with check (is_schedule_committee_member(auth.uid()) or is_owner(auth.uid()));


-- ---------- EXTERNAL_EXPERTS / SECTION_SLOT_MODERATORS ----------

create policy external_experts_select_all on external_experts for select to authenticated
  using (exists (select 1 from people where id = auth.uid()));
create policy external_experts_write_moderators on external_experts for all to authenticated
  using (is_moderators_committee_member(auth.uid()) or is_owner(auth.uid()))
  with check (is_moderators_committee_member(auth.uid()) or is_owner(auth.uid()));

create policy section_slot_moderators_select_all on section_slot_moderators for select to authenticated
  using (exists (select 1 from people where id = auth.uid()));
create policy section_slot_moderators_write_moderators on section_slot_moderators for all to authenticated
  using (is_moderators_committee_member(auth.uid()) or is_owner(auth.uid()))
  with check (is_moderators_committee_member(auth.uid()) or is_owner(auth.uid()));
