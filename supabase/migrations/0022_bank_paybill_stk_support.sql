alter table payment_attempts
  add column bank_paybill_shortcode text
    check (bank_paybill_shortcode is null or bank_paybill_shortcode ~ '^[0-9]{5,7}$');

create function tenant_bank_paybill(p_tenancy uuid)
returns table (paybill text, account_number text)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.paybill, lba.account_number
  from tenancies t
  join payment_accounts pa on pa.landlord_id = t.landlord_id and pa.mode = 'bank_paybill'
  join landlord_bank_accounts lba on lba.landlord_id = t.landlord_id and lba.verified
  join banks b on b.id = lba.bank_id and b.active
  where t.id = p_tenancy and t.status = 'active' and landlord_active(t.landlord_id)
    and lba.account_number is not null
$$;

create function bind_bank_paybill_attempt(p_attempt uuid, p_paybill text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update payment_attempts a
     set bank_paybill_shortcode = p_paybill
   where a.id = p_attempt and a.status = 'pending'
     and exists (
       select 1
       from landlord_bank_accounts lba
       join banks b on b.id = lba.bank_id and b.active and b.paybill = p_paybill
       join payment_accounts pa on pa.landlord_id = lba.landlord_id and pa.mode = 'bank_paybill'
       where lba.landlord_id = a.landlord_id and lba.verified and lba.account_number is not null
     );
  if not found then raise exception 'The verified bank payment destination changed. Please try again'; end if;
end $$;

revoke all on function tenant_bank_paybill(uuid), bind_bank_paybill_attempt(uuid, text)
  from public, anon, authenticated;
grant execute on function tenant_bank_paybill(uuid), bind_bank_paybill_attempt(uuid, text)
  to service_role;
