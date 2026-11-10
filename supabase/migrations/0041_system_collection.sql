-- 0041_system_collection: landlords have exactly TWO ways to receive rent.
--   1. 'platform'     System collection. Tenants pay HousePlug Kenya (M-Pesa prompt, Paybill, or Paystack card/M-Pesa). The landlord asks for
--                     a payout and HousePlug Kenya pays their M-Pesa phone, till or paybill. Every shilling is tracked: custody, requests, payouts.
--   2. 'bank_paybill' Manual bank transfer. The tenant pays the landlord's bank directly and pastes the bank's message; the landlord
--                     checks their bank and confirms. HousePlug Kenya never touches that money (unchanged, migration 0031).
-- Landlord-owned Daraja and landlord-owned Paystack connections are retired.

-- ---------- 1. retire landlord-owned routes ----------
update payment_accounts set mode = 'platform' where mode in ('own', 'paystack');
drop function if exists save_paystack_credentials(uuid, bytea, text, connection_status, text);
drop function if exists get_paystack_credentials(uuid);
drop function if exists save_payment_credentials(uuid, text, text, bytea, smallint, connection_status, text);
drop function if exists get_payment_credentials(uuid);
drop function if exists account_by_token(text);
alter table payment_accounts drop constraint payment_accounts_mode_connection_check;
alter table payment_accounts drop constraint payment_accounts_paystack_state_check;
alter table payment_accounts
  drop column paystack_ciphertext, drop column paystack_status, drop column paystack_failure_reason,
  drop column paystack_key_hint, drop column paystack_verified_at;
update payment_accounts
   set shortcode = null, shortcode_kind = null, credentials_ciphertext = null, key_version = null,
       status = 'not_connected', failure_reason = null, last_verified_at = null;
alter table payment_accounts add constraint payment_accounts_mode_check check (mode in ('platform', 'bank_paybill'));

-- ---------- 2. where a landlord is paid: M-Pesa phone, till, or paybill ----------
alter table payout_destinations drop constraint payout_destinations_kind_check;
alter table payout_destinations drop constraint payout_destinations_check;
update payout_destinations set kind = 'paybill' where kind = 'bank_paybill';
alter table payout_destinations
  add constraint payout_destinations_kind_check check (kind in ('mpesa_phone', 'till', 'paybill')),
  add constraint payout_destinations_shape_check check (
       (kind = 'mpesa_phone' and destination ~ '^(07|01)[0-9]{8}$' and account_ref is null)
    or (kind = 'till'        and destination ~ '^[0-9]{5,7}$'      and account_ref is null)
    or (kind = 'paybill'     and destination ~ '^[0-9]{5,7}$'      and coalesce(account_ref ~ '^[A-Za-z0-9 ._-]{1,40}$', false))) not valid;

-- Changing where money goes is the first thing an account thief would do, so a change starts a 24-hour wait before the next payout
-- request, and is written to the audit log. Saving the same details again changes nothing.
create function payout_destination_touch() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then          -- a browser can never choose its own change time
    if tg_op = 'INSERT' or (new.kind, new.destination, new.account_ref) is distinct from (old.kind, old.destination, old.account_ref) then
      new.updated_at := now();
    else
      new.updated_at := old.updated_at;
    end if;
  end if;
  return new;
end $$;
create trigger payout_destination_touch before insert or update on payout_destinations for each row execute function payout_destination_touch();

create function payout_destination_audit() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or (new.kind, new.destination, new.account_ref) is distinct from (old.kind, old.destination, old.account_ref) then
    insert into audit_log(actor, action, entity, entity_id, detail)
      values (coalesce(auth.uid(), new.landlord_id), 'payout_destination_changed', 'payout_destination', new.landlord_id, jsonb_build_object('kind', new.kind));
  end if;
  return null;
end $$;
create trigger payout_destination_audit after insert or update on payout_destinations for each row execute function payout_destination_audit();
update payout_destinations set updated_at = now() - interval '2 days';

-- ---------- 3. whose money is it? ----------
-- 'platform': HousePlug Kenya collected it and owes it to the landlord. 'landlord': it never passed through HousePlug Kenya (manual bank transfer).
-- Everything that already exists is 'landlord', which can never be paid out twice by mistake.
alter table ledger_entries add column custody text not null default 'landlord' check (custody in ('platform', 'landlord'));
alter table held_payments add column custody text not null default 'landlord' check (custody in ('platform', 'landlord')),
  add column admin_note text;

-- Each ledger entry can be paid out once, unless the payout it was in failed (then it is available again).
alter table payout_items drop constraint payout_items_ledger_entry_id_key;
create function payout_items_guard() returns trigger language plpgsql as $$
begin
  if exists (select 1 from payout_items i join payouts p on p.id = i.payout_id
              where i.ledger_entry_id = new.ledger_entry_id and p.status <> 'failed') then
    raise exception 'This payment has already been paid out';
  end if;
  return new;
end $$;
create trigger payout_items_guard before insert on payout_items for each row execute function payout_items_guard();

-- ---------- 4. what can be paid out ----------
create function payout_available(p_landlord uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(l.amount), 0)::int from ledger_entries l
   where l.landlord_id = p_landlord and l.custody = 'platform' and l.kind in ('rent_payment', 'deposit_payment')
     and not exists (select 1 from payout_items i join payouts p on p.id = i.payout_id where i.ledger_entry_id = l.id and p.status <> 'failed')
     and not exists (select 1 from ledger_entries r where r.reverses_id = l.id)
$$;

create or replace function create_payout(p_landlord uuid) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare dest payout_destinations%rowtype; total int; pid uuid;
begin
  select * into dest from payout_destinations where landlord_id = p_landlord;
  if not found then raise exception 'Add where you want to be paid first'; end if;
  total := payout_available(p_landlord);
  if total <= 0 then return null; end if;
  insert into payouts(landlord_id, amount, destination_kind, destination, account_ref)
    values (p_landlord, total, dest.kind, dest.destination, dest.account_ref) returning id into pid;
  insert into payout_items(payout_id, ledger_entry_id)
    select pid, l.id from ledger_entries l
     where l.landlord_id = p_landlord and l.custody = 'platform' and l.kind in ('rent_payment', 'deposit_payment')
       and not exists (select 1 from payout_items i join payouts p on p.id = i.payout_id where i.ledger_entry_id = l.id and p.status <> 'failed' and p.id <> pid)
       and not exists (select 1 from ledger_entries r where r.reverses_id = l.id);
  return pid;
end $$;
drop function if exists create_due_payouts();
revoke all on function create_payout(uuid), payout_available(uuid) from public, anon, authenticated;
grant execute on function create_payout(uuid), payout_available(uuid) to service_role;

-- The landlord asks to be paid. One open request at a time; the admin pays it and records the M-Pesa reference.
create function request_payout() returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare dest payout_destinations%rowtype; avail int; pid uuid;
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  perform 1 from payment_accounts where landlord_id = auth.uid() for update;       -- two taps cannot create two requests
  select * into dest from payout_destinations where landlord_id = auth.uid();
  if not found then raise exception 'Add where you want to be paid first'; end if;
  if dest.updated_at > now() - interval '24 hours' then
    raise exception 'For your safety, payouts open 24 hours after you change where you are paid';
  end if;
  if exists (select 1 from payouts where landlord_id = auth.uid() and status in ('scheduled', 'processing')) then
    raise exception 'You already have a payout waiting to be paid';
  end if;
  avail := payout_available(auth.uid());
  if avail < 100 then raise exception 'The minimum payout is KES 100. You have KES % available', avail; end if;
  pid := create_payout(auth.uid());
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'payout_requested', 'payout', pid, jsonb_build_object('amount', avail));
  return pid;
end $$;

create function my_payout_summary() returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'available', payout_available(auth.uid()),
    'requested', coalesce((select sum(amount) from payouts where landlord_id = auth.uid() and status in ('scheduled', 'processing')), 0)::int,
    'paidOut',   coalesce((select sum(amount) from payouts where landlord_id = auth.uid() and status = 'paid'), 0)::int,
    'minimum', 100,
    'opensAt', (select updated_at + interval '24 hours' from payout_destinations where landlord_id = auth.uid()))
$$;
revoke all on function request_payout(), my_payout_summary() from public, anon;
grant execute on function request_payout(), my_payout_summary() to authenticated;

-- ---------- 5. admin: pay, fail, and see what HousePlug Kenya holds ----------
drop view admin_payouts;
create view admin_payouts as
select p.id, p.landlord_id, l.full_name, p.amount, p.destination_kind, p.destination, p.account_ref, p.status, p.provider_ref, p.created_at, p.paid_at,
       p.failure_reason, d.updated_at as destination_changed_at, l.phone as landlord_phone
  from payouts p join profiles l on l.id = p.landlord_id left join payout_destinations d on d.landlord_id = p.landlord_id
 where is_admin();
grant select on admin_payouts to authenticated;

create function admin_fail_payout(p_payout uuid, p_reason text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 5 then raise exception 'Say why the payout could not be paid'; end if;
  update payouts set status = 'failed', failure_reason = left(trim(p_reason), 200) where id = p_payout and status in ('scheduled', 'processing');
  if not found then raise exception 'Payout not found or already settled'; end if;
  insert into audit_log(actor, action, entity, entity_id, detail) values (auth.uid(), 'payout_failed', 'payout', p_payout, jsonb_build_object('reason', left(trim(p_reason), 200)));
end $$;

create function admin_custody_summary() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'owedToLandlords', coalesce((select sum(l.amount) from ledger_entries l
        where l.custody = 'platform' and l.kind in ('rent_payment', 'deposit_payment')
          and not exists (select 1 from payout_items i join payouts p on p.id = i.payout_id where i.ledger_entry_id = l.id and p.status = 'paid')
          and not exists (select 1 from ledger_entries r where r.reverses_id = l.id)), 0)::int,
    'awaitingPayout', coalesce((select sum(amount) from payouts where status in ('scheduled', 'processing')), 0)::int,
    'paidOut', coalesce((select sum(amount) from payouts where status = 'paid'), 0)::int,
    'heldUnmatched', coalesce((select sum(amount) from held_payments where custody = 'platform' and resolved_at is null), 0)::int);
end $$;

create view admin_held_payments as
select h.id, h.provider_ref, h.bill_ref, h.amount, h.reason, h.created_at, h.admin_note, l.full_name as landlord_name
  from held_payments h left join profiles l on l.id = h.landlord_id
 where is_admin() and h.custody = 'platform' and h.resolved_at is null;
grant select on admin_held_payments to authenticated;

-- A payment HousePlug Kenya holds that cannot be matched (or was paid twice) is refunded to the payer outside the app; the admin records it.
create function admin_close_held_payment(p_held uuid, p_note text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  if char_length(coalesce(trim(p_note), '')) < 5 then raise exception 'Record what was done, for example the refund reference'; end if;
  update held_payments set resolved_at = now(), admin_note = left(trim(p_note), 300) where id = p_held and resolved_at is null and custody = 'platform';
  if not found then raise exception 'Held payment not found'; end if;
  insert into audit_log(actor, action, entity, entity_id, detail) values (auth.uid(), 'held_payment_closed', 'held_payment', p_held, jsonb_build_object('note', left(trim(p_note), 300)));
end $$;
revoke all on function admin_fail_payout(uuid, text), admin_custody_summary(), admin_close_held_payment(uuid, text) from public, anon;
grant execute on function admin_fail_payout(uuid, text), admin_custody_summary(), admin_close_held_payment(uuid, text) to authenticated;

-- ---------- 6. how a tenant is routed ----------
create function platform_collection_ready(p_landlord uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from payment_accounts pa join payout_destinations d on d.landlord_id = pa.landlord_id
                  where pa.landlord_id = p_landlord and pa.mode = 'platform') and landlord_active(p_landlord)
$$;
revoke all on function platform_collection_ready(uuid) from public, anon, authenticated;
grant execute on function platform_collection_ready(uuid) to service_role;

create or replace function tenant_payment_route()
returns payment_mode language sql stable security definer set search_path = public, pg_temp as $$
  select pa.mode
    from tenancies t
    join payment_accounts pa on pa.landlord_id = t.landlord_id
   where t.tenant_user_id = auth.uid()
     and t.status <> 'ended'
     and landlord_active(t.landlord_id)
     and (
       (pa.mode = 'platform' and exists (select 1 from payout_destinations d where d.landlord_id = t.landlord_id))
       or (pa.mode = 'bank_paybill' and exists (
         select 1 from landlord_bank_accounts lba
         join banks b on b.id = lba.bank_id and b.active
         where lba.landlord_id = t.landlord_id and lba.account_number is not null and lba.account_name is not null))
     )
   order by (t.status = 'active') desc
   limit 1
$$;
revoke all on function tenant_payment_route() from public, anon;
grant execute on function tenant_payment_route() to authenticated;

create or replace function set_payment_mode(p_mode payment_mode) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_accounts%rowtype;
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;
  if p_mode not in ('platform', 'bank_paybill') then raise exception 'Choose HousePlug Kenya collection or manual bank transfer for rent'; end if;
  select * into a from payment_accounts where landlord_id = auth.uid() for update;
  if not found then raise exception 'Payment account not found'; end if;
  if p_mode = 'platform' then
    if not exists (select 1 from payout_destinations where landlord_id = auth.uid()) then
      raise exception 'Add where you want to be paid (M-Pesa phone, till or paybill) first';
    end if;
  elsif not exists (
    select 1 from landlord_bank_accounts lba join banks b on b.id = lba.bank_id and b.active
     where lba.landlord_id = auth.uid() and lba.account_number is not null and lba.account_name is not null
  ) then
    raise exception 'Save your bank name, account number and account holder name first';
  end if;
  if p_mode <> 'bank_paybill' and exists (select 1 from manual_rent_payment_claims where landlord_id = auth.uid() and status = 'pending') then
    raise exception 'Review pending manual payment claims before changing payment method';
  end if;
  update payment_accounts set mode = p_mode where landlord_id = auth.uid();
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'payment_mode_changed', 'payment_account', a.id, jsonb_build_object('mode', p_mode));
end $$;
revoke all on function set_payment_mode(payment_mode) from public, anon;
grant execute on function set_payment_mode(payment_mode) to authenticated;

-- ---------- 7. paying: M-Pesa prompt, Paystack, Paybill ----------
create or replace function start_payment_attempt(p_tenancy uuid, p_msisdn text, p_checkout text, p_merchant text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; bal int; aid uuid;
begin
  select * into t from tenancies where id = p_tenancy and status <> 'ended';
  if not found or not platform_collection_ready(t.landlord_id) then raise exception 'Tenancy not found'; end if;
  bal := current_balance(p_tenancy);
  if bal is null or bal <= 0 then raise exception 'Nothing to pay'; end if;
  if (select count(*) from payment_attempts a where a.tenancy_id = p_tenancy and a.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many payment attempts. Try again in an hour';
  end if;
  insert into payment_attempts(tenancy_id, landlord_id, msisdn, expected_amount, checkout_request_id, merchant_request_id)
    values (t.id, t.landlord_id, p_msisdn, bal, p_checkout, p_merchant) returning payment_attempts.id into aid;
  return aid;
end $$;

create or replace function start_paystack_rent_attempt(p_tenancy uuid, p_reference text, p_msisdn text)
returns table (attempt_id uuid, amount integer, tenancy_code text, landlord_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; bal integer; aid uuid;
begin
  if p_reference !~ '^RHPS-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid payment reference'; end if;
  if p_msisdn !~ '^(07|01)[0-9]{8}$' then raise exception 'Confirm your phone number first'; end if;
  select * into t from tenancies where id = p_tenancy and status <> 'ended';
  if not found or not platform_collection_ready(t.landlord_id) then raise exception 'Tenancy not found'; end if;
  bal := current_balance(p_tenancy);
  if bal is null or bal <= 0 then raise exception 'Nothing to pay'; end if;
  if (select count(*) from payment_attempts a where a.tenancy_id = p_tenancy and a.provider = 'paystack' and a.created_at > now() - interval '1 hour') >= 6 then
    raise exception 'Too many payment attempts. Try again in an hour';
  end if;
  insert into payment_attempts(tenancy_id, landlord_id, msisdn, expected_amount, checkout_request_id, provider)
    values (t.id, t.landlord_id, p_msisdn, bal, p_reference, 'paystack') returning id into aid;
  return query select aid, bal, t.tenancy_code, t.landlord_id;
end $$;
revoke all on function start_payment_attempt(uuid, text, text, text), start_paystack_rent_attempt(uuid, text, text) from public, anon, authenticated;
grant execute on function start_payment_attempt(uuid, text, text, text), start_paystack_rent_attempt(uuid, text, text) to service_role;

-- A confirmed payment is credited once, for the exact amount, as money HousePlug Kenya holds for the landlord. A different amount, or rent
-- that was already paid, is held for a person to sort out. A payment that was collected is always credited to the tenant, even if
-- the landlord changed method while it was in flight, because the tenant really paid.
create or replace function confirm_payment(p_checkout text, p_receipt text, p_amount integer, p_msisdn text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare a payment_attempts%rowtype; existing uuid; new_id uuid; t tenancies%rowtype; bal integer;
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
  select * into t from tenancies where id = a.tenancy_id;
  if p_amount <> a.expected_amount then
    update payment_attempts set status = 'failed', result_desc = 'amount_mismatch' where id = a.id;
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, landlord_id, tenancy_id, custody)
      values (p_receipt, t.tenancy_code, p_amount, p_msisdn, 'amount_mismatch', a.landlord_id, a.tenancy_id, 'platform')
      on conflict (provider_ref) do nothing;
    return null;
  end if;
  bal := current_balance(a.tenancy_id);
  if bal is null or bal < p_amount then
    update payment_attempts set status = 'failed', result_desc = 'duplicate_payment' where id = a.id;
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, landlord_id, tenancy_id, custody)
      values (p_receipt, t.tenancy_code, p_amount, p_msisdn, 'duplicate_payment', a.landlord_id, a.tenancy_id, 'platform')
      on conflict (provider_ref) do nothing;
    return null;
  end if;
  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, attempt_id, msisdn, custody)
    values (a.tenancy_id, a.landlord_id, 'rent_payment', 'rent', p_amount,
            case when a.provider = 'paystack' then 'paystack' else 'stk_push' end, p_receipt, a.id, p_msisdn, 'platform')
    returning id into new_id;
  update payment_attempts set status = 'succeeded', result_code = 0 where id = a.id;
  return new_id;
end $$;

-- Paybill: the tenant pays HousePlug Kenya's Paybill from the M-Pesa menu with their tenancy code as the account number.
create or replace function validate_c2b(p_bill_ref text, p_amount integer, p_landlord uuid default null)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; bal int;
begin
  select * into t from tenancies where tenancy_code = upper(trim(p_bill_ref)) and status <> 'ended';
  if not found or not platform_collection_ready(t.landlord_id) then return 'unknown_account'; end if;
  bal := current_balance(t.id);
  if bal is null or bal <= 0 then return 'nothing_due'; end if;
  if p_amount <> bal then return 'amount_mismatch'; end if;
  return 'ok';
end $$;

create or replace function record_c2b_payment(p_bill_ref text, p_amount integer, p_receipt text, p_msisdn text, p_landlord uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; existing uuid; new_id uuid; bal int;
begin
  select id into existing from ledger_entries where provider_ref = p_receipt;
  if found then return existing; end if;
  if exists (select 1 from held_payments where provider_ref = p_receipt) then return null; end if;
  select * into t from tenancies where tenancy_code = upper(trim(p_bill_ref)) and status <> 'ended';
  if not found then
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, custody)
      values (p_receipt, left(p_bill_ref, 40), p_amount, p_msisdn, 'unknown_account', 'platform') on conflict (provider_ref) do nothing;
    return null;
  end if;
  bal := current_balance(t.id);
  if not platform_collection_ready(t.landlord_id) or bal is null or bal <= 0 or p_amount <> bal then
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason, landlord_id, tenancy_id, custody)
      values (p_receipt, t.tenancy_code, p_amount, p_msisdn,
              case when not platform_collection_ready(t.landlord_id) then 'unknown_account' when bal is null or bal <= 0 then 'duplicate_payment' else 'amount_mismatch' end,
              t.landlord_id, t.id, 'platform')
      on conflict (provider_ref) do nothing;
    return null;
  end if;
  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, msisdn, custody)
    values (t.id, t.landlord_id, 'rent_payment', 'rent', p_amount, 'c2b', p_receipt, p_msisdn, 'platform')
    returning id into new_id;
  return new_id;
end $$;

-- A landlord assigns a payment that HousePlug Kenya is holding for them to the right tenancy. It keeps its custody, so it is paid out like the rest.
create or replace function resolve_held_payment(p_held uuid, p_tenancy uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare h held_payments%rowtype; t tenancies%rowtype; new_id uuid;
begin
  select * into h from held_payments where id = p_held and resolved_at is null for update;
  if not found then raise exception 'Held payment not found'; end if;
  if h.reason = 'duplicate_payment' then raise exception 'This was a second payment for rent that was already paid. Customer care will refund it'; end if;
  select * into t from tenancies where id = p_tenancy;
  if not found or t.landlord_id <> auth.uid() then raise exception 'Tenancy not found'; end if;
  if h.landlord_id is distinct from auth.uid() then raise exception 'Held payment not found'; end if;
  insert into ledger_entries(tenancy_id, landlord_id, kind, bucket, amount, method, provider_ref, msisdn, custody)
    values (t.id, t.landlord_id, 'rent_payment', 'rent', h.amount, 'c2b', h.provider_ref || '-R', h.msisdn, h.custody) returning id into new_id;
  update held_payments set resolved_at = now(), ledger_id = new_id, landlord_id = t.landlord_id, tenancy_id = t.id where id = h.id;
  return new_id;
end $$;
revoke all on function resolve_held_payment(uuid, uuid) from public, anon;
grant execute on function resolve_held_payment(uuid, uuid) to authenticated;
revoke all on function confirm_payment(text, text, integer, text), validate_c2b(text, integer, uuid), record_c2b_payment(text, integer, text, text, uuid) from public, anon, authenticated;
grant execute on function confirm_payment(text, text, integer, text), validate_c2b(text, integer, uuid), record_c2b_payment(text, integer, text, text, uuid) to service_role;
