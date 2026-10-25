-- 0002_money: payments, ledger, payouts, subscriptions, SMS wallet.
-- The ledger is append-only. Money is never edited: a mistake is fixed with a reversal entry.

create type payment_mode       as enum ('platform','own');
create type connection_status  as enum ('not_connected','verifying','connected','failed');
create type attempt_status     as enum ('pending','succeeded','failed','timeout');
create type ledger_kind        as enum ('rent_payment','deposit_payment','reversal');
create type payout_status      as enum ('scheduled','processing','paid','failed');
create type subscription_status as enum ('active','expired','suspended');

create function forbid_change() returns trigger language plpgsql as $$
begin raise exception '% is append-only: % is not allowed', tg_table_name, tg_op using errcode = 'P0001'; end $$;

create function make_append_only(p_table regclass) returns void language plpgsql as $$
begin
  execute format('create trigger %I_no_change before update or delete on %s for each row execute function forbid_change()', p_table::text, p_table);
  execute format('create trigger %I_no_truncate before truncate on %s for each statement execute function forbid_change()', p_table::text, p_table);
end $$;
select make_append_only('audit_log');

-- ---------- How a landlord receives rent ----------
-- mode 'platform': rent lands in the platform Paybill and is paid out later.
-- mode 'own': rent lands in the landlord's own Paybill or Till, using their Daraja credentials.
-- Secrets are encrypted by server code and are never readable by any browser role (see 0003).
create table payment_accounts (
  id                    uuid primary key default gen_random_uuid(),
  landlord_id           uuid not null unique references profiles(id) on delete cascade,
  mode                  payment_mode not null default 'platform',
  shortcode             text check (shortcode ~ '^[0-9]{5,7}$'),
  shortcode_kind        text check (shortcode_kind in ('paybill','till')),
  credentials_ciphertext bytea,
  key_version           smallint,
  status                connection_status not null default 'not_connected',
  failure_reason        text,
  last_verified_at      timestamptz,
  callback_token        text not null unique default replace(gen_random_uuid()::text,'-','') ,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (mode = 'platform' or (shortcode is not null and shortcode_kind is not null))
);
create trigger payment_accounts_updated before update on payment_accounts for each row execute function set_updated_at();

create table payout_destinations (
  landlord_id uuid primary key references profiles(id) on delete cascade,
  kind        text not null check (kind in ('mpesa_phone','bank_paybill')),
  destination text not null check (char_length(destination) between 5 and 20),
  account_ref text,
  verified    boolean not null default false,
  updated_at  timestamptz not null default now(),
  check (kind <> 'bank_paybill' or account_ref is not null)
);

-- ---------- What is owed ----------
create table charges (
  id           uuid primary key default gen_random_uuid(),
  tenancy_id   uuid not null references tenancies(id),
  landlord_id  uuid not null references profiles(id),
  period_year  smallint not null,
  period_month smallint not null check (period_month between 1 and 12),
  amount       integer not null check (amount > 0),
  created_at   timestamptz not null default now(),
  unique (tenancy_id, period_year, period_month)
);
select make_append_only('charges');

-- ---------- Tracking an M-Pesa prompt (mutable: pending until Safaricom answers) ----------
create table payment_attempts (
  id                  uuid primary key default gen_random_uuid(),
  tenancy_id          uuid not null references tenancies(id),
  landlord_id         uuid not null references profiles(id),
  msisdn              text not null check (msisdn ~ '^(07|01)[0-9]{8}$'),
  expected_amount     integer not null check (expected_amount > 0),
  checkout_request_id text not null unique,
  merchant_request_id text,
  status              attempt_status not null default 'pending',
  result_code         integer,
  result_desc         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger payment_attempts_updated before update on payment_attempts for each row execute function set_updated_at();

-- ---------- The ledger: confirmed money only ----------
create table ledger_entries (
  id           uuid primary key default gen_random_uuid(),
  tenancy_id   uuid not null references tenancies(id),
  landlord_id  uuid not null references profiles(id),
  kind         ledger_kind not null,
  bucket       text not null check (bucket in ('rent','deposit')),
  amount       integer not null check (amount > 0),
  method       text not null check (method in ('stk_push','c2b','reversal')),
  provider_ref text not null unique,              -- M-Pesa receipt number: the idempotency key
  attempt_id   uuid references payment_attempts(id),
  msisdn       text,
  reverses_id  uuid unique references ledger_entries(id),   -- an entry can be reversed only once
  reason       text,
  receipt_no   text not null unique default 'RC' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
  paid_at      timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  check ((kind = 'reversal') = (reverses_id is not null)),
  check (kind <> 'reversal' or reason is not null)
);
create index ledger_tenancy_idx on ledger_entries(tenancy_id);
create index ledger_landlord_idx on ledger_entries(landlord_id);
select make_append_only('ledger_entries');

create function ledger_consistency() returns trigger language plpgsql as $$
declare t tenancies%rowtype; orig ledger_entries%rowtype;
begin
  select * into t from tenancies where id = new.tenancy_id;
  if t.landlord_id <> new.landlord_id then raise exception 'Ledger landlord does not match the tenancy'; end if;
  if new.kind = 'reversal' then
    select * into orig from ledger_entries where id = new.reverses_id;
    if orig.kind = 'reversal' then raise exception 'A reversal cannot be reversed'; end if;
    if orig.tenancy_id <> new.tenancy_id or orig.amount <> new.amount or orig.bucket <> new.bucket then
      raise exception 'A reversal must match the original entry';
    end if;
  end if;
  return new;
end $$;
create trigger ledger_consistency before insert on ledger_entries for each row execute function ledger_consistency();

-- Payments that arrived but could not be matched safely wait here for a human.
create table held_payments (
  id           uuid primary key default gen_random_uuid(),
  provider_ref text not null unique,
  bill_ref     text,
  amount       integer not null check (amount > 0),
  msisdn       text,
  reason       text not null check (reason in ('unknown_account','amount_mismatch')),
  landlord_id  uuid references profiles(id),
  tenancy_id   uuid references tenancies(id),
  resolved_at  timestamptz,
  ledger_id    uuid references ledger_entries(id),
  created_at   timestamptz not null default now()
);

create view tenancy_balances with (security_invoker = true) as
select tenancy_id, landlord_id, charged, paid, charged - paid as balance
from (
  select t.id as tenancy_id, t.landlord_id,
    coalesce((select sum(c.amount) from charges c where c.tenancy_id = t.id), 0)::int as charged,
    coalesce((select sum(case when l.kind = 'reversal' then -l.amount else l.amount end)
              from ledger_entries l where l.tenancy_id = t.id and l.bucket = 'rent'), 0)::int as paid
  from tenancies t
) s;

-- ---------- Payment functions (server only) ----------
create function current_balance(p_tenancy uuid) returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select balance from tenancy_balances where tenancy_id = p_tenancy
$$;

create function start_payment_attempt(p_tenancy uuid, p_msisdn text, p_checkout text, p_merchant text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; bal int; aid uuid;
begin
  select * into t from tenancies where id = p_tenancy and status <> 'ended';
  if not found then raise exception 'Tenancy not found'; end if;
  bal := current_balance(p_tenancy);
  if bal is null or bal <= 0 then raise exception 'Nothing to pay'; end if;
  insert into payment_attempts(tenancy_id, landlord_id, msisdn, expected_amount, checkout_request_id, merchant_request_id)
    values (t.id, t.landlord_id, p_msisdn, bal, p_checkout, p_merchant) returning payment_attempts.id into aid;
  return aid;
end $$;

-- Safaricom says an M-Pesa prompt succeeded. Full amount only, and safe to receive twice.
create function confirm_payment(p_checkout text, p_receipt text, p_amount integer, p_msisdn text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_attempts%rowtype; existing uuid; new_id uuid; t tenancies%rowtype;
begin
  select id into existing from ledger_entries where provider_ref = p_receipt;
  if found then return existing; end if;                         -- repeated callback: nothing changes

  select * into a from payment_attempts where checkout_request_id = p_checkout for update;
  if not found then raise exception 'Unknown payment request'; end if;
  select * into t from tenancies where id = a.tenancy_id;

  if p_amount <> a.expected_amount then
    update payment_attempts set status = 'failed', result_desc = 'amount_mismatch' where id = a.id;
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, landlord_id, tenancy_id)
      values (p_receipt, t.tenancy_code, p_amount, p_msisdn, 'amount_mismatch', a.landlord_id, a.tenancy_id)
      on conflict (provider_ref) do nothing;
    return null;
  end if;

  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, attempt_id, msisdn)
    values (a.tenancy_id, a.landlord_id, 'rent_payment', 'rent', p_amount, 'stk_push', p_receipt, a.id, p_msisdn)
    returning id into new_id;
  update payment_attempts set status = 'succeeded', result_code = 0 where id = a.id;
  return new_id;
end $$;

create function fail_payment_attempt(p_checkout text, p_code integer, p_desc text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update payment_attempts set status = case when p_code = 1037 then 'timeout'::attempt_status else 'failed'::attempt_status end,
         result_code = p_code, result_desc = p_desc
  where checkout_request_id = p_checkout and status = 'pending'
$$;

-- Manual Paybill payment: the tenant typed the account number. Reject wrong amounts before they are taken.
create function validate_c2b(p_bill_ref text, p_amount integer) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; bal int;
begin
  select * into t from tenancies where tenancy_code = upper(trim(p_bill_ref)) and status <> 'ended';
  if not found then return 'unknown_account'; end if;
  bal := current_balance(t.id);
  if bal is null or bal <= 0 then return 'nothing_due'; end if;
  if p_amount <> bal then return 'amount_mismatch'; end if;
  return 'ok';
end $$;

create function record_c2b_payment(p_bill_ref text, p_amount integer, p_receipt text, p_msisdn text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; existing uuid; new_id uuid; bal int;
begin
  select id into existing from ledger_entries where provider_ref = p_receipt;
  if found then return existing; end if;
  if exists (select 1 from held_payments where provider_ref = p_receipt) then return null; end if;

  select * into t from tenancies where tenancy_code = upper(trim(p_bill_ref)) and status <> 'ended';
  if not found then
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason) values (p_receipt, p_bill_ref, p_amount, p_msisdn, 'unknown_account');
    return null;
  end if;
  bal := current_balance(t.id);
  if bal is null or bal <= 0 or p_amount <> bal then
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, landlord_id, tenancy_id)
      values (p_receipt, p_bill_ref, p_amount, p_msisdn, 'amount_mismatch', t.landlord_id, t.id);
    return null;
  end if;
  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, msisdn)
    values (t.id, t.landlord_id, 'rent_payment', 'rent', p_amount, 'c2b', p_receipt, p_msisdn) returning id into new_id;
  return new_id;
end $$;

-- A landlord assigns a held payment to a tenancy of theirs.
create function resolve_held_payment(p_held uuid, p_tenancy uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare h held_payments%rowtype; t tenancies%rowtype; new_id uuid;
begin
  select * into h from held_payments where id = p_held and resolved_at is null for update;
  if not found then raise exception 'Held payment not found'; end if;
  select * into t from tenancies where id = p_tenancy;
  if not found or t.landlord_id <> auth.uid() then raise exception 'Tenancy not found'; end if;
  -- Only payments already tied to THIS landlord can be claimed. Money sent to an unknown account stays with the platform.
  if h.landlord_id is distinct from auth.uid() then raise exception 'Held payment not found'; end if;
  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, msisdn)
    values (t.id, t.landlord_id, 'rent_payment', 'rent', h.amount, 'c2b', h.provider_ref || '-R', h.msisdn) returning id into new_id;
  update held_payments set resolved_at = now(), ledger_id = new_id, landlord_id = t.landlord_id, tenancy_id = t.id where id = h.id;
  return new_id;
end $$;

create function reverse_payment(p_entry uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare e ledger_entries%rowtype; new_id uuid;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  select * into e from ledger_entries where id = p_entry;
  if not found or e.landlord_id <> auth.uid() then raise exception 'Entry not found'; end if;
  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, reverses_id, reason)
    values (e.tenancy_id, e.landlord_id, 'reversal', e.bucket, e.amount, 'reversal', 'REV-' || e.id, e.id, p_reason) returning id into new_id;
  insert into audit_log(actor, action, entity, entity_id, detail) values (auth.uid(), 'payment_reversed', 'payment', e.id, jsonb_build_object('reason', p_reason));
  return new_id;
end $$;

-- ---------- Payouts (platform-mode landlords only). Each ledger entry can be paid out once. ----------
create table payouts (
  id               uuid primary key default gen_random_uuid(),
  landlord_id      uuid not null references profiles(id),
  amount           integer not null check (amount > 0),
  destination_kind text not null,
  destination      text not null,
  account_ref      text,
  status           payout_status not null default 'scheduled',
  provider_ref     text unique,
  failure_reason   text,
  created_at       timestamptz not null default now(),
  paid_at          timestamptz
);
create table payout_items (
  payout_id       uuid not null references payouts(id),
  ledger_entry_id uuid not null unique references ledger_entries(id),
  primary key (payout_id, ledger_entry_id)
);
select make_append_only('payout_items');

create function create_payout(p_landlord uuid) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare acct payment_accounts%rowtype; dest payout_destinations%rowtype; total int; pid uuid;
begin
  select * into acct from payment_accounts where landlord_id = p_landlord;
  if not found or acct.mode <> 'platform' then raise exception 'This landlord is paid directly'; end if;
  select * into dest from payout_destinations where landlord_id = p_landlord and verified;
  if not found then raise exception 'No verified payout destination'; end if;

  select coalesce(sum(l.amount), 0) into total from ledger_entries l
   where l.landlord_id = p_landlord and l.kind in ('rent_payment','deposit_payment')
     and not exists (select 1 from payout_items i where i.ledger_entry_id = l.id)
     and not exists (select 1 from ledger_entries r where r.reverses_id = l.id);
  if total = 0 then return null; end if;

  insert into payouts(landlord_id, amount, destination_kind, destination, account_ref)
    values (p_landlord, total, dest.kind, dest.destination, dest.account_ref) returning id into pid;
  insert into payout_items(payout_id, ledger_entry_id)
    select pid, l.id from ledger_entries l
     where l.landlord_id = p_landlord and l.kind in ('rent_payment','deposit_payment')
       and not exists (select 1 from payout_items i where i.ledger_entry_id = l.id)
       and not exists (select 1 from ledger_entries r where r.reverses_id = l.id);
  return pid;
end $$;

-- ---------- Subscription ----------
create function price_for_units(p_units integer) returns integer language sql immutable as $$
  select 1000 + greatest(0, p_units - 20) * 15
$$;

create table subscriptions (
  landlord_id      uuid primary key references profiles(id) on delete cascade,
  period_start     date not null,
  period_end       date not null,
  units_billed     integer not null,
  amount_kes       integer not null,
  status           subscription_status not null default 'active',
  suspended_reason text,
  updated_at       timestamptz not null default now()
);
create table subscription_payments (
  id           uuid primary key default gen_random_uuid(),
  landlord_id  uuid not null references profiles(id),
  amount_kes   integer not null check (amount_kes > 0),
  provider_ref text not null unique,
  recorded_by  uuid references profiles(id),
  paid_at      timestamptz not null default now()
);
select make_append_only('subscription_payments');

create function landlord_units(p_landlord uuid) returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(total_units), 0)::int from houses where landlord_id = p_landlord
$$;

create function activate_subscription(p_landlord uuid, p_ref text, p_amount integer, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p profiles%rowtype; units int; price int; s subscriptions%rowtype; start_on date;
begin
  if exists (select 1 from subscription_payments where provider_ref = p_ref) then return; end if;   -- idempotent
  select * into p from profiles where id = p_landlord and role = 'landlord';
  if not found then raise exception 'Landlord not found'; end if;
  if p.landlord_state not in ('kyc_approved','active','expired','suspended') then
    raise exception 'Complete verification before paying the subscription';
  end if;
  units := landlord_units(p_landlord);
  price := price_for_units(units);
  if p_amount < price then raise exception 'Amount is below the monthly price of %', price; end if;

  select * into s from subscriptions where landlord_id = p_landlord;
  start_on := case when found and p.landlord_state = 'active' then greatest(s.period_end, current_date) else current_date end;
  insert into subscriptions(landlord_id, period_start, period_end, units_billed, amount_kes, status)
    values (p_landlord, start_on, start_on + 30, units, price, 'active')
  on conflict (landlord_id) do update
    set period_start = excluded.period_start, period_end = excluded.period_end, units_billed = excluded.units_billed,
        amount_kes = excluded.amount_kes, status = 'active', suspended_reason = null, updated_at = now();
  insert into subscription_payments(landlord_id, amount_kes, provider_ref, recorded_by) values (p_landlord, p_amount, p_ref, p_actor);
  update profiles set landlord_state = 'active' where id = p_landlord;
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (coalesce(p_actor, auth.uid()), 'subscription_activated', 'subscription', p_landlord, jsonb_build_object('ref', p_ref, 'amount', p_amount, 'units', units));
end $$;

create function expire_subscriptions() returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  with e as (update subscriptions set status = 'expired' where status = 'active' and period_end < current_date returning landlord_id)
  update profiles set landlord_state = 'expired' where id in (select landlord_id from e) and landlord_state = 'active';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- SMS wallet (landlords pay KES 0.80 per segment) ----------
create table sms_wallets (
  landlord_id uuid primary key references profiles(id) on delete cascade,
  balance_kes numeric(10,2) not null default 0 check (balance_kes >= 0),
  updated_at  timestamptz not null default now()
);
create table sms_recharges (
  id           uuid primary key default gen_random_uuid(),
  landlord_id  uuid not null references profiles(id),
  amount_kes   numeric(10,2) not null check (amount_kes > 0),
  provider_ref text not null unique,
  created_at   timestamptz not null default now()
);
create table sms_messages (
  id             uuid primary key default gen_random_uuid(),
  landlord_id    uuid not null references profiles(id),
  tenancy_id     uuid references tenancies(id),
  template       text not null check (template in ('rent_reminder','arrears','broadcast','payment_confirmed','visit_notice')),
  recipient      text not null check (recipient ~ '^(07|01)[0-9]{8}$'),
  body           text not null,
  segments       integer not null check (segments > 0),
  cost_kes       numeric(10,2) not null check (cost_kes >= 0),
  status         text not null check (status in ('queued','sent','delivered','failed','paused_insufficient_balance')),
  provider_msg_id text,
  created_at     timestamptz not null default now()
);

create function sms_charge(p_landlord uuid, p_template text, p_recipient text, p_body text, p_segments integer, p_tenancy uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare cost numeric(10,2) := 0.80 * p_segments; mid uuid;
begin
  update sms_wallets set balance_kes = balance_kes - cost, updated_at = now()
   where landlord_id = p_landlord and balance_kes >= cost;
  if found then
    insert into sms_messages(landlord_id, tenancy_id, template, recipient, body, segments, cost_kes, status)
      values (p_landlord, p_tenancy, p_template, p_recipient, p_body, p_segments, cost, 'queued') returning id into mid;
  else  -- at zero the message fails and nothing is debited. It is never resent after a recharge.
    insert into sms_messages(landlord_id, tenancy_id, template, recipient, body, segments, cost_kes, status)
      values (p_landlord, p_tenancy, p_template, p_recipient, p_body, p_segments, 0, 'paused_insufficient_balance') returning id into mid;
  end if;
  return mid;
end $$;

-- Celcom rejected the message: give the landlord their money back, once.
create function sms_provider_failed(p_message uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare m sms_messages%rowtype;
begin
  select * into m from sms_messages where id = p_message for update;
  if not found or m.status not in ('queued','sent') then return; end if;
  update sms_messages set status = 'failed' where id = m.id;
  update sms_wallets set balance_kes = balance_kes + m.cost_kes, updated_at = now() where landlord_id = m.landlord_id;
end $$;

create function sms_recharge(p_landlord uuid, p_amount numeric, p_ref text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from sms_recharges where provider_ref = p_ref) then return; end if;
  insert into sms_recharges(landlord_id, amount_kes, provider_ref) values (p_landlord, p_amount, p_ref);
  update sms_wallets set balance_kes = balance_kes + p_amount, updated_at = now() where landlord_id = p_landlord;
end $$;
