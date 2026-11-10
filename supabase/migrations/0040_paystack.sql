-- 0040_paystack: Paystack as (1) the card + M-Pesa checkout for HousePlug Kenya's own purchases (subscription, SMS credit)
-- and (2) an optional landlord-OWNED rent route. For (2) the landlord connects their own Paystack account, so rent is
-- collected and settled by Paystack straight to that landlord. HousePlug Kenya never receives, holds or pays out rent.
-- Paystack's reference is the idempotency key, and nothing is credited until the server has asked Paystack directly.

-- ---------- the landlord's own Paystack connection (secret key stored encrypted by server code, never readable by a browser role) ----------
alter table payment_accounts
  add column paystack_ciphertext bytea,
  add column paystack_status connection_status not null default 'not_connected',
  add column paystack_failure_reason text,
  add column paystack_key_hint text check (paystack_key_hint is null or paystack_key_hint ~ '^[A-Za-z0-9]{4}$'),
  add column paystack_verified_at timestamptz,
  add constraint payment_accounts_paystack_state_check check ((paystack_status = 'connected') = (paystack_ciphertext is not null));

alter table payment_accounts drop constraint payment_accounts_mode_connection_check;
alter table payment_accounts add constraint payment_accounts_mode_connection_check
  check (mode in ('platform', 'bank_paybill')
         or (mode = 'own' and shortcode is not null and shortcode_kind is not null)
         or (mode = 'paystack' and paystack_status = 'connected' and paystack_ciphertext is not null));

grant select (paystack_status, paystack_failure_reason, paystack_key_hint, paystack_verified_at) on payment_accounts to authenticated;

-- ---------- attempts remember which provider they belong to ----------
alter table payment_attempts
  add column provider text not null default 'daraja' check (provider in ('daraja', 'paystack')),
  add column checkout_url text;
alter table platform_attempts
  add column provider text not null default 'daraja' check (provider in ('daraja', 'paystack')),
  add column checkout_url text;
-- One open Paystack checkout per tenancy: a second tap re-opens the first instead of creating a double-payment risk.
create unique index paystack_one_open_rent_attempt on payment_attempts(tenancy_id) where provider = 'paystack' and status = 'pending';

-- A second successful checkout for rent that is already paid is held for the landlord to refund from their Paystack dashboard.
alter table held_payments drop constraint held_payments_reason_check;
alter table held_payments add constraint held_payments_reason_check
  check (reason in ('unknown_account', 'amount_mismatch', 'duplicate_payment'));

-- ---------- credentials (server only) ----------
create function save_paystack_credentials(p_landlord uuid, p_cipher bytea, p_hint text, p_status connection_status, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from payment_accounts where landlord_id = p_landlord for update;
  if not found then raise exception 'Payment account not found'; end if;
  if p_status = 'connected' and (p_cipher is null or p_hint is null) then raise exception 'Missing Paystack credentials'; end if;
  if p_status <> 'connected' and exists (
    select 1 from payment_attempts where landlord_id = p_landlord and provider = 'paystack' and status = 'pending'
  ) then
    raise exception 'Wait for open Paystack rent checkouts to finish before disconnecting';
  end if;
  update payment_accounts
     set paystack_ciphertext = case when p_status = 'connected' then p_cipher else null end,
         paystack_key_hint = case when p_status = 'connected' then p_hint else null end,
         paystack_status = p_status,
         paystack_failure_reason = p_reason,
         paystack_verified_at = case when p_status = 'connected' then now() else paystack_verified_at end,
         -- a removed key can never leave the landlord pointing at a route that cannot work; a first working route is selected for them
         mode = case when p_status <> 'connected' and mode = 'paystack' then 'platform'::payment_mode
                     when p_status = 'connected' and mode = 'platform' then 'paystack'::payment_mode
                     else mode end
   where landlord_id = p_landlord;
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (p_landlord, 'paystack_credentials_saved', 'payment_account', p_landlord,
            jsonb_build_object('status', p_status, 'direct_settlement_only', true));
end $$;

create function get_paystack_credentials(p_landlord uuid)
returns table (mode payment_mode, cipher bytea, status connection_status, callback_token text)
language sql stable security definer set search_path = public, pg_temp as $$
  select mode, paystack_ciphertext, paystack_status, callback_token from payment_accounts where landlord_id = p_landlord
$$;

-- ---------- which route may a tenant use? (notice-period tenants still owe rent, so only ended tenancies are excluded) ----------
create or replace function tenant_payment_route()
returns payment_mode language sql stable security definer set search_path = public, pg_temp as $$
  select pa.mode
    from tenancies t
    join payment_accounts pa on pa.landlord_id = t.landlord_id
   where t.tenant_user_id = auth.uid()
     and t.status <> 'ended'
     and landlord_active(t.landlord_id)
     and (
       (pa.mode = 'own' and pa.status = 'connected' and pa.shortcode is not null and pa.credentials_ciphertext is not null)
       or (pa.mode = 'paystack' and pa.paystack_status = 'connected' and pa.paystack_ciphertext is not null)
       or (pa.mode = 'bank_paybill' and exists (
         select 1 from landlord_bank_accounts lba
         join banks b on b.id = lba.bank_id and b.active
         where lba.landlord_id = t.landlord_id
           and lba.account_number is not null and lba.account_name is not null
       ))
     )
   order by (t.status = 'active') desc
   limit 1
$$;
revoke all on function tenant_payment_route() from public, anon;
grant execute on function tenant_payment_route() to authenticated;

-- ---------- choosing the active rent method ----------
create or replace function set_payment_mode(p_mode payment_mode) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_accounts%rowtype;
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  if p_mode not in ('own', 'paystack', 'bank_paybill') then
    raise exception 'Choose Daraja, Paystack or manual bank transfer for rent';
  end if;
  select * into a from payment_accounts where landlord_id = auth.uid() for update;
  if not found then raise exception 'Payment account not found'; end if;
  if p_mode = 'own' then
    if a.status <> 'connected' or a.shortcode is null or a.credentials_ciphertext is null then
      raise exception 'Connect and verify your own Daraja Paybill first';
    end if;
  elsif p_mode = 'paystack' then
    if a.paystack_status <> 'connected' or a.paystack_ciphertext is null then
      raise exception 'Connect and verify your own Paystack account first';
    end if;
  elsif not exists (
    select 1 from landlord_bank_accounts lba
    join banks b on b.id = lba.bank_id and b.active
    where lba.landlord_id = auth.uid()
      and lba.account_number is not null
      and lba.account_name is not null
  ) then
    raise exception 'Save your bank name, account number and account holder name first';
  end if;
  -- Open Paystack checkouts are not a reason to wait: if one is paid later it is still credited to the right tenant.
  if exists (select 1 from payment_attempts where landlord_id = auth.uid() and status = 'pending' and provider = 'daraja') then
    raise exception 'Wait for pending M-Pesa rent prompts before changing payment method';
  end if;
  if exists (select 1 from manual_rent_payment_claims where landlord_id = auth.uid() and status = 'pending') and p_mode <> 'bank_paybill' then
    raise exception 'Review pending manual payment claims before changing payment method';
  end if;
  update payment_accounts set mode = p_mode where landlord_id = auth.uid();
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'payment_mode_changed', 'payment_account', a.id,
            jsonb_build_object('mode', p_mode, 'manual_review_required', p_mode = 'bank_paybill'));
end $$;
revoke all on function set_payment_mode(payment_mode) from public, anon;
grant execute on function set_payment_mode(payment_mode) to authenticated;

-- Replacing Daraja keys only has to wait for Daraja prompts.
create or replace function save_payment_credentials(
  p_landlord uuid, p_shortcode text, p_kind text, p_cipher bytea,
  p_key_version smallint, p_status connection_status, p_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from payment_accounts where landlord_id = p_landlord for update;
  if not found then raise exception 'Payment account not found'; end if;
  if p_status = 'connected' and exists (select 1 from manual_rent_payment_claims where landlord_id = p_landlord and status = 'pending') then
    raise exception 'Review pending manual payment claims before switching to Daraja';
  end if;
  if p_status = 'connected' and exists (select 1 from payment_attempts where landlord_id = p_landlord and status = 'pending' and provider = 'daraja') then
    raise exception 'Wait for pending M-Pesa rent prompts before replacing Daraja credentials';
  end if;
  update payment_accounts
     set shortcode = p_shortcode, shortcode_kind = p_kind, credentials_ciphertext = p_cipher, key_version = p_key_version,
         status = p_status, failure_reason = p_reason,
         last_verified_at = case when p_status = 'connected' then now() else last_verified_at end,
         mode = case when p_status = 'connected' then 'own'::payment_mode else mode end
   where landlord_id = p_landlord;
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (p_landlord, 'payment_credentials_saved', 'payment_account', p_landlord,
            jsonb_build_object('status', p_status, 'direct_settlement_only', true));
end $$;

-- ---------- rent: start, re-open, look up, settle ----------
-- The route is checked here, in the database, not just in the server function.
create function start_paystack_rent_attempt(p_tenancy uuid, p_reference text, p_msisdn text)
returns table (attempt_id uuid, amount integer, tenancy_code text, landlord_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; pa payment_accounts%rowtype; bal integer; aid uuid;
begin
  if p_reference !~ '^RHPS-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid payment reference'; end if;
  if p_msisdn !~ '^(07|01)[0-9]{8}$' then raise exception 'Confirm your phone number first'; end if;
  select * into t from tenancies where id = p_tenancy and status <> 'ended';
  if not found or not landlord_active(t.landlord_id) then raise exception 'Tenancy not found'; end if;
  select * into pa from payment_accounts where payment_accounts.landlord_id = t.landlord_id;
  if not found or pa.mode <> 'paystack' or pa.paystack_status <> 'connected' or pa.paystack_ciphertext is null then
    raise exception 'Your landlord has not enabled Paystack for rent';
  end if;
  bal := current_balance(p_tenancy);
  if bal is null or bal <= 0 then raise exception 'Nothing to pay'; end if;
  if (select count(*) from payment_attempts a where a.tenancy_id = p_tenancy and a.provider = 'paystack' and a.created_at > now() - interval '1 hour') >= 6 then
    raise exception 'Too many payment attempts. Try again in an hour';
  end if;
  insert into payment_attempts(tenancy_id, landlord_id, msisdn, expected_amount, checkout_request_id, provider)
    values (t.id, t.landlord_id, p_msisdn, bal, p_reference, 'paystack') returning id into aid;
  return query select aid, bal, t.tenancy_code, t.landlord_id;
end $$;

-- An unpaid checkout for this tenancy, if there is one. Used to re-open it instead of starting a second one.
create function open_paystack_rent_attempt(p_tenancy uuid)
returns table (reference text, checkout_url text, amount integer, age_seconds integer, balance integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.checkout_request_id, a.checkout_url, a.expected_amount, extract(epoch from now() - a.created_at)::int, current_balance(a.tenancy_id)
    from payment_attempts a where a.tenancy_id = p_tenancy and a.provider = 'paystack' and a.status = 'pending'
$$;

-- Platform purchases (subscription, SMS credit, ...) use start_platform_attempt, then attach the Paystack reference.
create function open_paystack_platform_attempt(p_payer uuid, p_purpose text, p_reference uuid default null)
returns table (reference text, checkout_url text, amount integer, age_seconds integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.checkout_request_id, a.checkout_url, a.amount, extract(epoch from now() - a.created_at)::int
    from platform_attempts a
   where a.landlord_id = p_payer and a.purpose = p_purpose and a.provider = 'paystack' and a.status = 'pending'
     and a.reference_id is not distinct from p_reference
$$;

create function bind_paystack_checkout(p_kind text, p_attempt uuid, p_reference text, p_url text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_url !~ '^https://[A-Za-z0-9.-]+/' then raise exception 'Invalid checkout address'; end if;
  if p_kind = 'tenant' then
    update payment_attempts set checkout_url = p_url, checkout_request_id = p_reference
     where id = p_attempt and provider = 'paystack' and status = 'pending' and checkout_request_id = p_reference;
  else
    update platform_attempts set provider = 'paystack', checkout_url = p_url, checkout_request_id = p_reference
     where id = p_attempt and status = 'pending' and (checkout_request_id like 'pending-%' or checkout_request_id = p_reference);
  end if;
  if not found then raise exception 'Payment attempt not found'; end if;
end $$;

create function paystack_attempt_lookup(p_reference text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select jsonb_build_object('kind', 'tenant', 'id', a.id, 'landlord_id', a.landlord_id, 'payer_id', t.tenant_user_id, 'amount', a.expected_amount,
            'status', a.status, 'msisdn', a.msisdn, 'created_at', a.created_at)
       from payment_attempts a join tenancies t on t.id = a.tenancy_id
      where a.provider = 'paystack' and a.checkout_request_id = p_reference),
    (select jsonb_build_object('kind', 'platform', 'id', a.id, 'landlord_id', a.landlord_id, 'payer_id', a.landlord_id, 'amount', a.amount,
            'status', a.status, 'purpose', a.purpose, 'msisdn', a.msisdn, 'created_at', a.created_at)
       from platform_attempts a where a.provider = 'paystack' and a.checkout_request_id = p_reference))
$$;

-- Checkouts that never reported back: ask Paystack. Recently timed-out ones are asked again, in case the payer paid late.
create function pending_paystack_attempts(p_min_age interval default interval '2 minutes')
returns table (kind text, id uuid, landlord_id uuid, reference text, amount integer, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select 'tenant', a.id, a.landlord_id, a.checkout_request_id, a.expected_amount, a.created_at from payment_attempts a
   where a.provider = 'paystack' and a.status in ('pending', 'timeout') and a.checkout_request_id like 'RHPS-%'
     and a.created_at < now() - p_min_age and a.created_at > now() - interval '48 hours'
  union all
  select 'platform', a.id, a.landlord_id, a.checkout_request_id, a.amount, a.created_at from platform_attempts a
   where a.provider = 'paystack' and a.status in ('pending', 'timeout') and a.checkout_request_id like 'RHPS-%'
     and a.created_at < now() - p_min_age and a.created_at > now() - interval '48 hours'
$$;

-- Rent confirmation, now provider-aware. Daraja behaves exactly as before. A Paystack attempt is credited once, for the exact
-- amount, even if the landlord changed method after the checkout opened (the tenant has already paid that landlord).
create or replace function confirm_payment(p_checkout text, p_receipt text, p_amount integer, p_msisdn text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_attempts%rowtype; existing uuid; new_id uuid; t tenancies%rowtype; pa payment_accounts%rowtype; bal integer;
begin
  select id into existing from ledger_entries where provider_ref = p_receipt;
  if found then return existing; end if;
  select * into a from payment_attempts where checkout_request_id = p_checkout for update;
  if not found then raise exception 'Unknown payment request'; end if;
  select id into existing from ledger_entries where attempt_id = a.id;
  if found then return existing; end if;
  select * into t from tenancies where id = a.tenancy_id;
  select * into pa from payment_accounts where landlord_id = a.landlord_id;
  if a.provider = 'daraja' and (a.bank_paybill_shortcode is not null or pa.mode <> 'own' or pa.status <> 'connected'
     or pa.shortcode is null or pa.credentials_ciphertext is null) then
    update payment_attempts set status = 'failed', result_desc = 'Direct landlord settlement required' where id = a.id;
    raise exception 'This rent attempt is not routed to a verified landlord-owned account';
  end if;
  if p_amount <> a.expected_amount then
    update payment_attempts set status = 'failed', result_desc = 'amount_mismatch' where id = a.id;
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, landlord_id, tenancy_id)
      values (p_receipt, t.tenancy_code, p_amount, p_msisdn, 'amount_mismatch', a.landlord_id, a.tenancy_id)
      on conflict (provider_ref) do nothing;
    return null;
  end if;
  if a.provider = 'paystack' then
    bal := current_balance(a.tenancy_id);
    if bal is null or bal < p_amount then              -- the rent was already paid some other way: do not credit it twice
      update payment_attempts set status = 'failed', result_desc = 'duplicate_payment' where id = a.id;
      insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, landlord_id, tenancy_id)
        values (p_receipt, t.tenancy_code, p_amount, p_msisdn, 'duplicate_payment', a.landlord_id, a.tenancy_id)
        on conflict (provider_ref) do nothing;
      return null;
    end if;
  end if;
  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, attempt_id, msisdn)
    values (a.tenancy_id, a.landlord_id, 'rent_payment', 'rent', p_amount,
            case when a.provider = 'paystack' then 'paystack' else 'stk_push' end, p_receipt, a.id, p_msisdn)
    returning id into new_id;
  update payment_attempts set status = 'succeeded', result_code = 0 where id = a.id;
  return new_id;
end $$;

-- Platform purchases: a Paystack checkout that timed out but was paid late is still honoured, once.
create or replace function confirm_platform_payment(p_checkout text, p_receipt text, p_amount integer, p_msisdn text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare a platform_attempts%rowtype; b marketplace_bookings%rowtype;
begin
  if exists (select 1 from subscription_payments where provider_ref = p_receipt)
     or exists (select 1 from sms_recharges where provider_ref = p_receipt)
     or exists (select 1 from held_payments where provider_ref = p_receipt)
     or exists (select 1 from marketplace_marketers where activation_receipt = p_receipt)
     or exists (select 1 from marketplace_bookings where payment_receipt = p_receipt) then
    return true;
  end if;
  select * into a from platform_attempts where checkout_request_id = p_checkout for update;
  if not found then raise exception 'Unknown payment request'; end if;
  if a.status <> 'pending' and not (a.provider = 'paystack' and a.status = 'timeout') then return a.status = 'succeeded'; end if;
  if p_amount <> a.amount then
    update platform_attempts set status = 'failed', result_desc = 'amount_mismatch' where id = a.id;
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason)
      values (p_receipt, 'platform:' || a.purpose, p_amount, p_msisdn, 'amount_mismatch');
    return false;
  end if;
  if a.purpose = 'subscription' then
    perform activate_subscription(a.landlord_id, p_receipt, p_amount);
  elsif a.purpose = 'sms_recharge' then
    perform sms_recharge(a.landlord_id, p_amount, p_receipt);
  elsif a.purpose = 'marketer_activation' then
    update marketplace_marketers set status = 'active', activated_at = now(), activation_receipt = p_receipt
     where marketer_id = a.landlord_id and status = 'pending_activation';
    if not found then raise exception 'Marketer account is already active or unavailable'; end if;
  elsif a.purpose = 'viewing_fee' then
    select * into b from marketplace_bookings where id = a.reference_id for update;
    if not found or b.client_id <> a.landlord_id or b.status <> 'awaiting_payment' then
      raise exception 'Viewing booking is no longer payable';
    end if;
    update marketplace_bookings set status = 'paid', payment_receipt = p_receipt, paid_at = now() where id = b.id;
  end if;
  update platform_attempts set status = 'succeeded', result_code = 0 where id = a.id;
  return true;
end $$;

-- One "payment received" text per payment, however many times a provider repeats its callback.
create table payment_notices (ledger_id uuid primary key references ledger_entries(id), created_at timestamptz not null default now());
alter table payment_notices enable row level security;
revoke all on payment_notices from public, anon, authenticated;
create function claim_payment_notice(p_ledger uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into payment_notices(ledger_id) values (p_ledger) on conflict do nothing;
  return found;
end $$;
revoke all on function claim_payment_notice(uuid) from public, anon, authenticated;
grant execute on function claim_payment_notice(uuid) to service_role;

revoke all on function save_paystack_credentials(uuid, bytea, text, connection_status, text), get_paystack_credentials(uuid),
  start_paystack_rent_attempt(uuid, text, text), open_paystack_rent_attempt(uuid), open_paystack_platform_attempt(uuid, text, uuid),
  bind_paystack_checkout(text, uuid, text, text), paystack_attempt_lookup(text), pending_paystack_attempts(interval)
  from public, anon, authenticated;
grant execute on function save_paystack_credentials(uuid, bytea, text, connection_status, text), get_paystack_credentials(uuid),
  start_paystack_rent_attempt(uuid, text, text), open_paystack_rent_attempt(uuid), open_paystack_platform_attempt(uuid, text, uuid),
  bind_paystack_checkout(text, uuid, text, text), paystack_attempt_lookup(text), pending_paystack_attempts(interval)
  to service_role;
revoke all on function confirm_payment(text, text, integer, text), confirm_platform_payment(text, text, integer, text) from public, anon, authenticated;
grant execute on function confirm_payment(text, text, integer, text), confirm_platform_payment(text, text, integer, text) to service_role;
