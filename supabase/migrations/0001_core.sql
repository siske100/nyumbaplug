-- 0001_core: people, locations, listings, viewings, KYC, tenancies.
-- Row-level security is switched on in 0003. Nothing here is readable until a policy says so.

create type app_role         as enum ('landlord','tenant','caretaker','admin');
create type landlord_state   as enum ('pending_email','pending_phone','pending_kyc','kyc_submitted','kyc_approved','active','expired','suspended');
create type house_type       as enum ('Single Room','Bedsitter','1 Bedroom','2 Bedroom','3 Bedroom');
create type visit_status     as enum ('new','contacted','scheduled','rescheduled','done','no_show','house_taken','cancelled');
create type kyc_status       as enum ('pending','approved','rejected');
create type tenancy_status   as enum ('active','notice','ended');
create type complaint_status as enum ('open','in_progress','resolved');
create type complaint_priority as enum ('low','medium','high');

create function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- Append-only audit trail. Written only by server-side triggers and functions.
create table audit_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor     uuid,
  action    text not null,
  entity    text not null,
  entity_id uuid,
  detail    jsonb not null default '{}'
);

-- Roles and account state are set by the server only (see 0003 column grants).
create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  role           app_role not null,
  full_name      text,
  email          text,
  phone          text check (phone ~ '^(07|01)[0-9]{8}$'),
  phone_verified boolean not null default false,
  email_verified boolean not null default false,
  landlord_state landlord_state,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint landlord_has_state check ((role = 'landlord') = (landlord_state is not null))
);
create trigger profiles_updated before update on profiles for each row execute function set_updated_at();

create table counties (
  id   smallint primary key,
  name text not null unique
);
create table towns (
  id        serial primary key,
  county_id smallint not null references counties(id),
  name      text not null,
  unique (county_id, name),
  unique (id, county_id)
);

create table houses (
  id             uuid primary key default gen_random_uuid(),
  landlord_id    uuid not null references profiles(id),
  title          text not null check (char_length(title) between 3 and 80),
  county_id      smallint not null,
  town_id        integer  not null,
  house_type     house_type not null,
  rent_amount    integer not null check (rent_amount > 0),
  deposit_amount integer not null check (deposit_amount >= 0),
  total_units    integer not null check (total_units between 1 and 500),
  vacant_units   integer not null,
  amenities      text[] not null default '{}',
  rules          text,
  electricity_note text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint vacant_in_range check (vacant_units between 0 and total_units),
  foreign key (town_id, county_id) references towns(id, county_id),
  unique (id, landlord_id)
);
create index houses_landlord_idx on houses(landlord_id);
create trigger houses_updated before update on houses for each row execute function set_updated_at();

-- Seven photos at most: positions 0 to 6, one photo per position. The database enforces it, not just the form.
create table house_photos (
  id           uuid primary key default gen_random_uuid(),
  house_id     uuid not null references houses(id) on delete cascade,
  position     smallint not null check (position between 0 and 6),
  storage_path text not null,
  unique (house_id, position)
);

create table caretaker_assignments (
  caretaker_id uuid not null references profiles(id) on delete cascade,
  landlord_id  uuid not null,
  house_id     uuid not null,
  primary key (caretaker_id, house_id),
  foreign key (house_id, landlord_id) references houses(id, landlord_id) on delete cascade
);

-- Visitors are not users. They leave a verified phone number and a date within the week.
create table visit_requests (
  id               uuid primary key default gen_random_uuid(),
  house_id         uuid not null references houses(id),
  visitor_name     text not null check (char_length(visitor_name) between 2 and 120),
  visitor_phone    text not null check (visitor_phone ~ '^(07|01)[0-9]{8}$'),
  preferred_date   date not null,
  time_window      text not null check (time_window in ('Morning','Afternoon','Evening')),
  status           visit_status not null default 'new',
  scheduled_date   date,
  scheduled_window text check (scheduled_window in ('Morning','Afternoon','Evening')),
  reschedule_count smallint not null default 0 check (reschedule_count between 0 and 2),
  admin_notes      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index visit_requests_house_idx on visit_requests(house_id, status);
create trigger visit_requests_updated before update on visit_requests for each row execute function set_updated_at();

create table kyc_submissions (
  id            uuid primary key default gen_random_uuid(),
  landlord_id   uuid not null references profiles(id),
  national_id   text not null check (national_id ~ '^[0-9]{7,8}$'),
  kra_pin       text not null check (kra_pin ~ '^[AP][0-9]{9}[A-Z]$'),
  id_front_path text not null,
  id_back_path  text not null,
  kra_path      text not null,
  status        kyc_status not null default 'pending',
  reject_reason text,
  reviewed_by   uuid references profiles(id),
  reviewed_at   timestamptz,
  attempt       smallint not null check (attempt between 1 and 3),
  created_at    timestamptz not null default now(),
  -- files must sit in the landlord's own folder of private storage
  check (id_front_path like landlord_id::text || '/%' and id_back_path like landlord_id::text || '/%' and kra_path like landlord_id::text || '/%'),
  check (status <> 'rejected' or reject_reason is not null),
  unique (landlord_id, attempt)
);

create table tenancies (
  id                     uuid primary key default gen_random_uuid(),
  landlord_id            uuid not null,
  house_id               uuid not null,
  tenant_user_id         uuid references profiles(id),
  unit_label             text not null check (char_length(unit_label) between 1 and 20),
  tenant_name            text not null check (char_length(tenant_name) between 2 and 120),
  tenant_phone           text not null check (tenant_phone ~ '^(07|01)[0-9]{8}$'),
  emergency_name         text not null check (char_length(emergency_name) between 2 and 120),
  emergency_phone        text not null check (emergency_phone ~ '^(07|01)[0-9]{8}$'),
  emergency_relationship text not null check (char_length(emergency_relationship) between 2 and 40),
  rent_amount            integer not null check (rent_amount > 0),
  deposit_amount         integer not null check (deposit_amount >= 0),
  due_day                smallint not null check (due_day between 1 and 28),
  status                 tenancy_status not null default 'active',
  tenancy_code           text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  agreement_printed_on   date,
  agreement_signed_on    date,
  agreement_file_path    text,
  electricity_enabled    boolean not null default false,
  kplc_paybill           text check (kplc_paybill ~ '^[0-9]{5,7}$'),
  meter_number           text check (meter_number ~ '^[0-9]{8,13}$'),
  started_on             date not null default current_date,
  ended_on               date,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  foreign key (house_id, landlord_id) references houses(id, landlord_id),
  check (tenant_phone <> emergency_phone),
  check (not electricity_enabled or (kplc_paybill is not null and meter_number is not null))
);
create unique index tenancies_one_active_unit on tenancies(house_id, unit_label) where status <> 'ended';
create index tenancies_landlord_idx on tenancies(landlord_id);
create index tenancies_tenant_idx on tenancies(tenant_user_id);
create trigger tenancies_updated before update on tenancies for each row execute function set_updated_at();

-- Keeping vacant units truthful: moving a tenant in or out changes the count automatically.
create function tenancy_units_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'ended' then
      update houses set vacant_units = vacant_units - 1 where id = new.house_id and vacant_units > 0;
      if not found then raise exception 'No vacant units left in this listing'; end if;
      insert into audit_log(actor, action, entity, entity_id, detail)
        values (auth.uid(), 'tenant_moved_in', 'house', new.house_id, jsonb_build_object('unit', new.unit_label));
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status = 'ended' and new.status <> 'ended' then raise exception 'An ended tenancy cannot be reopened'; end if;
    if old.status <> 'ended' and new.status = 'ended' then
      update houses set vacant_units = least(total_units, vacant_units + 1) where id = new.house_id;
      new.ended_on := coalesce(new.ended_on, current_date);
      insert into audit_log(actor, action, entity, entity_id, detail)
        values (auth.uid(), 'tenant_moved_out', 'house', new.house_id, jsonb_build_object('unit', new.unit_label));
    end if;
  end if;
  return new;
end $$;
create trigger tenancies_units_ins before insert on tenancies for each row execute function tenancy_units_guard();
create trigger tenancies_units_upd before update on tenancies for each row execute function tenancy_units_guard();

create function houses_vacant_audit() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.vacant_units is distinct from old.vacant_units then
    insert into audit_log(actor, action, entity, entity_id, detail)
      values (auth.uid(), 'vacant_units_changed', 'house', new.id, jsonb_build_object('from', old.vacant_units, 'to', new.vacant_units));
  end if;
  return new;
end $$;
create trigger houses_vacant_audit after update on houses for each row execute function houses_vacant_audit();

create table complaints (
  id          uuid primary key default gen_random_uuid(),
  tenancy_id  uuid not null references tenancies(id),
  landlord_id uuid not null references profiles(id),
  category    text not null check (category in ('Water','Electricity','Plumbing','Security','Other')),
  title       text not null check (char_length(title) between 3 and 120),
  status      complaint_status not null default 'open',
  priority    complaint_priority not null default 'medium',
  assigned_to uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger complaints_updated before update on complaints for each row execute function set_updated_at();

create table complaint_messages (
  id           bigint generated always as identity primary key,
  complaint_id uuid not null references complaints(id) on delete cascade,
  author_id    uuid not null references profiles(id),
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now()
);

create table notices (
  id          uuid primary key default gen_random_uuid(),
  landlord_id uuid not null references profiles(id),
  house_id    uuid references houses(id),
  title       text not null check (char_length(title) between 3 and 120),
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
