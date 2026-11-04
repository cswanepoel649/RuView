-- =============================================================================
-- RuView Platform — 0001 foundation: schemas, enums, profiles, RLS helpers
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.platform_role   as enum ('platform_admin', 'installer');
create type public.member_role     as enum ('owner', 'member', 'viewer');
create type public.client_status   as enum ('active', 'suspended', 'archived');
create type public.property_status as enum ('planned', 'installing', 'active', 'suspended', 'archived');
create type public.security_mode   as enum ('disarmed', 'armed_home', 'armed_away');
create type public.device_kind     as enum ('sensor_node', 'gateway');
create type public.device_status   as enum ('inventory', 'assigned', 'provisioned', 'online', 'offline', 'fault', 'retired');
create type public.event_severity  as enum ('info', 'warning', 'critical');
create type public.command_status  as enum ('queued', 'dispatched', 'succeeded', 'failed', 'cancelled', 'expired');
create type public.ticket_status   as enum ('open', 'in_progress', 'waiting_client', 'resolved', 'closed');
create type public.installation_status as enum ('draft', 'in_progress', 'completed', 'cancelled');

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.severity_rank(s public.event_severity)
returns int language sql immutable set search_path = '' as $$
  select case s when 'info' then 1 when 'warning' then 2 when 'critical' then 3 end;
$$;

create or replace function private.motion_rank(m text)
returns int language sql immutable set search_path = '' as $$
  select case m when 'active' then 3 when 'present_moving' then 2 when 'present_still' then 1 else 0 end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text,
  phone         text,
  platform_role public.platform_role,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_email_lower check (email = lower(email))
);
create index profiles_platform_role_idx on public.profiles(platform_role) where platform_role is not null;
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(coalesce(new.email, '')),
          nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- True for the service role (gateway ingest, server jobs) and for direct database
-- sessions without a JWT (migrations, pg_cron). Based on the request JWT role claim
-- rather than current_user, because inside SECURITY DEFINER functions current_user
-- is always the function owner. PostgREST sets request.jwt.claims on every API call.
create or replace function private.is_privileged()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                  'service_role') = 'service_role';
$$;

-- Users may edit their own name/phone but never their platform_role or email.
create or replace function private.guard_profile_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if private.is_privileged() or private.is_admin() then
    return new;
  end if;
  if new.platform_role is distinct from old.platform_role then
    raise exception 'only platform administrators can change platform_role' using errcode = '42501';
  end if;
  new.email := old.email;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function private.guard_profile_update();

-- ---------------------------------------------------------------------------
-- RLS helper functions. SECURITY DEFINER so they can read membership tables
-- without recursive RLS evaluation; search_path pinned; private schema is not
-- exposed through PostgREST.
-- ---------------------------------------------------------------------------
create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.platform_role is not null
  );
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.platform_role = 'platform_admin'
  );
$$;
