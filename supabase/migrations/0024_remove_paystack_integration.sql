update payment_accounts
set mode = 'platform'
where mode = 'paystack';

alter table payment_accounts
  drop constraint if exists payment_accounts_paystack_mode_check,
  drop constraint if exists payment_accounts_paystack_state_check,
  drop constraint if exists payment_accounts_mode_connection_check;

drop function if exists set_payment_mode(payment_mode);
drop function if exists tenant_payment_route();
drop function if exists get_payment_credentials(uuid);

update payment_attempts
set status = 'failed', result_desc = 'Payment route is no longer available'
where provider = 'paystack' and status = 'pending';

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
            case when a.bank_paybill_shortcode is not null then 'bank_paybill' else 'stk_push' end,
            p_receipt, a.id, p_msisdn)
    returning id into new_id;
  update payment_attempts set status = 'succeeded', result_code = 0 where id = a.id;
  return new_id;
end $$;

drop function if exists save_paystack_credentials(uuid, bytea, connection_status, text);
drop function if exists get_paystack_credentials(uuid);
drop function if exists start_paystack_payment_attempt(uuid, text, text);
drop function if exists paystack_attempt_lookup(text);
drop function if exists fail_paystack_attempt(text, text);

alter table payment_accounts
  drop column if exists paystack_credentials_ciphertext,
  drop column if exists paystack_status,
  drop column if exists paystack_failure_reason;

alter table payment_attempts drop column if exists provider;

alter table payment_accounts alter column mode drop default;
alter table payment_accounts alter column mode type text using mode::text;
drop type payment_mode;
create type payment_mode as enum ('platform', 'own', 'bank_paybill');
alter table payment_accounts
  alter column mode type payment_mode using mode::payment_mode,
  alter column mode set default 'platform';

alter table payment_accounts
  add constraint payment_accounts_mode_connection_check
  check (mode in ('platform', 'bank_paybill')
         or (mode = 'own' and shortcode is not null and shortcode_kind is not null));

create function get_payment_credentials(p_landlord uuid)
returns table (mode payment_mode, shortcode text, shortcode_kind text, cipher bytea, key_version smallint, status connection_status, callback_token text)
language sql stable security definer set search_path = public, pg_temp as $$
  select mode, shortcode, shortcode_kind, credentials_ciphertext, key_version, status, callback_token
  from payment_accounts where landlord_id = p_landlord
$$;
revoke all on function get_payment_credentials(uuid) from public, anon, authenticated;
grant execute on function get_payment_credentials(uuid) to service_role;

create function tenant_payment_route()
returns payment_mode language sql stable security definer set search_path = public, pg_temp as $$
  select pa.mode
  from tenancies t
  join payment_accounts pa on pa.landlord_id = t.landlord_id
  where t.tenant_user_id = auth.uid() and t.status = 'active'
  limit 1
$$;
revoke all on function tenant_payment_route() from public, anon;
grant execute on function tenant_payment_route() to authenticated;

create function set_payment_mode(p_mode payment_mode) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_accounts%rowtype;
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  select * into a from payment_accounts where landlord_id = auth.uid();
  if not found then raise exception 'Payment account not found'; end if;
  if p_mode = 'own' and a.status <> 'connected' then raise exception 'Connect and verify your own Paybill first'; end if;
  if p_mode = 'bank_paybill' and not exists (
    select 1 from landlord_bank_accounts lba
    join banks b on b.id = lba.bank_id and b.active
    where lba.landlord_id = auth.uid() and lba.account_number is not null and lba.verified
  ) then raise exception 'Save and confirm a small test payment for your bank account first'; end if;
  update payment_accounts set mode = p_mode where landlord_id = auth.uid();
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'payment_mode_changed', 'payment_account', a.id, jsonb_build_object('mode', p_mode));
end $$;
revoke all on function set_payment_mode(payment_mode) from public, anon;
grant execute on function set_payment_mode(payment_mode) to authenticated;
