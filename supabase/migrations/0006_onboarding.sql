-- 0006_onboarding: phone codes and the phone a person typed at sign-up.
-- Email codes are handled by Supabase Auth itself. Phone codes are ours (sent through Celcom).
-- The code is never stored: only a keyed hash of it, made by the server function that sent it.

-- Keep the phone typed at sign-up (an unverified claim, proven later by SMS).
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r app_role := coalesce((new.raw_app_meta_data ->> 'invited_role')::app_role, 'landlord');
  ph text := regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '[\s-]', '', 'g');
begin
  ph := regexp_replace(regexp_replace(ph, '^\+254', '0'), '^254', '0');
  if ph !~ '^(07|01)[0-9]{8}$' then ph := null; end if;
  insert into profiles(id, role, email, full_name, phone, landlord_state, email_verified)
  values (new.id, r, new.email, nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''), ph,
          case when r = 'landlord' then (case when coalesce(new.raw_app_meta_data ->> 'provider', '') = 'google' then 'pending_phone' else 'pending_email' end)::landlord_state end,
          coalesce(new.raw_app_meta_data ->> 'provider' = 'google', false));
  if r = 'landlord' then
    insert into sms_wallets(landlord_id) values (new.id);
    insert into payment_accounts(landlord_id) values (new.id);
  end if;
  return new;
end $$;

-- A person may correct their phone number until it has been verified.
create function set_my_phone(p_phone text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare ph text := regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g');
begin
  ph := regexp_replace(regexp_replace(ph, '^\+254', '0'), '^254', '0');
  if ph !~ '^(07|01)[0-9]{8}$' then raise exception 'Enter a valid Kenyan phone number'; end if;
  update profiles set phone = ph where id = auth.uid() and phone_verified = false;
  if not found then raise exception 'Your phone number is already verified and cannot be changed here'; end if;
end $$;

create table verification_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  target      text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    smallint not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index verification_codes_user_idx on verification_codes(user_id, created_at desc);
alter table verification_codes enable row level security;        -- no policy and no grant: no browser can ever read these

-- Server asks for a new code. Limits: one a minute, three an hour. Older codes stop working.
create function issue_phone_code(p_user uuid, p_code_hash text) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare p profiles%rowtype; exp timestamptz := now() + interval '5 minutes';
begin
  select * into p from profiles where id = p_user;
  if not found then raise exception 'Account not found'; end if;
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

-- The SMS could not be sent: void the code so the person is not left waiting.
create function cancel_phone_code(p_user uuid) returns void language sql security definer set search_path = public, pg_temp as $$
  update verification_codes set consumed_at = now() where user_id = p_user and consumed_at is null
$$;

-- Returns true when the code is right, false when it is wrong. Five wrong tries burn the code.
create function verify_phone_code(p_user uuid, p_code_hash text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare c verification_codes%rowtype;
begin
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

revoke all on function issue_phone_code(uuid, text), cancel_phone_code(uuid), verify_phone_code(uuid, text), set_my_phone(text) from public, anon, authenticated;
grant execute on function issue_phone_code(uuid, text), cancel_phone_code(uuid), verify_phone_code(uuid, text) to service_role;
grant execute on function set_my_phone(text) to authenticated;
