-- 0004_signup: every new login becomes a landlord profile, unless the SERVER marked it as an invite.
-- The invited role is read from app metadata, which only server code can write.
-- A user editing their own sign-up details (user metadata) can never choose a role.

create function handle_new_user() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare r app_role := coalesce((new.raw_app_meta_data ->> 'invited_role')::app_role, 'landlord');
begin
  insert into profiles(id, role, email, full_name, landlord_state, email_verified)
  values (new.id, r, new.email, nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
          case when r = 'landlord' then (case when coalesce(new.raw_app_meta_data ->> 'provider', '') = 'google' then 'pending_phone' else 'pending_email' end)::landlord_state end,
          coalesce(new.raw_app_meta_data ->> 'provider' = 'google', false));
  if r = 'landlord' then
    insert into sms_wallets(landlord_id) values (new.id);
    insert into payment_accounts(landlord_id) values (new.id);
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
