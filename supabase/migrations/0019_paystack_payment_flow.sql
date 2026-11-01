-- Landlords may receive rent directly through their own Paystack account.
alter table payment_accounts
  add column paystack_credentials_ciphertext bytea,
  add column paystack_status connection_status not null default 'not_connected',
  add column paystack_failure_reason text,
  add constraint payment_accounts_paystack_state_check
    check ((paystack_status = 'connected') = (paystack_credentials_ciphertext is not null)),
  add constraint payment_accounts_paystack_mode_check
    check (mode <> 'paystack' or paystack_status = 'connected');

alter table payment_attempts
  add column provider text not null default 'daraja' check (provider in ('daraja','paystack'));

alter table ledger_entries drop constraint ledger_entries_method_check;
alter table ledger_entries add constraint ledger_entries_method_check
  check (method in ('stk_push','c2b','paystack','reversal'));

create or replace function set_payment_mode(p_mode payment_mode) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_accounts%rowtype;
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  select * into a from payment_accounts where landlord_id = auth.uid();
  if not found then raise exception 'Payment account not found'; end if;
  if p_mode = 'own' and a.status <> 'connected' then raise exception 'Connect and verify your own Paybill first'; end if;
  if p_mode = 'paystack' and a.paystack_status <> 'connected' then raise exception 'Connect and verify your Paystack account first'; end if;
  update payment_accounts set mode = p_mode where landlord_id = auth.uid();
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'payment_mode_changed', 'payment_account', a.id, jsonb_build_object('mode', p_mode));
end $$;

create function save_paystack_credentials(p_landlord uuid, p_cipher bytea, p_status connection_status, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update payment_accounts
     set paystack_credentials_ciphertext = case when p_status = 'connected' then p_cipher else null end,
         paystack_status = p_status,
         paystack_failure_reason = p_reason,
         mode = case when p_status <> 'connected' and mode = 'paystack' then 'platform'::payment_mode else mode end
   where landlord_id = p_landlord;
  if not found then raise exception 'Payment account not found'; end if;
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (p_landlord, 'paystack_credentials_saved', 'payment_account', p_landlord, jsonb_build_object('status', p_status));
end $$;

create function get_paystack_credentials(p_landlord uuid)
returns table (mode payment_mode, cipher bytea, status connection_status)
language sql stable security definer set search_path = public, pg_temp as $$
  select mode, paystack_credentials_ciphertext, paystack_status
  from payment_accounts where landlord_id = p_landlord
$$;

create function tenant_payment_route()
returns payment_mode language sql stable security definer set search_path = public, pg_temp as $$
  select pa.mode
  from tenancies t
  join payment_accounts pa on pa.landlord_id = t.landlord_id
  where t.tenant_user_id = auth.uid() and t.status = 'active'
  limit 1
$$;

create function start_paystack_payment_attempt(p_tenancy uuid, p_reference text, p_msisdn text)
returns table (attempt_id uuid, expected_amount integer, tenancy_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; bal integer; aid uuid;
begin
  if p_reference !~ '^RHPS-[A-Za-z0-9-]{36}$' then raise exception 'Invalid Paystack reference'; end if;
  if p_msisdn !~ '^(07|01)[0-9]{8}$' then raise exception 'Confirm your phone number first'; end if;
  select * into t from tenancies where id = p_tenancy and status = 'active';
  if not found or not landlord_active(t.landlord_id) then raise exception 'Tenancy not found'; end if;
  if not exists (
    select 1 from payment_accounts
    where landlord_id = t.landlord_id and mode = 'paystack' and paystack_status = 'connected'
      and paystack_credentials_ciphertext is not null
  ) then raise exception 'This landlord has not connected Paystack'; end if;
  bal := current_balance(p_tenancy);
  if bal is null or bal <= 0 then raise exception 'Nothing to pay'; end if;
  insert into payment_attempts(tenancy_id, landlord_id, msisdn, expected_amount, checkout_request_id, provider)
    values (t.id, t.landlord_id, p_msisdn, bal, p_reference, 'paystack')
    returning id into aid;
  return query select aid, bal, t.tenancy_code;
end $$;

create function paystack_attempt_lookup(p_reference text)
returns table (landlord_id uuid, tenancy_id uuid, expected_amount integer, msisdn text, status attempt_status)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.landlord_id, a.tenancy_id, a.expected_amount, a.msisdn, a.status
  from payment_attempts a where a.provider = 'paystack' and a.checkout_request_id = p_reference
$$;

create function fail_paystack_attempt(p_reference text, p_desc text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update payment_attempts set status = 'failed', result_desc = left(p_desc, 200)
  where provider = 'paystack' and checkout_request_id = p_reference and status = 'pending'
$$;

create or replace function confirm_payment(p_checkout text, p_receipt text, p_amount integer, p_msisdn text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_attempts%rowtype; existing uuid; new_id uuid; t tenancies%rowtype;
begin
  select id into existing from ledger_entries where provider_ref = p_receipt;
  if found then return existing; end if;
  select * into a from payment_attempts where checkout_request_id = p_checkout for update;
  if not found then raise exception 'Unknown payment request'; end if;
  select id into existing from ledger_entries where attempt_id = a.id;
  if found then return existing; end if;
  select * into t from tenancies where id = a.tenancy_id;
  if p_amount <> a.expected_amount then
    update payment_attempts set status = 'failed', result_desc = 'amount_mismatch' where id = a.id;
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, landlord_id, tenancy_id)
      values (p_receipt, t.tenancy_code, p_amount, p_msisdn, 'amount_mismatch', a.landlord_id, a.tenancy_id)
      on conflict (provider_ref) do nothing;
    return null;
  end if;
  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, attempt_id, msisdn)
    values (a.tenancy_id, a.landlord_id, 'rent_payment', 'rent', p_amount,
            case when a.provider = 'paystack' then 'paystack' else 'stk_push' end,
            p_receipt, a.id, p_msisdn)
    returning id into new_id;
  update payment_attempts set status = 'succeeded', result_code = 0 where id = a.id;
  return new_id;
end $$;

grant select (paystack_status, paystack_failure_reason) on payment_accounts to authenticated;
grant execute on function tenant_payment_route() to authenticated;
grant execute on function save_paystack_credentials(uuid, bytea, connection_status, text),
  get_paystack_credentials(uuid), start_paystack_payment_attempt(uuid, text, text),
  paystack_attempt_lookup(text), fail_paystack_attempt(text, text),
  confirm_payment(text, text, integer, text) to service_role;
