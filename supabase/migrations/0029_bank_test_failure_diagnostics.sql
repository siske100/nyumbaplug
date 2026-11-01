alter table bank_test_payments
  add column callback_result_code integer,
  add column callback_result_desc text,
  add column failure_reason text;

drop function fail_bank_test_payment(text);
drop function fail_bank_test_payment_by_id(uuid);
create function fail_bank_test_payment(p_checkout text, p_code integer, p_desc text, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update bank_test_payments
     set status = 'failed',
         completed_at = now(),
         callback_result_code = p_code,
         callback_result_desc = left(coalesce(p_desc, ''), 200),
         failure_reason = left(coalesce(p_reason, 'Safaricom did not confirm the test payment'), 200)
   where checkout_request_id = p_checkout and status = 'pending';
end $$;

create or replace function fail_bank_test_payment_by_id(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update bank_test_payments
     set status = 'failed', completed_at = now(),
         failure_reason = left(coalesce(p_reason, 'The test payment prompt could not be sent'), 200)
   where id = p_id and status = 'pending';
end $$;

create or replace function complete_bank_test_payment(p_checkout text, p_receipt text, p_amount integer, p_phone text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare test bank_test_payments%rowtype;
begin
  select * into test from bank_test_payments where checkout_request_id = p_checkout for update;
  if not found then raise exception 'Unknown test payment'; end if;
  if test.status = 'succeeded' and test.mpesa_receipt = p_receipt then return; end if;
  if test.status <> 'pending' then raise exception 'The test payment is no longer active'; end if;
  if p_amount is distinct from 10 or p_receipt is null or p_receipt !~ '^[A-Z0-9]{8,12}$'
     or p_phone is distinct from ('254' || substr(test.phone, 2)) then
    update bank_test_payments
       set status = 'failed', completed_at = now(),
           callback_result_code = 0,
           callback_result_desc = 'Success callback did not match the test payment',
           failure_reason = 'Safaricom callback details did not match the test payment'
     where id = test.id;
    return;
  end if;
  update bank_test_payments
     set status = 'succeeded', mpesa_receipt = p_receipt, completed_at = now(),
         callback_result_code = 0, callback_result_desc = 'Safaricom confirmed the test payment',
         failure_reason = null
   where id = test.id;
end $$;

revoke all on function fail_bank_test_payment(text, integer, text, text),
  fail_bank_test_payment_by_id(uuid, text),
  complete_bank_test_payment(text, text, integer, text) from public, anon, authenticated;
grant execute on function fail_bank_test_payment(text, integer, text, text),
  fail_bank_test_payment_by_id(uuid, text),
  complete_bank_test_payment(text, text, integer, text) to service_role;
