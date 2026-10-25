-- Landlords verify their email and provide a phone for M-Pesa; tenants and caretakers still verify phones by SMS.

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r app_role := coalesce((new.raw_app_meta_data ->> 'invited_role')::app_role, 'landlord');
  ph text := regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '[\s-]', '', 'g');
  google_signup boolean := coalesce(new.raw_app_meta_data ->> 'provider', '') = 'google';
begin
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
  end if;
  return new;
end $$;

create or replace function mark_contact_verified(p_user uuid, p_kind text, p_phone text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_kind = 'email' then
    update profiles
       set email_verified = true,
           landlord_state = case
             when landlord_state = 'pending_email' then
               case when phone is not null then 'pending_kyc'::landlord_state else 'pending_phone'::landlord_state end
             else landlord_state
           end
     where id = p_user;
  elsif p_kind = 'phone' then
    update profiles set phone_verified = true, phone = coalesce(p_phone, phone),
           landlord_state = case when landlord_state = 'pending_phone' then 'pending_kyc' else landlord_state end where id = p_user;
  else
    raise exception 'Unknown contact kind';
  end if;
end $$;

create or replace function set_my_phone(p_phone text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare ph text := regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g');
begin
  ph := regexp_replace(regexp_replace(ph, '^\+254', '0'), '^254', '0');
  if ph !~ '^(07|01)[0-9]{8}$' then raise exception 'Enter a valid Kenyan phone number'; end if;
  update profiles
     set phone = ph,
         landlord_state = case
           when role = 'landlord' and email_verified and landlord_state = 'pending_phone' then 'pending_kyc'
           else landlord_state
         end
   where id = auth.uid() and phone_verified = false;
  if not found then raise exception 'Your phone number is already verified and cannot be changed here'; end if;
end $$;

-- Finish the new path for landlords who had already confirmed email and were waiting on a phone code.
update profiles
   set landlord_state = case when phone is not null then 'pending_kyc'::landlord_state else 'pending_phone'::landlord_state end
 where role = 'landlord' and landlord_state = 'pending_phone' and email_verified;

create or replace function issue_phone_code(p_user uuid, p_code_hash text) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare p profiles%rowtype; exp timestamptz := now() + interval '5 minutes';
begin
  select * into p from profiles where id = p_user;
  if not found then raise exception 'Account not found'; end if;
  if p.role = 'landlord' then raise exception 'Landlord phone numbers are not verified with a code'; end if;
  if p.phone is null then raise exception 'Add your phone number first'; end if;
  if p.phone_verified then raise exception 'Your phone is already verified'; end if;
  if exists (select 1 from verification_codes where user_id = p_user and created_at > now() - interval '60 seconds') then
    raise exception 'Wait a minute before requesting another code';
  end if;
  if (select count(*) from verification_codes where user_id = p_user and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Too many codes requested. Try again in an hour';
  end if;
  update verification_codes set consumed_at = now() where user_id = p_user and consumed_at is null;
  insert into verification_codes(user_id, target, code_hash, expires_at) values (p_user, p.phone, p_code_hash, exp);
  return exp;
end $$;

create or replace function verify_phone_code(p_user uuid, p_code_hash text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare c verification_codes%rowtype; account_role app_role;
begin
  select role into account_role from profiles where id = p_user;
  if account_role = 'landlord' then raise exception 'Landlord phone numbers are not verified with a code'; end if;
  select * into c from verification_codes
   where user_id = p_user and consumed_at is null and expires_at > now() order by created_at desc limit 1 for update;
  if not found then raise exception 'No active code. Request a new one'; end if;
  if c.code_hash <> p_code_hash then
    update verification_codes set attempts = attempts + 1, consumed_at = case when attempts + 1 >= 5 then now() end where id = c.id;
    return false;
  end if;
  update verification_codes set consumed_at = now() where id = c.id;
  perform mark_contact_verified(p_user, 'phone', c.target);
  return true;
end $$;

create or replace function claim_subscription_reminder(p_admin uuid, p_landlord uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p profiles%rowtype; s subscriptions%rowtype; rid uuid; days int;
begin
  select * into p from profiles where id = p_landlord and role = 'landlord';
  if not found then raise exception 'Landlord not found'; end if;
  if p.landlord_state not in ('active','expired') then raise exception 'Reminders are only for active or expired accounts'; end if;
  if p.phone is null or not p.email_verified then raise exception 'This landlord has no verified email or phone number'; end if;
  if exists (select 1 from subscription_reminders where landlord_id = p_landlord and status in ('sending','sent') and created_at > now() - interval '24 hours') then
    raise exception 'A reminder was already sent in the last 24 hours';
  end if;
  select * into s from subscriptions where landlord_id = p_landlord;
  days := case when found then s.period_end - current_date else 0 end;
  insert into subscription_reminders(landlord_id, sent_by) values (p_landlord, p_admin) returning id into rid;
  return jsonb_build_object('reminder_id', rid, 'name', p.full_name, 'phone', p.phone, 'price', price_for_units(landlord_units(p_landlord)), 'days_left', days, 'state', p.landlord_state);
end $$;
