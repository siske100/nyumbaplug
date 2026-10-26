-- Public viewing requests collect contact details and preferences without SMS verification.
drop function issue_visitor_code(text, text, text);
drop function cancel_visitor_code(text);
drop function submit_visit_request(uuid, text, text, date, text, text);
drop table visitor_codes;

create table visitor_request_ip_limits (
  id         bigint generated always as identity primary key,
  ip_hash    text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index visitor_request_ip_limits_recent_idx on visitor_request_ip_limits(ip_hash, created_at desc);
alter table visitor_request_ip_limits enable row level security;
revoke all on visitor_request_ip_limits from public, anon, authenticated;
revoke all on sequence visitor_request_ip_limits_id_seq from public, anon, authenticated;

create function create_public_visit_request(p_house uuid, p_name text, p_phone text, p_date date, p_window text, p_ip_hash text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare request_id uuid;
begin
  if coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'Invalid request'; end if;
  if char_length(coalesce(trim(p_name), '')) not between 2 and 120 then raise exception 'Enter your name'; end if;
  if coalesce(p_phone, '') !~ '^(07|01)[0-9]{8}$' then raise exception 'Enter a valid Kenyan phone number'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_ip_hash, 0));
  if (select count(*) from visitor_request_ip_limits where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many viewing requests from your connection. Try again later';
  end if;

  request_id := create_visit_request(p_house, p_name, p_phone, p_date, p_window);
  insert into visitor_request_ip_limits(ip_hash) values (p_ip_hash);
  return request_id;
end $$;

revoke all on function create_public_visit_request(uuid, text, text, date, text, text) from public, anon, authenticated;
grant execute on function create_public_visit_request(uuid, text, text, date, text, text) to service_role;

drop policy visits_landlord_read on visit_requests;
create policy visits_landlord_read on visit_requests for select to authenticated using (
  status in ('new','contacted','scheduled','rescheduled','done','no_show','house_taken')
  and exists (select 1 from houses h where h.id = house_id and h.landlord_id = auth.uid() and landlord_active(auth.uid())));
