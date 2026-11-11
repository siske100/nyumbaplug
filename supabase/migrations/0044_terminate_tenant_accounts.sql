alter table tenancies drop constraint tenancies_tenant_user_id_fkey;
alter table tenancies
  add constraint tenancies_tenant_user_id_fkey
  foreign key (tenant_user_id) references profiles(id) on delete set null;

alter table complaint_messages alter column author_id drop not null;
alter table complaint_messages drop constraint complaint_messages_author_id_fkey;
alter table complaint_messages
  add constraint complaint_messages_author_id_fkey
  foreign key (author_id) references profiles(id) on delete set null;

alter table marketplace_bookings alter column client_id drop not null;
alter table marketplace_bookings drop constraint marketplace_bookings_client_id_fkey;
alter table marketplace_bookings
  add constraint marketplace_bookings_client_id_fkey
  foreign key (client_id) references profiles(id) on delete set null;

create function terminate_tenant_account(p_tenancy uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := auth.uid();
  t tenancies%rowtype;
  tenant_role app_role;
begin
  if caller is null or not landlord_active(caller) then
    raise exception 'Your landlord account is not active';
  end if;

  select * into t
    from tenancies
   where id = p_tenancy and landlord_id = caller
   for update;
  if not found then raise exception 'Tenant not found'; end if;
  if t.tenant_user_id is null then
    if t.status = 'ended' and exists (
      select 1 from audit_log
       where actor = caller and action = 'tenant_account_termination_requested'
         and entity_id is not null and detail->>'tenancy_id' = t.id::text
    ) then return null; end if;
    raise exception 'This tenant has no HousePlug account to delete';
  end if;

  select role into tenant_role from profiles where id = t.tenant_user_id;
  if tenant_role is distinct from 'tenant'::app_role then
    raise exception 'This account cannot be deleted as a tenant account';
  end if;

  if t.status <> 'ended' then
    update tenancies set status = 'ended' where id = t.id;
  end if;
  if not exists (
    select 1 from audit_log
     where actor = caller and action = 'tenant_account_termination_requested'
       and entity_id = t.tenant_user_id and detail->>'tenancy_id' = t.id::text
  ) then
    insert into audit_log(actor, action, entity, entity_id, detail)
      values (caller, 'tenant_account_termination_requested', 'profile', t.tenant_user_id,
              jsonb_build_object('tenancy_id', t.id, 'house_id', t.house_id, 'unit', t.unit_label));
  end if;
  return t.tenant_user_id;
end
$$;

revoke all on function terminate_tenant_account(uuid) from public, anon;
grant execute on function terminate_tenant_account(uuid) to authenticated;
