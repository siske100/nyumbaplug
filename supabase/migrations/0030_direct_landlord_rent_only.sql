-- Rent must never be collected by NyumbaPlug. Historical platform/bank records remain
-- queryable, but only a connected landlord-owned Daraja account can be selected for new rent.

-- Do not leave old in-flight platform/bank rent attempts capable of settling after cutover.
update payment_attempts
   set status = 'failed', result_desc = 'Rent route disabled: direct landlord settlement required'
 where status = 'pending'
   and (bank_paybill_shortcode is not null
        or not exists (select 1 from payment_accounts pa
                        where pa.landlord_id = payment_attempts.landlord_id
                          and pa.mode = 'own' and pa.status = 'connected'
                          and pa.shortcode is not null and pa.credentials_ciphertext is not null));

-- A broken/rejected Daraja connection must not switch the landlord back to the platform.
create or replace function save_payment_credentials(
  p_landlord uuid, p_shortcode text, p_kind text, p_cipher bytea,
  p_key_version smallint, p_status connection_status, p_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update payment_accounts
     set shortcode = p_shortcode,
         shortcode_kind = p_kind,
         credentials_ciphertext = p_cipher,
         key_version = p_key_version,
         status = p_status,
         failure_reason = p_reason,
         last_verified_at = case when p_status = 'connected' then now() else last_verified_at end,
         mode = case when p_status = 'connected' then 'own'::payment_mode else mode end
   where landlord_id = p_landlord;
  if not found then raise exception 'Payment account not found'; end if;
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (p_landlord, 'payment_credentials_saved', 'payment_account', p_landlord,
            jsonb_build_object('status', p_status, 'direct_settlement_only', true));
end $$;

-- Tenant-facing route is NULL unless the landlord has a connected own Paybill.
create or replace function tenant_payment_route()
returns payment_mode language sql stable security definer set search_path = public, pg_temp as $$
  select 'own'::payment_mode
    from tenancies t
    join payment_accounts pa on pa.landlord_id = t.landlord_id
   where t.tenant_user_id = auth.uid()
     and t.status = 'active'
     and pa.mode = 'own'
     and pa.status = 'connected'
     and pa.shortcode is not null
     and pa.credentials_ciphertext is not null
   limit 1
$$;
revoke all on function tenant_payment_route() from public, anon;
grant execute on function tenant_payment_route() to authenticated;

-- The only rent route selectable in the current release is a connected landlord-owned Paybill.
create or replace function set_payment_mode(p_mode payment_mode) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_accounts%rowtype;
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  if p_mode <> 'own' then raise exception 'Rent must be paid directly to a verified landlord-owned payment account'; end if;
  select * into a from payment_accounts where landlord_id = auth.uid();
  if not found then raise exception 'Payment account not found'; end if;
  if a.status <> 'connected' or a.shortcode is null or a.credentials_ciphertext is null then
    raise exception 'Connect and verify your own Daraja Paybill first';
  end if;
  update payment_accounts set mode = 'own' where landlord_id = auth.uid();
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'payment_mode_changed', 'payment_account', a.id,
            jsonb_build_object('mode', 'own', 'direct_settlement_only', true));
end $$;
revoke all on function set_payment_mode(payment_mode) from public, anon;
grant execute on function set_payment_mode(payment_mode) to authenticated;

-- The platform callback token must not validate or confirm tenant rent C2B payments.
-- Landlord-specific callback tokens continue to be scoped by account_by_token().

-- Defense in depth: even a stale/internal caller cannot credit a platform or bank-routed rent attempt.
create or replace function confirm_payment(p_checkout text, p_receipt text, p_amount integer, p_msisdn text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_attempts%rowtype; existing uuid; new_id uuid; t tenancies%rowtype; pa payment_accounts%rowtype;
begin
  select id into existing from ledger_entries where provider_ref = p_receipt;
  if found then return existing; end if;
  select * into a from payment_attempts where checkout_request_id = p_checkout for update;
  if not found then raise exception 'Unknown payment request'; end if;
  select id into existing from ledger_entries where attempt_id = a.id;
  if found then return existing; end if;
  select * into t from tenancies where id = a.tenancy_id;
  select * into pa from payment_accounts where landlord_id = a.landlord_id;
  if a.bank_paybill_shortcode is not null or pa.mode <> 'own' or pa.status <> 'connected'
     or pa.shortcode is null or pa.credentials_ciphertext is null then
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
  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, attempt_id, msisdn)
    values (a.tenancy_id, a.landlord_id, 'rent_payment', 'rent', p_amount, 'stk_push', p_receipt, a.id, p_msisdn)
    returning id into new_id;
  update payment_attempts set status = 'succeeded', result_code = 0 where id = a.id;
  return new_id;
end $$;

-- Platform C2B is not a tenant rent route. Manual Paybill rent is landlord-scoped only.
create or replace function validate_c2b(p_bill_ref text, p_amount integer, p_landlord uuid default null)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; bal int; pa payment_accounts%rowtype;
begin
  if p_landlord is null then return 'unknown_account'; end if;
  select * into t from tenancies where tenancy_code = upper(trim(p_bill_ref)) and status <> 'ended';
  if not found or t.landlord_id <> p_landlord then return 'unknown_account'; end if;
  select * into pa from payment_accounts where landlord_id = t.landlord_id;
  if pa.mode <> 'own' or pa.status <> 'connected' or pa.shortcode is null or pa.credentials_ciphertext is null then
    return 'unknown_account';
  end if;
  bal := current_balance(t.id);
  if bal is null or bal <= 0 then return 'nothing_due'; end if;
  if p_amount <> bal then return 'amount_mismatch'; end if;
  return 'ok';
end $$;

create or replace function record_c2b_payment(p_bill_ref text, p_amount integer, p_receipt text, p_msisdn text, p_landlord uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; existing uuid; new_id uuid; bal int; pa payment_accounts%rowtype;
begin
  select id into existing from ledger_entries where provider_ref = p_receipt;
  if found then return existing; end if;
  if exists (select 1 from held_payments where provider_ref = p_receipt) then return null; end if;
  if p_landlord is null then return null; end if;
  select * into t from tenancies where tenancy_code = upper(trim(p_bill_ref)) and status <> 'ended';
  if not found or t.landlord_id <> p_landlord then return null; end if;
  select * into pa from payment_accounts where landlord_id = t.landlord_id;
  if pa.mode <> 'own' or pa.status <> 'connected' or pa.shortcode is null or pa.credentials_ciphertext is null then return null; end if;
  bal := current_balance(t.id);
  if bal is null or bal <= 0 or p_amount <> bal then
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, landlord_id, tenancy_id)
      values (p_receipt, p_bill_ref, p_amount, p_msisdn, 'amount_mismatch', t.landlord_id, t.id)
      on conflict (provider_ref) do nothing;
    return null;
  end if;
  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, msisdn)
    values (t.id, t.landlord_id, 'rent_payment', 'rent', p_amount, 'c2b', p_receipt, p_msisdn)
    returning id into new_id;
  return new_id;
end $$;
