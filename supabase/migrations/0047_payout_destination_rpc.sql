create function save_payout_destination(p_kind text, p_destination text, p_account_ref text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  landlord uuid := auth.uid();
begin
  if landlord is null or not landlord_active(landlord) then
    raise exception 'Your landlord account is not active';
  end if;
  if p_destination is null then
    raise exception 'Enter a payout destination';
  end if;

  if p_kind = 'mpesa_phone' then
    if p_destination !~ '^(07|01)[0-9]{8}$' or p_account_ref is not null then
      raise exception 'Check the Safaricom M-Pesa phone number';
    end if;
  elsif p_kind in ('till', 'paybill') then
    if p_destination !~ '^[0-9]{5,7}$' then
      raise exception 'Enter a 5 to 7 digit Safaricom Till or Paybill number';
    end if;
    if p_kind = 'paybill' and coalesce(p_account_ref, '') !~ '^[A-Za-z0-9 ._-]{1,40}$' then
      raise exception 'Enter the account reference used for this Paybill';
    end if;
    if p_kind = 'till' and p_account_ref is not null then
      raise exception 'A Till does not use a Paybill account reference';
    end if;
  else
    raise exception 'Choose a Safaricom M-Pesa phone, Till, or Paybill';
  end if;

  insert into payout_destinations(landlord_id, kind, destination, account_ref, verified, updated_at)
  values (landlord, p_kind, p_destination, p_account_ref, false, now())
  on conflict (landlord_id) do update
    set kind = excluded.kind,
        destination = excluded.destination,
        account_ref = excluded.account_ref,
        verified = payout_destinations.verified
          and (payout_destinations.kind, payout_destinations.destination, payout_destinations.account_ref)
              is not distinct from (excluded.kind, excluded.destination, excluded.account_ref),
        updated_at = case
          when (payout_destinations.kind, payout_destinations.destination, payout_destinations.account_ref)
               is distinct from (excluded.kind, excluded.destination, excluded.account_ref)
            then now()
          else payout_destinations.updated_at
        end;

end $$;

revoke all on function save_payout_destination(text, text, text) from public, anon;
grant execute on function save_payout_destination(text, text, text) to authenticated;
