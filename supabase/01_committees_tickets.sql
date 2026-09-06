-- ============================================================
-- СоцПоляна: комитеты, роли, тикеты
-- MVP-этап 1 (декабрь)
-- ============================================================

-- ---------- ЛЮДИ ----------
-- Supabase auth.users уже хранит аутентификацию; здесь — профиль
-- people = только оргкомитет (25-30 человек), не участники конференции.
-- Участники (докладчики) живут отдельно в разделе "Секции" и никогда не логинятся —
-- их email используется исключительно для рассылок через email-сервис, не для auth.
create table people (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,  -- опционально; основной канал общения — Telegram, не email
  telegram_id bigint unique,  -- Telegram user id, ключ для входа (детали auth-flow — отдельная задача)
  telegram_username text,     -- @username, для человекочитаемости в интерфейсе
  phone text,
  is_owner boolean not null default false,  -- владелец системы: создаёт/удаляет комитеты как структуру
  created_at timestamptz not null default now()
);

-- ---------- КОМИТЕТЫ ----------
create table committees (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- владелец (единственный пользователь-владелец всей системы)
  -- создаёт/удаляет комитеты — проверяется в app-логике / RLS по people.id = owner_id
  created_at timestamptz not null default now(),
  archived_at timestamptz  -- на случай если комитет расформирован, но история тикетов нужна
);

create type committee_level as enum ('member', 'lead');

-- ---------- ЧЕЛОВЕК ↔ КОМИТЕТ ↔ УРОВЕНЬ ----------
create table committee_memberships (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  committee_id uuid not null references committees(id) on delete cascade,
  level committee_level not null default 'member',
  added_by uuid references people(id),  -- кто добавил (лид своего комитета либо владелец)
  created_at timestamptz not null default now(),
  unique (person_id, committee_id)  -- в одном комитете человек — одна запись/один уровень
);

create index idx_memberships_person on committee_memberships(person_id);
create index idx_memberships_committee on committee_memberships(committee_id);

-- Права на "кнопки решений" в тикете вычисляются НЕ через глобальную роль,
-- а через членство человека в конкретном комитете, к которому привязан тикет
-- (см. вьюху effective_ticket_rights ниже).


-- ============================================================
-- ТИКЕТЫ
-- ============================================================

create type ticket_source as enum ('manual', 'auto');
create type ticket_status as enum ('open', 'in_progress', 'closed');

-- Тикет может относиться к одному комитету, нескольким, или всем.
-- "Для нескольких/всех" — только руководители конференции (владелец) могут создавать,
-- проверяется в app-логике при создании, а не ограничением схемы.
create table tickets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,

  source ticket_source not null default 'manual',
  status ticket_status not null default 'open',

  -- комитет-инициатор (кто создал / откуда пришёл auto-тикет)
  origin_committee_id uuid references committees(id),

  created_by uuid references people(id),  -- null для чисто авто-тикетов без автора-человека
  created_at timestamptz not null default now(),

  closed_by uuid references people(id),
  closed_at timestamptz,

  -- Структурная привязка к объекту "Секций" (заявка/секция/слот/модератор и т.д.)
  -- Полиморфная привязка: тип объекта + его id.
  -- Когда "Секции" будут спроектированы, entity_type станет enum со значениями
  -- вроде 'application', 'section', 'slot_assignment', 'moderator' и т.д.
  linked_entity_type text,
  linked_entity_id uuid,

  -- для авто-тикетов: машиночитаемая причина + произвольные данные триггера
  auto_trigger_key text,       -- напр. 'moderator_unconfirmed'
  auto_trigger_payload jsonb,  -- напр. {"slot_id": "...", "section_id": "..."}

  check (
    (source = 'auto' and auto_trigger_key is not null)
    or (source = 'manual')
  ),
  check (
    (status = 'closed') = (closed_at is not null)
  )
);

create index idx_tickets_status on tickets(status);
create index idx_tickets_origin_committee on tickets(origin_committee_id);
create index idx_tickets_linked_entity on tickets(linked_entity_type, linked_entity_id);
create index idx_tickets_auto_trigger on tickets(auto_trigger_key) where source = 'auto';

-- Комитеты, для которых тикет виден/актуален как "входящий"
-- (получатель(и) — может быть несколько для тикетов "для нескольких/всех комитетов")
create table ticket_recipients (
  ticket_id uuid not null references tickets(id) on delete cascade,
  committee_id uuid not null references committees(id) on delete cascade,
  primary key (ticket_id, committee_id)
);

create index idx_ticket_recipients_committee on ticket_recipients(committee_id);

-- Комментарии/лог обсуждения тикета (свободная переписка внутри тикета)
create table ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  author_id uuid not null references people(id),
  body text not null,
  created_at timestamptz not null default now()
);

create index idx_ticket_comments_ticket on ticket_comments(ticket_id);


-- ============================================================
-- АВТО-ТИКЕТЫ: РЕЕСТР ТРИГГЕРОВ
-- ============================================================
-- Расширяемый реестр правил, а не хардкод в коде. Каждая строка описывает
-- одно условие "если поле объекта Х в состоянии Y — должен существовать
-- открытый авто-тикет с данным trigger_key". Актуализация (создание при
-- наступлении условия / закрытие при изменении поля) выполняется джобой
-- или триггером БД, который проверяет condition_sql на объектах linked_entity_type.
--
-- Пока "Секции" не спроектированы, здесь фиксируется только структура
-- реестра + известные по контексту примеры условий (заполняются позже,
-- когда появятся реальные таблицы секций/слотов/модераторов).

create table auto_ticket_rules (
  key text primary key,                 -- напр. 'moderator_unconfirmed'
  title_template text not null,         -- напр. 'Модератор не подтверждён: {section_name}, слот {slot_number}'
  description_template text,
  applies_to_entity_type text not null, -- напр. 'slot_assignment' (появится вместе со схемой "Секций")
  default_recipient_committee text,     -- напр. 'moderators' — какому комитету адресован по умолчанию
  is_active boolean not null default true,
  -- Условие закрытия: тикет с данным ключом закрывается автоматически, когда это
  -- условие перестаёт выполняться (проверяется приложением/джобой, не хранится как SQL здесь,
  -- т.к. зависит от таблиц "Секций", которых пока нет)
  created_at timestamptz not null default now()
);

-- Известные по текущему контексту правила (значения-заглушки для applies_to_entity_type,
-- будут скорректированы при проектировании "Секций"):
insert into auto_ticket_rules (key, title_template, applies_to_entity_type, default_recipient_committee) values
  ('moderator_unconfirmed', 'Модератор не подтверждён: {section_name}, слот {slot_number}', 'slot_assignment', 'moderators'),
  ('slot_over_capacity', 'Превышена вместимость слота: {slot_label} ({talks_count} докладов)', 'slot', 'schedule');
  -- добавить остальные auto-триггеры по мере проектирования "Секций"

comment on table auto_ticket_rules is
  'Реестр правил для авто-тикетов. applies_to_entity_type и логика проверки условий '
  'будут уточнены после проектирования раздела "Секции". Закрытие авто-тикета — только '
  'через изменение исходного поля объекта, никогда вручную (см. tickets.source check).';


-- ============================================================
-- ПРАВА: ВЫЧИСЛЕНИЕ "КНОПОК РЕШЕНИЙ" ДЛЯ ТИКЕТА
-- ============================================================
-- Право действовать по тикету = человек состоит в одном из ticket_recipients
-- (или является origin_committee_id) для этого тикета, и его уровень в ЭТОМ
-- конкретном комитете >= требуемого. Глобального "объединения" уровня нет —
-- права всегда проверяются в контексте комитета(ов), к которым привязан тикет.

create view ticket_actionable_by as
select
  t.id as ticket_id,
  cm.person_id,
  cm.committee_id,
  cm.level
from tickets t
join ticket_recipients tr on tr.ticket_id = t.id
join committee_memberships cm on cm.committee_id = tr.committee_id
union
select
  t.id as ticket_id,
  cm.person_id,
  cm.committee_id,
  cm.level
from tickets t
join committee_memberships cm on cm.committee_id = t.origin_committee_id;

comment on view ticket_actionable_by is
  'Кто может видеть/закрывать тикет и с каким уровнем — per-комитет, '
  'без глобального объединения ролей человека.';
