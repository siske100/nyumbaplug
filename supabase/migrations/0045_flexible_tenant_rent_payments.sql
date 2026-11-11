-- Tenants may pay partially or up to twelve months ahead. Outstanding arrears
-- can be cleared in addition to the advance; the ledger carries any rent credit.

alter table held_payments drop constraint held_payments_reason_check;
alter table held_payments add constraint held_payments_reason_check
  check (reason in ('unknown_account', 'amount_mismatch', 'duplicate_payment', 'advance_limit'));

create function start_tenant_payment_attempt(
  p_tenancy uuid, p_msisdn text, p_checkout text, p_merchant text, p_amount integer
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; bal integer; reserved integer; aid uuid;
begin
  select * into t from tenancies where id = p_tenancy and status <> 'ended' for update;
  if not found or not platform_collection_ready(t.landlord_id) then raise exception 'Tenancy not found'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a positive payment amount'; end if;
  if p_msisdn !~ '^(07|01)[0-9]{8}$' then raise exception 'Confirm your phone number first'; end if;

  bal := coalesce(current_balance(p_tenancy), 0);
  select coalesce(sum(expected_amount), 0)::integer into reserved
    from payment_attempts where tenancy_id = p_tenancy and status = 'pending';
  reserved := reserved + coalesce((
    select sum(amount)::integer from manual_rent_payment_claims
     where tenancy_id = p_tenancy and status = 'pending'
  ), 0);
  if p_amount > bal + (12 * t.rent_amount) - reserved then
    raise exception 'The maximum payment is your outstanding balance plus twelve months of rent';
  end if;
  if (select count(*) from payment_attempts a where a.tenancy_id = p_tenancy and a.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many payment attempts. Try again in an hour';
  end if;
  insert into payment_attempts(tenancy_id, landlord_id, msisdn, expected_amount, checkout_request_id, merchant_request_id)
    values (t.id, t.landlord_id, p_msisdn, p_amount, p_checkout, p_merchant)
    returning id into aid;
  return aid;
end $$;
revoke all on function start_tenant_payment_attempt(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function start_tenant_payment_attempt(uuid, text, text, text, integer) to service_role;

create or replace function resolve_held_payment(p_held uuid, p_tenancy uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare h held_payments%rowtype; t tenancies%rowtype; new_id uuid; due integer; reserved integer;
begin
  select * into h from held_payments where id = p_held and resolved_at is null for update;
  if not found then raise exception 'Held payment not found'; end if;
  if h.reason = 'duplicate_payment' then raise exception 'This was a second payment for rent that was already paid. Customer care will refund it'; end if;
  select * into t from tenancies where id = p_tenancy for update;
  if not found or t.landlord_id <> auth.uid() then raise exception 'Tenancy not found'; end if;
  if h.landlord_id is distinct from auth.uid() then raise exception 'Held payment not found'; end if;
  if h.reason = 'advance_limit' then
    if h.tenancy_id is distinct from t.id then raise exception 'This payment belongs to a different tenancy'; end if;
    due := coalesce(current_balance(t.id), 0);
    select coalesce(sum(expected_amount), 0)::integer into reserved
      from payment_attempts where tenancy_id = t.id and status = 'pending';
    reserved := reserved + coalesce((
      select sum(amount)::integer from manual_rent_payment_claims
       where tenancy_id = t.id and status = 'pending'
    ), 0);
    if h.amount > due + (12 * t.rent_amount) - reserved then
      raise exception 'This payment still exceeds twelve months of rent in advance';
    end if;
  end if;
  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, msisdn, custody)
    values (t.id, t.landlord_id, 'rent_payment', 'rent', h.amount, 'c2b', h.provider_ref || '-R', h.msisdn, h.custody)
    returning id into new_id;
  update held_payments set resolved_at = now(), ledger_id = new_id, landlord_id = t.landlord_id, tenancy_id = t.id where id = h.id;
  return new_id;
end $$;
revoke all on function resolve_held_payment(uuid, uuid) from public, anon;
grant execute on function resolve_held_payment(uuid, uuid) to authenticated;

create or replace function confirm_payment(p_checkout text, p_receipt text, p_amount integer, p_msisdn text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_attempts%rowtype; existing uuid; new_id uuid; t tenancies%rowtype; bal integer; reserved integer;
begin
  select id into existing from ledger_entries where provider_ref = p_receipt;
  if found then return existing; end if;
  select * into a from payment_attempts where checkout_request_id = p_checkout for update;
  if not found then raise exception 'Unknown payment request'; end if;
  select id into existing from ledger_entries where attempt_id = a.id;
  if found then return existing; end if;
  if a.bank_paybill_shortcode is not null then
    update payment_attempts set status = 'failed', result_desc = 'Legacy bank rent route disabled' where id = a.id;
    raise exception 'This rent attempt is not routed to HousePlug Kenya collection';
  end if;
  select * into t from tenancies where id = a.tenancy_id for update;
  if p_amount <> a.expected_amount then
    update payment_attempts set status = 'failed', result_desc = 'amount_mismatch' where id = a.id;
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, landlord_id, tenancy_id, custody)
      values (p_receipt, t.tenancy_code, p_amount, p_msisdn, 'amount_mismatch', a.landlord_id, a.tenancy_id, 'platform')
      on conflict (provider_ref) do nothing;
    return null;
  end if;

  bal := coalesce(current_balance(a.tenancy_id), 0);
  select coalesce(sum(expected_amount), 0)::integer into reserved
    from payment_attempts where tenancy_id = a.tenancy_id and status = 'pending' and id <> a.id;
  reserved := reserved + coalesce((
    select sum(amount)::integer from manual_rent_payment_claims
     where tenancy_id = a.tenancy_id and status = 'pending'
  ), 0);
  if p_amount > bal + (12 * t.rent_amount) - reserved then
    update payment_attempts set status = 'failed', result_desc = 'advance_limit' where id = a.id;
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, landlord_id, tenancy_id, custody)
      values (p_receipt, t.tenancy_code, p_amount, p_msisdn, 'advance_limit', a.landlord_id, a.tenancy_id, 'platform')
      on conflict (provider_ref) do nothing;
    return null;
  end if;

  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, attempt_id, msisdn, custody)
    values (a.tenancy_id, a.landlord_id, 'rent_payment', 'rent', p_amount,
            case when a.provider = 'paystack' then 'paystack' else 'stk_push' end, p_receipt, a.id, p_msisdn, 'platform')
    returning id into new_id;
  update payment_attempts set status = 'succeeded', result_code = 0 where id = a.id;
  return new_id;
end $$;

create or replace function submit_manual_rent_payment(p_amount integer, p_message text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; a payment_accounts%rowtype; due integer; reserved integer; claim_id uuid;
begin
  select * into t from tenancies
   where tenant_user_id = auth.uid() and status = 'active'
   for update;
  if not found then raise exception 'Active tenancy not found'; end if;
  if not landlord_active(t.landlord_id) then raise exception 'Your landlord account is not active'; end if;
  select * into a from payment_accounts where landlord_id = t.landlord_id for share;
  if not found or a.mode <> 'bank_paybill' then
    raise exception 'Manual bank transfer is not the selected rent payment method';
  end if;
  if not exists (
    select 1 from landlord_bank_accounts lba join banks b on b.id = lba.bank_id and b.active
     where lba.landlord_id = t.landlord_id and lba.account_number is not null and lba.account_name is not null
  ) then
    raise exception 'The landlord bank account is not configured';
  end if;
  if char_length(trim(coalesce(p_message, ''))) not between 10 and 2000 then
    raise exception 'Paste the bank transfer confirmation message';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a positive payment amount'; end if;

  due := coalesce(current_balance(t.id), 0);
  select coalesce(sum(expected_amount), 0)::integer into reserved
    from payment_attempts where tenancy_id = t.id and status = 'pending';
  reserved := reserved + coalesce((
    select sum(amount)::integer from manual_rent_payment_claims
     where tenancy_id = t.id and status = 'pending'
  ), 0);
  if p_amount > due + (12 * t.rent_amount) - reserved then
    raise exception 'The maximum payment is your outstanding balance plus twelve months of rent';
  end if;
  if exists (
    select 1 from manual_rent_payment_claims where tenancy_id = t.id and status = 'pending'
  ) then
    raise exception 'Your previous transfer is still waiting for landlord review';
  end if;
  insert into manual_rent_payment_claims (tenancy_id, landlord_id, amount, transaction_message)
    values (t.id, t.landlord_id, p_amount, trim(p_message))
    returning id into claim_id;
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'manual_rent_payment_submitted', 'manual_rent_payment_claim', claim_id,
            jsonb_build_object('amount', p_amount, 'tenancy_id', t.id));
  return claim_id;
end $$;

create or replace function review_manual_rent_payment(p_claim uuid, p_received boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c manual_rent_payment_claims%rowtype; t tenancies%rowtype; due integer; reserved integer; entry_id uuid;
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  if p_received is null then raise exception 'Choose whether the funds were received'; end if;
  select * into c from manual_rent_payment_claims where id = p_claim for update;
  if not found or c.landlord_id <> auth.uid() then raise exception 'Payment claim not found'; end if;
  if c.status <> 'pending' then raise exception 'This payment claim has already been reviewed'; end if;

  if not p_received then
    update manual_rent_payment_claims
       set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid()
     where id = c.id;
    insert into audit_log(actor, action, entity, entity_id, detail)
      values (auth.uid(), 'manual_rent_payment_rejected', 'manual_rent_payment_claim', c.id,
              jsonb_build_object('tenancy_id', c.tenancy_id, 'amount', c.amount));
    return;
  end if;

  select * into t from tenancies where id = c.tenancy_id and landlord_id = auth.uid() for update;
  if not found then raise exception 'Payment claim tenancy not found'; end if;
  due := coalesce(current_balance(t.id), 0);
  select coalesce(sum(expected_amount), 0)::integer into reserved
    from payment_attempts where tenancy_id = t.id and status = 'pending';
  reserved := reserved + coalesce((
    select sum(amount)::integer from manual_rent_payment_claims
     where tenancy_id = t.id and status = 'pending' and id <> c.id
  ), 0);
  if c.amount > due + (12 * t.rent_amount) - reserved then
    raise exception 'The payment would exceed twelve months of rent in advance';
  end if;

  insert into ledger_entries (tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref)
    values (t.id, t.landlord_id, 'rent_payment', 'rent', c.amount, 'manual_transfer',
            'MANUAL-' || upper(replace(c.id::text, '-', '')))
    returning id into entry_id;
  update manual_rent_payment_claims
     set status = 'received', reviewed_at = now(), reviewed_by = auth.uid(), ledger_entry_id = entry_id
   where id = c.id;
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'manual_rent_payment_received', 'manual_rent_payment_claim', c.id,
            jsonb_build_object('tenancy_id', t.id, 'amount', c.amount));
end $$;

revoke all on function submit_manual_rent_payment(integer, text), review_manual_rent_payment(uuid, boolean) from public, anon;
grant execute on function submit_manual_rent_payment(integer, text), review_manual_rent_payment(uuid, boolean) to authenticated;
