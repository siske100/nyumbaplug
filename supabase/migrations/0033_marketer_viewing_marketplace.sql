create table marketplace_marketers (
  marketer_id uuid primary key references profiles(id) on delete cascade,
  status text not null default 'pending_activation' check (status in ('pending_activation','active','suspended')),
  activated_at timestamptz,
  activation_receipt text unique,
  check (
    (status = 'pending_activation' and activated_at is null and activation_receipt is null)
    or (status in ('active','suspended') and activated_at is not null and activation_receipt is not null)
  )
);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'requested_role';
  r app_role;
  ph text := regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '[\s-]', '', 'g');
  google_signup boolean := coalesce(new.raw_app_meta_data ->> 'provider', '') = 'google';
begin
  if new.raw_app_meta_data ->> 'invited_role' = 'caretaker' then
    raise exception 'Caretaker accounts are no longer supported';
  end if;
  if new.raw_app_meta_data ? 'invited_role' then
    r := (new.raw_app_meta_data ->> 'invited_role')::app_role;
  elsif requested_role in ('marketer','client') then
    r := requested_role::app_role;
  else
    r := 'landlord';
  end if;

  ph := regexp_replace(regexp_replace(ph, '^\+254', '0'), '^254', '0');
  if ph !~ '^(07|01)[0-9]{8}$' then ph := null; end if;
  insert into profiles(id, role, email, full_name, phone, landlord_state, email_verified)
  values (new.id, r, new.email, nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''), ph,
          case when r = 'landlord' then
            (case when google_signup then
              case when ph is null then 'pending_phone' else 'pending_kyc' end
             else 'pending_email' end)::landlord_state
          end,
          coalesce(new.raw_app_meta_data ->> 'provider' = 'google', false));

  if r = 'landlord' then
    insert into sms_wallets(landlord_id) values (new.id);
    insert into payment_accounts(landlord_id) values (new.id);
  elsif r = 'marketer' then
    insert into marketplace_marketers(marketer_id) values (new.id);
  end if;
  return new;
end $$;

create function marketplace_marketer_active(p_marketer uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from marketplace_marketers
     where marketer_id = p_marketer and status = 'active'
  )
$$;

create table marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  marketer_id uuid not null references marketplace_marketers(marketer_id) on delete cascade,
  title text not null check (char_length(trim(title)) between 5 and 100),
  description text not null check (char_length(trim(description)) between 20 and 3000),
  county_id smallint not null references counties(id),
  town_id integer not null,
  house_type house_type not null,
  rent_amount integer not null check (rent_amount between 1 and 10000000),
  viewing_fee integer not null check (viewing_fee between 20 and 20000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (town_id, county_id) references towns(id, county_id)
);
create index marketplace_listings_marketer_idx on marketplace_listings(marketer_id, created_at desc);
create trigger marketplace_listings_updated before update on marketplace_listings for each row execute function set_updated_at();

create view marketplace_public_listings as
select l.id, l.title, l.description, c.name as county, t.name as town, l.house_type,
       l.rent_amount, l.viewing_fee, p.full_name as marketer_name
  from marketplace_listings l
  join marketplace_marketers m on m.marketer_id = l.marketer_id and m.status = 'active'
  join counties c on c.id = l.county_id
  join towns t on t.id = l.town_id
  join profiles p on p.id = l.marketer_id and p.role = 'marketer'
 where l.active;

create table marketplace_bookings (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references marketplace_listings(id),
  marketer_id uuid not null references marketplace_marketers(marketer_id),
  client_id uuid not null references profiles(id),
  listing_title text not null,
  county_name text not null,
  town_name text not null,
  marketer_name text not null,
  client_name text not null check (char_length(trim(client_name)) between 2 and 120),
  booking_phone text not null check (booking_phone ~ '^(07|01)[0-9]{8}$'),
  viewing_date date not null,
  time_window text not null check (time_window in ('Morning','Afternoon','Evening')),
  amount integer not null check (amount between 20 and 20000),
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment','paid','viewed','refunded','paid_out')),
  payment_receipt text unique,
  paid_at timestamptz,
  viewed_at timestamptz,
  settlement_ref text unique,
  settlement_amount integer check (settlement_amount is null or settlement_amount >= 0),
  platform_fee integer check (platform_fee is null or platform_fee >= 0),
  settled_at timestamptz,
  settled_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (
    (status in ('awaiting_payment','paid') and settled_at is null and settlement_ref is null)
    or (status = 'viewed' and viewed_at is not null and settled_at is null and settlement_ref is null)
    or (status = 'refunded' and settled_at is not null and settlement_ref is not null)
    or (status = 'paid_out' and viewed_at is not null and settled_at is not null and settlement_ref is not null)
  )
);
create index marketplace_bookings_client_idx on marketplace_bookings(client_id, viewing_date desc);
create index marketplace_bookings_marketer_idx on marketplace_bookings(marketer_id, viewing_date desc);
alter table platform_attempts
  drop constraint platform_attempts_purpose_check;
alter table platform_attempts
  add column reference_id uuid references marketplace_bookings(id),
  add constraint platform_attempts_purpose_check
    check (purpose in ('subscription','sms_recharge','marketer_activation','viewing_fee')),
  add constraint platform_attempts_reference_check
    check ((purpose = 'viewing_fee') = (reference_id is not null));
create unique index marketplace_booking_one_pending_attempt on platform_attempts(reference_id)
  where purpose = 'viewing_fee' and status = 'pending';
create unique index marketplace_activation_one_pending_attempt on platform_attempts(landlord_id)
  where purpose = 'marketer_activation' and status = 'pending';

alter table marketplace_marketers enable row level security;
alter table marketplace_listings enable row level security;
alter table marketplace_bookings enable row level security;

create policy marketplace_marketer_self_read on marketplace_marketers
  for select to authenticated using (marketer_id = auth.uid());
create policy marketplace_listing_owner_read on marketplace_listings
  for select to authenticated using (marketer_id = auth.uid() and marketplace_marketer_active(auth.uid()));
create policy marketplace_booking_participant_read on marketplace_bookings
  for select to authenticated using (
    client_id = auth.uid()
    or (marketer_id = auth.uid() and marketplace_marketer_active(auth.uid()))
  );
create policy marketplace_attempt_owner_read on platform_attempts
  for select to authenticated using (landlord_id = auth.uid());

revoke all on marketplace_marketers, marketplace_listings, marketplace_bookings from public, anon, authenticated;
grant select on marketplace_marketers, marketplace_listings, marketplace_bookings to authenticated;
grant select on marketplace_public_listings to anon, authenticated;

drop function start_platform_attempt(uuid,text,integer,text,text,text);
create function start_platform_attempt(
  p_landlord uuid, p_purpose text, p_amount integer, p_msisdn text,
  p_checkout text, p_merchant text, p_reference uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare p profiles%rowtype; expected int; aid uuid; booking marketplace_bookings%rowtype;
begin
  select * into p from profiles where id = p_landlord;
  if not found then raise exception 'Account not found'; end if;
  if (select count(*) from platform_attempts where landlord_id = p_landlord and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many payment attempts. Try again in an hour';
  end if;

  if p_purpose = 'subscription' then
    if p.role <> 'landlord' then raise exception 'Not allowed'; end if;
    if p.landlord_state = 'suspended' then raise exception 'Your account is suspended. Call customer care on 0799326074'; end if;
    if p.landlord_state not in ('kyc_approved','active','expired') then raise exception 'Complete verification before paying'; end if;
    expected := price_for_units(landlord_units(p_landlord));
    if p_amount <> expected then raise exception 'The subscription is KES %', expected; end if;
  elsif p_purpose = 'sms_recharge' then
    if p.role <> 'landlord' or p.landlord_state <> 'active' then raise exception 'Your account is not active'; end if;
    if p_amount < 50 or p_amount > 10000 then raise exception 'Recharge between KES 50 and KES 10,000'; end if;
  elsif p_purpose = 'marketer_activation' then
    if p.role <> 'marketer' or not p.email_verified or not p.phone_verified then raise exception 'Verify your email and phone first'; end if;
    if not exists (select 1 from marketplace_marketers where marketer_id = p_landlord and status = 'pending_activation') then
      raise exception 'This marketer account is already active or unavailable';
    end if;
    if p_reference is not null or p_amount <> 699 then raise exception 'Marketer activation costs KES 699'; end if;
  elsif p_purpose = 'viewing_fee' then
    if p.role <> 'client' or not p.email_verified or not p.phone_verified then raise exception 'Verify your email and phone first'; end if;
    if p_reference is null then raise exception 'Choose a viewing booking'; end if;
    select * into booking from marketplace_bookings
     where id = p_reference and client_id = p_landlord and status = 'awaiting_payment'
     for update;
    if not found then raise exception 'Viewing booking not found or already paid'; end if;
    if booking.amount <> p_amount then raise exception 'Viewing fee has changed. Create a new booking'; end if;
    if booking.booking_phone <> p.phone then raise exception 'Verify the booking phone number first'; end if;
    if not marketplace_marketer_active(booking.marketer_id) then raise exception 'This listing is no longer available'; end if;
  else
    raise exception 'Unknown purchase';
  end if;

  insert into platform_attempts(landlord_id, purpose, amount, msisdn, checkout_request_id, merchant_request_id, reference_id)
    values (p_landlord, p_purpose, p_amount, p_msisdn, p_checkout, p_merchant, p_reference)
    returning id into aid;
  return aid;
end $$;

create or replace function confirm_platform_payment(p_checkout text, p_receipt text, p_amount integer, p_msisdn text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare a platform_attempts%rowtype; b marketplace_bookings%rowtype;
begin
  if exists (select 1 from subscription_payments where provider_ref = p_receipt)
     or exists (select 1 from sms_recharges where provider_ref = p_receipt)
     or exists (select 1 from held_payments where provider_ref = p_receipt)
     or exists (select 1 from marketplace_marketers where activation_receipt = p_receipt)
     or exists (select 1 from marketplace_bookings where payment_receipt = p_receipt) then
    return true;
  end if;
  select * into a from platform_attempts where checkout_request_id = p_checkout for update;
  if not found then raise exception 'Unknown payment request'; end if;
  if a.status <> 'pending' then return a.status = 'succeeded'; end if;
  if p_amount <> a.amount then
    update platform_attempts set status = 'failed', result_desc = 'amount_mismatch' where id = a.id;
    insert into held_payments(provider_ref, bill_ref, amount, msisdn, reason)
      values (p_receipt, 'platform:' || a.purpose, p_amount, p_msisdn, 'amount_mismatch');
    return false;
  end if;

  if a.purpose = 'subscription' then
    perform activate_subscription(a.landlord_id, p_receipt, p_amount);
  elsif a.purpose = 'sms_recharge' then
    perform sms_recharge(a.landlord_id, p_amount, p_receipt);
  elsif a.purpose = 'marketer_activation' then
    update marketplace_marketers
       set status = 'active', activated_at = now(), activation_receipt = p_receipt
     where marketer_id = a.landlord_id and status = 'pending_activation';
    if not found then raise exception 'Marketer account is already active or unavailable'; end if;
  elsif a.purpose = 'viewing_fee' then
    select * into b from marketplace_bookings where id = a.reference_id for update;
    if not found or b.client_id <> a.landlord_id or b.status <> 'awaiting_payment' then
      raise exception 'Viewing booking is no longer payable';
    end if;
    update marketplace_bookings
       set status = 'paid', payment_receipt = p_receipt, paid_at = now()
     where id = b.id;
  end if;
  update platform_attempts set status = 'succeeded', result_code = 0 where id = a.id;
  return true;
end $$;

create function save_marketplace_listing(
  p_id uuid, p_title text, p_description text, p_county smallint, p_town integer,
  p_type house_type, p_rent integer, p_viewing_fee integer, p_active boolean
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare listing_id uuid;
begin
  if not marketplace_marketer_active(auth.uid()) then raise exception 'Pay the KES 699 activation fee before posting houses'; end if;
  if char_length(trim(coalesce(p_title,''))) not between 5 and 100 then raise exception 'Enter a house title between 5 and 100 characters'; end if;
  if char_length(trim(coalesce(p_description,''))) not between 20 and 3000 then raise exception 'Describe the house in 20 to 3000 characters'; end if;
  if p_rent not between 1 and 10000000 then raise exception 'Enter a valid monthly rent'; end if;
  if p_viewing_fee not between 20 and 20000 then raise exception 'Set a viewing fee between KES 20 and KES 20,000'; end if;
  if not exists (select 1 from towns where id = p_town and county_id = p_county) then raise exception 'Choose a town in the selected county'; end if;

  if p_id is null then
    insert into marketplace_listings(marketer_id, title, description, county_id, town_id, house_type, rent_amount, viewing_fee, active)
      values (auth.uid(), trim(p_title), trim(p_description), p_county, p_town, p_type, p_rent, p_viewing_fee, coalesce(p_active,true))
      returning id into listing_id;
  else
    update marketplace_listings
       set title = trim(p_title), description = trim(p_description), county_id = p_county, town_id = p_town,
           house_type = p_type, rent_amount = p_rent, viewing_fee = p_viewing_fee, active = coalesce(p_active,true)
     where id = p_id and marketer_id = auth.uid()
     returning id into listing_id;
    if not found then raise exception 'House listing not found'; end if;
  end if;
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), case when p_id is null then 'marketplace_listing_created' else 'marketplace_listing_updated' end,
            'marketplace_listing', listing_id, jsonb_build_object('active', coalesce(p_active,true)));
  return listing_id;
end $$;

create function create_marketplace_booking(p_listing uuid, p_date date, p_window text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare l marketplace_listings%rowtype; p profiles%rowtype; new_id uuid;
begin
  select * into p from profiles where id = auth.uid() and role = 'client';
  if not found or not p.email_verified or not p.phone_verified or p.phone is null then
    raise exception 'Confirm your email and phone before booking';
  end if;
  select * into l from marketplace_listings where id = p_listing and active for share;
  if not found or not marketplace_marketer_active(l.marketer_id) then raise exception 'This house is not available'; end if;
  if p_date < current_date or p_date > current_date + 30 then raise exception 'Choose a viewing date within the next 30 days'; end if;
  if p_window not in ('Morning','Afternoon','Evening') then raise exception 'Choose a valid time window'; end if;
  if (select count(*) from marketplace_bookings where client_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Too many bookings today. Try again tomorrow';
  end if;
  insert into marketplace_bookings(
    listing_id, marketer_id, client_id, listing_title, county_name, town_name, marketer_name,
    client_name, booking_phone, viewing_date, time_window, amount
  )
    select l.id, l.marketer_id, auth.uid(), l.title, c.name, t.name,
           (select full_name from profiles where id = l.marketer_id),
           p.full_name, p.phone, p_date, p_window, l.viewing_fee
      from counties c join towns t on t.county_id = c.id
     where c.id = l.county_id and t.id = l.town_id
    returning id into new_id;
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'marketplace_viewing_booked', 'marketplace_booking', new_id,
            jsonb_build_object('listing_id', l.id, 'amount', l.viewing_fee, 'viewing_date', p_date));
  return new_id;
end $$;

create function confirm_marketplace_viewing(p_booking uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare b marketplace_bookings%rowtype;
begin
  select * into b from marketplace_bookings where id = p_booking and client_id = auth.uid() for update;
  if not found then raise exception 'Viewing booking not found'; end if;
  if b.status <> 'paid' then raise exception 'Only a paid viewing can be confirmed'; end if;
  if b.viewing_date > current_date then raise exception 'Confirm after your viewing takes place'; end if;
  if b.viewing_date < date_trunc('month', current_date)::date then raise exception 'The confirmation period has ended; contact support if you attended'; end if;
  update marketplace_bookings set status = 'viewed', viewed_at = now() where id = b.id;
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), 'marketplace_viewing_confirmed', 'marketplace_booking', b.id,
            jsonb_build_object('amount', b.amount, 'marketer_id', b.marketer_id));
end $$;

create view admin_marketplace_settlements as
select b.id, b.viewing_date, b.time_window, b.amount,
       b.status, b.booking_phone, b.payment_receipt, b.paid_at, b.viewed_at,
       b.client_name, b.marketer_name, m.phone as marketer_phone,
       case when b.status = 'viewed' then b.amount - round(b.amount * 0.05)::integer else 0 end as marketer_amount,
       case when b.status = 'viewed' then round(b.amount * 0.05)::integer else 0 end as platform_fee
  from marketplace_bookings b
  join profiles c on c.id = b.client_id
  join profiles m on m.id = b.marketer_id
 where is_admin()
   and b.status in ('paid','viewed')
   and b.viewing_date < date_trunc('month', current_date)::date;

create function admin_settle_marketplace_booking(p_booking uuid, p_action text, p_ref text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare b marketplace_bookings%rowtype; payout integer; fee integer;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  if char_length(coalesce(trim(p_ref),'')) < 8 then raise exception 'Enter the full M-Pesa reference'; end if;
  select * into b from marketplace_bookings where id = p_booking for update;
  if not found or b.viewing_date >= date_trunc('month', current_date)::date then
    raise exception 'This booking is not ready for month-end settlement';
  end if;
  if p_action = 'pay_marketer' and b.status = 'viewed' then
    fee := round(b.amount * 0.05)::integer;
    payout := b.amount - fee;
    update marketplace_bookings
       set status = 'paid_out', platform_fee = fee, settlement_amount = payout,
           settlement_ref = upper(trim(p_ref)), settled_at = now(), settled_by = auth.uid()
     where id = b.id;
  elsif p_action = 'refund_client' and b.status = 'paid' then
    update marketplace_bookings
       set status = 'refunded', platform_fee = 0, settlement_amount = b.amount,
           settlement_ref = upper(trim(p_ref)), settled_at = now(), settled_by = auth.uid()
     where id = b.id;
  else
    raise exception 'Settlement action does not match the client confirmation status';
  end if;
  insert into audit_log(actor, action, entity, entity_id, detail)
    values (auth.uid(), case when p_action = 'pay_marketer' then 'marketplace_marketer_paid' else 'marketplace_client_refunded' end,
            'marketplace_booking', b.id,
            jsonb_build_object('amount', b.amount, 'settlement_amount', case when p_action = 'pay_marketer' then payout else b.amount end,
                               'platform_fee', fee, 'reference', upper(trim(p_ref))));
end $$;

revoke all on function marketplace_marketer_active(uuid), save_marketplace_listing(uuid,text,text,smallint,integer,house_type,integer,integer,boolean),
  create_marketplace_booking(uuid,date,text), confirm_marketplace_viewing(uuid), admin_settle_marketplace_booking(uuid,text,text)
  from public, anon;
grant execute on function marketplace_marketer_active(uuid) to authenticated, service_role;
grant execute on function save_marketplace_listing(uuid,text,text,smallint,integer,house_type,integer,integer,boolean),
  create_marketplace_booking(uuid,date,text), confirm_marketplace_viewing(uuid), admin_settle_marketplace_booking(uuid,text,text)
  to authenticated;
grant select on admin_marketplace_settlements to authenticated;

revoke all on function start_platform_attempt(uuid,text,integer,text,text,text,uuid),
  confirm_platform_payment(text,text,integer,text) from public, anon, authenticated;
grant execute on function start_platform_attempt(uuid,text,integer,text,text,text,uuid),
  confirm_platform_payment(text,text,integer,text) to service_role;
