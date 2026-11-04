-- =============================================================================
-- 0003 devices: catalog, inventory, credentials, firmware, commands, installs
-- =============================================================================

-- Hardware catalog. New hardware types are added as rows, not migrations.
create table public.device_models (
  id               text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  kind             public.device_kind not null,
  manufacturer     text not null,
  name             text not null,
  chip             text,
  flash_mb         int,
  firmware_family  text,                 -- e.g. 'esp32-csi-node'; null = not platform-flashed
  capabilities     text[] not null default '{}',
  provisioning     text not null default 'none' check (provisioning in ('web_serial', 'enrollment_code', 'manual', 'none')),
  supported        boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now()
);

insert into public.device_models (id, kind, manufacturer, name, chip, flash_mb, firmware_family, capabilities, provisioning, supported, notes) values
  ('esp32s3-8mb', 'sensor_node', 'Espressif', 'ESP32-S3 CSI node (8 MB flash)', 'ESP32-S3', 8, 'esp32-csi-node',
   array['csi','presence','motion','person_estimate','fall','vitals','ota','wasm'], 'web_serial', true,
   'RuView esp32-csi-node firmware. 2.4 GHz WiFi only. Note: OTA size gate 900 KB (see L3).'),
  ('esp32s3-4mb', 'sensor_node', 'Espressif', 'ESP32-S3 SuperMini CSI node (4 MB flash)', 'ESP32-S3', 4, 'esp32-csi-node',
   array['csi','presence','motion','person_estimate','fall','vitals','ota','wasm'], 'web_serial', true,
   'Compact 4 MB build (partitions_4mb.csv).'),
  ('esp32s3-mmwave-mr60', 'sensor_node', 'Espressif + Seeed', 'ESP32-S3 node + MR60BHA2 60 GHz mmWave', 'ESP32-S3', 8, 'esp32-csi-node',
   array['csi','presence','motion','person_estimate','fall','vitals','mmwave_vitals','mmwave_distance','ota'], 'web_serial', true,
   'mmWave auto-detected on UART; node sends fused vitals (0xC5110004).'),
  ('esp32s3-ld2410', 'sensor_node', 'Espressif + HiLink', 'ESP32-S3 node + HLK-LD2410 24 GHz radar', 'ESP32-S3', 8, 'esp32-csi-node',
   array['csi','presence','motion','person_estimate','fall','mmwave_distance','ota'], 'web_serial', true, null),
  ('gateway-rpi', 'gateway', 'Raspberry Pi', 'Raspberry Pi 4/5 home gateway', 'BCM2711/2712', null, null,
   array['sensing_server','udp_relay','ota_proxy'], 'enrollment_code', true,
   'Runs RuView sensing-server + ruview-agent (docker compose).'),
  ('gateway-linux', 'gateway', 'Generic', 'Linux mini-PC home gateway (x86_64/arm64)', null, null, null,
   array['sensing_server','udp_relay','ota_proxy'], 'enrollment_code', true, null),
  ('esp32-classic', 'sensor_node', 'Espressif', 'ESP32 (original) — unsupported', 'ESP32', 4, null,
   '{}', 'none', false, 'Single-core; cannot run the CSI DSP pipeline.'),
  ('esp32c3', 'sensor_node', 'Espressif', 'ESP32-C3 — unsupported', 'ESP32-C3', 4, null,
   '{}', 'none', false, 'Single-core; cannot run the CSI DSP pipeline.');

-- ---------------------------------------------------------------------------
-- Devices (inventory + installed). One table for all hardware kinds.
-- ---------------------------------------------------------------------------
create table public.devices (
  id               uuid primary key default gen_random_uuid(),
  kind             public.device_kind not null,
  model_id         text not null references public.device_models(id),
  name             text not null check (length(trim(name)) between 1 and 120),
  serial_number    text unique,
  -- Hardware identity: base MAC "aa:bb:cc:dd:ee:ff" for ESP32 (read over USB),
  -- machine-id for gateways (reported at enrollment).
  hw_id            text unique,
  client_id        uuid references public.clients(id) on delete restrict,
  property_id      uuid references public.properties(id) on delete restrict,
  room_id          uuid references public.rooms(id) on delete set null,
  gateway_id       uuid references public.devices(id) on delete set null,
  node_id          smallint check (node_id between 1 and 254),
  status           public.device_status not null default 'inventory',
  firmware_version text,
  firmware_release_id uuid,
  desired_config   jsonb not null default '{}'::jsonb,   -- what the platform wants on the device
  provisioned_config jsonb,                               -- non-secret snapshot written at provisioning
  provisioned_at   timestamptz,
  position         jsonb,                                 -- {x,y} normalised on floor plan, height_m
  mount_notes      text,
  last_seen_at     timestamptz,
  last_ip          inet,
  last_rssi        smallint,
  health           jsonb not null default '{}'::jsonb,   -- latest health snapshot
  purchase_ref     text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint devices_hw_id_format check (hw_id is null or (kind = 'gateway') or hw_id ~ '^[0-9a-f]{2}(:[0-9a-f]{2}){5}$'),
  constraint devices_node_only_sensor check (kind = 'sensor_node' or (node_id is null and gateway_id is null)),
  constraint devices_room_needs_property check (room_id is null or property_id is not null)
);
create unique index devices_gateway_node_uidx on public.devices(gateway_id, node_id)
  where node_id is not null and gateway_id is not null and status <> 'retired';
create index devices_client_idx on public.devices(client_id);
create index devices_property_idx on public.devices(property_id);
create index devices_room_idx on public.devices(room_id);
create index devices_gateway_idx on public.devices(gateway_id);
create index devices_status_idx on public.devices(status);
create trigger devices_touch before update on public.devices
  for each row execute function private.touch_updated_at();

create or replace function private.devices_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_room_prop uuid; v_gw record; v_model record;
begin
  select * into v_model from public.device_models m where m.id = new.model_id;
  if v_model.kind <> new.kind then
    raise exception 'device model % is a %, not a %', new.model_id, v_model.kind, new.kind using errcode = '23514';
  end if;
  if new.property_id is not null then
    select p.client_id into new.client_id from public.properties p where p.id = new.property_id;
  end if;
  if new.room_id is not null then
    select r.property_id into v_room_prop from public.rooms r where r.id = new.room_id;
    if v_room_prop is distinct from new.property_id then
      raise exception 'room does not belong to the device property' using errcode = '23514';
    end if;
  end if;
  if new.gateway_id is not null then
    select d.kind, d.property_id into v_gw from public.devices d where d.id = new.gateway_id;
    if v_gw.kind is distinct from 'gateway' then
      raise exception 'gateway_id must reference a gateway device' using errcode = '23514';
    end if;
    if v_gw.property_id is distinct from new.property_id then
      raise exception 'sensor and gateway must be installed at the same property' using errcode = '23514';
    end if;
  end if;
  if new.hw_id is not null then
    new.hw_id := lower(new.hw_id);
  end if;
  if new.status = 'retired' then
    new.room_id := null;
  end if;
  return new;
end $$;
create trigger devices_validate before insert or update on public.devices
  for each row execute function private.devices_validate();

-- Allocate the lowest free node_id (1..254) on a gateway.
create or replace function public.allocate_node_id(p_gateway uuid)
returns smallint language plpgsql security definer set search_path = '' as $$
declare v smallint;
begin
  if not (private.is_staff() or private.is_privileged()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.devices where id = p_gateway and kind = 'gateway' for update;
  if not found then raise exception 'gateway not found' using errcode = 'P0002'; end if;
  select g::smallint into v
  from generate_series(1, 254) g
  where not exists (select 1 from public.devices d
                    where d.gateway_id = p_gateway and d.node_id = g and d.status <> 'retired')
  order by g limit 1;
  if v is null then raise exception 'no free node ids on gateway' using errcode = '53400'; end if;
  return v;
end $$;

create table public.device_status_log (
  id          bigint generated always as identity primary key,
  device_id   uuid not null references public.devices(id) on delete cascade,
  client_id   uuid references public.clients(id) on delete cascade,
  from_status public.device_status,
  to_status   public.device_status not null,
  reason      text,
  created_at  timestamptz not null default now()
);
create index device_status_log_device_idx on public.device_status_log(device_id, created_at desc);
create index device_status_log_client_idx on public.device_status_log(client_id);

create or replace function private.devices_log_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.device_status_log (device_id, client_id, from_status, to_status, reason)
    values (new.id, new.client_id, case when tg_op = 'UPDATE' then old.status end, new.status,
            nullif(current_setting('ruview.status_reason', true), ''));
  end if;
  return null;
end $$;
create trigger devices_log_status after insert or update of status on public.devices
  for each row execute function private.devices_log_status();

-- ---------------------------------------------------------------------------
-- Gateway credentials & enrollment, device secrets (service-role only)
-- ---------------------------------------------------------------------------
create table public.device_credentials (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references public.devices(id) on delete cascade,
  token_hash   text not null unique,          -- sha256 hex of the bearer token
  token_prefix text not null,                 -- first chars for identification in UI
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index device_credentials_device_idx on public.device_credentials(device_id);

create table public.gateway_enrollments (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references public.devices(id) on delete cascade,
  code_hash   text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index gateway_enrollments_device_idx on public.gateway_enrollments(device_id);

create table public.device_secrets (
  device_id          uuid primary key references public.devices(id) on delete cascade,
  ota_psk_ciphertext text not null,     -- AES-256-GCM (app key), base64 iv.tag.ct
  created_at         timestamptz not null default now(),
  rotated_at         timestamptz
);

-- ---------------------------------------------------------------------------
-- Firmware releases (binaries in Storage bucket "firmware")
-- ---------------------------------------------------------------------------
create table public.firmware_releases (
  id            uuid primary key default gen_random_uuid(),
  family        text not null default 'esp32-csi-node',
  version       text not null check (version ~ '^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$'),
  flash_size_mb int not null check (flash_size_mb in (4, 8, 16)),
  model_ids     text[] not null,
  channel       text not null default 'stable' check (channel in ('stable', 'beta')),
  status        text not null default 'draft' check (status in ('draft', 'published', 'deprecated')),
  -- {"app":{"path":..,"size":..,"sha256":..,"offset":131072}, "bootloader":{..}, "partition_table":{..}, "ota_data":{..}}
  files         jsonb not null default '{}'::jsonb,
  app_size      int,
  notes         text,
  is_mock_build boolean not null default false,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  published_at  timestamptz,
  unique (family, version, flash_size_mb),
  -- Mock-CSI builds must never be published (CLAUDE.md firmware release rule).
  constraint firmware_no_mock_publish check (not (is_mock_build and status = 'published'))
);

alter table public.devices
  add constraint devices_firmware_release_fk foreign key (firmware_release_id)
  references public.firmware_releases(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Commands executed by gateways (pulled on heartbeat)
-- ---------------------------------------------------------------------------
create table public.device_commands (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references public.devices(id) on delete cascade,
  gateway_id    uuid not null references public.devices(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete cascade,
  property_id   uuid references public.properties(id) on delete cascade,
  command_type  text not null check (command_type in ('ota_update', 'probe_node', 'restart_agent')),
  payload       jsonb not null default '{}'::jsonb,
  status        public.command_status not null default 'queued',
  attempts      int not null default 0,
  requested_by  uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  dispatched_at timestamptz,
  completed_at  timestamptz,
  expires_at    timestamptz not null default now() + interval '24 hours',
  result        jsonb,
  error         text
);
create index device_commands_gateway_pending_idx on public.device_commands(gateway_id, created_at)
  where status in ('queued', 'dispatched');
create index device_commands_device_idx on public.device_commands(device_id, created_at desc);
create index device_commands_client_idx on public.device_commands(client_id);
create trigger device_commands_client before insert on public.device_commands
  for each row execute function private.set_client_from_property();

-- ---------------------------------------------------------------------------
-- Installations (guided wizard state)
-- ---------------------------------------------------------------------------
create table public.installations (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete cascade,
  status        public.installation_status not null default 'draft',
  technician_id uuid references public.profiles(id) on delete set null,
  scheduled_for timestamptz,
  started_at    timestamptz,
  completed_at  timestamptz,
  current_step  text not null default 'survey',
  steps         jsonb not null default '{}'::jsonb,  -- {"survey":{"done":true,"at":..}, ...}
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index installations_property_idx on public.installations(property_id);
create index installations_client_idx on public.installations(client_id);
create index installations_status_idx on public.installations(status);
create trigger installations_client before insert or update of property_id on public.installations
  for each row execute function private.set_client_from_property();
create trigger installations_touch before update on public.installations
  for each row execute function private.touch_updated_at();
