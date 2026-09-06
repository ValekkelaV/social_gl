-- ============================================================
-- СоцПоляна: генерация документов
-- MVP-этап 5 (к апрелю)
-- ============================================================
-- Все документы генерируются на LIVE-данных, без снэпшотов — если участник
-- отвалился после генерации, PDF устареет; это принятый риск, не решаем
-- архитектурно (см. контекст). Сама генерация (Puppeteer/HTML→PDF,
-- docx-плейсхолдеры) — вне БД, в Node.js-скрипте; здесь только:
--   - цвета секций/слотов (см. sections.color, time_slots.color в 07_scheduling.sql)
--   - лог сгенерированных документов (кто/когда, ссылка на файл)

create type generated_document_type as enum (
  'program_pdf', 'schedule_docx', 'security_list', 'badge_data'
);

create table generated_documents (
  id uuid primary key default gen_random_uuid(),

  document_type generated_document_type not null,
  file_url text not null,  -- ссылка на файл в Supabase Storage

  generated_by uuid not null references people(id),
  generated_at timestamptz not null default now(),

  -- Свободные метаданные о параметрах генерации (напр. какой день/фильтр
  -- использовался для списка охраны) — на случай если понадобится
  -- воспроизвести контекст генерации без строгой структуры под каждый тип
  params jsonb
);

create index idx_generated_documents_type on generated_documents(document_type, generated_at desc);

comment on table generated_documents is
  'Лог фактов генерации: файл создаётся Node.js/Puppeteer-скриптом вне БД, '
  'затем загружается в Storage и сюда пишется ссылка + кто/когда. Данные, '
  'на основе которых сгенерирован документ, НЕ версионируются (live-данные) — '
  'если после генерации данные изменились, старый файл в этом логе может '
  'не соответствовать текущему состоянию БД. Это осознанный компромисс, не баг.';
