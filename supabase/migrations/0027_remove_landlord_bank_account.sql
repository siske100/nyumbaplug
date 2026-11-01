create function remove_landlord_bank_account()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not landlord_active(auth.uid()) then raise exception 'Your account is not active'; end if;

  update landlord_bank_accounts
     set account_number = null, verified = false, test_payment_receipt = null, verified_at = null
   where landlord_id = auth.uid();
  if not found then raise exception 'No saved bank account to remove'; end if;

  update payment_accounts set mode = 'platform'
   where landlord_id = auth.uid() and mode = 'bank_paybill';
end $$;

revoke all on function remove_landlord_bank_account() from public, anon;
grant execute on function remove_landlord_bank_account() to authenticated;
