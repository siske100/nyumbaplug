-- Admin-only, aggregate marketer performance. No client names, phones, or booking references.
create view admin_dashboard_marketer_performance as
with booking_totals as (
  select marketer_id,
         count(*) filter (where status in ('viewed', 'paid_out'))::integer as bookings,
         coalesce(sum(settlement_amount) filter (where status = 'paid_out'), 0)::numeric as earnings
  from marketplace_bookings
  group by marketer_id
)
select m.marketer_id,
       p.full_name as marketer_name,
       coalesce(l.listings, 0)::integer as listings,
       coalesce(b.bookings, 0)::integer as bookings,
       coalesce(b.earnings, 0)::numeric as earnings
from marketplace_marketers m
join profiles p on p.id = m.marketer_id
left join (
  select marketer_id, count(*)::integer as listings
  from marketplace_listings
  where active
  group by marketer_id
) l on l.marketer_id = m.marketer_id
left join booking_totals b on b.marketer_id = m.marketer_id
where is_admin() and m.status = 'active'
order by bookings desc, earnings desc, marketer_name
limit 5;

grant select on admin_dashboard_marketer_performance to authenticated;
