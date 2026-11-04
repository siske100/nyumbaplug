alter table landlord_bank_accounts
  add column account_name text check (account_name is null or char_length(trim(account_name)) between 2 and 120);

alter table ledger_entries drop constraint ledger_entries_method_check;
alter table ledger_entries add constraint ledger_entries_method_check
  check (method in ('stk_push','c2b','paystack','bank_paybill','manual_transfer','reversal'));

create table manual_rent_payment_claims (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references tenancies(id),
  landlord_id uuid not null references profiles(id),
  amount integer not null check (amount > 0),
  transaction_message text not null check (char_length(trim(transaction_message)) between 10 and 2000),
  status text not null default 'pending' check (status in ('pending','received','rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references profiles(id),
  ledger_entry_id uuid unique references ledger_entries(id),
  check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null and ledger_entry_id is null)
    or (status = 'received' and reviewed_at is not null and reviewed_by is not null and ledger_entry_id is not null)
    or (status = 'rejected' and reviewed_at is not null and reviewed_by is not null and ledger_entry_id is null)
  )
);
create unique index manual_rent_payment_one_pending_per_tenancy
  on manual_rent_payment_claims(tenancy_id) where status = 'pending';
create index manual_rent_payment_claims_landlord_idx
  on manual_rent_payment_claims(landlord_id, submitted_at desc);

alter table manual_rent_payment_claims enable row level security;
create policy manual_rent_claims_read on manual_rent_payment_claims for select to authenticated using (
  (landlord_id = auth.uid() and landlord_active(auth.uid()))
  or exists (
    select 1 from tenancies t
     where t.id = tenancy_id and t.tenant_user_id = auth.uid() and t.status = 'active'
  )
);
revoke all on manual_rent_payment_claims from public, anon, authenticated;
grant select on manual_rent_payment_claims to authenticated;

create or replace function save_landlord_manual_bank_account(
  p_bank_id bigint, p_account_number text, p_account_name text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare existing landlord_bank_accounts%rowtype; had_existing boolean;
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  if p_account_number is null or p_account_number !~ '^[0-9]{1,40}$' then
    raise exception 'Enter an account number containing 1 to 40 digits';
  end if;
  if char_length(trim(coalesce(p_account_name, ''))) not between 2 and 120 then
    raise exception 'Enter the account holder name';
  end if;
  if not exists (select 1 from banks where id = p_bank_id and active) then
    raise exception 'Select an available bank';
  end if;

  perform 1 from payment_accounts where landlord_id = auth.uid() for update;
  if not found then raise exception 'Payment account not found'; end if;
  select * into existing from landlord_bank_accounts
   where landlord_id = auth.uid() for update;
  had_existing := found;
  if exists (
    select 1 from manual_rent_payment_claims
     where landlord_id = auth.uid() and status = 'pending'
  ) then
    raise exception 'Review pending manual payment claims before changing bank details';
  end if;

  insert into landlord_bank_accounts (landlord_id, bank_id, account_number, account_name)
    values (auth.uid(), p_bank_id, p_account_number, trim(p_account_name))
  on conflict (landlord_id) do update
    set bank_id = excluded.bank_id,
        account_number = excluded.account_number,
        account_name = excluded.account_name,
        verified = case
          when landlord_bank_accounts.bank_id is distinct from excluded.bank_id
            or landlord_bank_accounts.account_number is distinct from excluded.account_number then false
          else landlord_bank_accounts.verified
        end,
        test_payment_receipt = case
          when landlord_bank_accounts.bank_id is distinct from excluded.bank_id
            or landlord_bank_accounts.account_number is distinct from excluded.account_number then null
          else landlord_bank_accounts.test_payment_receipt
        end,
        verified_at = case
          when landlord_bank_accounts.bank_id is distinct from excluded.bank_id
            or landlord_bank_accounts.account_number is distinct from excluded.account_number then null
          else landlord_bank_accounts.verified_at
        end;

  if had_existing and (existing.bank_id is distinct from p_bank_id or existing.account_number is distinct from p_account_number) then
    update payment_accounts set mode = 'platform'
     where landlord_id = auth.uid() and mode = 'bank_paybill';
  end if;
end $$;
revoke all on function save_landlord_manual_bank_account(bigint, text, text) from public, anon;
grant execute on function save_landlord_manual_bank_account(bigint, text, text) to authenticated;

create or replace function set_payment_mode(p_mode payment_mode) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_accounts%rowtype;
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  if p_mode not in ('own','bank_paybill') then
    raise exception 'Choose Daraja or manual bank transfer for rent';
  end if;
  select * into a from payment_accounts where landlord_id = auth.uid() for update;
  if not found then raise exception 'Payment account not found'; end if;
  if p_mode = 'own' then
    if a.status <> 'connected' or a.shortcode is null or a.credentials_ciphertext is null then
      raise exception 'Connect and verify your own Daraja Paybill first';
    end if;
  elsif not exists (
    select 1 from landlord_bank_accounts lba
    join banks b on b.id = lba.bank_id and b.active
    where lba.landlord_id = auth.uid()
      and lba.account_number is not null
      and lba.account_name is not null
  ) then
    raise exception 'Save your bank name, account number and account holder name first';
  end if;
  if exists (
    select 1 from payment_attempts
     where landlord_id = auth.uid() and status = 'pending'
  ) then
    raise exception 'Wait for pending M-Pesa rent prompts before changing payment method';
  end if;
  if exists (
    select 1 from manual_rent_payment_claims
     where landlord_id = auth.uid() and status = 'pending'
  ) and p_mode <> 'bank_paybill' then
    raise exception 'Review pending manual payment claims before changing payment method';
  end if;

  update payment_accounts set mode = p_mode where landlord_id = auth.uid();
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'payment_mode_changed', 'payment_account', a.id,
            jsonb_build_object('mode', p_mode, 'manual_review_required', p_mode = 'bank_paybill'));
end $$;
revoke all on function set_payment_mode(payment_mode) from public, anon;
grant execute on function set_payment_mode(payment_mode) to authenticated;

create or replace function save_payment_credentials(
  p_landlord uuid, p_shortcode text, p_kind text, p_cipher bytea,
  p_key_version smallint, p_status connection_status, p_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from payment_accounts where landlord_id = p_landlord for update;
  if not found then raise exception 'Payment account not found'; end if;
  if p_status = 'connected' and exists (
    select 1 from manual_rent_payment_claims
     where landlord_id = p_landlord and status = 'pending'
  ) then
    raise exception 'Review pending manual payment claims before switching to Daraja';
  end if;
  if p_status = 'connected' and exists (
    select 1 from payment_attempts
     where landlord_id = p_landlord and status = 'pending'
  ) then
    raise exception 'Wait for pending M-Pesa rent prompts before replacing Daraja credentials';
  end if;
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

create or replace function tenant_payment_route()
returns payment_mode language sql stable security definer set search_path = public, pg_temp as $$
  select pa.mode
    from tenancies t
    join payment_accounts pa on pa.landlord_id = t.landlord_id
   where t.tenant_user_id = auth.uid()
     and t.status = 'active'
     and landlord_active(t.landlord_id)
     and (
       (pa.mode = 'own' and pa.status = 'connected' and pa.shortcode is not null and pa.credentials_ciphertext is not null)
       or (pa.mode = 'bank_paybill' and exists (
         select 1 from landlord_bank_accounts lba
         join banks b on b.id = lba.bank_id and b.active
         where lba.landlord_id = t.landlord_id
           and lba.account_number is not null and lba.account_name is not null
       ))
     )
   limit 1
$$;
revoke all on function tenant_payment_route() from public, anon;
grant execute on function tenant_payment_route() to authenticated;

create or replace function tenant_manual_bank_details()
returns table (bank_name text, account_number text, account_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.name, lba.account_number, lba.account_name
    from tenancies t
    join payment_accounts pa on pa.landlord_id = t.landlord_id and pa.mode = 'bank_paybill'
    join landlord_bank_accounts lba on lba.landlord_id = t.landlord_id
    join banks b on b.id = lba.bank_id and b.active
   where t.tenant_user_id = auth.uid() and t.status = 'active'
     and landlord_active(t.landlord_id)
     and lba.account_number is not null and lba.account_name is not null
   limit 1
$$;
revoke all on function tenant_manual_bank_details() from public, anon;
grant execute on function tenant_manual_bank_details() to authenticated;

create function submit_manual_rent_payment(p_amount integer, p_message text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; a payment_accounts%rowtype; current_due integer; claim_id uuid;
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
  current_due := current_balance(t.id);
  if current_due is null or current_due <= 0 then raise exception 'Nothing to pay'; end if;
  if p_amount is distinct from current_due then
    raise exception 'Enter the full outstanding balance of KES %', current_due;
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
revoke all on function submit_manual_rent_payment(integer, text) from public, anon;
grant execute on function submit_manual_rent_payment(integer, text) to authenticated;

create function review_manual_rent_payment(p_claim uuid, p_received boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c manual_rent_payment_claims%rowtype; t tenancies%rowtype; due integer; entry_id uuid;
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
  due := current_balance(t.id);
  if due is distinct from c.amount then
    raise exception 'The outstanding balance changed. Review the transfer against the current balance before confirming';
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
            jsonb_build_object('tenancy_id', c.tenancy_id, 'amount', c.amount, 'ledger_entry_id', entry_id));
end $$;
revoke all on function review_manual_rent_payment(uuid, boolean) from public, anon;
grant execute on function review_manual_rent_payment(uuid, boolean) to authenticated;
