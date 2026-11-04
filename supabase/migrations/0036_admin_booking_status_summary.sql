-- Admins receive booking status totals only; individual viewing requests remain landlord-only.
create view admin_dashboard_booking_statuses as
select statuses.status,
       count(v.id)::integer as booking_count
from (
  values
    ('new'), ('contacted'), ('scheduled'), ('rescheduled'),
    ('done'), ('no_show'), ('house_taken'), ('cancelled')
) as statuses(status)
left join visit_requests v on v.status::text = statuses.status
where is_admin()
group by statuses.status;

grant select on admin_dashboard_booking_statuses to authenticated;
