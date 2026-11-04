-- =============================================================================
-- 0004 monitoring: live state, history, events, alerting, notifications
-- =============================================================================

-- Current per-node state (upserted by ingest; one row per sensor node).
create table public.node_state (
  device_id      uuid primary key references public.devices(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  property_id    uuid not null references public.properties(id) on delete cascade,
  room_id        uuid references public.rooms(id) on delete set null,
  presence       boolean not null default false,
  motion_level   text not null default 'absent' check (motion_level in ('absent', 'present_still', 'present_moving', 'active')),
  person_count   smallint not null default 0 check (person_count between 0 and 16),
  motion_energy  real,
  presence_score real,
  confidence     real check (confidence is null or confidence between 0 and 1),
  rssi           smallint,
  frame_rate     real,
  source         text not null check (source in ('edge', 'server', 'merged')),
  vitals         jsonb,           -- only stored when property.features.wellness_vitals = true
  extra          jsonb not null default '{}'::jsonb,
  observed_at    timestamptz not null,
  received_at    timestamptz not null default now()
);
create index node_state_property_idx on public.node_state(property_id);
create index node_state_room_idx on public.node_state(room_id);
create index node_state_client_idx on public.node_state(client_id);

-- Current per-room state (derived; Realtime-published).
create table public.room_state (
  room_id               uuid primary key references public.rooms(id) on delete cascade,
  client_id             uuid not null references public.clients(id) on delete cascade,
  property_id           uuid not null references public.properties(id) on delete cascade,
  occupied              boolean not null default false,
  person_count          smallint not null default 0,
  motion_level          text not null default 'absent',
  confidence            real,
  contributing_nodes    int not null default 0,
  stale                 boolean not null default true,   -- true = no fresh sensor data
  last_presence_seen_at timestamptz,
  last_motion_at        timestamptz,
  last_change_at        timestamptz,
  observed_at           timestamptz,
  updated_at            timestamptz not null default now()
);
create index room_state_property_idx on public.room_state(property_id);
create index room_state_client_idx on public.room_state(client_id);

-- Minute-resolution history per node, partitioned monthly (partitions live in
-- the non-exposed "private" schema so PostgREST only sees the RLS-protected parent).
create table public.telemetry_minutes (
  device_id         uuid not null,
  bucket            timestamptz not null,
  client_id         uuid not null,
  property_id       uuid not null,
  room_id           uuid,
  samples           int not null check (samples >= 0),
  presence_ratio    real not null check (presence_ratio between 0 and 1),
  max_persons       smallint not null default 0,
  avg_motion_energy real,
  max_motion_energy real,
  active_ratio      real check (active_ratio is null or active_ratio between 0 and 1),
  avg_rssi          real,
  avg_frame_rate    real,
  avg_breathing_bpm real,
  avg_heart_bpm     real,
  extra             jsonb not null default '{}'::jsonb,
  primary key (device_id, bucket)
) partition by range (bucket);
create index telemetry_minutes_room_bucket_idx on public.telemetry_minutes(room_id, bucket desc);
create index telemetry_minutes_property_bucket_idx on public.telemetry_minutes(property_id, bucket desc);
create index telemetry_minutes_client_idx on public.telemetry_minutes(client_id);

create table private.telemetry_minutes_default partition of public.telemetry_minutes default;

create or replace function private.ensure_telemetry_partitions(p_months_ahead int default 2)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m date;
  name text;
begin
  for i in -1..p_months_ahead loop
    m := (date_trunc('month', now()) + make_interval(months => i))::date;
    name := 'telemetry_minutes_' || to_char(m, 'YYYY_MM');
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'private' and c.relname = name) then
      execute format(
        'create table private.%I partition of public.telemetry_minutes for values from (%L) to (%L)',
        name, m, (m + interval '1 month')::date);
    end if;
  end loop;
end $$;

-- Drops monthly partitions older than the retention window (default 13 months).
create or replace function private.drop_old_telemetry_partitions(p_keep_months int default 13)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; cutoff date := (date_trunc('month', now()) - make_interval(months => p_keep_months))::date; n int := 0;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'private' and c.relname ~ '^telemetry_minutes_\d{4}_\d{2}$' loop
    if to_date(substr(r.relname, 19), 'YYYY_MM') < cutoff then
      execute format('drop table private.%I', r.relname);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Events: activity timeline + alarms. Event kinds are catalogue rows.
-- ---------------------------------------------------------------------------
create table public.event_types (
  code              text primary key check (code ~ '^[a-z][a-z0-9_]{1,63}$'),
  category          text not null check (category in ('security', 'safety', 'activity', 'device', 'system')),
  label             text not null,
  default_severity  public.event_severity not null,
  description       text,
  notifiable        boolean not null default true
);

insert into public.event_types (code, category, label, default_severity, description, notifiable) values
  ('intrusion_detected',      'security', 'Intrusion detected',          'critical', 'Presence detected in a security zone while the property is armed.', true),
  ('entry_delay_started',     'security', 'Entry delay started',         'warning',  'Presence in an entry zone while armed; alarm fires unless disarmed in time.', true),
  ('security_mode_changed',   'security', 'Security mode changed',       'info',     'Property armed or disarmed.', true),
  ('fall_detected',           'safety',   'Possible fall detected',      'critical', 'On-device phase-acceleration fall heuristic (experimental).', true),
  ('presence_detected',       'activity', 'Presence detected',           'info',     'A room became occupied.', true),
  ('presence_cleared',        'activity', 'Room clear',                  'info',     'No presence for the clear-delay period.', true),
  ('device_offline',          'device',   'Sensor offline',              'warning',  'No data from a sensor node for 2 minutes.', true),
  ('device_online',           'device',   'Sensor back online',          'info',     null, true),
  ('gateway_offline',         'device',   'Gateway offline',             'critical', 'Home gateway has not checked in for 2 minutes. Monitoring is paused.', true),
  ('gateway_online',          'device',   'Gateway back online',         'info',     null, true),
  ('device_identity_mismatch','device',   'Sensor identity mismatch',    'warning',  'The MAC address observed for a node id differs from the registered device.', true),
  ('unregistered_node',       'device',   'Unregistered sensor seen',    'warning',  'A node id with no registered device is sending data to the gateway.', false),
  ('firmware_update_succeeded','device',  'Firmware updated',            'info',     null, true),
  ('firmware_update_failed',  'device',   'Firmware update failed',      'warning',  null, true),
  ('sensing_degraded',        'device',   'Sensing degraded',            'warning',  'Gateway sensing service is unreachable or not receiving live ESP32 data.', true),
  ('problem_reported',        'system',   'Problem reported',            'info',     'Client opened a support ticket.', false);

create table public.events (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  property_id      uuid references public.properties(id) on delete cascade,
  room_id          uuid references public.rooms(id) on delete set null,
  zone_id          uuid references public.security_zones(id) on delete set null,
  device_id        uuid references public.devices(id) on delete set null,
  event_type       text not null references public.event_types(code),
  severity         public.event_severity not null,
  title            text not null,
  message          text,
  data             jsonb not null default '{}'::jsonb,
  dedupe_key       text,
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  acknowledged_at  timestamptz,
  acknowledged_by  uuid references public.profiles(id) on delete set null,
  ack_note         text,
  resolved_at      timestamptz,
  resolved_by      uuid references public.profiles(id) on delete set null,
  actor_id         uuid references public.profiles(id) on delete set null
);
create unique index events_dedupe_uidx on public.events(client_id, dedupe_key) where dedupe_key is not null;
create index events_property_time_idx on public.events(property_id, occurred_at desc);
create index events_client_time_idx on public.events(client_id, occurred_at desc);
create index events_room_time_idx on public.events(room_id, occurred_at desc);
create index events_open_critical_idx on public.events(occurred_at desc)
  where severity = 'critical' and acknowledged_at is null;
create trigger events_client before insert on public.events
  for each row execute function private.set_client_from_property();

-- Alarms waiting for an entry delay to expire (cancelled on disarm).
create table public.pending_alarms (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  room_id     uuid not null references public.rooms(id) on delete cascade,
  zone_id     uuid not null references public.security_zones(id) on delete cascade,
  armed_mode  public.security_mode not null,
  fire_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (property_id, zone_id)
);

-- ---------------------------------------------------------------------------
-- Alerting configuration
-- ---------------------------------------------------------------------------
create table public.alert_rules (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,  -- null = all properties
  zone_id     uuid references public.security_zones(id) on delete cascade,
  room_id     uuid references public.rooms(id) on delete cascade,
  event_type  text not null references public.event_types(code),
  channels    text[] not null default array['in_app', 'email'],
  -- {"days":[0..6] (0=Sunday), "start":"22:00", "end":"06:00"} in property timezone; null = always
  schedule    jsonb,
  enabled     boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index alert_rules_client_idx on public.alert_rules(client_id, event_type);
create trigger alert_rules_touch before update on public.alert_rules
  for each row execute function private.touch_updated_at();

create or replace function private.alert_rules_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.property_id is not null then
    select p.client_id into new.client_id from public.properties p where p.id = new.property_id;
  end if;
  if new.zone_id is not null and not exists (
      select 1 from public.security_zones z where z.id = new.zone_id and z.client_id = new.client_id
        and (new.property_id is null or z.property_id = new.property_id)) then
    raise exception 'zone does not belong to this client/property' using errcode = '23514';
  end if;
  if new.room_id is not null and not exists (
      select 1 from public.rooms r where r.id = new.room_id and r.client_id = new.client_id
        and (new.property_id is null or r.property_id = new.property_id)) then
    raise exception 'room does not belong to this client/property' using errcode = '23514';
  end if;
  if new.schedule is not null and not (
      jsonb_typeof(new.schedule) = 'object'
      and (new.schedule ->> 'start') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and (new.schedule ->> 'end')   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'invalid schedule' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger alert_rules_validate before insert or update on public.alert_rules
  for each row execute function private.alert_rules_validate();

create table public.notification_preferences (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete cascade,
  email_enabled boolean not null default true,
  sms_enabled   boolean not null default false,
  push_enabled  boolean not null default false,
  min_severity  public.event_severity not null default 'info',     -- email threshold
  -- {"start":"22:00","end":"07:00"} — non-critical email suppressed during quiet hours
  quiet_hours   jsonb,
  muted_event_types text[] not null default '{}',
  updated_at    timestamptz not null default now(),
  primary key (user_id, client_id)
);
create trigger notification_preferences_touch before update on public.notification_preferences
  for each row execute function private.touch_updated_at();

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  event_id    uuid references public.events(id) on delete cascade,
  channel     text not null check (channel in ('in_app', 'email', 'sms', 'push')),
  status      text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  severity    public.event_severity not null default 'info',
  title       text not null,
  body        text,
  link        text,
  attempts    int not null default 0,
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  read_at     timestamptz
);
create index notifications_user_idx on public.notifications(user_id, created_at desc) where channel = 'in_app';
create index notifications_pending_idx on public.notifications(created_at) where status = 'pending' and channel <> 'in_app';
create index notifications_client_idx on public.notifications(client_id);
