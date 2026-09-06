-- ============================================================
-- СоцПоляна: раздел "Секции" — заявки
-- MVP-этап 3 (к приёму заявок, конец февраля/7 марта)
-- ============================================================

-- ============================================================
-- СПРАВОЧНИК ВУЗОВ
-- ============================================================
-- Переиспользуется между годами. Заполняется вручную по мере встречи новых.

create table universities (
  id uuid primary key default gen_random_uuid(),
  full_name text not null unique,
  short_name text,  -- null => подсветка в UI как сигнал "заполнить вручную"
  created_at timestamptz not null default now()
);

create index idx_universities_short_name_null on universities(id) where short_name is null;


-- ============================================================
-- ЗАЯВКИ (APPLICATIONS)
-- ============================================================

create type application_status as enum (
  'submitted', 'under_review', 'accepted', 'rejected', 'needs_revision'
);

create table applications (
  id uuid primary key default gen_random_uuid(),

  -- Контакты — привязаны к заявке целиком, не к конкретному докладчику
  contact_email text,
  contact_phone text,
  contact_social text,

  -- Тематика — свободный текст автора; секция (формируется позже, постфактум) —
  -- ссылка появится в отдельной схеме "распределение по секциям/слотам"
  title text,                 -- название доклада (для программы, рассылок и т.д.)
  proposed_topic text,       -- то, что вписал автор в форме
  desired_section text,       -- "куда хочет" — тоже текст, может совпадать с proposed_topic
                                -- или отсутствовать, если автор указал только тему

  participation_format text,  -- 'доклад' / 'секция' / др., свободная строка на старте

  -- Тезисы: текст ИЛИ файл — оба поля nullable, минимум один заполнен
  abstract_text text,
  abstract_file_url text,     -- ссылка на файл (docx/pdf) в Supabase Storage

  -- Текст заявки живёт вне админки — ссылка на источник для комментирования
  external_doc_url text,      -- Google Doc (открытое комментирование) или конвертированный файл

  status application_status not null default 'submitted',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (abstract_text is not null or abstract_file_url is not null)
);

create index idx_applications_status on applications(status);

-- Общая функция обновления updated_at (используется в нескольких таблицах "Секций")
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_applications_updated_at
  before update on applications
  for each row
  execute function set_updated_at();


-- ============================================================
-- ДОКЛАДЧИКИ (внутри заявки)
-- ============================================================
-- Результат автопарсинга CSV: ФИО/курс/вуз разбиваются по разделителю
-- в структурированный список. Курс/вуз могут быть общими на всех
-- докладчиков заявки или различаться — храним per-докладчик, при
-- одинаковых значениях импорт просто дублирует одно и то же значение
-- в каждую строку (проще, чем городить "общее поле + override").

create table speakers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,

  full_name text not null,
  course text,                          -- курс на момент подачи (свободный текст: "3", "магистратура 1" и т.д.)
  university_id uuid references universities(id),
  university_raw text,                  -- как было в исходном CSV, на случай если university_id не сматчен

  sort_order int not null default 0,    -- порядок докладчиков в заявке (как в исходном списке через ;)

  created_at timestamptz not null default now()
);

create index idx_speakers_application on speakers(application_id);
create index idx_speakers_university on speakers(university_id);


-- ============================================================
-- ИСТОРИЯ ВЕРСИЙ ТЕКСТА (при доработке)
-- ============================================================
-- "На доработке" -> повторная подача НЕ через форму, а по email вручную;
-- кто-то из читающих вручную заносит новую версию текста/файла, статус
-- переоткрывается вручную. Храним снимки abstract_text/abstract_file_url
-- на момент каждой ре-подачи.

create table application_text_revisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,

  abstract_text text,
  abstract_file_url text,
  external_doc_url text,

  recorded_by uuid not null references people(id),  -- кто внёс доработку вручную
  recorded_at timestamptz not null default now(),
  note text  -- опционально: комментарий "получено по почте от ..., дата"
);

create index idx_application_text_revisions_app on application_text_revisions(application_id, recorded_at desc);


-- ============================================================
-- ЧТЕНИЕ ЗАЯВОК
-- ============================================================
-- Минимум 2 человека должны прочитать. Не эксклюзивный захват —
-- список отметок "прочитал(а) X", несколько параллельно.

create table application_reads (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  reader_id uuid not null references people(id),
  read_at timestamptz not null default now(),
  unique (application_id, reader_id)  -- один человек — одна отметка на заявку
);

create index idx_application_reads_application on application_reads(application_id);

-- Быстрая проверка "прочитано минимум 2 людьми"
create view application_read_counts as
  select application_id, count(*) as reads_count
  from application_reads
  group by application_id;


-- ============================================================
-- КОММЕНТАРИИ И ФИДБЕК
-- ============================================================
-- Два отдельных поля/сущности: "комментарии" (сырые, внутренние,
-- множественные — обсуждение между читающими) и "фидбек" (финальный
-- текст, один на заявку, готовый к отправке автору, пишет прочитавший).

create table application_comments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  author_id uuid not null references people(id),
  body text not null,
  created_at timestamptz not null default now()
);

create index idx_application_comments_application on application_comments(application_id);

-- Фидбек — один актуальный текст на заявку (не лог, а редактируемое поле;
-- перезаписывается прочитавшим до отправки). Если нужна история черновиков
-- фидбека — используем тот же паттерн ревизий, что и в content_posts,
-- но пока это не запрошено, оставляем простое поле.
create table application_feedback (
  application_id uuid primary key references applications(id) on delete cascade,
  body text not null default '',
  written_by uuid references people(id),
  updated_at timestamptz not null default now()
);

create trigger trg_application_feedback_updated_at
  before update on application_feedback
  for each row
  execute function set_updated_at();

-- Факт массовой отправки фидбека — отдельная таблица, т.к. право её заполнять
-- уже (только лид комитета "Отбор заявок"), в отличие от права редактировать
-- сам текст фидбека (весь оргкомитет). Разделение прав через RLS требует
-- разделения таблиц/строк, а не столбцов одной строки.
create table application_feedback_sends (
  application_id uuid primary key references applications(id) on delete cascade,
  sent_at timestamptz not null default now(),
  sent_by uuid not null references people(id),
  -- снимок текста на момент отправки — важно, т.к. body в application_feedback
  -- может быть отредактирован позже, а что реально ушло автору, знать нужно
  body_snapshot text not null
);
