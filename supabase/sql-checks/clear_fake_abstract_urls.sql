-- Очистить фейковые/тестовые значения abstract_file_url перед бэкфиллом
-- реальных ссылок на Drive. "Фейковые" включают не только произвольный
-- текст, но и битые Excel/Sheets-ссылки вида #REF! (остаются от старых
-- формул при экспорте/копипасте).
--
-- ВАЖНО: applications_check требует (abstract_text is not null or
-- abstract_file_url is not null) — если у заявки нет ни текста, ни файла,
-- простой UPDATE ... = null уронит constraint. Поэтому для строк, где
-- abstract_text тоже пуст, используем плейсхолдер вместо null (реальная
-- ссылка перезапишет его при бэкфилле; если бэкфилл не найдёт соответствие —
-- плейсхолдер останется явным сигналом "тезисов реально нет", а не тихим null).

-- 1. Посмотреть, что сейчас в abstract_file_url (включая #REF! и подобное):
select id, abstract_file_url, abstract_text
from applications
where abstract_file_url is not null;

-- 2. Заявки, где abstract_text ТОЖЕ пуст — их нельзя занулить, только пометить:
update applications
set abstract_file_url = '__PENDING_BACKFILL__'
where (abstract_file_url is not null and abstract_file_url !~ '^https?://')
  and (abstract_text is null or abstract_text = '');

-- 3. Заявки, где abstract_text заполнен — можно спокойно занулить fake-ссылку:
update applications
set abstract_file_url = null
where (abstract_file_url is not null and abstract_file_url !~ '^https?://')
  and abstract_text is not null
  and abstract_text != '';

-- После этого backfill_file_links.py сможет применить реальные ссылки —
-- его UPDATE использует "and abstract_file_url is null", так что строки с
-- плейсхолдером '__PENDING_BACKFILL__' НЕ обновятся автоматически. Их нужно
-- обработать отдельно (см. ниже) либо временно ослабить условие в скрипте.

-- 4. После backfill_file_links.py — проверить, остались ли ещё плейсхолдеры
-- (значит, для этих заявок совпадения в CSV не нашлось — реальных тезисов
-- действительно нет, это заявка без вложения):
select id, contact_email, abstract_file_url
from applications
where abstract_file_url = '__PENDING_BACKFILL__';

