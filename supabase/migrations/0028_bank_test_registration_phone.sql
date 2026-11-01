create or replace function start_bank_test_payment(p_landlord uuid)
returns table (id uuid, paybill text, account_number text, phone text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare a landlord_bank_accounts%rowtype; b banks%rowtype; p profiles%rowtype; test_id uuid;
begin
  if not landlord_active(p_landlord) then raise exception 'Your account is not active'; end if;
  select * into p from profiles where profiles.id = p_landlord and role = 'landlord';
  if not found or p.phone is null then raise exception 'Add a phone number to your account first'; end if;
  select * into a from landlord_bank_accounts where landlord_id = p_landlord for update;
  if not found or a.account_number is null then raise exception 'Save your bank account details first'; end if;
  select * into b from banks where banks.id = a.bank_id and active;
  if not found then raise exception 'Select an available receiving bank'; end if;
  if p.phone !~ '^0[17][0-9]{8}$' then raise exception 'Your saved phone number is invalid'; end if;

  update bank_test_payments
     set status = 'failed', completed_at = now()
   where landlord_bank_account_id = p_landlord and status = 'pending';

  insert into bank_test_payments (landlord_bank_account_id, bank_id, paybill, account_number, phone)
    values (p_landlord, b.id, b.paybill, a.account_number, p.phone)
    returning bank_test_payments.id into test_id;
  return query select test_id, b.paybill, a.account_number, p.phone;
end $$;

revoke all on function start_bank_test_payment(uuid) from public, anon, authenticated;
grant execute on function start_bank_test_payment(uuid) to service_role;
