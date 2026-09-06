-- ============================================================
-- RLS: комитеты, членство, тикеты
-- ============================================================

alter table people enable row level security;
alter table committees enable row level security;
alter table committee_memberships enable row level security;
alter table tickets enable row level security;
alter table ticket_recipients enable row level security;
alter table ticket_comments enable row level security;
alter table auto_ticket_rules enable row level security;


-- ---------- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ----------
-- security definer, чтобы избежать рекурсии RLS при проверках внутри других политик

create or replace function is_owner(p_person uuid)
returns boolean
language sql stable security definer
as $$
  select coalesce((select is_owner from people where id = p_person), false);
$$;

create or replace function is_committee_lead(p_person uuid, p_committee uuid)
returns boolean
language sql stable security definer
as $$
  select exists (
    select 1 from committee_memberships
    where person_id = p_person
      and committee_id = p_committee
      and level = 'lead'
  );
$$;

create or replace function is_any_lead(p_person uuid)
returns boolean
language sql stable security definer
as $$
  select exists (
    select 1 from committee_memberships
    where person_id = p_person and level = 'lead'
  );
$$;

create or replace function is_committee_member(p_person uuid, p_committee uuid)
returns boolean
language sql stable security definer
as $$
  select exists (
    select 1 from committee_memberships
    where person_id = p_person and committee_id = p_committee
  );
$$;


-- ============================================================
-- PEOPLE
-- ============================================================
-- Контекст: "данные участников открыты всем в оргкомитете". Чтение — всем
-- аутентифицированным (людям из people). Редактирование своей карточки —
-- только собой; is_owner менять может только владелец.

create policy people_select_all
  on people for select
  to authenticated
  using (true);

create policy people_update_self
  on people for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and is_owner = (select is_owner from people where id = auth.uid())  -- нельзя самому себе выдать is_owner
  );

create policy people_update_owner
  on people for update
  to authenticated
  using (is_owner(auth.uid()))
  with check (true);

-- people = только 25-30 членов оргкомитета. Вставка новых people обычно идёт
-- через триггер на auth.users (signup) либо владелец приглашает вручную —
-- оставляем insert только для owner здесь; если приглашения делаются иначе
-- (напр. service role при сигнапе), эта политика не помешает, т.к. service
-- role обходит RLS.
create policy people_insert_owner
  on people for insert
  to authenticated
  with check (is_owner(auth.uid()));


-- ============================================================
-- COMMITTEES
-- ============================================================
-- Чтение — всем в системе (нужно видеть список комитетов, чтобы ориентироваться).
-- Создание/удаление — только владелец.

create policy committees_select_all
  on committees for select
  to authenticated
  using (true);

create policy committees_insert_owner
  on committees for insert
  to authenticated
  with check (is_owner(auth.uid()));

create policy committees_update_owner
  on committees for update
  to authenticated
  using (is_owner(auth.uid()))
  with check (true);

create policy committees_delete_owner
  on committees for delete
  to authenticated
  using (is_owner(auth.uid()));


-- ============================================================
-- COMMITTEE_MEMBERSHIPS
-- ============================================================
-- Чтение — всем (нужно видеть состав комитетов).
-- Добавление людей и назначение уровня вплоть до lead — может лид этого
-- комитета либо владелец. Рядовой участник не может менять членство.

create policy memberships_select_all
  on committee_memberships for select
  to authenticated
  using (true);

create policy memberships_insert_lead_or_owner
  on committee_memberships for insert
  to authenticated
  with check (
    is_owner(auth.uid())
    or is_committee_lead(auth.uid(), committee_id)
  );

create policy memberships_update_lead_or_owner
  on committee_memberships for update
  to authenticated
  using (
    is_owner(auth.uid())
    or is_committee_lead(auth.uid(), committee_id)
  )
  with check (
    is_owner(auth.uid())
    or is_committee_lead(auth.uid(), committee_id)
  );

create policy memberships_delete_lead_or_owner
  on committee_memberships for delete
  to authenticated
  using (
    is_owner(auth.uid())
    or is_committee_lead(auth.uid(), committee_id)
  );


-- ============================================================
-- TICKETS
-- ============================================================
-- Видимость по умолчанию — тикеты своих комитетов, но можно "зайти помочь
-- в чужие" => на уровне БД читать могут ВСЕ аутентифицированные (фильтр
-- "по умолчанию видны свои" — это UI-логика, не ограничение доступа).
--
-- Создание:
--   - тикет внутри своего комитета (origin = свой комитет, единственный recipient = свой комитет) — любой участник комитета
--   - тикет для чужого комитета (origin = свой комитет, recipient = чужой) — любой участник своего комитета
--   - тикет для нескольких/всех комитетов (>1 recipient) — owner, любой lead, "руководители конференции"
--     Прим.: отдельной сущности "руководитель конференции" в схеме пока нет;
--     трактуем как is_owner OR is_any_lead(auth.uid()) до появления явной роли.
--
-- Закрытие/изменение статуса:
--   - manual: любой с правом действовать в контексте recipient/origin комитета
--     (см. вьюху ticket_actionable_by) — здесь для простоты: любой участник
--     recipient/origin комитета может комментировать; закрывать — тоже участник
--     (в контексте не сказано, что закрытие тикета требует уровня lead, в отличие
--     от специфичных "кнопок решений", которые не детализированы структурно)
--   - auto: закрывается только сменой линкованного поля объекта -> в БД закрывать
--     auto-тикет через обычный UPDATE запрещаем; предполагается server-side/trigger job
--     с service role, которая обходит RLS.

create policy tickets_select_all
  on tickets for select
  to authenticated
  using (true);

create policy tickets_insert_own_or_cross_committee
  on tickets for insert
  to authenticated
  with check (
    -- пока просто проверяем, что автор состоит хоть в каком-то комитете;
    -- ограничение "recipients только один чужой" или "несколько" валидируется
    -- дальше через ticket_recipients insert policy ниже
    is_committee_member(auth.uid(), origin_committee_id)
    or is_owner(auth.uid())
  );

create policy tickets_update_recipient_or_origin_member
  on tickets for update
  to authenticated
  using (
    source = 'manual'
    and (
      is_owner(auth.uid())
      or is_committee_member(auth.uid(), origin_committee_id)
      or exists (
        select 1 from ticket_recipients tr
        where tr.ticket_id = tickets.id
          and is_committee_member(auth.uid(), tr.committee_id)
      )
    )
  )
  with check (
    source = 'manual'
  );

-- auto-тикеты обновляются только service role (минуя RLS) —
-- намеренно НЕТ update-политики для auto здесь.


-- ============================================================
-- TICKET_RECIPIENTS
-- ============================================================
-- Один recipient (адресация чужому комитету) — любой участник origin-комитета.
-- Несколько recipients (несколько/все комитеты) — owner, lead любого комитета.

create policy ticket_recipients_select_all
  on ticket_recipients for select
  to authenticated
  using (true);

create policy ticket_recipients_insert
  on ticket_recipients for insert
  to authenticated
  with check (
    is_owner(auth.uid())
    or is_any_lead(auth.uid())
    or (
      -- одиночная адресация чужому комитету: разрешено любому участнику
      -- origin-комитета тикета, при условии что это единственный recipient
      exists (
        select 1 from tickets t
        where t.id = ticket_id
          and is_committee_member(auth.uid(), t.origin_committee_id)
      )
      and (select count(*) from ticket_recipients tr2 where tr2.ticket_id = ticket_id) = 0
      -- проверка "единственный" по факту достигается тем, что вставки
      -- сверх первой для не-lead будут блокированы приложением; на уровне
      -- БД это мягкое ограничение, т.к. полный контроль "ровно один recipient
      -- для non-lead" через RLS на INSERT без доп. состояния громоздок и
      -- дублирует app-валидацию, которая всё равно нужна для UX
    )
  );

create policy ticket_recipients_delete
  on ticket_recipients for delete
  to authenticated
  using (
    is_owner(auth.uid())
    or is_any_lead(auth.uid())
  );


-- ============================================================
-- TICKET_COMMENTS
-- ============================================================
-- Комментировать может любой, кто видит тикет в контексте своих комитетов
-- (origin или recipient), либо владелец. "Зайти помочь в чужой" тикет
-- технически не блокируется на select, но на insert комментария требуем
-- членство хотя бы в одном релевантном комитете — иначе теряется смысл
-- привязки прав к комитету.

create policy ticket_comments_select_all
  on ticket_comments for select
  to authenticated
  using (true);

create policy ticket_comments_insert
  on ticket_comments for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and (
      is_owner(auth.uid())
      or exists (
        select 1 from tickets t
        where t.id = ticket_id
          and is_committee_member(auth.uid(), t.origin_committee_id)
      )
      or exists (
        select 1 from ticket_recipients tr
        where tr.ticket_id = ticket_id
          and is_committee_member(auth.uid(), tr.committee_id)
      )
    )
  );


-- ============================================================
-- AUTO_TICKET_RULES
-- ============================================================
-- Справочник правил — читают все, редактирует только владелец
-- (это конфигурация системы, не оперативные данные).

create policy auto_rules_select_all
  on auto_ticket_rules for select
  to authenticated
  using (true);

create policy auto_rules_write_owner
  on auto_ticket_rules for all
  to authenticated
  using (is_owner(auth.uid()))
  with check (is_owner(auth.uid()));
