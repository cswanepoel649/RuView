-- =============================================================================
-- 0002 tenancy: clients, members, contacts, properties, floors, rooms, zones
-- =============================================================================

create table public.clients (
  id             uuid primary key default gen_random_uuid(),
  display_name   text not null check (length(trim(display_name)) between 1 and 200),
  legal_name     text,
  kind           text not null default 'individual' check (kind in ('individual', 'business')),
  primary_email  text check (primary_email is null or primary_email = lower(primary_email)),
  primary_phone  text,
  billing_address jsonb not null default '{}'::jsonb,
  account_ref    text unique,
  notes          text,
  status         public.client_status not null default 'active',
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index clients_status_idx on public.clients(status);
create index clients_name_search_idx on public.clients using gin (to_tsvector('simple', display_name || ' ' || coalesce(legal_name, '') || ' ' || coalesce(primary_email, '')));
create trigger clients_touch before update on public.clients
  for each row execute function private.touch_updated_at();

create table public.client_members (
  client_id  uuid not null references public.clients(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       public.member_role not null default 'member',
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);
create index client_members_user_idx on public.client_members(user_id);

create table public.client_contacts (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  name       text not null,
  relationship text,
  email      text check (email is null or email = lower(email)),
  phone      text,
  kind       text not null default 'primary' check (kind in ('primary', 'emergency', 'billing', 'technical', 'other')),
  notes      text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index client_contacts_client_idx on public.client_contacts(client_id);
create trigger client_contacts_touch before update on public.client_contacts
  for each row execute function private.touch_updated_at();

-- Membership helpers (need client_members) ------------------------------------
create or replace function private.member_role(p_client uuid)
returns public.member_role language sql stable security definer set search_path = '' as $$
  select m.role from public.client_members m
  where m.client_id = p_client and m.user_id = auth.uid();
$$;

create or replace function private.is_member(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.client_members m
                 where m.client_id = p_client and m.user_id = auth.uid());
$$;

-- owner or member (not viewer)
create or replace function private.can_operate(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.client_members m
                 where m.client_id = p_client and m.user_id = auth.uid()
                   and m.role in ('owner', 'member'));
$$;

create or replace function private.is_owner(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.client_members m
                 where m.client_id = p_client and m.user_id = auth.uid()
                   and m.role = 'owner');
$$;

-- Read access to a tenant row: staff or any member of the client.
create or replace function private.can_read(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_staff() or private.is_member(p_client);
$$;

-- ---------------------------------------------------------------------------
-- Properties
-- ---------------------------------------------------------------------------
create table public.properties (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete restrict,
  name           text not null check (length(trim(name)) between 1 and 200),
  address_line1  text,
  address_line2  text,
  city           text,
  region         text,
  postal_code    text,
  country        text,
  timezone       text not null default 'UTC',
  latitude       double precision check (latitude between -90 and 90),
  longitude      double precision check (longitude between -180 and 180),
  status         public.property_status not null default 'planned',
  security_mode  public.security_mode not null default 'disarmed',
  security_mode_changed_at timestamptz not null default now(),
  security_mode_changed_by uuid references public.profiles(id) on delete set null,
  exit_delay_s   int not null default 60 check (exit_delay_s between 0 and 600),
  features       jsonb not null default '{}'::jsonb,
  access_notes   text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index properties_client_idx on public.properties(client_id);
create index properties_status_idx on public.properties(status);
create trigger properties_touch before update on public.properties
  for each row execute function private.touch_updated_at();

create or replace function private.properties_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.client_id is distinct from old.client_id then
    raise exception 'properties.client_id is immutable' using errcode = '42501';
  end if;
  begin
    perform now() at time zone new.timezone;
  exception when others then
    raise exception 'invalid timezone: %', new.timezone using errcode = '22023';
  end;
  return new;
end $$;
create trigger properties_guard before update on public.properties
  for each row execute function private.properties_guard();

create or replace function private.properties_validate_tz()
returns trigger language plpgsql set search_path = '' as $$
begin
  begin
    perform now() at time zone new.timezone;
  exception when others then
    raise exception 'invalid timezone: %', new.timezone using errcode = '22023';
  end;
  return new;
end $$;
create trigger properties_validate_tz before insert on public.properties
  for each row execute function private.properties_validate_tz();

-- Derive client_id for child rows from their property (never trust callers).
create or replace function private.set_client_from_property()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_client uuid;
begin
  if new.property_id is null then
    return new;
  end if;
  select p.client_id into v_client from public.properties p where p.id = new.property_id;
  if v_client is null then
    raise exception 'property % does not exist', new.property_id using errcode = '23503';
  end if;
  new.client_id := v_client;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Floors & rooms
-- ---------------------------------------------------------------------------
create table public.floors (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  client_id    uuid not null references public.clients(id) on delete cascade,
  name         text not null,
  level        int not null default 0,
  plan_path    text,              -- storage: floor-plans/{client_id}/{property_id}/{floor_id}.{ext}
  plan_width   int,               -- intrinsic pixel size of the uploaded plan
  plan_height  int,
  width_m      numeric(7,2),
  depth_m      numeric(7,2),
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (property_id, name)
);
create index floors_property_idx on public.floors(property_id);
create index floors_client_idx on public.floors(client_id);
create trigger floors_client before insert or update of property_id on public.floors
  for each row execute function private.set_client_from_property();
create trigger floors_touch before update on public.floors
  for each row execute function private.touch_updated_at();

create table public.rooms (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  client_id    uuid not null references public.clients(id) on delete cascade,
  floor_id     uuid references public.floors(id) on delete set null,
  name         text not null check (length(trim(name)) between 1 and 120),
  room_type    text not null default 'other' check (room_type in
               ('living', 'bedroom', 'kitchen', 'bathroom', 'hallway', 'entrance', 'office',
                'garage', 'dining', 'laundry', 'storage', 'outdoor', 'other')),
  -- Polygon in normalised floor-plan coordinates: [[x,y],...] with 0<=x,y<=1
  shape        jsonb,
  area_m2      numeric(7,2),
  monitoring_enabled boolean not null default true,
  notes        text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (property_id, name),
  constraint rooms_shape_is_array check (shape is null or jsonb_typeof(shape) = 'array')
);
create index rooms_property_idx on public.rooms(property_id);
create index rooms_client_idx on public.rooms(client_id);
create index rooms_floor_idx on public.rooms(floor_id);
create trigger rooms_client before insert or update of property_id on public.rooms
  for each row execute function private.set_client_from_property();
create trigger rooms_touch before update on public.rooms
  for each row execute function private.touch_updated_at();

create or replace function private.rooms_validate()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.floor_id is not null and not exists (
       select 1 from public.floors f where f.id = new.floor_id and f.property_id = new.property_id) then
    raise exception 'floor % does not belong to property %', new.floor_id, new.property_id using errcode = '23514';
  end if;
  return new;
end $$;
create trigger rooms_validate before insert or update on public.rooms
  for each row execute function private.rooms_validate();

-- ---------------------------------------------------------------------------
-- Security zones
-- ---------------------------------------------------------------------------
create table public.security_zones (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 120),
  description   text,
  -- Security modes in which presence in this zone raises an intrusion alarm
  active_modes  public.security_mode[] not null default array['armed_away']::public.security_mode[],
  entry_delay_s int not null default 0 check (entry_delay_s between 0 and 300),
  auto_include_new_rooms boolean not null default false,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (property_id, name),
  constraint zones_modes_not_disarmed check (not ('disarmed' = any(active_modes)))
);
create index security_zones_property_idx on public.security_zones(property_id);
create index security_zones_client_idx on public.security_zones(client_id);
create trigger security_zones_client before insert or update of property_id on public.security_zones
  for each row execute function private.set_client_from_property();
create trigger security_zones_touch before update on public.security_zones
  for each row execute function private.touch_updated_at();

create table public.zone_rooms (
  zone_id    uuid not null references public.security_zones(id) on delete cascade,
  room_id    uuid not null references public.rooms(id) on delete cascade,
  client_id  uuid not null references public.clients(id) on delete cascade,
  primary key (zone_id, room_id)
);
create index zone_rooms_room_idx on public.zone_rooms(room_id);
create index zone_rooms_client_idx on public.zone_rooms(client_id);

create or replace function private.zone_rooms_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_zone_prop uuid; v_room_prop uuid; v_client uuid;
begin
  select z.property_id, z.client_id into v_zone_prop, v_client from public.security_zones z where z.id = new.zone_id;
  select r.property_id into v_room_prop from public.rooms r where r.id = new.room_id;
  if v_zone_prop is null or v_room_prop is null or v_zone_prop <> v_room_prop then
    raise exception 'zone and room must belong to the same property' using errcode = '23514';
  end if;
  new.client_id := v_client;
  return new;
end $$;
create trigger zone_rooms_validate before insert or update on public.zone_rooms
  for each row execute function private.zone_rooms_validate();
