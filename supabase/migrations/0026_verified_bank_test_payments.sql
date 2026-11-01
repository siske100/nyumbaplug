create table bank_test_payments (
  id uuid primary key default gen_random_uuid(),
  landlord_bank_account_id uuid not null references landlord_bank_accounts(landlord_id) on delete cascade,
  checkout_request_id text unique,
  mpesa_receipt text unique,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  bank_id bigint not null references banks(id),
  paybill text not null check (paybill ~ '^[0-9]{5,7}$'),
  account_number text not null check (account_number ~ '^[0-9]{1,40}$'),
  phone text not null check (phone ~ '^0[17][0-9]{8}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'succeeded') = (mpesa_receipt is not null))
);
create trigger bank_test_payments_updated before update on bank_test_payments
  for each row execute function set_updated_at();
create index bank_test_payments_landlord_created_idx
  on bank_test_payments(landlord_bank_account_id, created_at desc);

create function invalidate_bank_test_payments_on_destination_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.bank_id is distinct from new.bank_id or old.account_number is distinct from new.account_number then
    update bank_test_payments set status = 'failed', completed_at = now()
     where landlord_bank_account_id = new.landlord_id and status = 'pending';
  end if;
  return new;
end $$;
create trigger landlord_bank_account_destination_changed
  after update of bank_id, account_number on landlord_bank_accounts
  for each row execute function invalidate_bank_test_payments_on_destination_change();

update landlord_bank_accounts
   set verified = false, test_payment_receipt = null, verified_at = null;
update payment_accounts set mode = 'platform' where mode = 'bank_paybill';

alter table bank_test_payments enable row level security;
create policy bank_test_payments_read on bank_test_payments
  for select to authenticated using (landlord_bank_account_id = auth.uid());
grant select on bank_test_payments to authenticated;
revoke insert, update, delete on bank_test_payments from anon, authenticated;

create function start_bank_test_payment(p_landlord uuid)
returns table (id uuid, paybill text, account_number text, phone text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare a landlord_bank_accounts%rowtype; b banks%rowtype; p profiles%rowtype; test_id uuid;
begin
  if not landlord_active(p_landlord) then raise exception 'Your account is not active'; end if;
  select * into p from profiles where profiles.id = p_landlord and role = 'landlord';
  if not found or p.phone is null or not p.phone_verified then
    raise exception 'Confirm your phone number first';
  end if;
  select * into a from landlord_bank_accounts where landlord_id = p_landlord for update;
  if not found or a.account_number is null then raise exception 'Save your bank account details first'; end if;
  select * into b from banks where banks.id = a.bank_id and active;
  if not found then raise exception 'Select an available receiving bank'; end if;
  if p.phone !~ '^0[17][0-9]{8}$' then raise exception 'Your verified phone number is invalid'; end if;

  update bank_test_payments
     set status = 'failed', completed_at = now()
   where landlord_bank_account_id = p_landlord and status = 'pending';

  insert into bank_test_payments (landlord_bank_account_id, bank_id, paybill, account_number, phone)
    values (p_landlord, b.id, b.paybill, a.account_number, p.phone)
    returning bank_test_payments.id into test_id;
  return query select test_id, b.paybill, a.account_number, p.phone;
end $$;

create function bind_bank_test_payment(p_id uuid, p_checkout text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_checkout is null or p_checkout = '' then raise exception 'Invalid payment request'; end if;
  update bank_test_payments set checkout_request_id = p_checkout
   where id = p_id and status = 'pending' and checkout_request_id is null;
  if not found then raise exception 'The test payment is no longer active'; end if;
end $$;

create function bank_test_payment_lookup(p_checkout text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'kind', 'bank_test', 'id', id, 'landlord_bank_account_id', landlord_bank_account_id,
    'status', status, 'paybill', paybill, 'account_number', account_number, 'phone', phone
  )
  from bank_test_payments where checkout_request_id = p_checkout
$$;

create function fail_bank_test_payment(p_checkout text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update bank_test_payments set status = 'failed', completed_at = now()
   where checkout_request_id = p_checkout and status = 'pending';
end $$;

create function fail_bank_test_payment_by_id(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update bank_test_payments set status = 'failed', completed_at = now()
   where id = p_id and status = 'pending';
end $$;

create function complete_bank_test_payment(p_checkout text, p_receipt text, p_amount integer, p_phone text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare test bank_test_payments%rowtype;
begin
  select * into test from bank_test_payments where checkout_request_id = p_checkout for update;
  if not found then raise exception 'Unknown test payment'; end if;
  if test.status = 'succeeded' and test.mpesa_receipt = p_receipt then return; end if;
  if test.status <> 'pending' then raise exception 'The test payment is no longer active'; end if;
  if p_amount is distinct from 10 or p_receipt is null or p_receipt !~ '^[A-Z0-9]{8,12}$'
     or p_phone is distinct from ('254' || substr(test.phone, 2)) then
    update bank_test_payments set status = 'failed', completed_at = now() where id = test.id;
    return;
  end if;
  update bank_test_payments
     set status = 'succeeded', mpesa_receipt = p_receipt, completed_at = now()
   where id = test.id;
end $$;

drop function confirm_landlord_bank_account_test(text);
create function confirm_landlord_bank_account_test()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare test bank_test_payments%rowtype;
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  select * into test from bank_test_payments
   where landlord_bank_account_id = auth.uid()
   order by created_at desc limit 1;
  if not found or test.status <> 'succeeded' then
    raise exception 'Wait for Safaricom to confirm the KES 10 test payment first';
  end if;
  update landlord_bank_accounts lba
     set verified = true, test_payment_receipt = test.mpesa_receipt, verified_at = now()
   where lba.landlord_id = auth.uid()
     and lba.bank_id = test.bank_id
     and lba.account_number = test.account_number
     and exists (select 1 from banks b where b.id = lba.bank_id and b.active and b.paybill = test.paybill);
  if not found then raise exception 'Your bank details changed. Send a new test payment'; end if;
  update payment_accounts set mode = 'platform'
   where landlord_id = auth.uid() and mode = 'bank_paybill';
end $$;

revoke all on function start_bank_test_payment(uuid), bind_bank_test_payment(uuid, text),
  bank_test_payment_lookup(text), fail_bank_test_payment(text),
  fail_bank_test_payment_by_id(uuid),
  complete_bank_test_payment(text, text, integer, text),
  confirm_landlord_bank_account_test() from public, anon, authenticated;
revoke all on function invalidate_bank_test_payments_on_destination_change() from public, anon, authenticated;
grant execute on function start_bank_test_payment(uuid), bind_bank_test_payment(uuid, text),
  bank_test_payment_lookup(text), fail_bank_test_payment(text),
  fail_bank_test_payment_by_id(uuid),
  complete_bank_test_payment(text, text, integer, text) to service_role;
grant execute on function confirm_landlord_bank_account_test() to authenticated;
