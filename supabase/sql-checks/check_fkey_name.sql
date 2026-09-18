-- Проверить точное имя FK-constraint'а person_id -> people в committee_memberships
select
  conname as constraint_name,
  conrelid::regclass as table_name,
  confrelid::regclass as references_table
from pg_constraint
where conrelid = 'committee_memberships'::regclass
  and contype = 'f';
