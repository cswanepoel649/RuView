begin;
\ir fixtures.sql

-- trigger-derived tenancy
select test.ok((select client_id from public.floors where id = '0000000f-0000-0000-0000-00000000000a') = '0000000c-0000-0000-0000-00000000000a',
               'floor client_id derived from property, not caller');
select test.ok((select client_id from public.devices where id = '0000000d-0000-0000-0000-0000000000a1') = '0000000c-0000-0000-0000-00000000000a',
               'device client_id derived from property');
select test.ok((select count(*) from public.room_state) = 3, 'room_state initialised for each room');
select test.ok((select count(*) from public.alert_rules where property_id = '0000000b-0000-0000-0000-00000000000a') >= 5, 'default alert rules seeded');
select test.ok((select count(*) from public.zone_rooms zr join public.security_zones z on z.id = zr.zone_id
                where z.property_id = '0000000b-0000-0000-0000-00000000000a') = 2, 'rooms auto-included in default zone');

-- ===== Alice (client A owner) =====
select test.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select test.ok((select count(*) from public.clients) = 1, 'alice sees exactly one client');
select test.ok((select count(*) from public.clients where id = '0000000c-0000-0000-0000-00000000000b') = 0, 'alice cannot see client B');
select test.ok((select count(*) from public.properties) = 1, 'alice sees only her property');
select test.ok((select count(*) from public.rooms) = 2, 'alice sees only her rooms');
select test.ok((select count(*) from public.devices) = 3, 'alice sees her gateway + 2 sensors');
select test.ok((select count(*) from public.room_state) = 2, 'alice sees only her room_state');
select test.ok((select count(*) from public.events where client_id = '0000000c-0000-0000-0000-00000000000b') = 0, 'alice cannot read B events');
select test.ok((select count(*) from public.profiles) = 2, 'alice sees herself and her household only');
select test.ok((select count(*) from public.device_models) >= 6, 'device catalog readable');
select test.ok((select count(*) from public.firmware_releases) = 0, 'firmware not visible to clients');
select test.ok((select count(*) from public.device_commands) = 0, 'commands not visible to clients');
select test.ok((select count(*) from public.audit_log) = 0, 'audit log not visible to clients');
select test.fails($$select * from public.device_secrets$$, 'device secrets unreadable');
select test.fails($$select token_hash from public.device_credentials$$, 'token hashes unreadable');
select test.fails($$insert into public.properties (client_id, name) values ('0000000c-0000-0000-0000-00000000000a', 'x')$$, 'client cannot create properties');
select test.fails($$insert into public.events (client_id, event_type, severity, title) values ('0000000c-0000-0000-0000-00000000000a', 'intrusion_detected', 'critical', 'fake')$$, 'client cannot forge events');
select test.fails($$update public.room_state set occupied = true$$, 'client cannot write room state');
select test.fails($$insert into public.node_state (device_id, client_id, property_id, source, observed_at) values ('0000000d-0000-0000-0000-0000000000a1','0000000c-0000-0000-0000-00000000000a','0000000b-0000-0000-0000-00000000000a','edge',now())$$, 'client cannot write node state');
-- updates on rows outside tenant silently affect 0 rows
update public.devices set name = 'pwned' where id = '0000000d-0000-0000-0000-0000000000b1';
select test.fails($$update public.profiles set platform_role = 'platform_admin' where id = '00000000-0000-0000-0000-0000000000b1'$$, 'alice cannot self-promote');
-- owner can create a security zone in her property, not in B
insert into public.security_zones (property_id, client_id, name, active_modes)
  values ('0000000b-0000-0000-0000-00000000000a', '0000000c-0000-0000-0000-00000000000a', 'Night', array['armed_home']::public.security_mode[]);
select test.fails($$insert into public.security_zones (property_id, client_id, name) values ('0000000b-0000-0000-0000-00000000000b', '0000000c-0000-0000-0000-00000000000a', 'evil')$$, 'alice cannot create zones in B property');
select test.fails($$insert into public.zone_rooms (zone_id, room_id, client_id) select z.id, '00000001-0000-0000-0000-0000000000b1', '0000000c-0000-0000-0000-00000000000a' from public.security_zones z where z.name = 'Night'$$, 'alice cannot add B room to her zone');
-- tickets
insert into public.support_tickets (client_id, property_id, subject, description, status, priority)
  values ('0000000c-0000-0000-0000-00000000000a', '0000000b-0000-0000-0000-00000000000a', 'Sensor flashing', 'The bedroom sensor seems offline', 'resolved', 'urgent');
select test.ok((select status = 'open' and priority = 'high' and opened_by = '00000000-0000-0000-0000-0000000000b1' from public.support_tickets limit 1),
               'client ticket fields are sanitised by trigger');
select test.fails($$insert into public.support_tickets (client_id, subject, description) values ('0000000c-0000-0000-0000-00000000000b', 'x x x', 'y')$$, 'alice cannot open tickets for client B');
-- RPC authorisation
select test.ok((select security_mode = 'armed_away' from public.set_security_mode('0000000b-0000-0000-0000-00000000000a', 'armed_away')), 'owner can arm her property');
select test.fails($$select public.set_security_mode('0000000b-0000-0000-0000-00000000000b', 'disarmed')$$, 'owner cannot disarm another client property');
select test.fails($$select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000a0', '{}'::jsonb)$$, 'clients cannot call ingest');
select test.fails($$select public.run_maintenance()$$, 'clients cannot call maintenance');
select test.fails($$select public.allocate_node_id('0000000d-0000-0000-0000-0000000000a0')$$, 'clients cannot allocate node ids');
reset role;
select test.ok((select name from public.devices where id = '0000000d-0000-0000-0000-0000000000b1') = 'Lounge sensor', 'cross-tenant update had no effect');

-- ===== Bob (client A viewer) =====
select test.login('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select test.ok((select count(*) from public.properties) = 1, 'viewer can read property');
select test.fails($$select public.set_security_mode('0000000b-0000-0000-0000-00000000000a', 'disarmed')$$, 'viewer cannot disarm');
select test.fails($$insert into public.security_zones (property_id, client_id, name) values ('0000000b-0000-0000-0000-00000000000a', '0000000c-0000-0000-0000-00000000000a', 'v')$$, 'viewer cannot create zones');
select test.fails($$insert into public.support_tickets (client_id, subject, description) values ('0000000c-0000-0000-0000-00000000000a', 'viewer ticket', 'y')$$, 'viewer cannot open tickets');
reset role;

-- ===== Carol (client B) =====
select test.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select test.ok((select count(*) from public.properties) = 1 and (select name from public.properties) = 'B Home', 'carol sees only B Home');
select test.ok((select count(*) from public.support_tickets) = 0, 'carol cannot see client A tickets');
select test.ok((select count(*) from public.events) = 1, 'carol sees only her events');
reset role;

-- ===== Nobody (authenticated, no membership) =====
select test.login('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select test.ok((select count(*) from public.clients) + (select count(*) from public.properties)
             + (select count(*) from public.devices) + (select count(*) from public.events) = 0, 'unaffiliated user sees nothing');
reset role;

-- ===== anon =====
set local role anon;
select test.fails($$select * from public.clients$$, 'anon has no table access');
reset role;

-- ===== Installer =====
select test.login('00000000-0000-0000-0000-0000000000a2');
set local role authenticated;
select test.ok((select count(*) from public.clients) = 2, 'installer reads all clients');
select test.fails($$insert into public.clients (display_name) values ('rogue')$$, 'installer cannot create clients');
insert into public.rooms (property_id, client_id, name) values ('0000000b-0000-0000-0000-00000000000b', '0000000c-0000-0000-0000-00000000000b', 'Kitchen');
select test.ok((select public.allocate_node_id('0000000d-0000-0000-0000-0000000000a0')) = 3, 'installer allocates next free node id');
select test.fails($$insert into public.firmware_releases (version, flash_size_mb, model_ids) values ('9.9.9', 8, array['esp32s3-8mb'])$$, 'installer cannot create firmware');
select test.ok((select count(*) from public.audit_log) = 0, 'installer cannot read audit log');
reset role;

-- ===== Admin =====
select test.login('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select test.ok((select count(*) from public.audit_log) > 0, 'admin reads audit log');
insert into public.firmware_releases (version, flash_size_mb, model_ids) values ('0.6.2', 8, array['esp32s3-8mb']);
select test.fails($$insert into public.firmware_releases (version, flash_size_mb, model_ids, is_mock_build, status) values ('0.6.3', 8, array['esp32s3-8mb'], true, 'published')$$, 'mock firmware cannot be published');
select test.fails($$select * from public.device_secrets$$, 'even admins cannot read device secrets via API');
reset role;

-- integrity guards
select test.fails($$update public.properties set client_id = '0000000c-0000-0000-0000-00000000000b' where id = '0000000b-0000-0000-0000-00000000000a'$$, 'property cannot move between clients');
select test.fails($$insert into public.devices (kind, model_id, name, property_id, room_id) values ('sensor_node', 'esp32s3-8mb', 'x', '0000000b-0000-0000-0000-00000000000a', '00000001-0000-0000-0000-0000000000b1')$$, 'device room must belong to device property');
select test.fails($$insert into public.devices (kind, model_id, name, property_id, gateway_id, node_id) values ('sensor_node', 'esp32s3-8mb', 'x', '0000000b-0000-0000-0000-00000000000b', '0000000d-0000-0000-0000-0000000000a0', 9)$$, 'sensor gateway must be at same property');
select test.fails($$insert into public.devices (kind, model_id, name, property_id, gateway_id, node_id) values ('sensor_node', 'esp32s3-8mb', 'dup', '0000000b-0000-0000-0000-00000000000a', '0000000d-0000-0000-0000-0000000000a0', 1)$$, 'node_id unique per gateway');
select test.fails($$insert into public.devices (kind, model_id, name) values ('sensor_node', 'gateway-rpi', 'x')$$, 'model kind must match device kind');
select test.fails($$insert into public.properties (client_id, name, timezone) values ('0000000c-0000-0000-0000-00000000000a', 'tz', 'Mars/Olympus')$$, 'invalid timezone rejected');
rollback;
