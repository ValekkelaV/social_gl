-- ============================================================
-- RLS: генерация документов
-- ============================================================
-- Контекст не уточняет отдельно, кто может генерировать документы — это
-- разные типы (программа/расписание — расписание секций; списки для
-- охраны/бейджей — вероятно административное/техническое сопровождение).
-- Даю доступ всему оргкомитету на чтение лога и создание записи о генерации
-- (сама генерация — не деструктивное действие, это создание нового файла,
-- не изменение исходных данных) — если нужно точнее ограничить по типу
-- документа/комитету, уточните и я разделю политики по document_type.

alter table generated_documents enable row level security;

create policy generated_documents_select_all
  on generated_documents for select
  to authenticated
  using (exists (select 1 from people where id = auth.uid()));

create policy generated_documents_insert_org
  on generated_documents for insert
  to authenticated
  with check (
    generated_by = auth.uid()
    and exists (select 1 from people where id = auth.uid())
  );

-- Намеренно нет update/delete: лог генераций неизменяем постфактум
-- (факт "сгенерировали такого-то числа" не должен переписываться).
