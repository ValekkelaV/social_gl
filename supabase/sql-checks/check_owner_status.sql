-- Проверить, что у вас реально стоит is_owner = true, и какие у вас есть membership'ы
select id, full_name, telegram_username, is_owner
from people;

select cm.id, p.full_name, c.name as committee, cm.level
from committee_memberships cm
join people p on p.id = cm.person_id
join committees c on c.id = cm.committee_id;
