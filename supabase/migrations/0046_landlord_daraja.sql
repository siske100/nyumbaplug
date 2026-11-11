-- Restore direct Safaricom Daraja collection for landlords. Credentials remain encrypted
-- and are readable only by the Edge Functions service role.

alter table payment_accounts
  drop constraint if exists payment_accounts_mode_check,
  drop constraint if exists payment_accounts_mode_connection_check;

alter table payment_accounts
  add constraint payment_accounts_mode_check check (
    mode in ('platform', 'own', 'bank_paybill')
    and (mode <> 'own' or (
      shortcode is not null
      and shortcode_kind is not distinct from 'paybill'
    ))
  );

revoke all on payment_accounts from anon, authenticated;
grant select (mode, shortcode, status, failure_reason) on payment_accounts to authenticated;

create or replace function save_payment_credentials(
  p_landlord uuid, p_shortcode text, p_kind text, p_cipher bytea, p_key_version smallint,
  p_status connection_status, p_reason text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_shortcode is null or p_shortcode !~ '^[0-9]{5,7}$' or p_kind is distinct from 'paybill' then
    raise exception 'Invalid Safaricom Paybill details';
  end if;
  if exists (
    select 1 from payment_attempts
     where landlord_id = p_landlord and collection_mode = 'own' and status = 'pending'
  ) then raise exception 'Wait for pending Daraja rent payments to finish before changing credentials'; end if;
  update payment_accounts
     set shortcode = p_shortcode,
         shortcode_kind = p_kind,
         credentials_ciphertext = p_cipher,
         key_version = p_key_version,
         status = p_status,
         failure_reason = p_reason,
         last_verified_at = case when p_status = 'connected' then now() else null end
   where landlord_id = p_landlord;
  if not found then raise exception 'Payment account not found'; end if;
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (p_landlord, 'payment_credentials_saved', 'payment_account', p_landlord, jsonb_build_object('status', p_status));
end $$;

create or replace function get_payment_credentials(p_landlord uuid)
returns table (mode payment_mode, shortcode text, shortcode_kind text, cipher bytea, key_version smallint, status connection_status, callback_token text)
language sql stable security definer set search_path = public, pg_temp as $$
  select pa.mode, pa.shortcode, pa.shortcode_kind, pa.credentials_ciphertext, pa.key_version, pa.status, pa.callback_token
    from payment_accounts pa where pa.landlord_id = p_landlord
$$;

create or replace function account_by_token(p_token text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('landlord_id', landlord_id, 'mode', mode, 'shortcode', shortcode)
    from payment_accounts
   where callback_token = p_token and mode = 'own' and status = 'connected'
$$;

revoke all on function save_payment_credentials(uuid, text, text, bytea, smallint, connection_status, text),
  get_payment_credentials(uuid), account_by_token(text) from public, anon, authenticated;
grant execute on function save_payment_credentials(uuid, text, text, bytea, smallint, connection_status, text),
  get_payment_credentials(uuid), account_by_token(text) to service_role;

create or replace view admin_platform_payout_destinations as
select d.landlord_id, p.full_name, d.kind, d.destination, d.account_ref, d.updated_at
  from payout_destinations d
  join payment_accounts pa on pa.landlord_id = d.landlord_id and pa.mode = 'platform'
  join profiles p on p.id = d.landlord_id
 where is_admin();
grant select on admin_platform_payout_destinations to authenticated;

create or replace function tenant_payment_route()
returns payment_mode language sql stable security definer set search_path = public, pg_temp as $$
  select pa.mode
    from tenancies t
    join payment_accounts pa on pa.landlord_id = t.landlord_id
   where t.tenant_user_id = auth.uid()
     and t.status <> 'ended'
     and landlord_active(t.landlord_id)
     and (
       (pa.mode = 'platform' and exists (select 1 from payout_destinations d where d.landlord_id = pa.landlord_id))
       or (pa.mode = 'own' and pa.status = 'connected' and pa.credentials_ciphertext is not null and pa.shortcode is not null)
       or (pa.mode = 'bank_paybill' and exists (
         select 1 from landlord_bank_accounts lba
         join banks b on b.id = lba.bank_id and b.active
         where lba.landlord_id = pa.landlord_id and lba.account_number is not null and lba.account_name is not null
       ))
     )
   order by (t.status = 'active') desc
   limit 1
$$;

create or replace function set_payment_mode(p_mode payment_mode) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_accounts%rowtype;
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  select * into a from payment_accounts where landlord_id = auth.uid() for update;
  if not found then raise exception 'Payment account not found'; end if;
  if p_mode = 'platform' and not exists (
    select 1 from payout_destinations where landlord_id = auth.uid()
  ) then raise exception 'Add a Safaricom payout destination first'; end if;
  if p_mode = 'own' and (
    a.status <> 'connected' or a.shortcode is null or a.credentials_ciphertext is null
  ) then raise exception 'Connect and verify your Safaricom Daraja Paybill first'; end if;
  if p_mode = 'bank_paybill' and not exists (
    select 1 from landlord_bank_accounts lba join banks b on b.id = lba.bank_id and b.active
     where lba.landlord_id = auth.uid() and lba.account_number is not null and lba.account_name is not null
  ) then raise exception 'Save your bank name, account number and account holder name first'; end if;
  if p_mode <> 'bank_paybill' and exists (
    select 1 from manual_rent_payment_claims where landlord_id = auth.uid() and status = 'pending'
  ) then raise exception 'Review pending manual payment claims before changing payment method'; end if;
  update payment_accounts set mode = p_mode where landlord_id = auth.uid();
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'payment_mode_changed', 'payment_account', a.id, jsonb_build_object('mode', p_mode));
end $$;

revoke all on function tenant_payment_route() from public, anon;
grant execute on function tenant_payment_route() to authenticated;
revoke all on function set_payment_mode(payment_mode) from public, anon;
grant execute on function set_payment_mode(payment_mode) to authenticated;

alter table payment_attempts
  add column collection_mode payment_mode not null default 'platform';

drop function if exists start_tenant_payment_attempt(uuid, text, text, text, integer, payment_mode);
create function start_tenant_payment_attempt(
  p_tenancy uuid, p_msisdn text, p_checkout text, p_merchant text, p_amount integer, p_mode payment_mode
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; a payment_accounts%rowtype; bal integer; reserved integer; aid uuid;
begin
  select * into t from tenancies where id = p_tenancy and status <> 'ended' for update;
  if not found or not landlord_active(t.landlord_id) then raise exception 'Tenancy not found'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a positive payment amount'; end if;
  if p_msisdn !~ '^(07|01)[0-9]{8}$' then raise exception 'Confirm your phone number first'; end if;
  select * into a from payment_accounts where landlord_id = t.landlord_id for share;
  if not found or a.mode is distinct from p_mode then raise exception 'The landlord payment method changed. Refresh and try again'; end if;
  if p_mode = 'platform' then
    if not platform_collection_ready(t.landlord_id) then raise exception 'Tenancy not found'; end if;
  elsif p_mode = 'own' then
    if a.status <> 'connected' or a.credentials_ciphertext is null or a.shortcode is null then
      raise exception 'The landlord Safaricom Daraja connection is not ready';
    end if;
  else
    raise exception 'This rent payment method is not enabled for M-Pesa rent payments';
  end if;

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
  if (select count(*) from payment_attempts x where x.tenancy_id = p_tenancy and x.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many payment attempts. Try again in an hour';
  end if;
  insert into payment_attempts(tenancy_id, landlord_id, msisdn, expected_amount, checkout_request_id, merchant_request_id, collection_mode)
    values (t.id, t.landlord_id, p_msisdn, p_amount, p_checkout, p_merchant, p_mode)
    returning id into aid;
  return aid;
end $$;

create or replace function start_tenant_payment_attempt(
  p_tenancy uuid, p_msisdn text, p_checkout text, p_merchant text, p_amount integer
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare m payment_mode;
begin
  select pa.mode into m
    from tenancies t join payment_accounts pa on pa.landlord_id = t.landlord_id
   where t.id = p_tenancy and t.status <> 'ended';
  return start_tenant_payment_attempt(p_tenancy, p_msisdn, p_checkout, p_merchant, p_amount, m);
end $$;

revoke all on function start_tenant_payment_attempt(uuid, text, text, text, integer, payment_mode),
  start_tenant_payment_attempt(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function start_tenant_payment_attempt(uuid, text, text, text, integer, payment_mode),
  start_tenant_payment_attempt(uuid, text, text, text, integer) to service_role;

create or replace function start_payment_attempt(p_tenancy uuid, p_msisdn text, p_checkout text, p_merchant text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; a payment_accounts%rowtype; bal integer; aid uuid;
begin
  select * into t from tenancies where id = p_tenancy and status <> 'ended';
  if not found or not landlord_active(t.landlord_id) then raise exception 'Tenancy not found'; end if;
  select * into a from payment_accounts where landlord_id = t.landlord_id;
  if not found then raise exception 'Payment account not found'; end if;
  if a.mode = 'platform' and not platform_collection_ready(t.landlord_id) then raise exception 'Tenancy not found'; end if;
  if a.mode = 'own' and (a.status <> 'connected' or a.credentials_ciphertext is null or a.shortcode is null) then
    raise exception 'The landlord Safaricom Daraja connection is not ready';
  end if;
  if a.mode = 'bank_paybill' then raise exception 'Manual bank transfer is not an M-Pesa prompt'; end if;
  bal := current_balance(p_tenancy);
  if bal is null or bal <= 0 then raise exception 'Nothing to pay'; end if;
  if (select count(*) from payment_attempts x where x.tenancy_id = p_tenancy and x.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many payment attempts. Try again in an hour';
  end if;
  insert into payment_attempts(tenancy_id, landlord_id, msisdn, expected_amount, checkout_request_id, merchant_request_id, collection_mode)
    values (t.id, t.landlord_id, p_msisdn, bal, p_checkout, p_merchant, a.mode)
    returning id into aid;
  return aid;
end $$;

create or replace function attempt_lookup(p_checkout text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select jsonb_build_object(
       'kind', 'tenant', 'id', id, 'landlord_id', landlord_id, 'amount', expected_amount,
       'status', status, 'bank_paybill_shortcode', bank_paybill_shortcode, 'collection_mode', collection_mode
     ) from payment_attempts where checkout_request_id = p_checkout),
    (select jsonb_build_object(
       'kind', 'platform', 'id', id, 'landlord_id', landlord_id, 'amount', amount,
       'status', status, 'collection_mode', 'platform'
     ) from platform_attempts where checkout_request_id = p_checkout))
$$;

revoke all on function attempt_lookup(text) from public, anon, authenticated;
grant execute on function attempt_lookup(text) to service_role;

create or replace function confirm_payment(p_checkout text, p_receipt text, p_amount integer, p_msisdn text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_attempts%rowtype; existing uuid; new_id uuid; t tenancies%rowtype; bal integer; reserved integer; custody_value text;
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
      values (p_receipt, t.tenancy_code, p_amount, p_msisdn, 'amount_mismatch', a.landlord_id, a.tenancy_id,
              case when a.collection_mode = 'own' then 'landlord' else 'platform' end)
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
      values (p_receipt, t.tenancy_code, p_amount, p_msisdn, 'advance_limit', a.landlord_id, a.tenancy_id,
              case when a.collection_mode = 'own' then 'landlord' else 'platform' end)
      on conflict (provider_ref) do nothing;
    return null;
  end if;
  custody_value := case when a.collection_mode = 'own' then 'landlord' else 'platform' end;
  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, attempt_id, msisdn, custody)
    values (a.tenancy_id, a.landlord_id, 'rent_payment', 'rent', p_amount,
            case when a.provider = 'paystack' then 'paystack' else 'stk_push' end,
            p_receipt, a.id, p_msisdn, custody_value)
    returning id into new_id;
  update payment_attempts set status = 'succeeded', result_code = 0 where id = a.id;
  return new_id;
end $$;

create or replace function validate_c2b(p_bill_ref text, p_amount integer, p_landlord uuid default null)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; bal integer; m payment_mode; ready boolean;
begin
  select * into t from tenancies where tenancy_code = upper(trim(p_bill_ref)) and status <> 'ended';
  if not found or not landlord_active(t.landlord_id) then return 'unknown_account'; end if;
  if p_landlord is not null and t.landlord_id <> p_landlord then return 'unknown_account'; end if;
  select mode into m from payment_accounts where landlord_id = t.landlord_id;
  ready := case
    when p_landlord is null then m = 'platform' and platform_collection_ready(t.landlord_id)
    else t.landlord_id = p_landlord and m = 'own'
      and exists (select 1 from payment_accounts where landlord_id = p_landlord and status = 'connected' and credentials_ciphertext is not null)
  end;
  if not coalesce(ready, false) then return 'unknown_account'; end if;
  bal := current_balance(t.id);
  if bal is null or bal <= 0 then return 'nothing_due'; end if;
  if p_amount <> bal then return 'amount_mismatch'; end if;
  return 'ok';
end $$;

create or replace function record_c2b_payment(p_bill_ref text, p_amount integer, p_receipt text, p_msisdn text, p_landlord uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; existing uuid; new_id uuid; bal integer; m payment_mode; ready boolean; custody_value text;
begin
  select id into existing from ledger_entries where provider_ref = p_receipt;
  if found then return existing; end if;
  if exists (select 1 from held_payments where provider_ref = p_receipt) then return null; end if;
  select * into t from tenancies where tenancy_code = upper(trim(p_bill_ref)) and status <> 'ended';
  custody_value := case when p_landlord is null then 'platform' else 'landlord' end;
  if not found or not landlord_active(t.landlord_id) then
    if p_landlord is not null then return null; end if;
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, custody)
      values (p_receipt, left(p_bill_ref, 40), p_amount, p_msisdn, 'unknown_account', custody_value)
      on conflict (provider_ref) do nothing;
    return null;
  end if;
  if p_landlord is not null and t.landlord_id <> p_landlord then return null; end if;
  select mode into m from payment_accounts where landlord_id = t.landlord_id;
  ready := case
    when p_landlord is null then m = 'platform' and platform_collection_ready(t.landlord_id)
    else t.landlord_id = p_landlord and m = 'own'
      and exists (select 1 from payment_accounts where landlord_id = p_landlord and status = 'connected' and credentials_ciphertext is not null)
  end;
  bal := current_balance(t.id);
  if not coalesce(ready, false) or bal is null or bal <= 0 or p_amount <> bal then
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, landlord_id, tenancy_id, custody)
      values (p_receipt, t.tenancy_code, p_amount, p_msisdn,
              case when not coalesce(ready, false) then 'unknown_account' when bal is null or bal <= 0 then 'duplicate_payment' else 'amount_mismatch' end,
              t.landlord_id, t.id, custody_value)
      on conflict (provider_ref) do nothing;
    return null;
  end if;
  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, msisdn, custody)
    values (t.id, t.landlord_id, 'rent_payment', 'rent', p_amount, 'c2b', p_receipt, p_msisdn, custody_value)
    returning id into new_id;
  return new_id;
end $$;
