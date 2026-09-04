-- ============================================================
-- СоцПоляна: раздел "Секции" — распределение по секциям/слотам
-- MVP-этап 4 (к марту)
-- ============================================================

-- ============================================================
-- ДНИ И СЛОТЫ
-- ============================================================

create table conference_days (
  id uuid primary key default gen_random_uuid(),
  day_date date not null unique,
  label text,  -- опционально, напр. "День 1" для UI, если не хотите ориентироваться по дате
  sort_order int not null  -- порядок дней конференции (на случай дат не по порядку)
);

create table time_slots (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references conference_days(id) on delete cascade,
  sort_order int not null,  -- порядок слота внутри дня: 1 = до обеда, 2 = после обеда, 3 = после перерыва...
  label text,               -- опционально, напр. "До обеда"
  starts_at time,
  ends_at time,
  color text,                -- цвет слота (hex) — используется в других сгенерированных документах (не в программе), задаётся через color-picker
  unique (day_id, sort_order)
);

create index idx_time_slots_day on time_slots(day_id);


-- ============================================================
-- СЕКЦИИ
-- ============================================================
-- Секция физически создаётся (INSERT) в момент первого распределения доклада
-- в неё — нет отдельного UI-экрана "создать секцию", но в БД это отдельная
-- запись со своим id, т.к. на неё вешаются аудитория/модератор/номер.

create table sections (
  id uuid primary key default gen_random_uuid(),
  name text not null,  -- рабочее название темы секции, редактируется организаторами
  color text,           -- цвет секции для программы.pdf (hex, напр. '#FF5733'); задаётся через color-picker, хранится между генерациями
  created_at timestamptz not null default now()
);

-- Номер секции — свойство пары (секция, день): одна секция теоретически
-- может встречаться в разные дни с разными номерами (редкий кейс, но
-- контекст явно это допускает).
create table section_day_numbers (
  section_id uuid not null references sections(id) on delete cascade,
  day_id uuid not null references conference_days(id) on delete cascade,
  section_number int not null,  -- сквозной номер секции в рамках этого дня
  primary key (section_id, day_id),
  unique (day_id, section_number)  -- номер уникален в рамках дня
);


-- ============================================================
-- СВЯЗЬ СЕКЦИЯ ↔ СЛОТ
-- ============================================================
-- Секция может занимать несколько слотов подряд; аудитория и модератор
-- фиксируются отдельно на каждый слот (могут меняться между слотами).

create table section_slots (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references sections(id) on delete cascade,
  slot_id uuid not null references time_slots(id) on delete cascade,

  room text,  -- аудитория; может быть null пока не назначена

  unique (section_id, slot_id)
);

create index idx_section_slots_section on section_slots(section_id);
create index idx_section_slots_slot on section_slots(slot_id);


-- ============================================================
-- ВНЕШНИЕ ЭКСПЕРТЫ (модераторы, лекторы, участники круглых столов)
-- ============================================================
-- Отдельная сущность, НЕ связана с ролями/правами системы — это не
-- пользователи админки, а внешние люди без логина.

create table external_experts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  affiliation text,     -- аффилиация
  position text,         -- должность/degree
  email text,
  phone text,
  social text,
  created_at timestamptz not null default now()
);

-- Модератор привязан к паре (секция, слот) — т.е. к конкретной строке section_slots.
-- Один модератор на section_slot (разные слоты одной секции могут иметь разных
-- модераторов — это уже покрыто тем, что модератор привязан к section_slot, а не к section).
create table section_slot_moderators (
  section_slot_id uuid primary key references section_slots(id) on delete cascade,
  expert_id uuid not null references external_experts(id) on delete cascade
);


-- ============================================================
-- РАСПРЕДЕЛЕНИЕ ДОКЛАДОВ
-- ============================================================
-- Один доклад — обычно одна заявка целиком (application), распределяется
-- в конкретный (section, slot). Погранслучаи (доклад логически можно
-- отнести к нескольким секциям) решаются вручную при распределении —
-- технологически это всё равно один section_slot_id на заявку.

create table talk_assignments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references applications(id) on delete cascade,
  section_slot_id uuid not null references section_slots(id) on delete cascade,

  talk_number int not null,  -- порядковый номер доклада внутри слота (последняя цифра ID)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (section_slot_id, talk_number)  -- номер доклада уникален внутри пары (секция, слот)
);

create trigger trg_talk_assignments_updated_at
  before update on talk_assignments
  for each row
  execute function set_updated_at();

create index idx_talk_assignments_section_slot on talk_assignments(section_slot_id);

-- ---------- Составной человекочитаемый ID доклада ----------
-- Формат: день-слот-секция-доклад (пример: 1111).
-- Вычисляется на лету (view), а не хранится как отдельное поле, т.к.
-- зависит от sort_order дня/слота и section_day_numbers, которые могут
-- измениться при перераспределении — хранимое поле рассинхронизировалось бы.

create view talk_display_ids as
select
  ta.id as talk_assignment_id,
  ta.application_id,
  cd.sort_order as day_number,
  ts.sort_order as slot_number,
  sdn.section_number,
  ta.talk_number,
  (
    cd.sort_order::text
    || ts.sort_order::text
    || sdn.section_number::text
    || ta.talk_number::text
  ) as display_id
from talk_assignments ta
join section_slots ss on ss.id = ta.section_slot_id
join time_slots ts on ts.id = ss.slot_id
join conference_days cd on cd.id = ts.day_id
join section_day_numbers sdn on sdn.section_id = ss.section_id and sdn.day_id = cd.id;

comment on view talk_display_ids is
  'Составной ID доклада (день-слот-секция-доклад) вычисляется на лету, '
  'не хранится как поле — зависит от изменяемых sort_order/section_number. '
  'ВНИМАНИЕ: конкатенация чисел как в примере (1111) работает только пока '
  'каждый компонент однозначно 1 цифра; при >9 секций/слотов/докладов в день '
  'нужен разделитель (напр. "1-1-1-1") — уточнить с пользователем при достижении.';


-- ============================================================
-- ПРЕДУПРЕЖДЕНИЕ О ВМЕСТИМОСТИ СЛОТА
-- ============================================================
-- ~90 минут, доклад = 10 мин + 5-7 мин вопросы => 4-6 докладов на слот.
-- Автоматическое ПРЕДУПРЕЖДЕНИЕ (не блокировка) при превышении — реализуется
-- как view для UI, а не constraint (constraint бы жёстко блокировал вставку).

create view slot_capacity_warnings as
select
  ss.slot_id,
  ts.day_id,
  count(ta.id) as talks_count
from section_slots ss
join time_slots ts on ts.id = ss.slot_id
join talk_assignments ta on ta.section_slot_id = ss.id
group by ss.slot_id, ts.day_id
having count(ta.id) > 6;

comment on view slot_capacity_warnings is
  'Слоты с числом докладов > 6 (мягкий верхний порог из расчёта вместимости). '
  'UI показывает предупреждение, не блокирует. Порог 6 — верхняя граница '
  'из контекста ("4-6 докладов на слот"); если нужен другой порог, изменить здесь.';
