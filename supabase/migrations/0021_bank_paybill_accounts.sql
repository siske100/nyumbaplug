create table banks (
  id bigint generated always as identity primary key,
  name text not null unique check (char_length(trim(name)) between 2 and 120),
  paybill text not null unique check (paybill ~ '^[0-9]{5,7}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger banks_updated before update on banks for each row execute function set_updated_at();

create table landlord_bank_accounts (
  landlord_id uuid primary key references profiles(id) on delete cascade,
  bank_id bigint not null references banks(id),
  account_number text check (account_number is null or account_number ~ '^[0-9]{1,40}$'),
  verified boolean not null default false,
  test_payment_receipt text unique,
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((verified = true) = (test_payment_receipt is not null and verified_at is not null)),
  check (verified = false or account_number is not null)
);
create trigger landlord_bank_accounts_updated before update on landlord_bank_accounts
  for each row execute function set_updated_at();

create function reset_bank_accounts_on_paybill_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.paybill is distinct from new.paybill then
    update landlord_bank_accounts
       set verified = false, test_payment_receipt = null, verified_at = null
     where bank_id = new.id;
    update payment_accounts
       set mode = 'platform'
     where landlord_id in (select landlord_id from landlord_bank_accounts where bank_id = new.id)
       and mode = 'bank_paybill';
  end if;
  return new;
end $$;
create trigger banks_paybill_change_resets_accounts after update of paybill on banks
  for each row execute function reset_bank_accounts_on_paybill_change();

alter table banks enable row level security;
alter table landlord_bank_accounts enable row level security;

create policy banks_read on banks for select to anon, authenticated using (active);
create policy landlord_bank_accounts_read on landlord_bank_accounts
  for select to authenticated using (landlord_id = auth.uid());

grant select on banks to anon, authenticated;
grant select on landlord_bank_accounts to authenticated;

revoke all on banks from anon, authenticated;
grant select on banks to anon, authenticated;
revoke insert, update, delete on landlord_bank_accounts from anon, authenticated;

-- A bank change clears the saved account and its confirmation; the landlord must submit it again.
create function save_landlord_bank_account(p_bank_id bigint, p_account_number text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare existing landlord_bank_accounts%rowtype;
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  if not exists (select 1 from banks where id = p_bank_id and active) then
    raise exception 'Select an available receiving bank';
  end if;

  select * into existing from landlord_bank_accounts
   where landlord_id = auth.uid() for update;

  if found and existing.bank_id <> p_bank_id then
    update landlord_bank_accounts
       set bank_id = p_bank_id, account_number = null, verified = false,
           test_payment_receipt = null, verified_at = null
     where landlord_id = auth.uid();
    update payment_accounts set mode = 'platform' where landlord_id = auth.uid() and mode = 'bank_paybill';
    return 'reenter_account_number';
  end if;

  if p_account_number is null or p_account_number !~ '^[0-9]{1,40}$' then
    raise exception 'Enter an account number containing 1 to 40 digits';
  end if;

  insert into landlord_bank_accounts (landlord_id, bank_id, account_number)
    values (auth.uid(), p_bank_id, p_account_number)
  on conflict (landlord_id) do update
    set account_number = excluded.account_number,
        verified = case
          when landlord_bank_accounts.account_number is distinct from excluded.account_number then false
          else landlord_bank_accounts.verified
        end,
        test_payment_receipt = case
          when landlord_bank_accounts.account_number is distinct from excluded.account_number then null
          else landlord_bank_accounts.test_payment_receipt
        end,
        verified_at = case
          when landlord_bank_accounts.account_number is distinct from excluded.account_number then null
          else landlord_bank_accounts.verified_at
        end;

  return 'saved';
end $$;

-- This records the landlord's confirmation of a small test payment; clients cannot write verified directly.
create function confirm_landlord_bank_account_test(p_receipt text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  if p_receipt !~ '^[A-Za-z0-9]{8,12}$' then raise exception 'Enter a valid M-Pesa receipt number'; end if;
  update landlord_bank_accounts
     set verified = true, test_payment_receipt = upper(p_receipt), verified_at = now()
   where landlord_id = auth.uid()
     and account_number is not null
     and exists (select 1 from banks where id = landlord_bank_accounts.bank_id and active);
  if not found then raise exception 'Save an account number for an available bank first'; end if;
  update payment_accounts set mode = 'platform'
   where landlord_id = auth.uid() and mode = 'bank_paybill';
end $$;

alter table payment_accounts drop constraint payment_accounts_check;
alter table payment_accounts add constraint payment_accounts_mode_connection_check
  check (mode in ('platform', 'paystack', 'bank_paybill')
         or (mode = 'own' and shortcode is not null and shortcode_kind is not null));

create or replace function set_payment_mode(p_mode payment_mode) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_accounts%rowtype;
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  select * into a from payment_accounts where landlord_id = auth.uid();
  if not found then raise exception 'Payment account not found'; end if;
  if p_mode = 'own' and a.status <> 'connected' then raise exception 'Connect and verify your own Paybill first'; end if;
  if p_mode = 'paystack' and a.paystack_status <> 'connected' then raise exception 'Connect and verify your Paystack account first'; end if;
  if p_mode = 'bank_paybill' and not exists (
    select 1 from landlord_bank_accounts lba
    join banks b on b.id = lba.bank_id and b.active
    where lba.landlord_id = auth.uid() and lba.account_number is not null and lba.verified
  ) then raise exception 'Save and confirm a small test payment for your bank account first'; end if;
  update payment_accounts set mode = p_mode where landlord_id = auth.uid();
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'payment_mode_changed', 'payment_account', a.id, jsonb_build_object('mode', p_mode));
end $$;

revoke all on function save_landlord_bank_account(bigint, text),
  confirm_landlord_bank_account_test(text) from public, anon;
grant execute on function save_landlord_bank_account(bigint, text),
  confirm_landlord_bank_account_test(text), set_payment_mode(payment_mode) to authenticated;
