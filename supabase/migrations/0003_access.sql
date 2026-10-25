-- 0003_access: who may see and do what. Deny by default, then allow narrowly.
-- Every rule here is checked by supabase/tests, including attempts to break it.

-- ---------- Helpers used by the policies ----------
create function is_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;
create function landlord_active(p_landlord uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles where id = p_landlord and role = 'landlord' and landlord_state = 'active')
$$;
create function caretaker_has_house(p_house uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from caretaker_assignments where caretaker_id = auth.uid() and house_id = p_house)
$$;

-- ---------- Public listings: the only thing a stranger can read ----------
create view public_listings as
select h.id, h.title, c.name as county, t.name as town, h.house_type, h.rent_amount, h.deposit_amount,
       h.total_units, h.vacant_units, h.amenities, h.rules, h.electricity_note,
       (select count(*) from house_photos p where p.house_id = h.id)::int as photo_count,
       true as verified_landlord
from houses h
join counties c on c.id = h.county_id
join towns t on t.id = h.town_id
join profiles l on l.id = h.landlord_id
where h.vacant_units > 0                                    -- full houses vanish from search
  and l.landlord_state = 'active'                           -- suspended or expired landlords vanish too
  and (select count(*) from house_photos p where p.house_id = h.id) >= 3;

create view public_listing_photos as
select p.house_id, p.position, p.storage_path from house_photos p where p.house_id in (select id from public_listings);

-- ---------- Viewing requests (visitors have no account, so these run on the server) ----------
create function create_visit_request(p_house uuid, p_name text, p_phone text, p_date date, p_window text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare h houses%rowtype; new_id uuid;
begin
  select * into h from houses where id = p_house;
  if not found or h.vacant_units < 1 or not landlord_active(h.landlord_id) then raise exception 'This house is not available'; end if;
  if p_date < current_date or p_date > current_date + 7 then raise exception 'Pick a date within the next 7 days'; end if;
  if (select count(*) from visit_requests where visitor_phone = p_phone and status in ('new','contacted','scheduled','rescheduled')) >= 3 then
    raise exception 'Too many open requests for this number';
  end if;
  if (select count(*) from visit_requests where house_id = p_house and status in ('new','contacted','scheduled','rescheduled')) >= 5 then
    raise exception 'Viewing requests are full for this house';   -- flood protection
  end if;
  insert into visit_requests(house_id, visitor_name, visitor_phone, preferred_date, time_window)
    values (p_house, p_name, p_phone, p_date, p_window) returning id into new_id;
  return new_id;
end $$;

create function reschedule_visit(p_request uuid, p_date date, p_window text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v visit_requests%rowtype;
begin
  select vr.* into v from visit_requests vr join houses h on h.id = vr.house_id
   where vr.id = p_request and h.landlord_id = auth.uid() for update of vr;
  if not found then raise exception 'Viewing not found'; end if;
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  if v.status not in ('scheduled','rescheduled') then raise exception 'Only scheduled viewings can be rescheduled'; end if;
  if v.reschedule_count >= 2 then raise exception 'Maximum 2 reschedules'; end if;
  if p_date < current_date or p_date > current_date + 7 then raise exception 'Pick a date within the next 7 days'; end if;
  if p_window not in ('Morning','Afternoon','Evening') then raise exception 'Invalid time window'; end if;
  update visit_requests set scheduled_date = p_date, scheduled_window = p_window, status = 'rescheduled',
         reschedule_count = reschedule_count + 1 where id = v.id;
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'viewing_rescheduled', 'viewing', v.id, jsonb_build_object('date', p_date, 'window', p_window));
end $$;

-- ---------- Landlord verification ----------
create function mark_contact_verified(p_user uuid, p_kind text, p_phone text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_kind = 'email' then
    update profiles set email_verified = true, landlord_state = case when landlord_state = 'pending_email' then 'pending_phone' else landlord_state end where id = p_user;
  elsif p_kind = 'phone' then
    update profiles set phone_verified = true, phone = coalesce(p_phone, phone),
           landlord_state = case when landlord_state = 'pending_phone' then 'pending_kyc' else landlord_state end where id = p_user;
  else raise exception 'Unknown contact kind'; end if;
end $$;

create function submit_kyc(p_national_id text, p_kra_pin text, p_front text, p_back text, p_kra text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare st landlord_state; n int; new_id uuid;
begin
  select landlord_state into st from profiles where id = auth.uid() and role = 'landlord';
  if st is distinct from 'pending_kyc' then raise exception 'Documents cannot be submitted right now'; end if;
  select count(*) into n from kyc_submissions where landlord_id = auth.uid();
  if n >= 3 then raise exception 'Maximum attempts reached. Contact support'; end if;
  insert into kyc_submissions(landlord_id, national_id, kra_pin, id_front_path, id_back_path, kra_path, attempt)
    values (auth.uid(), p_national_id, upper(trim(p_kra_pin)), p_front, p_back, p_kra, n + 1) returning id into new_id;
  update profiles set landlord_state = 'kyc_submitted' where id = auth.uid();
  return new_id;
end $$;

create function review_kyc(p_submission uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare k kyc_submissions%rowtype;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  select * into k from kyc_submissions where id = p_submission and status = 'pending' for update;
  if not found then raise exception 'Submission not found'; end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to reject'; end if;
  update kyc_submissions set status = case when p_approve then 'approved'::kyc_status else 'rejected'::kyc_status end,
         reject_reason = case when p_approve then null else p_reason end, reviewed_by = auth.uid(), reviewed_at = now() where id = k.id;
  update profiles set landlord_state = case when p_approve then 'kyc_approved'::landlord_state else 'pending_kyc'::landlord_state end where id = k.landlord_id;
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), case when p_approve then 'kyc_approved' else 'kyc_rejected' end, 'kyc', k.landlord_id, jsonb_build_object('reason', p_reason));
end $$;

-- ---------- Admin: suspend and resume (the admin never touches tenants) ----------
create function admin_suspend_landlord(p_landlord uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update profiles set landlord_state = 'suspended' where id = p_landlord and role = 'landlord' and landlord_state in ('active','expired');
  if not found then raise exception 'Landlord cannot be suspended'; end if;
  update subscriptions set status = 'suspended', suspended_reason = p_reason where landlord_id = p_landlord;
  insert into audit_log(actor, action, entity, entity_id, detail) values (auth.uid(), 'landlord_suspended', 'subscription', p_landlord, jsonb_build_object('reason', p_reason));
end $$;

create function admin_resume_landlord(p_landlord uuid, p_ref text, p_amount integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  if char_length(coalesce(trim(p_ref), '')) < 8 then raise exception 'Enter the full M-Pesa reference'; end if;
  perform activate_subscription(p_landlord, upper(trim(p_ref)), p_amount, auth.uid());
end $$;

-- ---------- Small self-service functions ----------
create function update_my_emergency_contact(p_name text, p_phone text, p_relationship text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update tenancies set emergency_name = p_name, emergency_phone = p_phone, emergency_relationship = p_relationship
   where tenant_user_id = auth.uid() and status <> 'ended' and landlord_active(landlord_id);
  if not found then raise exception 'Tenancy not found'; end if;
end $$;

create function set_payment_mode(p_mode payment_mode) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_accounts%rowtype;
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  select * into a from payment_accounts where landlord_id = auth.uid();
  if not found then raise exception 'Payment account not found'; end if;
  if p_mode = 'own' and a.status <> 'connected' then raise exception 'Connect and verify your own Paybill first'; end if;
  update payment_accounts set mode = p_mode where landlord_id = auth.uid();
  insert into audit_log(actor, action, entity, entity_id, detail) values (auth.uid(), 'payment_mode_changed', 'payment_account', a.id, jsonb_build_object('mode', p_mode));
end $$;

create function complaints_set_landlord() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  select landlord_id into new.landlord_id from tenancies where id = new.tenancy_id;
  return new;
end $$;
create trigger complaints_landlord before insert on complaints for each row execute function complaints_set_landlord();

create function payout_destination_reset() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated','anon') then       -- a browser can never mark its own destination as verified
    if tg_op = 'INSERT' then new.verified := false;
    else new.verified := old.verified and new.kind = old.kind and new.destination = old.destination and new.account_ref is not distinct from old.account_ref;
    end if;
  end if;
  return new;
end $$;
create trigger payout_destination_reset before insert or update on payout_destinations for each row execute function payout_destination_reset();

-- ---------- Admin overview: houses tallied to the monthly payment, no tenant data ----------
create view admin_landlord_overview as
select p.id as landlord_id, p.full_name, p.email, p.phone, p.landlord_state,
       u.units, price_for_units(u.units) as monthly_price,
       s.period_end, (s.period_end - current_date) as days_left, w.balance_kes as sms_balance
from profiles p
left join subscriptions s on s.landlord_id = p.id
left join sms_wallets w on w.landlord_id = p.id
cross join lateral (select coalesce(sum(h.total_units), 0)::int as units from houses h where h.landlord_id = p.id) u
where p.role = 'landlord' and is_admin();

-- ======================= Row-level security =======================
alter table audit_log enable row level security;
alter table profiles enable row level security;
alter table counties enable row level security;
alter table towns enable row level security;
alter table houses enable row level security;
alter table house_photos enable row level security;
alter table caretaker_assignments enable row level security;
alter table visit_requests enable row level security;
alter table kyc_submissions enable row level security;
alter table tenancies enable row level security;
alter table complaints enable row level security;
alter table complaint_messages enable row level security;
alter table notices enable row level security;
alter table payment_accounts enable row level security;
alter table payout_destinations enable row level security;
alter table charges enable row level security;
alter table payment_attempts enable row level security;
alter table ledger_entries enable row level security;
alter table held_payments enable row level security;
alter table payouts enable row level security;
alter table payout_items enable row level security;
alter table subscriptions enable row level security;
alter table subscription_payments enable row level security;
alter table sms_wallets enable row level security;
alter table sms_recharges enable row level security;
alter table sms_messages enable row level security;

create policy profiles_read on profiles for select to authenticated using (id = auth.uid() or (is_admin() and role = 'landlord'));
create policy profiles_update_self on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy counties_read on counties for select to anon, authenticated using (true);
create policy towns_read on towns for select to anon, authenticated using (true);
create policy towns_admin_write on towns for all to authenticated using (is_admin()) with check (is_admin());

create policy houses_read on houses for select to authenticated using (
  (landlord_id = auth.uid() and landlord_active(landlord_id))
  or (caretaker_has_house(id) and landlord_active(landlord_id))
  or exists (select 1 from tenancies t where t.house_id = houses.id and t.tenant_user_id = auth.uid() and landlord_active(t.landlord_id)));
create policy houses_insert on houses for insert to authenticated with check (landlord_id = auth.uid() and landlord_active(auth.uid()));
create policy houses_update on houses for update to authenticated using (landlord_id = auth.uid() and landlord_active(auth.uid())) with check (landlord_id = auth.uid());
create policy houses_delete on houses for delete to authenticated using (landlord_id = auth.uid() and landlord_active(auth.uid()));

create policy photos_all on house_photos for all to authenticated
  using (exists (select 1 from houses h where h.id = house_id and h.landlord_id = auth.uid() and landlord_active(auth.uid())))
  with check (exists (select 1 from houses h where h.id = house_id and h.landlord_id = auth.uid() and landlord_active(auth.uid())));

create policy caretakers_landlord on caretaker_assignments for all to authenticated
  using (landlord_id = auth.uid() and landlord_active(auth.uid())) with check (landlord_id = auth.uid() and landlord_active(auth.uid()));
create policy caretakers_self on caretaker_assignments for select to authenticated using (caretaker_id = auth.uid());

create policy visits_admin_read on visit_requests for select to authenticated using (is_admin());
create policy visits_admin_update on visit_requests for update to authenticated using (is_admin()) with check (is_admin());
create policy visits_landlord_read on visit_requests for select to authenticated using (
  status in ('scheduled','rescheduled','done','no_show','house_taken')
  and exists (select 1 from houses h where h.id = house_id and h.landlord_id = auth.uid() and landlord_active(auth.uid())));

create policy kyc_read on kyc_submissions for select to authenticated using (landlord_id = auth.uid() or is_admin());

create policy tenancies_read on tenancies for select to authenticated using (
  (landlord_id = auth.uid() and landlord_active(landlord_id))
  or (tenant_user_id = auth.uid() and landlord_active(landlord_id))
  or (caretaker_has_house(house_id) and landlord_active(landlord_id)));
create policy tenancies_insert on tenancies for insert to authenticated with check (landlord_id = auth.uid() and landlord_active(auth.uid()));
create policy tenancies_update on tenancies for update to authenticated using (landlord_id = auth.uid() and landlord_active(auth.uid())) with check (landlord_id = auth.uid());

create policy complaints_read on complaints for select to authenticated using (
  (landlord_id = auth.uid() and landlord_active(landlord_id))
  or exists (select 1 from tenancies t where t.id = tenancy_id and t.tenant_user_id = auth.uid() and landlord_active(t.landlord_id))
  or exists (select 1 from tenancies t where t.id = tenancy_id and caretaker_has_house(t.house_id) and landlord_active(t.landlord_id)));
create policy complaints_insert on complaints for insert to authenticated with check (
  exists (select 1 from tenancies t where t.id = tenancy_id and t.tenant_user_id = auth.uid() and t.status <> 'ended' and landlord_active(t.landlord_id)));
create policy complaints_update on complaints for update to authenticated using (landlord_id = auth.uid() and landlord_active(auth.uid())) with check (landlord_id = auth.uid());

create policy cmsg_read on complaint_messages for select to authenticated using (exists (select 1 from complaints c where c.id = complaint_id));
create policy cmsg_insert on complaint_messages for insert to authenticated with check (author_id = auth.uid() and exists (select 1 from complaints c where c.id = complaint_id));

create policy notices_landlord on notices for all to authenticated
  using (landlord_id = auth.uid() and landlord_active(auth.uid())) with check (landlord_id = auth.uid() and landlord_active(auth.uid()));
create policy notices_tenant on notices for select to authenticated using (
  exists (select 1 from tenancies t where t.tenant_user_id = auth.uid() and t.landlord_id = notices.landlord_id and landlord_active(t.landlord_id)
          and (notices.house_id is null or notices.house_id = t.house_id)));

create policy payacct_read on payment_accounts for select to authenticated using (landlord_id = auth.uid());
create policy paydest_read on payout_destinations for select to authenticated using (landlord_id = auth.uid());
create policy paydest_write on payout_destinations for insert to authenticated with check (landlord_id = auth.uid() and landlord_active(auth.uid()));
create policy paydest_update on payout_destinations for update to authenticated using (landlord_id = auth.uid() and landlord_active(auth.uid())) with check (landlord_id = auth.uid());

create policy charges_read on charges for select to authenticated using (
  (landlord_id = auth.uid() and landlord_active(landlord_id))
  or exists (select 1 from tenancies t where t.id = tenancy_id and t.tenant_user_id = auth.uid() and landlord_active(t.landlord_id)));
create policy attempts_read on payment_attempts for select to authenticated using (
  (landlord_id = auth.uid() and landlord_active(landlord_id))
  or exists (select 1 from tenancies t where t.id = tenancy_id and t.tenant_user_id = auth.uid() and landlord_active(t.landlord_id)));
create policy ledger_read on ledger_entries for select to authenticated using (
  (landlord_id = auth.uid() and landlord_active(landlord_id))
  or exists (select 1 from tenancies t where t.id = tenancy_id and t.tenant_user_id = auth.uid() and landlord_active(t.landlord_id)));
create policy held_read on held_payments for select to authenticated using ((landlord_id = auth.uid() and landlord_active(landlord_id)) or (is_admin() and landlord_id is null));
create policy payouts_read on payouts for select to authenticated using (landlord_id = auth.uid());
create policy payout_items_read on payout_items for select to authenticated using (exists (select 1 from payouts p where p.id = payout_id and p.landlord_id = auth.uid()));

create policy subs_read on subscriptions for select to authenticated using (landlord_id = auth.uid() or is_admin());
create policy subpay_read on subscription_payments for select to authenticated using (landlord_id = auth.uid() or is_admin());
create policy smsw_read on sms_wallets for select to authenticated using (landlord_id = auth.uid() or is_admin());
create policy smsr_read on sms_recharges for select to authenticated using (landlord_id = auth.uid() or is_admin());
create policy smsm_read on sms_messages for select to authenticated using (landlord_id = auth.uid() and landlord_active(landlord_id));   -- recipients are tenants: admin cannot see them

create policy audit_read on audit_log for select to authenticated using (
  actor = auth.uid() or (is_admin() and entity in ('kyc','subscription','house','viewing','profile')));

-- ======================= Privileges: nothing by default =======================
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges revoke execute on functions from public;                       -- the built-in default lets everyone run new functions
alter default privileges in schema public revoke execute on functions from anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- reads
grant select on profiles, counties, towns, houses, house_photos, caretaker_assignments, visit_requests, kyc_submissions,
  tenancies, complaints, complaint_messages, notices, payout_destinations, charges, payment_attempts, ledger_entries,
  held_payments, payouts, payout_items, subscriptions, subscription_payments, sms_wallets, sms_recharges, sms_messages,
  audit_log, tenancy_balances, admin_landlord_overview to authenticated;
grant select (id, landlord_id, mode, shortcode, shortcode_kind, status, failure_reason, last_verified_at) on payment_accounts to authenticated;  -- never the secrets
grant select on counties, towns, public_listings, public_listing_photos to anon;
grant select on public_listings, public_listing_photos to authenticated;

-- writes, column by column
grant update (full_name) on profiles to authenticated;                                    -- role and state can never be self-edited
grant select, insert, delete on towns to authenticated;
grant update (name) on towns to authenticated;
grant insert (landlord_id, title, county_id, town_id, house_type, rent_amount, deposit_amount, total_units, vacant_units, amenities, rules, electricity_note) on houses to authenticated;
grant update (title, county_id, town_id, house_type, rent_amount, deposit_amount, total_units, vacant_units, amenities, rules, electricity_note) on houses to authenticated;
grant delete on houses to authenticated;
grant insert, update, delete on house_photos to authenticated;
grant insert, delete on caretaker_assignments to authenticated;
grant update (status, admin_notes, scheduled_date, scheduled_window) on visit_requests to authenticated;
grant insert (landlord_id, house_id, unit_label, tenant_name, tenant_phone, emergency_name, emergency_phone, emergency_relationship, rent_amount, deposit_amount, due_day, started_on) on tenancies to authenticated;
grant update (tenant_name, tenant_phone, emergency_name, emergency_phone, emergency_relationship, rent_amount, due_day, status, agreement_printed_on, agreement_signed_on, agreement_file_path, electricity_enabled, kplc_paybill, meter_number) on tenancies to authenticated;
grant insert (tenancy_id, category, title) on complaints to authenticated;
grant update (status, priority, assigned_to) on complaints to authenticated;
grant insert (complaint_id, author_id, body) on complaint_messages to authenticated;
grant insert, update, delete on notices to authenticated;
grant insert (landlord_id, kind, destination, account_ref), update (kind, destination, account_ref) on payout_destinations to authenticated;

-- functions a signed-in user may call (each one checks who is calling)
grant execute on function is_admin(), landlord_active(uuid), caretaker_has_house(uuid), price_for_units(integer),
  reschedule_visit(uuid, date, text), submit_kyc(text, text, text, text, text), review_kyc(uuid, boolean, text),
  admin_suspend_landlord(uuid, text), admin_resume_landlord(uuid, text, integer), update_my_emergency_contact(text, text, text),
  set_payment_mode(payment_mode), resolve_held_payment(uuid, uuid), reverse_payment(uuid, text)
  to authenticated;   -- current_balance and landlord_units are server-only: they bypass row-level security
grant execute on function price_for_units(integer) to anon;
