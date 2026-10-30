-- Remove caretaker access without deleting existing authentication profiles. The enum value remains
-- only so existing profile rows stay readable; new caretaker accounts and all caretaker access are blocked.
drop view if exists my_caretakers;

drop policy if exists caretakers_landlord on caretaker_assignments;
drop policy if exists caretakers_self on caretaker_assignments;
drop policy if exists houses_read on houses;
create policy houses_read on houses for select to authenticated using (
  (landlord_id = auth.uid() and landlord_active(landlord_id))
  or exists (select 1 from tenancies t where t.house_id = houses.id and t.tenant_user_id = auth.uid() and landlord_active(t.landlord_id)));
drop policy if exists tenancies_read on tenancies;
create policy tenancies_read on tenancies for select to authenticated using (
  (landlord_id = auth.uid() and landlord_active(landlord_id))
  or (tenant_user_id = auth.uid() and landlord_active(landlord_id)));
drop policy if exists complaints_read on complaints;
create policy complaints_read on complaints for select to authenticated using (
  (landlord_id = auth.uid() and landlord_active(landlord_id))
  or exists (select 1 from tenancies t where t.id = tenancy_id and t.tenant_user_id = auth.uid() and landlord_active(t.landlord_id)));

drop function if exists caretaker_has_house(uuid);
drop table if exists caretaker_assignments;
alter table complaints drop column if exists assigned_to;
grant update (status, priority) on complaints to authenticated;

delete from login_invites where kind = 'caretaker';
drop function if exists create_invite(uuid, text, uuid, uuid, text, text, text);
drop function if exists invite_lookup(text);
drop function if exists invite_accept(text, uuid);

do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.login_invites'::regclass
      and pg_get_constraintdef(oid) ilike '%house_id%'
  loop
    execute format('alter table public.login_invites drop constraint %I', c.conname);
  end loop;
end $$;
alter table login_invites drop column if exists house_id;
alter table login_invites drop constraint if exists login_invites_kind_check;
alter table login_invites add constraint login_invites_kind_check check (kind = 'tenant');

create function create_invite(p_landlord uuid, p_kind text, p_tenancy uuid, p_hash text)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare t tenancies%rowtype; exp timestamptz := now() + interval '7 days';
begin
  if p_kind <> 'tenant' then raise exception 'Unknown invite type'; end if;
  if not landlord_active(p_landlord) then raise exception 'Your account is not active'; end if;
  select * into t from tenancies where id = p_tenancy and landlord_id = p_landlord and status <> 'ended';
  if not found then raise exception 'Tenant not found'; end if;
  if t.tenant_user_id is not null then raise exception 'This tenant has already joined'; end if;
  if (select count(*) from login_invites where tenancy_id = t.id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Too many invites today';
  end if;
  update login_invites set revoked_at = now() where tenancy_id = t.id and used_at is null and revoked_at is null;
  insert into login_invites(kind, landlord_id, tenancy_id, invitee_name, invitee_phone, token_hash, expires_at)
    values ('tenant', p_landlord, t.id, t.tenant_name, t.tenant_phone, p_hash, exp);
  return exp;
end $$;

create function invite_lookup(p_hash text) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('kind', i.kind, 'landlord_name', l.full_name, 'invitee_name', i.invitee_name, 'invitee_phone', i.invitee_phone,
           'house_title', h.title, 'unit_label', t.unit_label)
  from login_invites i
  join profiles l on l.id = i.landlord_id
  join tenancies t on t.id = i.tenancy_id
  join houses h on h.id = t.house_id
  where i.token_hash = p_hash and i.used_at is null and i.revoked_at is null and i.expires_at > now() and landlord_active(i.landlord_id)
$$;

create function invite_accept(p_hash text, p_user uuid) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare i login_invites%rowtype; p profiles%rowtype;
begin
  select * into i from login_invites where token_hash = p_hash and used_at is null and revoked_at is null and expires_at > now() for update;
  if not found or not landlord_active(i.landlord_id) then raise exception 'This invite link is no longer valid'; end if;
  select * into p from profiles where id = p_user;
  if not found or p.role::text <> 'tenant' or i.kind <> 'tenant' then raise exception 'This account cannot accept that invite'; end if;
  update tenancies set tenant_user_id = p_user where id = i.tenancy_id and tenant_user_id is null;
  if not found then raise exception 'This tenant has already joined'; end if;
  update profiles set phone = i.invitee_phone, phone_verified = false, full_name = coalesce(full_name, i.invitee_name) where id = p_user;
  update login_invites set used_at = now() where id = i.id;
  return i.kind;
end $$;
revoke all on function create_invite(uuid, text, uuid, text), invite_lookup(text), invite_accept(text, uuid) from public, anon, authenticated;
grant execute on function create_invite(uuid, text, uuid, text), invite_lookup(text), invite_accept(text, uuid) to service_role;

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  invited_role text := new.raw_app_meta_data ->> 'invited_role';
  r app_role;
  ph text := regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '[\s-]', '', 'g');
  google_signup boolean := coalesce(new.raw_app_meta_data ->> 'provider', '') = 'google';
begin
  if invited_role = 'caretaker' then raise exception 'Caretaker accounts are no longer supported'; end if;
  r := coalesce(invited_role::app_role, 'landlord');
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
