-- 0042_notifications: text messages for events that happen inside the database (payout requested, paid or not paid; a tenant's
-- bank-transfer claim submitted, confirmed or rejected). Each event writes one row to an outbox in the same transaction, and a scheduled
-- job sends them, so a message is never lost if sending fails and never sent twice.
--   charge_landlord is null  -> Rental Houses Kenya pays for the text (messages to the landlord about their own money)
--   charge_landlord is set   -> that landlord's SMS wallet pays (messages to their tenants), like every other tenant text
create table notification_outbox (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('payout_requested', 'payout_paid', 'payout_failed', 'claim_submitted', 'claim_received', 'claim_rejected')),
  recipient_phone text not null check (recipient_phone ~ '^(07|01)[0-9]{8}$'),
  body            text not null check (char_length(body) between 1 and 320),
  charge_landlord uuid references profiles(id),
  tenancy_id      uuid references tenancies(id),
  dedupe_key      text not null unique,
  status          text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'paused')),
  attempts        integer not null default 0,
  claimed_at      timestamptz,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index notification_outbox_open on notification_outbox(created_at) where status in ('pending', 'sending');
alter table notification_outbox enable row level security;
revoke all on notification_outbox from public, anon, authenticated;

create function notify_enqueue(p_kind text, p_phone text, p_body text, p_charge uuid, p_tenancy uuid, p_key text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_phone is null or p_phone !~ '^(07|01)[0-9]{8}$' then return; end if;          -- no usable number: nothing to send, and never an error
  insert into notification_outbox(kind, recipient_phone, body, charge_landlord, tenancy_id, dedupe_key)
    values (p_kind, p_phone, left(p_body, 320), p_charge, p_tenancy, p_key) on conflict (dedupe_key) do nothing;
end $$;
revoke all on function notify_enqueue(text, text, text, uuid, uuid, text) from public, anon, authenticated;

create function first_name_of(p_name text) returns text language sql immutable as $$
  select coalesce(nullif(split_part(trim(coalesce(p_name, '')), ' ', 1), ''), 'there')
$$;

-- ---------- payouts ----------
create function payouts_notify() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare l profiles%rowtype; where_to text;
begin
  select * into l from profiles where id = new.landlord_id;
  where_to := case new.destination_kind when 'mpesa_phone' then 'M-Pesa ' || new.destination when 'till' then 'Till ' || new.destination
              else 'Paybill ' || new.destination || ' account ' || coalesce(new.account_ref, '') end;
  if tg_op = 'INSERT' then
    perform notify_enqueue('payout_requested', l.phone,
      format('Hello %s, we received your payout request of KES %s. You will get a message when it is paid.', first_name_of(l.full_name), new.amount),
      null, null, 'payout_requested:' || new.id);
  elsif new.status = 'paid' and old.status <> 'paid' then
    perform notify_enqueue('payout_paid', l.phone,
      format('Hello %s, your payout of KES %s has been sent to %s. M-Pesa ref %s.', first_name_of(l.full_name), new.amount, where_to, coalesce(new.provider_ref, '')),
      null, null, 'payout_paid:' || new.id);
  elsif new.status = 'failed' and old.status <> 'failed' then
    perform notify_enqueue('payout_failed', l.phone,
      format('Hello %s, your payout of KES %s could not be paid: %s. The money is back in your balance. Please check your payout details in the app.',
             first_name_of(l.full_name), new.amount, left(coalesce(new.failure_reason, 'please check your details'), 80)),
      null, null, 'payout_failed:' || new.id);
  end if;
  return null;
end $$;
create trigger payouts_notify_insert after insert on payouts for each row execute function payouts_notify();
create trigger payouts_notify_update after update of status on payouts for each row execute function payouts_notify();

-- ---------- manual bank-transfer claims ----------
create function claims_notify() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare l profiles%rowtype; t tenancies%rowtype;
begin
  select * into l from profiles where id = new.landlord_id;
  select * into t from tenancies where id = new.tenancy_id;
  if tg_op = 'INSERT' then
    perform notify_enqueue('claim_submitted', l.phone,
      format('Hello %s, %s says they paid KES %s to your bank account. Open Payments in the app, check your bank and confirm.', first_name_of(l.full_name), first_name_of(t.tenant_name), new.amount),
      null, null, 'claim_submitted:' || new.id);
  elsif new.status = 'received' and old.status = 'pending' then
    perform notify_enqueue('claim_received', t.tenant_phone,
      format('Hello %s, your landlord confirmed your payment of KES %s. Thank you.', first_name_of(t.tenant_name), new.amount),
      new.landlord_id, new.tenancy_id, 'claim_received:' || new.id);
  elsif new.status = 'rejected' and old.status = 'pending' then
    perform notify_enqueue('claim_rejected', t.tenant_phone,
      format('Hello %s, your landlord could not confirm your payment of KES %s. Please contact your landlord.', first_name_of(t.tenant_name), new.amount),
      new.landlord_id, new.tenancy_id, 'claim_rejected:' || new.id);
  end if;
  return null;
end $$;
create trigger claims_notify_insert after insert on manual_rent_payment_claims for each row execute function claims_notify();
create trigger claims_notify_update after update of status on manual_rent_payment_claims for each row execute function claims_notify();

-- ---------- the scheduled sender ----------
-- Takes a batch for itself (two senders never take the same row). A batch that was taken but never finished is taken again after 5 minutes.
create function outbox_claim(p_limit integer default 50)
returns table (id uuid, kind text, recipient_phone text, body text, charge_landlord uuid, tenancy_id uuid)
language sql security definer set search_path = public, pg_temp as $$
  update notification_outbox o set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
   where o.id in (
     select x.id from notification_outbox x
      where (x.status = 'pending' or (x.status = 'sending' and x.claimed_at < now() - interval '5 minutes')) and x.attempts < 3
      order by x.created_at limit least(greatest(p_limit, 1), 200) for update skip locked)
  returning o.id, o.kind, o.recipient_phone, o.body, o.charge_landlord, o.tenancy_id
$$;
-- 'failed' goes back to the queue until it has had 3 tries; 'paused' (landlord's SMS wallet is empty) and 'sent' are final.
create function outbox_mark(p_id uuid, p_status text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('sent', 'failed', 'paused') then raise exception 'Invalid status'; end if;
  update notification_outbox
     set status = case when p_status = 'failed' and attempts < 3 then 'pending' else p_status end,
         sent_at = case when p_status = 'sent' then now() else sent_at end
   where id = p_id and status = 'sending';
end $$;
revoke all on function outbox_claim(integer), outbox_mark(uuid, text) from public, anon, authenticated;
grant execute on function outbox_claim(integer), outbox_mark(uuid, text) to service_role;
