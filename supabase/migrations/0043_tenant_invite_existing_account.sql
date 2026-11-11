-- Link invited tenants to existing accounts, converting only unused landlord accounts.
create or replace function invite_accept(p_hash text, p_user uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  i login_invites%rowtype;
  p profiles%rowtype;
begin
  select * into i
    from login_invites
   where token_hash = p_hash and used_at is null and revoked_at is null and expires_at > now()
   for update;
  if not found or not landlord_active(i.landlord_id) then
    raise exception 'This invite link is no longer valid';
  end if;

  select * into p from profiles where id = p_user for update;
  if not found then raise exception 'This account cannot accept that invite'; end if;

  if p.role = 'landlord' then
    if p.landlord_state not in ('pending_email','pending_phone','pending_kyc')
       or exists (select 1 from houses where landlord_id = p_user)
       or exists (select 1 from kyc_submissions where landlord_id = p_user)
       or exists (select 1 from subscriptions where landlord_id = p_user)
       or exists (select 1 from subscription_payments where landlord_id = p_user)
       or exists (select 1 from payouts where landlord_id = p_user)
       or exists (select 1 from payout_destinations where landlord_id = p_user)
       or exists (select 1 from payment_attempts where landlord_id = p_user)
       or exists (select 1 from ledger_entries where landlord_id = p_user)
       or exists (select 1 from sms_recharges where landlord_id = p_user)
       or exists (select 1 from sms_messages where landlord_id = p_user)
       or exists (select 1 from payment_accounts
                   where landlord_id = p_user
                     and (mode <> 'platform' or status <> 'not_connected' or shortcode is not null or credentials_ciphertext is not null))
       or exists (select 1 from sms_wallets where landlord_id = p_user and balance_kes <> 0) then
      raise exception 'This landlord account has landlord data and cannot be converted. Use a separate tenant account or contact support';
    end if;
    update profiles set role = 'tenant', landlord_state = null where id = p_user;
  elsif p.role <> 'tenant' then
    raise exception 'This account cannot accept that invite';
  end if;

  update tenancies set tenant_user_id = p_user
   where id = i.tenancy_id and tenant_user_id is null;
  if not found then raise exception 'This tenant has already joined'; end if;

  update profiles
     set phone = i.invitee_phone, phone_verified = true,
         full_name = coalesce(full_name, i.invitee_name)
   where id = p_user;
  update login_invites set used_at = now() where id = i.id;
  return i.kind;
end
$$;

revoke all on function invite_accept(text, uuid) from public, anon, authenticated;
grant execute on function invite_accept(text, uuid) to service_role;
