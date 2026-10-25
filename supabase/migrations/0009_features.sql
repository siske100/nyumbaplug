-- 0009_features: invites, visitor codes, platform purchases, reminders, payment credentials, payouts, file storage.

-- ================= Invites: tenants and caretakers only join when a landlord invites them =================
create table login_invites (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('tenant','caretaker')),
  landlord_id   uuid not null references profiles(id) on delete cascade,
  tenancy_id    uuid references tenancies(id) on delete cascade,
  house_id      uuid references houses(id) on delete cascade,
  invitee_name  text,
  invitee_phone text not null check (invitee_phone ~ '^(07|01)[0-9]{8}$'),
  token_hash    text not null unique,                 -- only a hash of the link's secret is stored
  expires_at    timestamptz not null,
  used_at       timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  check ((kind = 'tenant') = (tenancy_id is not null)),
  check ((kind = 'caretaker') = (house_id is not null))
);
alter table login_invites enable row level security;
create policy invites_read on login_invites for select to authenticated using (landlord_id = auth.uid() and landlord_active(auth.uid()));

create function create_invite(p_landlord uuid, p_kind text, p_tenancy uuid, p_house uuid, p_name text, p_phone text, p_hash text)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; h houses%rowtype; exp timestamptz := now() + interval '7 days'; nm text; ph text;
begin
  if not landlord_active(p_landlord) then raise exception 'Your account is not active'; end if;
  if p_kind = 'tenant' then
    select * into t from tenancies where id = p_tenancy and landlord_id = p_landlord and status <> 'ended';
    if not found then raise exception 'Tenant not found'; end if;
    if t.tenant_user_id is not null then raise exception 'This tenant has already joined'; end if;
    nm := t.tenant_name; ph := t.tenant_phone;
    if (select count(*) from login_invites where tenancy_id = t.id and created_at > now() - interval '1 day') >= 5 then raise exception 'Too many invites today'; end if;
    update login_invites set revoked_at = now() where tenancy_id = t.id and used_at is null and revoked_at is null;
  elsif p_kind = 'caretaker' then
    select * into h from houses where id = p_house and landlord_id = p_landlord;
    if not found then raise exception 'House not found'; end if;
    ph := regexp_replace(regexp_replace(regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g'), '^\+254', '0'), '^254', '0');
    if ph !~ '^(07|01)[0-9]{8}$' then raise exception 'Enter a valid Kenyan phone number'; end if;
    nm := nullif(trim(coalesce(p_name, '')), '');
    if (select count(*) from login_invites where house_id = h.id and invitee_phone = ph and created_at > now() - interval '1 day') >= 5 then raise exception 'Too many invites today'; end if;
    update login_invites set revoked_at = now() where house_id = h.id and invitee_phone = ph and used_at is null and revoked_at is null;
  else raise exception 'Unknown invite type'; end if;
  insert into login_invites(kind, landlord_id, tenancy_id, house_id, invitee_name, invitee_phone, token_hash, expires_at)
    values (p_kind, p_landlord, case when p_kind = 'tenant' then p_tenancy end, case when p_kind = 'caretaker' then p_house end, nm, ph, p_hash, exp);
  return exp;
end $$;

create function invite_lookup(p_hash text) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('kind', i.kind, 'landlord_name', l.full_name, 'invitee_name', i.invitee_name, 'invitee_phone', i.invitee_phone,
           'house_title', coalesce(th.title, ch.title), 'unit_label', t.unit_label)
  from login_invites i
  join profiles l on l.id = i.landlord_id
  left join tenancies t on t.id = i.tenancy_id
  left join houses th on th.id = t.house_id
  left join houses ch on ch.id = i.house_id
  where i.token_hash = p_hash and i.used_at is null and i.revoked_at is null and i.expires_at > now() and landlord_active(i.landlord_id)
$$;

create function invite_accept(p_hash text, p_user uuid) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare i login_invites%rowtype; p profiles%rowtype;
begin
  select * into i from login_invites where token_hash = p_hash and used_at is null and revoked_at is null and expires_at > now() for update;
  if not found or not landlord_active(i.landlord_id) then raise exception 'This invite link is no longer valid'; end if;
  select * into p from profiles where id = p_user;
  if not found or p.role::text <> i.kind then raise exception 'This account cannot accept that invite'; end if;
  if i.kind = 'tenant' then
    update tenancies set tenant_user_id = p_user where id = i.tenancy_id and tenant_user_id is null;
    if not found then raise exception 'This tenant has already joined'; end if;
  else
    insert into caretaker_assignments(caretaker_id, landlord_id, house_id) values (p_user, i.landlord_id, i.house_id) on conflict do nothing;
  end if;
  update profiles set phone = i.invitee_phone, phone_verified = false, full_name = coalesce(full_name, i.invitee_name) where id = p_user;
  update login_invites set used_at = now() where id = i.id;
  return i.kind;
end $$;

-- ================= Visitors: a verified phone before a viewing request reaches anyone =================
create table visitor_codes (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null check (phone ~ '^(07|01)[0-9]{8}$'),
  ip_hash     text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    smallint not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index visitor_codes_phone_idx on visitor_codes(phone, created_at desc);
create index visitor_codes_ip_idx on visitor_codes(ip_hash, created_at desc);
alter table visitor_codes enable row level security;

create function issue_visitor_code(p_phone text, p_code_hash text, p_ip_hash text) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare exp timestamptz := now() + interval '5 minutes';
begin
  if p_phone !~ '^(07|01)[0-9]{8}$' then raise exception 'Enter a valid Kenyan phone number'; end if;
  if exists (select 1 from visitor_codes where phone = p_phone and created_at > now() - interval '60 seconds') then raise exception 'Wait a minute before requesting another code'; end if;
  if (select count(*) from visitor_codes where phone = p_phone and created_at > now() - interval '1 hour') >= 5 then raise exception 'Too many codes for this number. Try again in an hour'; end if;
  if (select count(*) from visitor_codes where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 10 then raise exception 'Too many requests from your connection. Try again later'; end if;
  update visitor_codes set consumed_at = now() where phone = p_phone and consumed_at is null;
  insert into visitor_codes(phone, ip_hash, code_hash, expires_at) values (p_phone, p_ip_hash, p_code_hash, exp);
  return exp;
end $$;

create function cancel_visitor_code(p_phone text) returns void language sql security definer set search_path = public, pg_temp as $$
  update visitor_codes set consumed_at = now() where phone = p_phone and consumed_at is null
$$;

-- Checks the code and creates the request in one step. If the request is refused the code is NOT used up.
-- Returns null when the code is wrong.
create function submit_visit_request(p_house uuid, p_name text, p_phone text, p_date date, p_window text, p_code_hash text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c visitor_codes%rowtype;
begin
  select * into c from visitor_codes where phone = p_phone and consumed_at is null and expires_at > now() order by created_at desc limit 1 for update;
  if not found then raise exception 'No active code. Request a new one'; end if;
  if c.code_hash <> p_code_hash then
    update visitor_codes set attempts = attempts + 1, consumed_at = case when attempts + 1 >= 5 then now() end where id = c.id;
    return null;
  end if;
  update visitor_codes set consumed_at = now() where id = c.id;
  return create_visit_request(p_house, p_name, p_phone, p_date, p_window);
end $$;

-- ================= Platform purchases by landlords: subscription and SMS credit, paid by M-Pesa =================
create table platform_attempts (
  id                  uuid primary key default gen_random_uuid(),
  landlord_id         uuid not null references profiles(id),
  purpose             text not null check (purpose in ('subscription','sms_recharge')),
  amount              integer not null check (amount > 0),
  msisdn              text not null check (msisdn ~ '^(07|01)[0-9]{8}$'),
  checkout_request_id text not null unique,
  merchant_request_id text,
  status              attempt_status not null default 'pending',
  result_code         integer,
  result_desc         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table platform_attempts enable row level security;
create policy platform_attempts_read on platform_attempts for select to authenticated using (landlord_id = auth.uid());
create trigger platform_attempts_updated before update on platform_attempts for each row execute function set_updated_at();

create function start_platform_attempt(p_landlord uuid, p_purpose text, p_amount integer, p_msisdn text, p_checkout text, p_merchant text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare p profiles%rowtype; expected int; aid uuid;
begin
  select * into p from profiles where id = p_landlord and role = 'landlord';
  if not found then raise exception 'Landlord not found'; end if;
  if (select count(*) from platform_attempts where landlord_id = p_landlord and created_at > now() - interval '1 hour') >= 5 then raise exception 'Too many payment attempts. Try again in an hour'; end if;
  if p_purpose = 'subscription' then
    if p.landlord_state = 'suspended' then raise exception 'Your account is suspended. Call customer care on 0799326074'; end if;
    if p.landlord_state not in ('kyc_approved','active','expired') then raise exception 'Complete verification before paying'; end if;
    expected := price_for_units(landlord_units(p_landlord));
    if p_amount <> expected then raise exception 'The subscription is KES %', expected; end if;
  elsif p_purpose = 'sms_recharge' then
    if p.landlord_state <> 'active' then raise exception 'Your account is not active'; end if;
    if p_amount < 50 or p_amount > 10000 then raise exception 'Recharge between KES 50 and KES 10,000'; end if;
  else raise exception 'Unknown purchase'; end if;
  insert into platform_attempts(landlord_id, purpose, amount, msisdn, checkout_request_id, merchant_request_id)
    values (p_landlord, p_purpose, p_amount, p_msisdn, p_checkout, p_merchant) returning id into aid;
  return aid;
end $$;

create function confirm_platform_payment(p_checkout text, p_receipt text, p_amount integer, p_msisdn text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare a platform_attempts%rowtype;
begin
  if exists (select 1 from subscription_payments where provider_ref = p_receipt) or exists (select 1 from sms_recharges where provider_ref = p_receipt)
     or exists (select 1 from held_payments where provider_ref = p_receipt) then return true; end if;     -- a repeated callback changes nothing
  select * into a from platform_attempts where checkout_request_id = p_checkout for update;
  if not found then raise exception 'Unknown payment request'; end if;
  if p_amount <> a.amount then
    update platform_attempts set status = 'failed', result_desc = 'amount_mismatch' where id = a.id;
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason) values (p_receipt, 'platform:' || a.purpose, p_amount, p_msisdn, 'amount_mismatch');   -- no landlord: the platform handles it
    return false;
  end if;
  if a.purpose = 'subscription' then perform activate_subscription(a.landlord_id, p_receipt, p_amount);
  else perform sms_recharge(a.landlord_id, p_amount, p_receipt); end if;
  update platform_attempts set status = 'succeeded', result_code = 0 where id = a.id;
  return true;
end $$;

create function fail_platform_attempt(p_checkout text, p_code integer, p_desc text) returns void language sql security definer set search_path = public, pg_temp as $$
  update platform_attempts set status = case when p_code = 1037 then 'timeout'::attempt_status else 'failed'::attempt_status end, result_code = p_code, result_desc = p_desc
  where checkout_request_id = p_checkout and status = 'pending'
$$;

-- ================= Rent reminders (the platform pays; the landlord's wallet is charged by the server) =================
create table reminder_schedules (
  landlord_id uuid primary key references profiles(id) on delete cascade,
  triggers    text[] not null default array['2d','due'],
  updated_at  timestamptz not null default now(),
  check (triggers <@ array['7d','4d','2d','1d','due','overdue']::text[])
);
alter table reminder_schedules enable row level security;
create policy schedules_read on reminder_schedules for select to authenticated using (landlord_id = auth.uid());
create policy schedules_insert on reminder_schedules for insert to authenticated with check (landlord_id = auth.uid() and landlord_active(auth.uid()));
create policy schedules_update on reminder_schedules for update to authenticated using (landlord_id = auth.uid() and landlord_active(auth.uid())) with check (landlord_id = auth.uid());

create table rent_reminders_sent (
  tenancy_id   uuid not null references tenancies(id) on delete cascade,
  period_year  smallint not null,
  period_month smallint not null,
  trigger      text not null,
  sent_at      timestamptz not null default now(),
  primary key (tenancy_id, period_year, period_month, trigger)
);
alter table rent_reminders_sent enable row level security;

-- Which tenants should be reminded on a given day. Only tenants who still owe this month's rent, once per reminder.
create function due_reminders(p_date date) returns table (tenancy_id uuid, landlord_id uuid, phone text, tenant_name text, balance integer, trigger text, due_date date)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.landlord_id, t.tenant_phone, t.tenant_name, b.balance, trg, make_date(ym.y, ym.m, t.due_day)
  from tenancies t
  join tenancy_balances b on b.tenancy_id = t.id
  left join reminder_schedules rs on rs.landlord_id = t.landlord_id
  cross join lateral (select extract(year from p_date)::int as y, extract(month from p_date)::int as m) ym
  cross join lateral unnest(coalesce(rs.triggers, array['2d','due'])) as trg
  where t.status in ('active','notice') and landlord_active(t.landlord_id) and b.balance > 0
    and exists (select 1 from charges c where c.tenancy_id = t.id and c.period_year = ym.y and c.period_month = ym.m)
    and p_date = make_date(ym.y, ym.m, t.due_day) + case trg when '7d' then -7 when '4d' then -4 when '2d' then -2 when '1d' then -1 when 'due' then 0 else 1 end
    and not exists (select 1 from rent_reminders_sent s where s.tenancy_id = t.id and s.period_year = ym.y and s.period_month = ym.m and s.trigger = trg)
$$;
create function mark_reminder_sent(p_tenancy uuid, p_date date, p_trigger text) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into rent_reminders_sent(tenancy_id, period_year, period_month, trigger) values (p_tenancy, extract(year from p_date), extract(month from p_date), p_trigger) on conflict do nothing
$$;

create function sms_mark_status(p_message uuid, p_status text, p_provider_id text) returns void language sql security definer set search_path = public, pg_temp as $$
  update sms_messages set status = p_status, provider_msg_id = coalesce(p_provider_id, provider_msg_id)
  where id = p_message and status in ('queued','sent') and p_status in ('sent','delivered','failed')
$$;

-- ================= Payment credentials (written and read only by server code) =================
create function save_payment_credentials(p_landlord uuid, p_shortcode text, p_kind text, p_cipher bytea, p_key_version smallint, p_status connection_status, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update payment_accounts set shortcode = p_shortcode, shortcode_kind = p_kind, credentials_ciphertext = p_cipher, key_version = p_key_version,
         status = p_status, failure_reason = p_reason, last_verified_at = case when p_status = 'connected' then now() end,
         mode = case when p_status <> 'connected' then 'platform'::payment_mode else mode end        -- a broken connection falls back to the platform Paybill
   where landlord_id = p_landlord;
  if not found then raise exception 'Payment account not found'; end if;
  insert into audit_log(actor, action, entity, entity_id, detail) values (p_landlord, 'payment_credentials_saved', 'payment_account', p_landlord, jsonb_build_object('status', p_status));
end $$;
create function get_payment_credentials(p_landlord uuid) returns table (mode payment_mode, shortcode text, shortcode_kind text, cipher bytea, key_version smallint, status connection_status, callback_token text)
language sql stable security definer set search_path = public, pg_temp as $$
  select mode, shortcode, shortcode_kind, credentials_ciphertext, key_version, status, callback_token from payment_accounts where landlord_id = p_landlord
$$;
create function account_by_token(p_token text) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('landlord_id', landlord_id, 'mode', mode) from payment_accounts where callback_token = p_token
$$;

-- ================= Payouts: the admin pays by M-Pesa and records the reference =================
create view admin_payouts as
select p.id, p.landlord_id, l.full_name, p.amount, p.destination_kind, p.destination, p.account_ref, p.status, p.provider_ref, p.created_at, p.paid_at
from payouts p join profiles l on l.id = p.landlord_id where is_admin();

create function admin_mark_payout_paid(p_payout uuid, p_ref text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  if char_length(coalesce(trim(p_ref), '')) < 8 then raise exception 'Enter the full M-Pesa reference'; end if;
  update payouts set status = 'paid', provider_ref = upper(trim(p_ref)), paid_at = now() where id = p_payout and status in ('scheduled','processing');
  if not found then raise exception 'Payout not found or already paid'; end if;
  insert into audit_log(actor, action, entity, entity_id, detail) values (auth.uid(), 'payout_paid', 'payout', p_payout, jsonb_build_object('ref', upper(trim(p_ref))));
end $$;

create function create_due_payouts() returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0; pid uuid;
begin
  for r in select pa.landlord_id from payment_accounts pa join payout_destinations d on d.landlord_id = pa.landlord_id and d.verified
           where pa.mode = 'platform' and landlord_active(pa.landlord_id) loop
    pid := create_payout(r.landlord_id);
    if pid is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ================= File storage =================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('house-photos', 'house-photos', true, 5242880, array['image/jpeg','image/png','image/webp']),
       ('agreements', 'agreements', false, 5242880, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy photos_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'house-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.landlord_active(auth.uid())
  and (select count(*) from storage.objects o where o.bucket_id = 'house-photos' and (storage.foldername(o.name))[1] = auth.uid()::text) < 700);
create policy photos_read_own on storage.objects for select to authenticated using (bucket_id = 'house-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy photos_delete_own on storage.objects for delete to authenticated using (bucket_id = 'house-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.landlord_active(auth.uid()));

create policy agreements_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'agreements' and (storage.foldername(name))[1] = auth.uid()::text and public.landlord_active(auth.uid())
  and (select count(*) from storage.objects o where o.bucket_id = 'agreements' and (storage.foldername(o.name))[1] = auth.uid()::text) < 2000);
create policy agreements_read_landlord on storage.objects for select to authenticated using (bucket_id = 'agreements' and (storage.foldername(name))[1] = auth.uid()::text);
-- Does the signed-in person rent the tenancy this file belongs to? A helper keeps the check out of the policy's own row-level rules.
create function agreement_visible_to_me(p_path text) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from tenancies t where t.agreement_file_path = p_path and t.tenant_user_id = auth.uid() and landlord_active(t.landlord_id))
$$;
create policy agreements_read_tenant on storage.objects for select to authenticated using (bucket_id = 'agreements' and public.agreement_visible_to_me(name));
-- Agreements can never be replaced or deleted. A new upload is a new file, and the tenancy points to the newest.

-- ================= Privileges =================
revoke all on function create_invite(uuid, text, uuid, uuid, text, text, text), invite_lookup(text), invite_accept(text, uuid),
  issue_visitor_code(text, text, text), cancel_visitor_code(text), submit_visit_request(uuid, text, text, date, text, text),
  start_platform_attempt(uuid, text, integer, text, text, text), confirm_platform_payment(text, text, integer, text), fail_platform_attempt(text, integer, text),
  due_reminders(date), mark_reminder_sent(uuid, date, text), sms_mark_status(uuid, text, text),
  save_payment_credentials(uuid, text, text, bytea, smallint, connection_status, text), get_payment_credentials(uuid), account_by_token(text),
  admin_mark_payout_paid(uuid, text), create_due_payouts() from public, anon, authenticated;
grant execute on function create_invite(uuid, text, uuid, uuid, text, text, text), invite_lookup(text), invite_accept(text, uuid),
  issue_visitor_code(text, text, text), cancel_visitor_code(text), submit_visit_request(uuid, text, text, date, text, text),
  start_platform_attempt(uuid, text, integer, text, text, text), confirm_platform_payment(text, text, integer, text), fail_platform_attempt(text, integer, text),
  due_reminders(date), mark_reminder_sent(uuid, date, text), sms_mark_status(uuid, text, text),
  save_payment_credentials(uuid, text, text, bytea, smallint, connection_status, text), get_payment_credentials(uuid), account_by_token(text),
  admin_mark_payout_paid(uuid, text), create_due_payouts() to service_role;
revoke all on function agreement_visible_to_me(text) from public, anon, authenticated;
grant execute on function agreement_visible_to_me(text) to authenticated, service_role;
grant execute on function admin_mark_payout_paid(uuid, text) to authenticated;
revoke all on login_invites, visitor_codes, platform_attempts, reminder_schedules, rent_reminders_sent from anon, authenticated;
grant select (id, kind, tenancy_id, house_id, invitee_name, invitee_phone, expires_at, used_at, revoked_at, created_at) on login_invites to authenticated;
grant select on platform_attempts, reminder_schedules, admin_payouts to authenticated;
grant insert (landlord_id, triggers), update (triggers) on reminder_schedules to authenticated;
