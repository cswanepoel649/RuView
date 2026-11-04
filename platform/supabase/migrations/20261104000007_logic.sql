-- =============================================================================
-- 0007 domain logic: defaults, ingest, room derivation, alarms, heartbeat,
--      offline detection, notification fan-out, client RPCs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------------
-- p_window = {"days":[0..6]?, "start":"HH:MM", "end":"HH:MM"}; overnight windows allowed.
create or replace function private.in_window(p_window jsonb, p_tz text, p_at timestamptz)
returns boolean language plpgsql stable set search_path = '' as $$
declare
  v_local timestamp := p_at at time zone coalesce(p_tz, 'UTC');
  v_t time := v_local::time;
  v_dow int := extract(dow from v_local)::int;
  v_start time; v_end time; v_days int[]; v_day_ref int;
begin
  if p_window is null or jsonb_typeof(p_window) <> 'object' then
    return true;
  end if;
  v_start := (p_window ->> 'start')::time;
  v_end := (p_window ->> 'end')::time;
  if p_window ? 'days' then
    select array_agg(x::int) into v_days from jsonb_array_elements_text(p_window -> 'days') x;
  end if;
  if v_start <= v_end then
    if not (v_t >= v_start and v_t < v_end) then return false; end if;
    v_day_ref := v_dow;
  else
    if not (v_t >= v_start or v_t < v_end) then return false; end if;
    -- after midnight belongs to the window that started the previous day
    v_day_ref := case when v_t >= v_start then v_dow else (v_dow + 6) % 7 end;
  end if;
  return v_days is null or v_day_ref = any(v_days);
end $$;

-- ---------------------------------------------------------------------------
-- Defaults for new properties and rooms
-- ---------------------------------------------------------------------------
create or replace function private.property_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.alert_rules (client_id, property_id, event_type, channels)
  select new.client_id, new.id, t, array['in_app', 'email']
  from unnest(array['intrusion_detected', 'entry_delay_started', 'fall_detected', 'gateway_offline',
                    'device_offline', 'firmware_update_failed', 'sensing_degraded',
                    'device_identity_mismatch']) t;
  insert into public.security_zones (property_id, client_id, name, description, active_modes, auto_include_new_rooms)
  values (new.id, new.client_id, 'Whole home',
          'All monitored rooms. Active when armed away.', array['armed_away']::public.security_mode[], true);
  return null;
end $$;
create trigger properties_defaults after insert on public.properties
  for each row execute function private.property_defaults();

create or replace function private.room_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.room_state (room_id, client_id, property_id, stale)
  values (new.id, new.client_id, new.property_id, true)
  on conflict (room_id) do nothing;
  insert into public.zone_rooms (zone_id, room_id, client_id)
  select z.id, new.id, new.client_id from public.security_zones z
  where z.property_id = new.property_id and z.auto_include_new_rooms
  on conflict do nothing;
  return null;
end $$;
create trigger rooms_defaults after insert on public.rooms
  for each row execute function private.room_defaults();

-- ---------------------------------------------------------------------------
-- Event creation helper (dedupe-aware). Returns the event id or null if deduped.
-- ---------------------------------------------------------------------------
create or replace function private.emit_event(
  p_client uuid, p_property uuid, p_type text, p_title text, p_message text,
  p_data jsonb default '{}'::jsonb, p_room uuid default null, p_zone uuid default null,
  p_device uuid default null, p_dedupe text default null, p_severity public.event_severity default null,
  p_actor uuid default null, p_occurred_at timestamptz default now())
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_sev public.event_severity;
begin
  select coalesce(p_severity, et.default_severity) into v_sev from public.event_types et where et.code = p_type;
  if v_sev is null then
    raise exception 'unknown event type %', p_type using errcode = '23503';
  end if;
  insert into public.events (client_id, property_id, room_id, zone_id, device_id, event_type, severity,
                             title, message, data, dedupe_key, actor_id, occurred_at)
  values (p_client, p_property, p_room, p_zone, p_device, p_type, v_sev, p_title, p_message,
          coalesce(p_data, '{}'::jsonb), p_dedupe, p_actor, p_occurred_at)
  on conflict (client_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Notification fan-out (after insert on events)
-- ---------------------------------------------------------------------------
create or replace function private.fanout_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_notifiable boolean;
  v_tz text := 'UTC';
  v_channels text[];
  m record;
  pref record;
  v_link text;
begin
  select et.notifiable into v_notifiable from public.event_types et where et.code = new.event_type;
  if not coalesce(v_notifiable, false) then
    return null;
  end if;
  if new.property_id is not null then
    select p.timezone into v_tz from public.properties p where p.id = new.property_id;
  end if;

  select array_agg(distinct c) into v_channels
  from public.alert_rules r, unnest(r.channels) c
  where r.client_id = new.client_id and r.enabled and r.event_type = new.event_type
    and (r.property_id is null or r.property_id = new.property_id)
    and (r.zone_id is null or r.zone_id = new.zone_id
         or (new.room_id is not null and exists (select 1 from public.zone_rooms zr
                                                where zr.zone_id = r.zone_id and zr.room_id = new.room_id)))
    and (r.room_id is null or r.room_id = new.room_id)
    and private.in_window(r.schedule, v_tz, new.occurred_at);

  if v_channels is null then
    return null;   -- no rule matched → timeline only
  end if;

  v_link := '/app/alerts?event=' || new.id;
  for m in select cm.user_id, p.email from public.client_members cm
           join public.profiles p on p.id = cm.user_id
           where cm.client_id = new.client_id loop
    select * into pref from public.notification_preferences np
      where np.user_id = m.user_id and np.client_id = new.client_id;
    if new.severity <> 'critical' and new.event_type = any(coalesce(pref.muted_event_types, '{}')) then
      continue;
    end if;
    if 'in_app' = any(v_channels) then
      insert into public.notifications (user_id, client_id, event_id, channel, status, sent_at, severity, title, body, link)
      values (m.user_id, new.client_id, new.id, 'in_app', 'sent', now(), new.severity, new.title, new.message, v_link);
    end if;
    if 'email' = any(v_channels)
       and coalesce(pref.email_enabled, true)
       and m.email <> ''
       and private.severity_rank(new.severity) >= private.severity_rank(coalesce(pref.min_severity, 'info'))
       and (new.severity = 'critical' or pref.quiet_hours is null
            or not private.in_window(pref.quiet_hours, v_tz, new.occurred_at)) then
      insert into public.notifications (user_id, client_id, event_id, channel, status, severity, title, body, link)
      values (m.user_id, new.client_id, new.id, 'email', 'pending', new.severity, new.title, new.message, v_link);
    end if;
  end loop;
  return null;
end $$;
create trigger events_fanout after insert on public.events
  for each row execute function private.fanout_event();

-- ---------------------------------------------------------------------------
-- Alarms
-- ---------------------------------------------------------------------------
create or replace function private.raise_intrusion(p_property uuid, p_room uuid, p_zone uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_prop record; v_room text; v_zone text;
begin
  select * into v_prop from public.properties where id = p_property;
  select name into v_room from public.rooms where id = p_room;
  select name into v_zone from public.security_zones where id = p_zone;
  perform private.emit_event(
    v_prop.client_id, p_property, 'intrusion_detected',
    'Intrusion detected: ' || coalesce(v_room, 'room'),
    'Presence detected in "' || coalesce(v_room, '?') || '" (zone "' || coalesce(v_zone, '?') ||
      '") while ' || replace(v_prop.security_mode::text, '_', ' ') || '.',
    jsonb_build_object('security_mode', v_prop.security_mode),
    p_room, p_zone, null,
    -- one alarm per room per arming session per 5 minutes
    'intrusion:' || p_room || ':' || extract(epoch from v_prop.security_mode_changed_at)::bigint
      || ':' || floor(extract(epoch from now()) / 300)::bigint);
end $$;

create or replace function private.evaluate_intrusion(p_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_prop record; z record; v_inserted uuid;
begin
  select p.* into v_prop from public.properties p join public.rooms r on r.property_id = p.id where r.id = p_room;
  if v_prop.security_mode = 'disarmed' or v_prop.status in ('suspended', 'archived') then
    return;
  end if;
  -- exit delay after arming
  if v_prop.security_mode_changed_at + make_interval(secs => v_prop.exit_delay_s) > now() then
    return;
  end if;
  for z in select sz.* from public.security_zones sz join public.zone_rooms zr on zr.zone_id = sz.id
           where zr.room_id = p_room and sz.enabled and v_prop.security_mode = any(sz.active_modes) loop
    if z.entry_delay_s > 0 then
      insert into public.pending_alarms (client_id, property_id, room_id, zone_id, armed_mode, fire_at)
      values (v_prop.client_id, v_prop.id, p_room, z.id, v_prop.security_mode, now() + make_interval(secs => z.entry_delay_s))
      on conflict (property_id, zone_id) do nothing
      returning id into v_inserted;
      if v_inserted is not null then
        perform private.emit_event(v_prop.client_id, v_prop.id, 'entry_delay_started',
          'Entry delay started — disarm within ' || z.entry_delay_s || ' s',
          'Presence detected in entry zone "' || z.name || '".',
          jsonb_build_object('entry_delay_s', z.entry_delay_s), p_room, z.id);
      end if;
    else
      perform private.raise_intrusion(v_prop.id, p_room, z.id);
    end if;
  end loop;
end $$;

create or replace function private.process_pending_alarms(p_property uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare pa record; v_mode public.security_mode; n int := 0;
begin
  for pa in delete from public.pending_alarms
            where fire_at <= now() and (p_property is null or property_id = p_property)
            returning * loop
    select security_mode into v_mode from public.properties where id = pa.property_id;
    if v_mode = pa.armed_mode then
      perform private.raise_intrusion(pa.property_id, pa.room_id, pa.zone_id);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Room state derivation from fresh node state (20 s freshness, 30 s clear hold)
-- ---------------------------------------------------------------------------
create or replace function private.recompute_room(p_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  agg record;
  rs record;
  v_room record;
  v_occupied boolean;
  v_motion text;
begin
  select r.id, r.name, r.property_id, r.client_id, r.monitoring_enabled into v_room from public.rooms r where r.id = p_room;
  if v_room.id is null then return; end if;

  insert into public.room_state (room_id, client_id, property_id) values (p_room, v_room.client_id, v_room.property_id)
  on conflict (room_id) do nothing;
  select * into rs from public.room_state where room_id = p_room for update;

  select bool_or(ns.presence) as any_presence,
         max(ns.person_count) filter (where ns.presence) as persons,
         max(private.motion_rank(ns.motion_level)) as motion,
         max(ns.confidence) as conf,
         count(*) as n,
         max(ns.observed_at) as obs
    into agg
  from public.node_state ns join public.devices d on d.id = ns.device_id
  where d.room_id = p_room and d.status not in ('retired', 'inventory')
    and ns.received_at > v_now - interval '20 seconds';

  if agg.n = 0 then
    update public.room_state set stale = true, contributing_nodes = 0, updated_at = v_now where room_id = p_room;
    return;
  end if;

  if agg.any_presence then
    v_occupied := true;
  elsif rs.occupied and rs.last_presence_seen_at > v_now - interval '30 seconds' then
    v_occupied := true;     -- clear-delay hysteresis
  else
    v_occupied := false;
  end if;

  v_motion := case coalesce(agg.motion, 0) when 3 then 'active' when 2 then 'present_moving'
                                           when 1 then 'present_still' else 'absent' end;

  update public.room_state set
    occupied = v_occupied,
    person_count = case when v_occupied then greatest(coalesce(agg.persons, rs.person_count, 1), 1) else 0 end,
    motion_level = case when v_occupied then v_motion else 'absent' end,
    confidence = agg.conf,
    contributing_nodes = agg.n,
    stale = false,
    last_presence_seen_at = case when agg.any_presence then v_now else rs.last_presence_seen_at end,
    last_motion_at = case when coalesce(agg.motion, 0) >= 2 then v_now else rs.last_motion_at end,
    last_change_at = case when v_occupied is distinct from rs.occupied then v_now else rs.last_change_at end,
    observed_at = agg.obs,
    updated_at = v_now
  where room_id = p_room;

  if not v_room.monitoring_enabled then
    return;
  end if;
  if v_occupied and not rs.occupied then
    perform private.emit_event(v_room.client_id, v_room.property_id, 'presence_detected',
      'Presence detected: ' || v_room.name, null,
      jsonb_build_object('person_count', coalesce(agg.persons, 1), 'motion_level', v_motion), p_room);
  elsif not v_occupied and rs.occupied then
    perform private.emit_event(v_room.client_id, v_room.property_id, 'presence_cleared',
      'Room clear: ' || v_room.name, null, '{}'::jsonb, p_room);
  end if;
  if agg.any_presence then
    perform private.evaluate_intrusion(p_room);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Gateway authentication / enrollment (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.gateway_authenticate(p_token_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_device uuid; v_cred uuid; v_last timestamptz;
begin
  select c.device_id, c.id, c.last_used_at into v_device, v_cred, v_last
  from public.device_credentials c join public.devices d on d.id = c.device_id
  where c.token_hash = p_token_hash and c.revoked_at is null and d.status <> 'retired' and d.kind = 'gateway';
  if v_device is null then
    return null;
  end if;
  if v_last is null or v_last < now() - interval '60 seconds' then
    update public.device_credentials set last_used_at = now() where id = v_cred;
  end if;
  return v_device;
end $$;

create or replace function public.gateway_enroll(
  p_code_hash text, p_token_hash text, p_token_prefix text, p_hw_id text, p_info jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_enr record; v_dev record;
begin
  select * into v_enr from public.gateway_enrollments
  where code_hash = p_code_hash and used_at is null and expires_at > now()
  for update;
  if v_enr.id is null then
    raise exception 'invalid or expired enrollment code' using errcode = '28000';
  end if;
  select * into v_dev from public.devices where id = v_enr.device_id for update;
  if v_dev.hw_id is not null and p_hw_id is not null and v_dev.hw_id <> lower(p_hw_id) then
    raise exception 'enrollment code belongs to a different gateway hardware id' using errcode = '28000';
  end if;
  update public.gateway_enrollments set used_at = now() where id = v_enr.id;
  -- re-enrollment invalidates previous tokens
  update public.device_credentials set revoked_at = now() where device_id = v_dev.id and revoked_at is null;
  insert into public.device_credentials (device_id, token_hash, token_prefix, created_by)
  values (v_dev.id, p_token_hash, p_token_prefix, v_enr.created_by);
  perform set_config('ruview.status_reason', 'gateway enrolled', true);
  update public.devices set
    hw_id = coalesce(hw_id, lower(nullif(p_hw_id, ''))),
    status = case when status in ('inventory', 'assigned', 'provisioned', 'offline') then 'online' else status end,
    last_seen_at = now(),
    firmware_version = coalesce(p_info ->> 'agent_version', firmware_version),
    health = health || jsonb_build_object('enrolled_at', now(), 'hostname', p_info ->> 'hostname',
                                          'platform', p_info ->> 'platform')
  where id = v_dev.id;
  return jsonb_build_object('gateway_id', v_dev.id, 'property_id', v_dev.property_id);
end $$;

-- ---------------------------------------------------------------------------
-- Telemetry ingest (service role only). Gateway identity comes from the
-- authenticated token, never from the payload.
-- ---------------------------------------------------------------------------
create or replace function public.ingest_telemetry(p_gateway uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  gw record; prop record; dev record;
  s jsonb; m jsonb;
  v_obs timestamptz; v_bucket timestamptz;
  v_rooms uuid[] := '{}'; v_room uuid;
  v_unknown int[] := '{}';
  v_accepted int := 0; v_minutes int := 0; v_rejected int := 0;
  v_vitals_on boolean;
begin
  select * into gw from public.devices where id = p_gateway and kind = 'gateway' and status <> 'retired';
  if gw.id is null or gw.property_id is null then
    raise exception 'gateway is not installed at a property' using errcode = '28000';
  end if;
  select * into prop from public.properties where id = gw.property_id;
  v_vitals_on := coalesce((prop.features ->> 'wellness_vitals')::boolean, false);
  update public.devices set last_seen_at = v_now where id = gw.id;

  -- live samples ------------------------------------------------------------
  for s in select value from jsonb_array_elements(coalesce(p_payload -> 'samples', '[]'::jsonb)) loop
    select d.* into dev from public.devices d
    where d.gateway_id = gw.id and d.node_id = (s ->> 'node_id')::int and d.status <> 'retired';
    if dev.id is null then
      if not ((s ->> 'node_id')::int = any(v_unknown)) then
        v_unknown := array_append(v_unknown, (s ->> 'node_id')::int);
      end if;
      continue;
    end if;
    v_obs := least(coalesce((s ->> 'observed_at')::timestamptz, v_now), v_now + interval '5 seconds');
    if v_obs < v_now - interval '10 minutes' then
      v_rejected := v_rejected + 1;
      continue;
    end if;

    insert into public.node_state as ns (device_id, client_id, property_id, room_id, presence, motion_level, person_count,
                                   motion_energy, presence_score, confidence, rssi, frame_rate, source, vitals,
                                   extra, observed_at, received_at)
    values (dev.id, prop.client_id, prop.id, dev.room_id,
            coalesce((s ->> 'presence')::boolean, false),
            coalesce(s ->> 'motion_level', 'absent'),
            least(greatest(coalesce((s ->> 'person_count')::int, 0), 0), 16),
            (s ->> 'motion_energy')::real, (s ->> 'presence_score')::real,
            least(greatest((s ->> 'confidence')::real, 0), 1),
            (s ->> 'rssi')::smallint, (s ->> 'frame_rate')::real,
            coalesce(s ->> 'source', 'merged'),
            case when v_vitals_on then s -> 'vitals' end,
            coalesce(s -> 'extra', '{}'::jsonb), v_obs, v_now)
    on conflict (device_id) do update set
      room_id = excluded.room_id, presence = excluded.presence, motion_level = excluded.motion_level,
      person_count = excluded.person_count, motion_energy = excluded.motion_energy,
      presence_score = excluded.presence_score, confidence = excluded.confidence, rssi = excluded.rssi,
      frame_rate = excluded.frame_rate, source = excluded.source, vitals = excluded.vitals,
      extra = excluded.extra, observed_at = excluded.observed_at, received_at = excluded.received_at
    where ns.observed_at <= excluded.observed_at;

    if dev.status in ('offline', 'provisioned', 'assigned', 'fault') then
      perform set_config('ruview.status_reason', 'telemetry received', true);
      update public.devices set status = 'online' where id = dev.id;
      if dev.status = 'offline' then
        perform private.emit_event(prop.client_id, prop.id, 'device_online', 'Sensor back online: ' || dev.name,
                                   null, '{}'::jsonb, dev.room_id, null, dev.id);
      end if;
    end if;
    update public.devices set
      last_seen_at = greatest(coalesce(last_seen_at, v_obs), v_obs),
      last_rssi = coalesce((s ->> 'rssi')::smallint, last_rssi)
    where id = dev.id;

    if dev.room_id is not null and not (dev.room_id = any(v_rooms)) then
      v_rooms := array_append(v_rooms, dev.room_id);
    end if;
    v_accepted := v_accepted + 1;
  end loop;

  -- closed minute buckets (idempotent; replayed after outages up to 7 days) ----
  for m in select value from jsonb_array_elements(coalesce(p_payload -> 'minutes', '[]'::jsonb)) loop
    select d.* into dev from public.devices d
    where d.gateway_id = gw.id and d.node_id = (m ->> 'node_id')::int and d.status <> 'retired';
    if dev.id is null then continue; end if;
    v_bucket := date_trunc('minute', (m ->> 'bucket')::timestamptz);
    if v_bucket > v_now + interval '1 minute' or v_bucket < v_now - interval '7 days' then
      v_rejected := v_rejected + 1;
      continue;
    end if;
    insert into public.telemetry_minutes as tm (device_id, bucket, client_id, property_id, room_id, samples,
        presence_ratio, max_persons, avg_motion_energy, max_motion_energy, active_ratio, avg_rssi,
        avg_frame_rate, avg_breathing_bpm, avg_heart_bpm, extra)
    values (dev.id, v_bucket, prop.client_id, prop.id, dev.room_id,
        greatest(coalesce((m ->> 'samples')::int, 0), 0),
        least(greatest(coalesce((m ->> 'presence_ratio')::real, 0), 0), 1),
        least(greatest(coalesce((m ->> 'max_persons')::int, 0), 0), 16),
        (m ->> 'avg_motion_energy')::real, (m ->> 'max_motion_energy')::real,
        least(greatest((m ->> 'active_ratio')::real, 0), 1),
        (m ->> 'avg_rssi')::real, (m ->> 'avg_frame_rate')::real,
        case when v_vitals_on then (m ->> 'avg_breathing_bpm')::real end,
        case when v_vitals_on then (m ->> 'avg_heart_bpm')::real end,
        coalesce(m -> 'extra', '{}'::jsonb))
    on conflict (device_id, bucket) do update set
      samples = excluded.samples, presence_ratio = excluded.presence_ratio, max_persons = excluded.max_persons,
      avg_motion_energy = excluded.avg_motion_energy, max_motion_energy = excluded.max_motion_energy,
      active_ratio = excluded.active_ratio, avg_rssi = excluded.avg_rssi, avg_frame_rate = excluded.avg_frame_rate,
      avg_breathing_bpm = excluded.avg_breathing_bpm, avg_heart_bpm = excluded.avg_heart_bpm, extra = excluded.extra;
    v_minutes := v_minutes + 1;
  end loop;

  foreach v_room in array v_rooms loop
    perform private.recompute_room(v_room);
  end loop;
  perform private.process_pending_alarms(prop.id);

  return jsonb_build_object('accepted', v_accepted, 'minutes', v_minutes, 'rejected', v_rejected,
                            'unknown_nodes', to_jsonb(v_unknown));
end $$;

-- Edge events reported by the gateway (currently: fall detection).
create or replace function public.ingest_gateway_events(p_gateway uuid, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare gw record; prop record; dev record; e jsonb; v_id uuid; n int := 0;
begin
  select * into gw from public.devices where id = p_gateway and kind = 'gateway' and status <> 'retired';
  if gw.property_id is null then
    raise exception 'gateway is not installed at a property' using errcode = '28000';
  end if;
  select * into prop from public.properties where id = gw.property_id;
  for e in select value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    if (e ->> 'type') not in ('fall_detected') then
      continue;   -- gateways may only report edge-originated event kinds
    end if;
    select d.* into dev from public.devices d
    where d.gateway_id = gw.id and d.node_id = (e ->> 'node_id')::int and d.status <> 'retired';
    if dev.id is null then continue; end if;
    v_id := private.emit_event(prop.client_id, prop.id, e ->> 'type',
      'Possible fall detected' || coalesce(' — ' || (select r.name from public.rooms r where r.id = dev.room_id), ''),
      'On-device fall heuristic triggered on sensor "' || dev.name || '". Experimental — please check on occupants.',
      coalesce(e -> 'data', '{}'::jsonb), dev.room_id, null, dev.id,
      'gw:' || gw.id || ':' || left(coalesce(e ->> 'dedupe_key', gen_random_uuid()::text), 120),
      null, null,
      least(coalesce((e ->> 'occurred_at')::timestamptz, now()), now()));
    if v_id is not null then n := n + 1; end if;
  end loop;
  return jsonb_build_object('created', n);
end $$;

-- ---------------------------------------------------------------------------
-- Heartbeat: liveness, node discovery/identity checks, command dispatch.
-- ---------------------------------------------------------------------------
create or replace function public.gateway_heartbeat(p_gateway uuid, p_payload jsonb, p_remote_ip text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  gw record; prop record; dev record; n jsonb;
  v_mac text; v_cmds jsonb; v_map jsonb; v_source text; v_reachable boolean;
begin
  select * into gw from public.devices where id = p_gateway and kind = 'gateway' and status <> 'retired' for update;
  if gw.id is null then
    raise exception 'unknown gateway' using errcode = '28000';
  end if;
  select * into prop from public.properties where id = gw.property_id;

  perform set_config('ruview.status_reason', 'heartbeat', true);
  update public.devices set
    last_seen_at = now(),
    last_ip = coalesce(nullif(p_remote_ip, '')::inet, last_ip),
    firmware_version = coalesce(p_payload ->> 'agent_version', firmware_version),
    status = case when status in ('offline', 'assigned', 'provisioned', 'fault', 'inventory') and property_id is not null
                  then 'online'::public.device_status else status end,
    health = jsonb_strip_nulls(jsonb_build_object(
      'agent_version', p_payload ->> 'agent_version',
      'uptime_s', p_payload -> 'uptime_s',
      'lan_ips', p_payload -> 'lan_ips',
      'sensing', p_payload -> 'sensing',
      'system', p_payload -> 'system',
      'buffer', p_payload -> 'buffer',
      'reported_at', now()))
  where id = gw.id;

  if gw.status = 'offline' and prop.id is not null then
    perform private.emit_event(prop.client_id, prop.id, 'gateway_online', 'Gateway back online: ' || gw.name,
                               'Monitoring resumed.', '{}'::jsonb, null, null, gw.id);
  end if;

  if prop.id is not null then
    v_reachable := coalesce((p_payload #>> '{sensing,reachable}')::boolean, false);
    v_source := p_payload #>> '{sensing,source}';
    if not v_reachable or (v_source is not null and v_source <> 'esp32') then
      perform private.emit_event(prop.client_id, prop.id, 'sensing_degraded',
        'Sensing degraded at ' || prop.name,
        case when not v_reachable then 'The RuView sensing service on the gateway is not responding.'
             else 'The sensing service reports source "' || v_source || '" (no live ESP32 data).' end,
        jsonb_build_object('source', v_source, 'reachable', v_reachable), null, null, gw.id,
        'degraded:' || gw.id || ':' || to_char(now(), 'YYYYMMDDHH24'));
    end if;

    for n in select value from jsonb_array_elements(coalesce(p_payload -> 'nodes', '[]'::jsonb)) loop
      select d.* into dev from public.devices d
      where d.gateway_id = gw.id and d.node_id = (n ->> 'node_id')::int and d.status <> 'retired';
      v_mac := lower(nullif(n ->> 'mac', ''));
      if dev.id is null then
        perform private.emit_event(prop.client_id, prop.id, 'unregistered_node',
          'Unregistered sensor node ' || (n ->> 'node_id') || ' seen at ' || prop.name,
          'A sensor is streaming to this gateway but is not registered in the platform.',
          jsonb_build_object('node_id', n -> 'node_id', 'ip', n -> 'ip', 'mac', v_mac),
          null, null, gw.id, 'unreg:' || gw.id || ':' || (n ->> 'node_id') || ':' || to_char(now(), 'YYYYMMDD'));
        continue;
      end if;
      update public.devices set
        last_ip = coalesce(nullif(n ->> 'ip', '')::inet, last_ip),
        firmware_version = coalesce(n ->> 'firmware_version', firmware_version),
        health = health || jsonb_strip_nulls(jsonb_build_object(
          'mac_observed', v_mac, 'packets_per_s', n -> 'packets_per_s', 'packet_types', n -> 'packet_types',
          'edge_tier_observed', n -> 'edge_tier_observed', 'ota', n -> 'ota', 'last_seen_ms', n -> 'last_seen_ms',
          'reported_at', now()))
      where id = dev.id;
      if v_mac is not null and dev.hw_id is not null and v_mac <> dev.hw_id then
        perform private.emit_event(prop.client_id, prop.id, 'device_identity_mismatch',
          'Identity mismatch on node ' || dev.node_id || ' (' || dev.name || ')',
          'Registered MAC ' || dev.hw_id || ' but the gateway observes ' || v_mac || '. A different board may be using this node id.',
          jsonb_build_object('expected', dev.hw_id, 'observed', v_mac), dev.room_id, null, dev.id,
          'mac:' || dev.id || ':' || v_mac);
      end if;
    end loop;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('node_id', d.node_id, 'device_id', d.id, 'room_id', d.room_id,
                                               'name', d.name, 'hw_id', d.hw_id) order by d.node_id), '[]'::jsonb)
    into v_map
  from public.devices d where d.gateway_id = gw.id and d.node_id is not null and d.status <> 'retired';

  with picked as (
    update public.device_commands c set status = 'dispatched', dispatched_at = now(), attempts = attempts + 1
    where c.gateway_id = gw.id and c.expires_at > now() and c.attempts < 3
      and (c.status = 'queued' or (c.status = 'dispatched' and c.dispatched_at < now() - interval '10 minutes'))
    returning c.id, c.device_id, c.command_type, c.payload, c.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'device_id', p.device_id, 'type', p.command_type,
                                               'payload', p.payload, 'attempt', p.attempts,
                                               'node_id', d.node_id, 'node_ip', host(d.last_ip))), '[]'::jsonb)
    into v_cmds
  from picked p join public.devices d on d.id = p.device_id;

  return jsonb_build_object(
    'server_time', now(),
    'property_id', gw.property_id,
    'config', jsonb_build_object(
      'telemetry_interval_s', coalesce((prop.features ->> 'telemetry_interval_s')::int, 5),
      'heartbeat_interval_s', 30,
      'vitals_enabled', coalesce((prop.features ->> 'wellness_vitals')::boolean, false)),
    'node_map', v_map,
    'commands', v_cmds);
end $$;

create or replace function public.gateway_complete_command(
  p_gateway uuid, p_command uuid, p_success boolean, p_result jsonb, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare c record; dev record;
begin
  select * into c from public.device_commands where id = p_command and gateway_id = p_gateway for update;
  if c.id is null then
    raise exception 'command not found for this gateway' using errcode = 'P0002';
  end if;
  if c.status not in ('dispatched', 'queued') then
    return;   -- already finalised (idempotent)
  end if;
  update public.device_commands set
    status = case when p_success then 'succeeded'::public.command_status else 'failed'::public.command_status end,
    completed_at = now(), result = p_result, error = left(p_error, 2000)
  where id = c.id;
  select * into dev from public.devices where id = c.device_id;
  if c.command_type = 'ota_update' then
    if p_success then
      update public.devices set
        firmware_version = coalesce(p_result ->> 'version', c.payload ->> 'version', firmware_version),
        firmware_release_id = coalesce((c.payload ->> 'release_id')::uuid, firmware_release_id)
      where id = dev.id;
      perform private.emit_event(c.client_id, c.property_id, 'firmware_update_succeeded',
        'Firmware updated: ' || dev.name, 'Now running ' || coalesce(p_result ->> 'version', c.payload ->> 'version', '?') || '.',
        coalesce(p_result, '{}'::jsonb), dev.room_id, null, dev.id);
    else
      perform private.emit_event(c.client_id, c.property_id, 'firmware_update_failed',
        'Firmware update failed: ' || dev.name, left(p_error, 500),
        jsonb_build_object('command_id', c.id), dev.room_id, null, dev.id);
    end if;
  elsif c.command_type = 'probe_node' and p_success then
    update public.devices set
      firmware_version = coalesce(p_result ->> 'version', firmware_version),
      health = health || jsonb_build_object('ota', p_result, 'probed_at', now())
    where id = dev.id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Periodic maintenance (pg_cron every minute and/or /api/cron/maintenance)
-- ---------------------------------------------------------------------------
create or replace function public.run_maintenance()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d record; v_nodes int := 0; v_gws int := 0; v_alarms int; v_expired int;
begin
  perform set_config('ruview.status_reason', 'no data for 2 minutes', true);
  for d in update public.devices set status = 'offline'
           where status = 'online' and property_id is not null
             and (last_seen_at is null or last_seen_at < now() - interval '2 minutes')
           returning id, kind, name, client_id, property_id, room_id loop
    if d.kind = 'gateway' then
      v_gws := v_gws + 1;
      perform private.emit_event(d.client_id, d.property_id, 'gateway_offline', 'Gateway offline: ' || d.name,
        'The home gateway has not checked in for 2 minutes. Live monitoring and alarms are paused until it reconnects.',
        '{}'::jsonb, null, null, d.id, 'gwoff:' || d.id || ':' || floor(extract(epoch from now()) / 600)::bigint);
    else
      v_nodes := v_nodes + 1;
      perform private.emit_event(d.client_id, d.property_id, 'device_offline', 'Sensor offline: ' || d.name,
        'No data received from this sensor for 2 minutes.', '{}'::jsonb, d.room_id, null, d.id,
        'devoff:' || d.id || ':' || floor(extract(epoch from now()) / 600)::bigint);
    end if;
  end loop;

  -- rooms with no fresh data are "unknown", never "empty"
  update public.room_state rs set stale = true, contributing_nodes = 0, updated_at = now()
  where not rs.stale and not exists (
    select 1 from public.node_state ns join public.devices dv on dv.id = ns.device_id
    where dv.room_id = rs.room_id and ns.received_at > now() - interval '60 seconds');

  v_alarms := private.process_pending_alarms(null);

  update public.device_commands set status = 'expired', completed_at = now()
  where status in ('queued', 'dispatched') and expires_at <= now();
  get diagnostics v_expired = row_count;

  return jsonb_build_object('nodes_offline', v_nodes, 'gateways_offline', v_gws,
                            'alarms_fired', v_alarms, 'commands_expired', v_expired);
end $$;

-- Claim pending email notifications for the dispatcher (SKIP LOCKED for concurrency).
create or replace function public.claim_pending_notifications(p_limit int default 50)
returns setof public.notifications language sql security definer set search_path = '' as $$
  update public.notifications n set status = 'sending', attempts = attempts + 1
  where n.id in (select id from public.notifications
                 where status = 'pending' and channel <> 'in_app'
                 order by created_at limit p_limit for update skip locked)
  returning n.*;
$$;

-- ---------------------------------------------------------------------------
-- Client-facing RPCs (re-check authorisation; run as definer)
-- ---------------------------------------------------------------------------
create or replace function public.set_security_mode(p_property uuid, p_mode public.security_mode)
returns public.properties language plpgsql security definer set search_path = '' as $$
declare v_prop public.properties; v_old public.security_mode;
begin
  select * into v_prop from public.properties where id = p_property for update;
  if v_prop.id is null or not (private.is_staff() or private.can_operate(v_prop.client_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if v_prop.status in ('suspended', 'archived') then
    raise exception 'property is %', v_prop.status using errcode = '55000';
  end if;
  v_old := v_prop.security_mode;
  if v_old = p_mode then
    return v_prop;
  end if;
  update public.properties set security_mode = p_mode, security_mode_changed_at = now(),
                               security_mode_changed_by = auth.uid()
  where id = p_property returning * into v_prop;
  if p_mode = 'disarmed' then
    delete from public.pending_alarms where property_id = p_property;
  end if;
  perform private.emit_event(v_prop.client_id, v_prop.id, 'security_mode_changed',
    case p_mode when 'disarmed' then 'Disarmed' when 'armed_home' then 'Armed (home)' else 'Armed (away)' end
      || ' — ' || v_prop.name,
    case when p_mode <> 'disarmed' and v_prop.exit_delay_s > 0
         then 'Alarm active after a ' || v_prop.exit_delay_s || ' s exit delay.' end,
    jsonb_build_object('from', v_old, 'to', p_mode), null, null, null, null, null, auth.uid());
  return v_prop;
end $$;

create or replace function public.acknowledge_event(p_event uuid, p_note text default null)
returns public.events language plpgsql security definer set search_path = '' as $$
declare v_ev public.events;
begin
  select * into v_ev from public.events where id = p_event for update;
  if v_ev.id is null or not (private.is_staff() or private.can_operate(v_ev.client_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update public.events set acknowledged_at = coalesce(acknowledged_at, now()),
                           acknowledged_by = coalesce(acknowledged_by, auth.uid()),
                           ack_note = coalesce(left(p_note, 1000), ack_note)
  where id = p_event returning * into v_ev;
  update public.notifications set read_at = coalesce(read_at, now())
  where event_id = p_event and user_id = auth.uid() and channel = 'in_app';
  return v_ev;
end $$;

create or replace function public.resolve_event(p_event uuid, p_note text default null)
returns public.events language plpgsql security definer set search_path = '' as $$
declare v_ev public.events;
begin
  select * into v_ev from public.events where id = p_event for update;
  if v_ev.id is null or not (private.is_staff() or private.can_operate(v_ev.client_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update public.events set
    acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid()),
    resolved_at = coalesce(resolved_at, now()), resolved_by = coalesce(resolved_by, auth.uid()),
    ack_note = coalesce(left(p_note, 1000), ack_note)
  where id = p_event returning * into v_ev;
  return v_ev;
end $$;

-- Hourly occupancy rollup for analytics (RLS enforced via the base table: invoker rights).
create or replace function public.room_occupancy_hourly(p_property uuid, p_from timestamptz, p_to timestamptz)
returns table (room_id uuid, hour timestamptz, occupied_ratio real, max_persons int, avg_motion real, minutes int)
language sql stable security invoker set search_path = '' as $$
  select t.room_id, date_trunc('hour', t.bucket) as hour,
         avg(t.presence_ratio)::real, max(t.max_persons)::int, avg(t.avg_motion_energy)::real, count(*)::int
  from public.telemetry_minutes t
  where t.property_id = p_property and t.bucket >= p_from and t.bucket < p_to and t.room_id is not null
  group by t.room_id, date_trunc('hour', t.bucket)
  order by 2;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.gateway_authenticate(text), public.gateway_enroll(text, text, text, text, jsonb),
  public.ingest_telemetry(uuid, jsonb), public.ingest_gateway_events(uuid, jsonb),
  public.gateway_heartbeat(uuid, jsonb, text), public.gateway_complete_command(uuid, uuid, boolean, jsonb, text),
  public.run_maintenance(), public.claim_pending_notifications(int), public.allocate_node_id(uuid)
  from public, anon, authenticated;
grant execute on function
  public.gateway_authenticate(text), public.gateway_enroll(text, text, text, text, jsonb),
  public.ingest_telemetry(uuid, jsonb), public.ingest_gateway_events(uuid, jsonb),
  public.gateway_heartbeat(uuid, jsonb, text), public.gateway_complete_command(uuid, uuid, boolean, jsonb, text),
  public.run_maintenance(), public.claim_pending_notifications(int), public.allocate_node_id(uuid)
  to service_role;
-- allocate_node_id is also useful to staff from the admin UI (it re-checks is_staff()).
grant execute on function public.allocate_node_id(uuid) to authenticated;

revoke execute on function public.set_security_mode(uuid, public.security_mode), public.acknowledge_event(uuid, text),
  public.resolve_event(uuid, text), public.room_occupancy_hourly(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.set_security_mode(uuid, public.security_mode), public.acknowledge_event(uuid, text),
  public.resolve_event(uuid, text), public.room_occupancy_hourly(uuid, timestamptz, timestamptz) to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_staff(), private.is_admin(), private.is_member(uuid), private.member_role(uuid),
  private.can_operate(uuid), private.is_owner(uuid), private.can_read(uuid), private.is_privileged()
  to authenticated;
grant execute on all functions in schema private to service_role;
