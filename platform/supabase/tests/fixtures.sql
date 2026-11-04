-- Shared fixtures for database tests (run as superuser inside a transaction).
create schema if not exists test;
grant usage on schema test to anon, authenticated, service_role;

create or replace function test.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'ASSERTION FAILED: %', p_msg;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

-- Expect a statement to fail (e.g. RLS violation / permission denied)
create or replace function test.fails(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok - % (rejected: %)', p_msg, sqlstate;
    return;
  end;
  raise exception 'ASSERTION FAILED (statement succeeded): %', p_msg;
end $$;

create or replace function test.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create or replace function test.service() returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
$$;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- Users ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@ops.test',     '{"full_name":"Ada Admin"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'tech@ops.test',      '{"full_name":"Ian Installer"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'alice@client-a.test','{"full_name":"Alice Owner"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'bob@client-a.test',  '{"full_name":"Bob Viewer"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'carol@client-b.test','{"full_name":"Carol Owner"}'),
  ('00000000-0000-0000-0000-0000000000d1', 'nobody@x.test',      '{}');
update public.profiles set platform_role = 'platform_admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set platform_role = 'installer'      where id = '00000000-0000-0000-0000-0000000000a2';

-- Tenants -------------------------------------------------------------------
insert into public.clients (id, display_name, primary_email) values
  ('0000000c-0000-0000-0000-00000000000a', 'Client A household', 'alice@client-a.test'),
  ('0000000c-0000-0000-0000-00000000000b', 'Client B household', 'carol@client-b.test');
insert into public.client_members (client_id, user_id, role) values
  ('0000000c-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'owner'),
  ('0000000c-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b2', 'viewer'),
  ('0000000c-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c1', 'owner');

insert into public.properties (id, client_id, name, timezone, exit_delay_s) values
  ('0000000b-0000-0000-0000-00000000000a', '0000000c-0000-0000-0000-00000000000a', 'A Home', 'Africa/Johannesburg', 0),
  ('0000000b-0000-0000-0000-00000000000b', '0000000c-0000-0000-0000-00000000000b', 'B Home', 'Europe/London', 0);

insert into public.floors (id, property_id, client_id, name, level) values
  ('0000000f-0000-0000-0000-00000000000a', '0000000b-0000-0000-0000-00000000000a', '0000000c-0000-0000-0000-00000000000b', 'Ground', 0);
-- note: deliberately wrong client_id above; trigger must correct it.

insert into public.rooms (id, property_id, client_id, floor_id, name, room_type) values
  ('00000001-0000-0000-0000-0000000000a1', '0000000b-0000-0000-0000-00000000000a', '0000000c-0000-0000-0000-00000000000a', '0000000f-0000-0000-0000-00000000000a', 'Living', 'living'),
  ('00000001-0000-0000-0000-0000000000a2', '0000000b-0000-0000-0000-00000000000a', '0000000c-0000-0000-0000-00000000000a', '0000000f-0000-0000-0000-00000000000a', 'Bedroom', 'bedroom'),
  ('00000001-0000-0000-0000-0000000000b1', '0000000b-0000-0000-0000-00000000000b', '0000000c-0000-0000-0000-00000000000b', null, 'Lounge', 'living');

-- Devices -------------------------------------------------------------------
insert into public.devices (id, kind, model_id, name, property_id, status, hw_id) values
  ('0000000d-0000-0000-0000-0000000000a0', 'gateway', 'gateway-rpi', 'A gateway', '0000000b-0000-0000-0000-00000000000a', 'online', 'machine-a'),
  ('0000000d-0000-0000-0000-0000000000b0', 'gateway', 'gateway-rpi', 'B gateway', '0000000b-0000-0000-0000-00000000000b', 'online', 'machine-b');
insert into public.devices (id, kind, model_id, name, property_id, room_id, gateway_id, node_id, status, hw_id) values
  ('0000000d-0000-0000-0000-0000000000a1', 'sensor_node', 'esp32s3-8mb', 'Living sensor', '0000000b-0000-0000-0000-00000000000a', '00000001-0000-0000-0000-0000000000a1', '0000000d-0000-0000-0000-0000000000a0', 1, 'provisioned', 'aa:bb:cc:00:00:01'),
  ('0000000d-0000-0000-0000-0000000000a2', 'sensor_node', 'esp32s3-8mb', 'Bedroom sensor', '0000000b-0000-0000-0000-00000000000a', '00000001-0000-0000-0000-0000000000a2', '0000000d-0000-0000-0000-0000000000a0', 2, 'provisioned', 'aa:bb:cc:00:00:02'),
  ('0000000d-0000-0000-0000-0000000000b1', 'sensor_node', 'esp32s3-4mb', 'Lounge sensor', '0000000b-0000-0000-0000-00000000000b', '00000001-0000-0000-0000-0000000000b1', '0000000d-0000-0000-0000-0000000000b0', 1, 'provisioned', 'aa:bb:cc:00:00:b1');
insert into public.device_secrets (device_id, ota_psk_ciphertext) values ('0000000d-0000-0000-0000-0000000000a1', 'secret-ciphertext');
insert into public.device_credentials (device_id, token_hash, token_prefix) values ('0000000d-0000-0000-0000-0000000000a0', 'hash-a', 'gw_aaaa');
insert into public.events (client_id, property_id, event_type, severity, title) values
  ('0000000c-0000-0000-0000-00000000000b', '0000000b-0000-0000-0000-00000000000b', 'presence_detected', 'info', 'B private event');
