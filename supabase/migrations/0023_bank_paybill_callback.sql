create or replace function attempt_lookup(p_checkout text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select jsonb_build_object(
       'kind', 'tenant', 'id', id, 'landlord_id', landlord_id, 'amount', expected_amount,
       'status', status, 'bank_paybill_shortcode', bank_paybill_shortcode
     ) from payment_attempts where checkout_request_id = p_checkout),
    (select jsonb_build_object(
       'kind', 'platform', 'id', id, 'landlord_id', landlord_id, 'amount', amount,
       'status', status
     ) from platform_attempts where checkout_request_id = p_checkout))
$$;

create function pending_stk_attempts(p_min_age interval default interval '3 minutes')
returns table (kind text, id uuid, landlord_id uuid, checkout text, amount integer, bank_paybill_shortcode text)
language sql stable security definer set search_path = public, pg_temp as $$
  select 'tenant', a.id, a.landlord_id, a.checkout_request_id, a.expected_amount, a.bank_paybill_shortcode
    from payment_attempts a
   where a.status = 'pending' and a.checkout_request_id not like 'pending-%'
     and a.created_at < now() - p_min_age and a.created_at > now() - interval '24 hours'
  union all
  select 'platform', a.id, a.landlord_id, a.checkout_request_id, a.amount, null::text
    from platform_attempts a
   where a.status = 'pending' and a.checkout_request_id not like 'pending-%'
     and a.created_at < now() - p_min_age and a.created_at > now() - interval '24 hours'
$$;

alter table ledger_entries drop constraint ledger_entries_method_check;
alter table ledger_entries add constraint ledger_entries_method_check
  check (method in ('stk_push','c2b','paystack','bank_paybill','reversal'));

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
            case when a.bank_paybill_shortcode is not null then 'bank_paybill'
                 when a.provider = 'paystack' then 'paystack'
                 else 'stk_push' end,
            p_receipt, a.id, p_msisdn)
    returning id into new_id;
  update payment_attempts set status = 'succeeded', result_code = 0 where id = a.id;
  return new_id;
end $$;

revoke all on function pending_stk_attempts(interval) from public, anon, authenticated;
grant execute on function pending_stk_attempts(interval) to service_role;
