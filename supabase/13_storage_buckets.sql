-- ============================================================
-- СоцПоляна: Storage-бакеты
-- ============================================================
-- Три бакета по типу файлов — упрощает политики (без разбора префиксов пути
-- внутри одного бакета) и позволяет применять правила (например, будущую
-- очистку старья) к бакету целиком, а не фильтровать по пути.
--
-- Все данные в проекте открыты всему оргкомитету (people) — файлы не
-- исключение. Доступ идёт через обычную RLS-модель Storage: таблица
-- storage.objects со своими policies, bucket публичным НЕ делаем (public
-- flag просто открыл бы файлы вообще всем в интернете без авторизации) —
-- вместо этого authenticated-пользователи из people читают/пишут через
-- политики ниже, что и есть "открыто всем в оргкомитете".

insert into storage.buckets (id, name, public)
values
  ('application-files', 'application-files', false),
  ('content-media', 'content-media', false),
  ('generated-documents', 'generated-documents', false)
on conflict (id) do nothing;


-- ---------- APPLICATION-FILES ----------
-- Тезисы (docx/pdf), прикреплённые к заявке. Весь оргкомитет читает/пишет,
-- как и саму таблицу applications.

create policy application_files_select_all
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'application-files'
    and exists (select 1 from people where id = auth.uid())
  );

create policy application_files_insert_org
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'application-files'
    and exists (select 1 from people where id = auth.uid())
  );

create policy application_files_update_org
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'application-files'
    and exists (select 1 from people where id = auth.uid())
  )
  with check (
    bucket_id = 'application-files'
    and exists (select 1 from people where id = auth.uid())
  );

create policy application_files_delete_org
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'application-files'
    and exists (select 1 from people where id = auth.uid())
  );


-- ---------- CONTENT-MEDIA ----------
-- Картинки/медиа для постов контент-плана. Права идентичны content_posts —
-- весь оргкомитет, без привязки к комитету.

create policy content_media_select_all
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'content-media'
    and exists (select 1 from people where id = auth.uid())
  );

create policy content_media_insert_org
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'content-media'
    and exists (select 1 from people where id = auth.uid())
  );

create policy content_media_update_org
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'content-media'
    and exists (select 1 from people where id = auth.uid())
  )
  with check (
    bucket_id = 'content-media'
    and exists (select 1 from people where id = auth.uid())
  );

create policy content_media_delete_org
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'content-media'
    and exists (select 1 from people where id = auth.uid())
  );


-- ---------- GENERATED-DOCUMENTS ----------
-- Программа/расписание/списки — генерируются вне БД (Node.js/Puppeteer),
-- сюда только загружается готовый файл. Чтение — весь оргкомитет (как лог
-- generated_documents). Запись — тоже открыта всем, т.к. в контексте не
-- уточнено разделение по комитетам для генерации (см. комментарий в
-- 12_document_generation_rls.sql — то же допущение здесь).
-- Намеренно нет delete-политики: как и таблица generated_documents,
-- файлы не должны удаляться постфактум (история генераций неизменяема).

create policy generated_documents_files_select_all
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'generated-documents'
    and exists (select 1 from people where id = auth.uid())
  );

create policy generated_documents_files_insert_org
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'generated-documents'
    and exists (select 1 from people where id = auth.uid())
  );
