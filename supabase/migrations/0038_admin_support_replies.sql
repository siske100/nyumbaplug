alter table support_requests
  add column admin_response text,
  add column admin_responded_at timestamptz;

create function admin_support_requests_with_replies()
returns table (
  id uuid, user_id uuid, full_name text, email text, role text,
  message text, status text, created_at timestamptz,
  admin_response text, admin_responded_at timestamptz
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  return query
    select r.id, r.user_id, coalesce(p.full_name, 'Account'), coalesce(p.email, ''),
           p.role::text, r.message, r.status, r.created_at,
           r.admin_response, r.admin_responded_at
      from support_requests r
      join profiles p on p.id = r.user_id
     order by r.created_at desc
     limit 200;
end $$;

create function admin_reply_support_request(p_request uuid, p_response text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  if char_length(trim(coalesce(p_response, ''))) not between 1 and 5000 then
    raise exception 'A response must be between 1 and 5000 characters';
  end if;
  update support_requests
     set admin_response = trim(p_response),
         admin_responded_at = now()
   where id = p_request;
  if not found then raise exception 'Support request not found'; end if;
end $$;

revoke all on function admin_support_requests_with_replies(), admin_reply_support_request(uuid, text)
  from public, anon;
grant execute on function admin_support_requests_with_replies(), admin_reply_support_request(uuid, text)
  to authenticated;
