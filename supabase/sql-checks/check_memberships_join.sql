select
  c.id as committee_id,
  c.name as committee_name,
  cm.id as membership_id,
  cm.person_id,
  p.full_name,
  cm.level
from committees c
left join committee_memberships cm on cm.committee_id = c.id
left join people p on p.id = cm.person_id
order by c.name;
