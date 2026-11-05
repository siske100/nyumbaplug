create table support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  message text not null check (char_length(trim(message)) between 10 and 5000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);
create index support_requests_created_idx on support_requests(created_at desc);

alter table support_requests enable row level security;
create policy support_requests_read on support_requests
  for select to authenticated using (user_id = auth.uid() or is_admin());
grant select on support_requests to authenticated;

create function submit_support_request(p_message text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare requester uuid := auth.uid(); request_id uuid;
begin
  if requester is null then raise exception 'Sign in to send a support request'; end if;
  if char_length(trim(coalesce(p_message, ''))) not between 10 and 5000 then
    raise exception 'Describe your issue in 10 to 5000 characters';
  end if;
  if (select count(*) from support_requests
       where user_id = requester and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You have reached the daily support request limit';
  end if;
  insert into support_requests(user_id, message)
    values (requester, trim(p_message))
    returning id into request_id;
  return request_id;
end $$;

create function admin_support_requests()
returns table (
  id uuid, user_id uuid, full_name text, email text, role text,
  message text, status text, created_at timestamptz
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  return query
    select r.id, r.user_id, coalesce(p.full_name, 'Account'), coalesce(p.email, ''),
           p.role::text, r.message, r.status, r.created_at
      from support_requests r
      join profiles p on p.id = r.user_id
     order by r.created_at desc
     limit 200;
end $$;

create function admin_update_support_request(p_request uuid, p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  if p_status is null or p_status not in ('open', 'resolved') then raise exception 'Invalid support request status'; end if;
  update support_requests set status = p_status where id = p_request;
  if not found then raise exception 'Support request not found'; end if;
end $$;

revoke all on function submit_support_request(text), admin_support_requests(), admin_update_support_request(uuid, text)
  from public, anon;
grant execute on function submit_support_request(text), admin_support_requests(), admin_update_support_request(uuid, text)
  to authenticated;
