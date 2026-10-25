-- 0005_jobs: scheduled work that must be safe to run twice.

-- Called once a month (and safe to call again): adds that month's rent charge to every running tenancy.
create function generate_charges(p_year integer, p_month integer) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if p_month not between 1 and 12 then raise exception 'Invalid month'; end if;
  insert into charges(tenancy_id, landlord_id, period_year, period_month, amount)
  select t.id, t.landlord_id, p_year, p_month, t.rent_amount
    from tenancies t
   where t.status <> 'ended'
     and landlord_active(t.landlord_id)
     and t.started_on <= (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date
  on conflict (tenancy_id, period_year, period_month) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function generate_charges(integer, integer) from public, anon, authenticated;
grant execute on function generate_charges(integer, integer) to service_role;
