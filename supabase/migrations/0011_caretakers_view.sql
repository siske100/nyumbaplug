-- 0011: a landlord can see who their caretakers are (name and phone), and nobody else's.
create view my_caretakers as
select ca.caretaker_id, p.full_name, p.phone, ca.house_id, h.title as house_title
from caretaker_assignments ca
join profiles p on p.id = ca.caretaker_id
join houses h on h.id = ca.house_id
where ca.landlord_id = auth.uid() and landlord_active(auth.uid());
grant select on my_caretakers to authenticated;
