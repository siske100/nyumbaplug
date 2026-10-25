-- 0010_payment_plumbing: what the Daraja server functions need to be safe and repeatable.

-- A payment attempt can be confirmed only once, even if two different receipts or a status check arrive for it.
create or replace function confirm_payment(p_checkout text, p_receipt text, p_amount integer, p_msisdn text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_attempts%rowtype; existing uuid; new_id uuid; t tenancies%rowtype;
begin
  select id into existing from ledger_entries where provider_ref = p_receipt;
  if found then return existing; end if;
  select * into a from payment_attempts where checkout_request_id = p_checkout for update;
  if not found then raise exception 'Unknown payment request'; end if;
  select id into existing from ledger_entries where attempt_id = a.id;
  if found then return existing; end if;                                   -- this attempt is already paid
  select * into t from tenancies where id = a.tenancy_id;
  if p_amount <> a.expected_amount then
    update payment_attempts set status = 'failed', result_desc = 'amount_mismatch' where id = a.id;
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, landlord_id, tenancy_id)
      values (p_receipt, t.tenancy_code, p_amount, p_msisdn, 'amount_mismatch', a.landlord_id, a.tenancy_id) on conflict (provider_ref) do nothing;
    return null;
  end if;
  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, attempt_id, msisdn)
    values (a.tenancy_id, a.landlord_id, 'rent_payment', 'rent', p_amount, 'stk_push', p_receipt, a.id, p_msisdn) returning id into new_id;
  update payment_attempts set status = 'succeeded', result_code = 0 where id = a.id;
  return new_id;
end $$;

-- Manual Paybill payments to a landlord's OWN Paybill must be for that landlord's own tenants.
drop function validate_c2b(text, integer);
drop function record_c2b_payment(text, integer, text, text);

create function validate_c2b(p_bill_ref text, p_amount integer, p_landlord uuid default null) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; bal int; m payment_mode;
begin
  select * into t from tenancies where tenancy_code = upper(trim(p_bill_ref)) and status <> 'ended';
  if not found then return 'unknown_account'; end if;
  select mode into m from payment_accounts where landlord_id = t.landlord_id;
  -- Paid to the platform Paybill (p_landlord is null): only landlords who use the platform Paybill.
  -- Paid to a landlord's own Paybill: only that landlord's tenants, and only while they use their own.
  if (p_landlord is null and m is distinct from 'platform') or (p_landlord is not null and (t.landlord_id <> p_landlord or m is distinct from 'own')) then return 'unknown_account'; end if;
  bal := current_balance(t.id);
  if bal is null or bal <= 0 then return 'nothing_due'; end if;
  if p_amount <> bal then return 'amount_mismatch'; end if;
  return 'ok';
end $$;

create function record_c2b_payment(p_bill_ref text, p_amount integer, p_receipt text, p_msisdn text, p_landlord uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; existing uuid; new_id uuid; bal int; m payment_mode;
begin
  select id into existing from ledger_entries where provider_ref = p_receipt;
  if found then return existing; end if;
  if exists (select 1 from held_payments where provider_ref = p_receipt) then return null; end if;
  select * into t from tenancies where tenancy_code = upper(trim(p_bill_ref)) and status <> 'ended';
  if found then select mode into m from payment_accounts where landlord_id = t.landlord_id; end if;
  if not found or (p_landlord is null and m is distinct from 'platform') or (p_landlord is not null and (t.landlord_id <> p_landlord or m is distinct from 'own')) then
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

-- Attempts are created BEFORE the prompt is sent (so the database can refuse bad requests first),
-- then bound to Safaricom's request id once it answers.
create function bind_payment_attempt(p_attempt uuid, p_checkout text, p_merchant text) returns void language sql security definer set search_path = public, pg_temp as $$
  update payment_attempts set checkout_request_id = p_checkout, merchant_request_id = p_merchant where id = p_attempt and checkout_request_id like 'pending-%'
$$;
create function bind_platform_attempt(p_attempt uuid, p_checkout text, p_merchant text) returns void language sql security definer set search_path = public, pg_temp as $$
  update platform_attempts set checkout_request_id = p_checkout, merchant_request_id = p_merchant where id = p_attempt and checkout_request_id like 'pending-%'
$$;
create function fail_attempt_by_id(p_kind text, p_attempt uuid, p_desc text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_kind = 'tenant' then update payment_attempts set status = 'failed', result_desc = p_desc where id = p_attempt and status = 'pending';
  else update platform_attempts set status = 'failed', result_desc = p_desc where id = p_attempt and status = 'pending'; end if;
end $$;

create function attempt_lookup(p_checkout text) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select jsonb_build_object('kind', 'tenant', 'id', id, 'landlord_id', landlord_id, 'amount', expected_amount, 'status', status) from payment_attempts where checkout_request_id = p_checkout),
    (select jsonb_build_object('kind', 'platform', 'id', id, 'landlord_id', landlord_id, 'amount', amount, 'status', status, 'purpose', purpose) from platform_attempts where checkout_request_id = p_checkout))
$$;

-- Prompts that never got an answer: ask Safaricom directly. Anything older than a day is written off as timed out.
create function pending_attempts(p_min_age interval default interval '3 minutes') returns table (kind text, id uuid, landlord_id uuid, checkout text, amount integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select 'tenant', a.id, a.landlord_id, a.checkout_request_id, a.expected_amount from payment_attempts a
   where a.status = 'pending' and a.checkout_request_id not like 'pending-%' and a.created_at < now() - p_min_age and a.created_at > now() - interval '24 hours'
  union all
  select 'platform', a.id, a.landlord_id, a.checkout_request_id, a.amount from platform_attempts a
   where a.status = 'pending' and a.checkout_request_id not like 'pending-%' and a.created_at < now() - p_min_age and a.created_at > now() - interval '24 hours'
$$;
create function expire_old_attempts() returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; m int;
begin
  update payment_attempts set status = 'timeout', result_desc = 'no answer from Safaricom' where status = 'pending' and created_at < now() - interval '24 hours'; get diagnostics n = row_count;
  update platform_attempts set status = 'timeout', result_desc = 'no answer from Safaricom' where status = 'pending' and created_at < now() - interval '24 hours'; get diagnostics m = row_count;
  return n + m;
end $$;

create function sms_message_status(p_message uuid) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select status from sms_messages where id = p_message
$$;

-- What the "payment received" text needs.
create function ledger_notice(p_ledger uuid) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('landlord_id', l.landlord_id, 'tenancy_id', l.tenancy_id, 'phone', t.tenant_phone, 'name', t.tenant_name,
           'amount', l.amount, 'receipt', l.receipt_no, 'balance', b.balance)
  from ledger_entries l join tenancies t on t.id = l.tenancy_id join tenancy_balances b on b.tenancy_id = l.tenancy_id
  where l.id = p_ledger
$$;

revoke all on function validate_c2b(text, integer, uuid), record_c2b_payment(text, integer, text, text, uuid),
  bind_payment_attempt(uuid, text, text), bind_platform_attempt(uuid, text, text), fail_attempt_by_id(text, uuid, text), attempt_lookup(text),
  pending_attempts(interval), expire_old_attempts(), sms_message_status(uuid), ledger_notice(uuid) from public, anon, authenticated;
grant execute on function validate_c2b(text, integer, uuid), record_c2b_payment(text, integer, text, text, uuid),
  bind_payment_attempt(uuid, text, text), bind_platform_attempt(uuid, text, text), fail_attempt_by_id(text, uuid, text), attempt_lookup(text),
  pending_attempts(interval), expire_old_attempts(), sms_message_status(uuid), ledger_notice(uuid), confirm_payment(text, text, integer, text) to service_role;
