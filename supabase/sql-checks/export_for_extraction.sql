-- Экспорт заявок для extract_abstract_text.py: все заявки, у которых
-- abstract_file_url — реальная ссылка (не null, не плейсхолдер, не мусор
-- вроде #REF!). abstract_text НЕ фильтруем по пустоте — наличие файла и
-- наличие текста не взаимоисключающие: у многих заявок будет и то, и
-- другое (напр. текст ввели вручную, а файл тоже приложен) или только файл.
--
-- Скрипт сам не трогает abstract_text, если он уже непустой — его UPDATE
-- идёт с условием "and (abstract_text is null or abstract_text = '')",
-- так что запускать его на всех заявках с файлом безопасно: там, где текст
-- уже есть, строка просто не перезапишется.

select id, abstract_file_url
from applications
where abstract_file_url is not null
  and abstract_file_url != '__PENDING_BACKFILL__'
  and abstract_file_url ~ '^https?://';

-- Выполните этот запрос в Supabase SQL Editor, затем нажмите "Export to CSV"
-- в панели результатов (обычно кнопка сверху справа над таблицей результатов).
-- Сохранённый файл и есть --applications-csv для extract_abstract_text.py.
