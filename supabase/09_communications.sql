-- ============================================================
-- СоцПоляна: коммуникации (MVP)
-- Надстройка над applications — НЕ отдельная база данных.
-- MVP-версия: хранит только шаблоны; сама отправка — вручную через
-- экспорт CSV + загрузку в интерфейс внешнего email-сервиса (Unisender
-- или аналог). Полная API-интеграция и история рассылок — не в этой версии.
-- ============================================================

-- ---------- ШАБЛОНЫ ПИСЕМ ----------
-- Плейсхолдеры вида {full_name}, {talk_title} и т.д. — подставляются при
-- экспорте CSV на основе данных заявки/докладчика/распределения.
-- Список поддерживаемых плейсхолдеров не enforced схемой (свободный текст
-- с плейсхолдерами) — валидируется на уровне приложения при экспорте.

create table email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,          -- рабочее название шаблона, напр. "Заявка принята"
  subject text not null,        -- тема письма, может содержать плейсхолдеры
  body text not null,           -- текст письма с плейсхолдерами

  created_by uuid not null references people(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_email_templates_updated_at
  before update on email_templates
  for each row
  execute function set_updated_at();

comment on table email_templates is
  'Поддерживаемые плейсхолдеры (подставляются при экспорте, не хранятся как '
  'отдельные колонки здесь): {full_name} — ФИО докладчика; {talk_title} — '
  'название доклада (applications.title); {section_name} — название секции; '
  '{day_date} — дата дня конференции; {slot_time} — время слота; '
  '{room} — аудитория; {application_status} — статус заявки; '
  '{feedback_body} — текст фидбека (application_feedback.body). '
  'Список расширяется по мере необходимости без миграции схемы — '
  'просто новый плейсхолдер поддерживается в коде экспорта.';


-- ============================================================
-- ЭКСПОРТ ДЛЯ РАССЫЛКИ
-- ============================================================
-- MVP не хранит саму рассылку (нет adressee list / send log) — это просто
-- view-подсказка для построения запроса на экспорт CSV. Одна строка на
-- ЗАЯВКУ (не на докладчика), т.к. рассылка идёт одним письмом на contact_email
-- заявки, даже если у неё несколько соавторов. ФИО докладчиков агрегируются
-- в одну строку (через "; ", как и в исходном формате заявки) — плейсхолдер
-- {full_name} в этом случае подставляет весь список соавторов сразу.
-- Фильтр аудитории по статусу заявки/секции — обычный WHERE поверх этой view
-- при экспорте, выполняется в приложении, не хранится в БД как сохранённый сегмент.

create view mailing_recipients as
select
  a.id as application_id,
  string_agg(s.full_name, '; ' order by s.sort_order) as full_name,
  a.title as talk_title,
  a.status as application_status,
  a.contact_email,
  sec.name as section_name,
  cd.day_date,
  ts.starts_at as slot_starts_at,
  ts.ends_at as slot_ends_at,
  ss.room,
  af.body as feedback_body
from applications a
join speakers s on s.application_id = a.id
left join talk_assignments ta on ta.application_id = a.id
left join section_slots ss on ss.id = ta.section_slot_id
left join sections sec on sec.id = ss.section_id
left join time_slots ts on ts.id = ss.slot_id
left join conference_days cd on cd.id = ts.day_id
left join application_feedback af on af.application_id = a.id
group by
  a.id, a.title, a.status, a.contact_email,
  sec.name, cd.day_date, ts.starts_at, ts.ends_at, ss.room, af.body;

comment on view mailing_recipients is
  'Одна строка на заявку (не на докладчика) — рассылка идёт одним письмом '
  'на contact_email заявки. {full_name} подставляет всех соавторов через "; ". '
  'Если нужно письмо конкретно на одного из соавторов отдельно — используйте '
  'таблицу speakers напрямую, эта view для этого не предназначена.';
