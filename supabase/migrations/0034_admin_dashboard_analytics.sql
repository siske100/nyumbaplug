-- Admin dashboard aggregates only; never expose tenant or payment-recipient details.
create view admin_dashboard_summary as
select
  (select count(*)::integer from houses) as total_properties,
  (select count(*)::integer from visit_requests
    where created_at >= date_trunc('month', now())) as monthly_bookings,
  (
    (select coalesce(sum(amount_kes), 0) from subscription_payments)
    + (select coalesce(sum(cost_kes), 0) from sms_messages
        where status in ('queued','sent','delivered'))
    + (select coalesce(sum(platform_fee), 0) from marketplace_bookings
        where status = 'paid_out')
  ) as total_revenue,
  (select count(*)::integer from marketplace_marketers where status = 'active') as active_marketers
where is_admin();

create view admin_dashboard_daily as
with days as (
  select generate_series(
    current_date - 29,
    current_date,
    interval '1 day'
  )::date as month
),
bookings as (
  select created_at::date as month, count(*)::integer as total
  from visit_requests
  where created_at >= current_date - 29
  group by 1
),
revenue as (
  select paid_at::date as month, sum(amount_kes) as total
  from subscription_payments
  where paid_at >= current_date - 29
  group by 1
  union all
  select created_at::date as month, sum(cost_kes) as total
  from sms_messages
  where status in ('queued','sent','delivered')
    and created_at >= current_date - 29
  group by 1
  union all
  select settled_at::date as month, sum(platform_fee) as total
  from marketplace_bookings
  where status = 'paid_out'
    and settled_at >= current_date - 29
  group by 1
),
daily_revenue as (
  select month, sum(total) as total from revenue group by month
)
select d.month, coalesce(b.total, 0)::integer as bookings,
       coalesce(r.total, 0)::numeric as revenue
from days d
left join bookings b using (month)
left join daily_revenue r using (month)
where is_admin();

create view admin_dashboard_counties as
with totals as (
  select c.id, c.name as county, count(v.id)::integer as bookings
  from counties c
  join houses h on h.county_id = c.id
  join visit_requests v on v.house_id = h.id
  group by c.id, c.name
),
ranked as (
  select county, bookings,
         round(bookings * 100.0 / nullif(sum(bookings) over (), 0))::integer as share,
         row_number() over (order by bookings desc, county) as rank
  from totals
)
select county, bookings, share from ranked
where is_admin() and rank <= 5;

grant select on admin_dashboard_summary, admin_dashboard_daily, admin_dashboard_counties to authenticated;
