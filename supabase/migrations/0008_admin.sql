-- 0008_admin: everything the admin area needs. The admin sees landlords, documents, subscriptions, SMS totals and viewings.
-- The admin never sees tenants, rent, complaints or SMS recipients.

-- Admin power now needs a second factor. Even a stolen admin password opens nothing:
-- the database itself refuses unless the session was upgraded with an authenticator code (aal2).
create or replace function is_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- ---------- Subscription reminders sent by the admin ----------
create table subscription_reminders (
  id          uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references profiles(id) on delete cascade,
  sent_by     uuid not null references profiles(id),
  status      text not null default 'sending' check (status in ('sending','sent','failed')),
  created_at  timestamptz not null default now()
);
create index subscription_reminders_idx on subscription_reminders(landlord_id, created_at desc);
alter table subscription_reminders enable row level security;          -- server only

-- One reminder per landlord per day. Returns what the message needs.
create function claim_subscription_reminder(p_admin uuid, p_landlord uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p profiles%rowtype; s subscriptions%rowtype; rid uuid; days int;
begin
  select * into p from profiles where id = p_landlord and role = 'landlord';
  if not found then raise exception 'Landlord not found'; end if;
  if p.landlord_state not in ('active','expired') then raise exception 'Reminders are only for active or expired accounts'; end if;
  if p.phone is null or not p.phone_verified then raise exception 'This landlord has no verified phone number'; end if;
  if exists (select 1 from subscription_reminders where landlord_id = p_landlord and status in ('sending','sent') and created_at > now() - interval '24 hours') then
    raise exception 'A reminder was already sent in the last 24 hours';
  end if;
  select * into s from subscriptions where landlord_id = p_landlord;
  days := case when found then s.period_end - current_date else 0 end;
  insert into subscription_reminders(landlord_id, sent_by) values (p_landlord, p_admin) returning id into rid;
  return jsonb_build_object('reminder_id', rid, 'name', p.full_name, 'phone', p.phone, 'price', price_for_units(landlord_units(p_landlord)), 'days_left', days, 'state', p.landlord_state);
end $$;
create function finish_subscription_reminder(p_id uuid, p_ok boolean) returns void language sql security definer set search_path = public, pg_temp as $$
  update subscription_reminders set status = case when p_ok then 'sent' else 'failed' end where id = p_id and status = 'sending'
$$;

-- ---------- The platform's own Celcom credit: top-ups in, segments used out (KES 0.25 a segment) ----------
create table celcom_ledger (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('topup','usage')),
  segments   integer check (segments > 0),
  amount_kes numeric(10,2) not null check (amount_kes > 0),
  purpose    text,
  ref        text unique,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check ((kind = 'usage') = (segments is not null))
);
alter table celcom_ledger enable row level security;
select make_append_only('celcom_ledger');

create function celcom_record_usage(p_segments integer, p_purpose text) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into celcom_ledger(kind, segments, amount_kes, purpose) values ('usage', p_segments, p_segments * 0.25, p_purpose)
$$;
create function admin_celcom_topup(p_amount numeric, p_ref text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount you topped up'; end if;
  if char_length(coalesce(trim(p_ref), '')) < 4 then raise exception 'Enter the payment reference'; end if;
  insert into celcom_ledger(kind, amount_kes, purpose, ref, created_by) values ('topup', p_amount, 'topup', upper(trim(p_ref)), auth.uid());
end $$;

-- ---------- Admin views. Each returns nothing unless the caller is an admin with a verified second factor. ----------
create or replace view admin_landlord_overview as
select p.id as landlord_id, p.full_name, p.email, p.phone, p.landlord_state,
       u.units, price_for_units(u.units) as monthly_price,
       s.period_end, (s.period_end - current_date) as days_left, w.balance_kes as sms_balance,
       s.status as sub_status, s.suspended_reason,
       (select max(r.created_at) from subscription_reminders r where r.landlord_id = p.id and r.status = 'sent') as last_reminder_at
from profiles p
left join subscriptions s on s.landlord_id = p.id
left join sms_wallets w on w.landlord_id = p.id
cross join lateral (select coalesce(sum(h.total_units), 0)::int as units from houses h where h.landlord_id = p.id) u
where p.role = 'landlord' and is_admin();

create view admin_kyc_queue as
select k.id, k.landlord_id, p.full_name, p.email, p.phone, k.national_id, k.kra_pin,
       k.id_front_path, k.id_back_path, k.kra_path, k.status, k.attempt, k.created_at
from kyc_submissions k join profiles p on p.id = k.landlord_id
where is_admin();

create view admin_subscription_payments as
select sp.id, sp.landlord_id, p.full_name, sp.amount_kes, sp.provider_ref, sp.paid_at, (sp.recorded_by is not null) as recorded_by_admin
from subscription_payments sp join profiles p on p.id = sp.landlord_id
where is_admin();

create view admin_celcom_balance as
select topped_up, used, topped_up - used as balance, (topped_up - used) < 500 as low
from (select coalesce(sum(amount_kes) filter (where kind = 'topup'), 0) as topped_up,
             coalesce(sum(amount_kes) filter (where kind = 'usage'), 0) as used
      from celcom_ledger) t
where is_admin();                                   -- the check sits outside the totals, so everyone else gets no row at all

-- Totals only: no recipients, no message text.
create view admin_sms_month as
select segments_sold, revenue_kes, segments_sold * 0.25 as cost_kes, revenue_kes - segments_sold * 0.25 as profit_kes
from (select coalesce(sum(segments), 0)::int as segments_sold, coalesce(sum(cost_kes), 0) as revenue_kes
      from sms_messages
      where cost_kes > 0 and status in ('queued','sent','delivered') and created_at >= date_trunc('month', now())) t
where is_admin();

create view admin_viewings as
select v.id, v.house_id, h.title as house_title, l.full_name as landlord_name, v.visitor_name, v.visitor_phone,
       v.preferred_date, v.time_window, v.status, v.scheduled_date, v.scheduled_window, v.reschedule_count, v.admin_notes, v.created_at
from visit_requests v join houses h on h.id = v.house_id join profiles l on l.id = h.landlord_id
where is_admin();

-- ---------- Viewing status can only move forward along real steps ----------
create function visit_status_guard() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'new'         and new.status in ('contacted','cancelled','house_taken')) or
      (old.status = 'contacted'   and new.status in ('scheduled','cancelled','house_taken')) or
      (old.status = 'scheduled'   and new.status in ('rescheduled','done','no_show','house_taken','cancelled')) or
      (old.status = 'rescheduled' and new.status in ('done','no_show','house_taken','cancelled'))
    ) then raise exception 'A viewing cannot move from % to %', old.status, new.status; end if;
    if new.status = 'scheduled' and (new.scheduled_date is null or new.scheduled_window is null
        or new.scheduled_date < current_date or new.scheduled_date > current_date + 7) then
      raise exception 'Pick a date within the next 7 days and a time window';
    end if;
  end if;
  return new;
end $$;
create trigger visit_status_guard before update on visit_requests for each row execute function visit_status_guard();

-- ---------- Privileges ----------
revoke all on function claim_subscription_reminder(uuid, uuid), finish_subscription_reminder(uuid, boolean), celcom_record_usage(integer, text), admin_celcom_topup(numeric, text) from public, anon, authenticated;
grant execute on function claim_subscription_reminder(uuid, uuid), finish_subscription_reminder(uuid, boolean), celcom_record_usage(integer, text) to service_role;
grant execute on function admin_celcom_topup(numeric, text) to authenticated;
grant select on admin_kyc_queue, admin_subscription_payments, admin_celcom_balance, admin_sms_month, admin_viewings, admin_landlord_overview to authenticated;
revoke all on subscription_reminders, celcom_ledger from anon, authenticated;
