begin;
\ir fixtures.sql

-- ---------------------------------------------------------------- ingest basics
select test.service();
set local role service_role;
create temp table r as select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object(
  'samples', jsonb_build_array(
     jsonb_build_object('node_id', 1, 'observed_at', now(), 'presence', true, 'motion_level', 'present_moving',
                        'person_count', 1, 'motion_energy', 0.4, 'confidence', 0.8, 'rssi', -55, 'source', 'merged',
                        'vitals', jsonb_build_object('breathing_bpm', 14)),
     jsonb_build_object('node_id', 7, 'observed_at', now(), 'presence', true, 'source', 'edge')))) as res;
reset role;
select test.ok((select (res->>'accepted')::int = 1 from r), 'one known sample accepted');
select test.ok((select res->'unknown_nodes' = '[7]'::jsonb from r), 'unknown node reported back');
select test.ok((select status = 'online' from public.devices where id = '0000000d-0000-0000-0000-0000000000a1'), 'sensor promoted to online');
select test.ok((select occupied and not stale and person_count = 1 and motion_level = 'present_moving'
                from public.room_state where room_id = '00000001-0000-0000-0000-0000000000a1'), 'living room occupied');
select test.ok((select vitals is null from public.node_state where device_id = '0000000d-0000-0000-0000-0000000000a1'), 'vitals dropped unless wellness feature enabled');
select test.ok((select count(*) = 1 from public.events where event_type = 'presence_detected' and room_id = '00000001-0000-0000-0000-0000000000a1'), 'presence_detected event');
select test.ok((select count(*) = 0 from public.events where event_type = 'intrusion_detected'), 'no intrusion while disarmed');
select test.ok((select count(*) = 0 from public.notifications where client_id = '0000000c-0000-0000-0000-00000000000a'), 'presence does not notify without a rule');

-- gateway cannot write to another property's nodes: B gateway reporting node 1 maps to B sensor only
set local role service_role;
select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000b0', jsonb_build_object('samples', jsonb_build_array(
  jsonb_build_object('node_id', 2, 'observed_at', now(), 'presence', true, 'source', 'edge'))));
reset role;
select test.ok((select count(*) = 0 from public.node_state where device_id = '0000000d-0000-0000-0000-0000000000a2'), 'gateway B cannot inject client A node 2');

-- --------------------------------------------------------------- hysteresis
set local role service_role;
select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object('samples', jsonb_build_array(
  jsonb_build_object('node_id', 1, 'observed_at', now(), 'presence', false, 'motion_level', 'absent', 'source', 'merged'))));
reset role;
select test.ok((select occupied from public.room_state where room_id = '00000001-0000-0000-0000-0000000000a1'), 'room held occupied during clear delay');
update public.room_state set last_presence_seen_at = now() - interval '40 seconds' where room_id = '00000001-0000-0000-0000-0000000000a1';
set local role service_role;
select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object('samples', jsonb_build_array(
  jsonb_build_object('node_id', 1, 'observed_at', now(), 'presence', false, 'motion_level', 'absent', 'source', 'merged'))));
reset role;
select test.ok((select not occupied and person_count = 0 from public.room_state where room_id = '00000001-0000-0000-0000-0000000000a1'), 'room cleared after 30 s');
select test.ok((select count(*) = 1 from public.events where event_type = 'presence_cleared'), 'presence_cleared event');

-- --------------------------------------------------------------- arming + intrusion
select test.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.set_security_mode('0000000b-0000-0000-0000-00000000000a', 'armed_away');
reset role;
select test.ok((select count(*) = 1 from public.events where event_type = 'security_mode_changed' and actor_id = '00000000-0000-0000-0000-0000000000b1'), 'arming logged with actor');
select test.service();
set local role service_role;
select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object('samples', jsonb_build_array(
  jsonb_build_object('node_id', 1, 'observed_at', now(), 'presence', true, 'motion_level', 'active', 'person_count', 2, 'source', 'merged'))));
select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object('samples', jsonb_build_array(
  jsonb_build_object('node_id', 1, 'observed_at', now(), 'presence', true, 'motion_level', 'active', 'source', 'merged'))));
reset role;
select test.ok((select count(*) = 1 from public.events where event_type = 'intrusion_detected' and severity = 'critical'
                and room_id = '00000001-0000-0000-0000-0000000000a1' and zone_id is not null), 'exactly one intrusion alarm (deduped)');
select test.ok((select count(*) = 2 from public.notifications n join public.events e on e.id = n.event_id
                where e.event_type = 'intrusion_detected' and n.channel = 'in_app'), 'in-app alarm for both household members');
select test.ok((select count(*) = 2 from public.notifications n join public.events e on e.id = n.event_id
                where e.event_type = 'intrusion_detected' and n.channel = 'email' and n.status = 'pending'), 'email alarms queued');
select test.ok((select count(*) = 0 from public.notifications where client_id = '0000000c-0000-0000-0000-00000000000b'), 'client B not notified');

-- exit delay suppresses alarms right after arming
update public.properties set exit_delay_s = 60 where id = '0000000b-0000-0000-0000-00000000000a';
select test.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.set_security_mode('0000000b-0000-0000-0000-00000000000a', 'disarmed');
select public.set_security_mode('0000000b-0000-0000-0000-00000000000a', 'armed_away');
reset role;
-- push mode-change time back so the dedupe window is a new arming session, but still inside exit delay
update public.properties set security_mode_changed_at = now() - interval '10 seconds' where id = '0000000b-0000-0000-0000-00000000000a';
select test.service();
set local role service_role;
select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object('samples', jsonb_build_array(
  jsonb_build_object('node_id', 1, 'observed_at', now(), 'presence', true, 'source', 'merged'))));
reset role;
select test.ok((select count(*) = 1 from public.events where event_type = 'intrusion_detected'), 'no alarm during exit delay');
update public.properties set security_mode_changed_at = now() - interval '2 minutes' where id = '0000000b-0000-0000-0000-00000000000a';
set local role service_role;
select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object('samples', jsonb_build_array(
  jsonb_build_object('node_id', 1, 'observed_at', now(), 'presence', true, 'source', 'merged'))));
reset role;
select test.ok((select count(*) = 2 from public.events where event_type = 'intrusion_detected'), 'alarm after exit delay (new arming session)');

-- armed_home: whole-home zone (armed_away only) must not trigger
update public.properties set security_mode = 'armed_home', security_mode_changed_at = now() - interval '1 hour' where id = '0000000b-0000-0000-0000-00000000000a';
set local role service_role;
select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object('samples', jsonb_build_array(
  jsonb_build_object('node_id', 1, 'observed_at', now(), 'presence', true, 'source', 'merged'))));
reset role;
select test.ok((select count(*) = 2 from public.events where event_type = 'intrusion_detected'), 'armed_home ignores away-only zone');

-- entry delay zone on bedroom
delete from public.zone_rooms where room_id = '00000001-0000-0000-0000-0000000000a2';
insert into public.security_zones (id, property_id, client_id, name, active_modes, entry_delay_s)
  values ('0000000e-0000-0000-0000-000000000001', '0000000b-0000-0000-0000-00000000000a', '0000000c-0000-0000-0000-00000000000a', 'Entry', array['armed_away','armed_home']::public.security_mode[], 30);
insert into public.zone_rooms (zone_id, room_id, client_id) values ('0000000e-0000-0000-0000-000000000001', '00000001-0000-0000-0000-0000000000a2', '0000000c-0000-0000-0000-00000000000a');
set local role service_role;
select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object('samples', jsonb_build_array(
  jsonb_build_object('node_id', 2, 'observed_at', now(), 'presence', true, 'source', 'edge'))));
reset role;
select test.ok((select count(*) = 1 from public.pending_alarms), 'entry delay creates a pending alarm');
select test.ok((select count(*) = 1 from public.events where event_type = 'entry_delay_started'), 'entry_delay_started event');
select test.ok((select count(*) = 0 from public.events where event_type = 'intrusion_detected' and room_id = '00000001-0000-0000-0000-0000000000a2'), 'no alarm before entry delay expires');
update public.pending_alarms set fire_at = now() - interval '1 second';
set local role service_role;
select public.run_maintenance();
reset role;
select test.ok((select count(*) = 1 from public.events where event_type = 'intrusion_detected' and room_id = '00000001-0000-0000-0000-0000000000a2'), 'alarm fires when entry delay expires');
-- disarm cancels pending alarms
set local role service_role;
select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object('samples', jsonb_build_array(
  jsonb_build_object('node_id', 2, 'observed_at', now(), 'presence', true, 'source', 'edge'))));
reset role;
select test.ok((select count(*) = 1 from public.pending_alarms), 'new pending alarm');
select test.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.set_security_mode('0000000b-0000-0000-0000-00000000000a', 'disarmed');
reset role;
select test.ok((select count(*) = 0 from public.pending_alarms), 'disarm cancels pending alarms');

-- acknowledge
set local role authenticated;
select public.acknowledge_event((select id from public.events where event_type = 'intrusion_detected' order by occurred_at limit 1), 'false alarm - cat');
reset role;
select test.ok((select count(*) = 1 from public.events where acknowledged_by = '00000000-0000-0000-0000-0000000000b1'), 'event acknowledged by owner');

-- --------------------------------------------------------------- history
select test.service();
set local role service_role;
select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object('minutes', jsonb_build_array(
  jsonb_build_object('node_id', 1, 'bucket', date_trunc('minute', now()) - interval '1 minute', 'samples', 12, 'presence_ratio', 0.5, 'max_persons', 1, 'avg_motion_energy', 0.2),
  jsonb_build_object('node_id', 1, 'bucket', now() - interval '30 days', 'samples', 12, 'presence_ratio', 1))));
select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object('minutes', jsonb_build_array(
  jsonb_build_object('node_id', 1, 'bucket', date_trunc('minute', now()) - interval '1 minute', 'samples', 12, 'presence_ratio', 0.75, 'max_persons', 2))));
reset role;
select test.ok((select count(*) = 1 from public.telemetry_minutes), 'minute replay is idempotent; >7 day bucket rejected');
select test.ok((select presence_ratio = 0.75 from public.telemetry_minutes), 'replayed bucket replaced');
select test.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select test.ok((select count(*) = 1 from public.room_occupancy_hourly('0000000b-0000-0000-0000-00000000000a', now() - interval '1 day', now() + interval '1 hour')), 'owner reads hourly rollup');
reset role;
select test.login('00000000-0000-0000-0000-0000000000c1');
set local role authenticated;
select test.ok((select count(*) = 0 from public.room_occupancy_hourly('0000000b-0000-0000-0000-00000000000a', now() - interval '1 day', now() + interval '1 hour')), 'other tenant gets empty rollup');
reset role;

-- --------------------------------------------------------------- edge events
select test.service();
set local role service_role;
select public.ingest_gateway_events('0000000d-0000-0000-0000-0000000000a0', jsonb_build_array(
  jsonb_build_object('type', 'fall_detected', 'node_id', 2, 'dedupe_key', 'n2-1000'),
  jsonb_build_object('type', 'fall_detected', 'node_id', 2, 'dedupe_key', 'n2-1000'),
  jsonb_build_object('type', 'intrusion_detected', 'node_id', 2, 'dedupe_key', 'forged')));
reset role;
select test.ok((select count(*) = 1 from public.events where event_type = 'fall_detected' and severity = 'critical'), 'fall event created once');
select test.ok((select count(*) = 0 from public.events where dedupe_key like '%forged%'), 'gateway cannot forge alarm kinds');

-- --------------------------------------------------------------- heartbeat / commands
insert into public.firmware_releases (id, version, flash_size_mb, model_ids, status) values ('0000000a-0000-0000-0000-000000000001', '0.6.3', 4, array['esp32s3-4mb'], 'published');
insert into public.device_commands (id, device_id, gateway_id, property_id, command_type, payload) values
  ('0000000a-0000-0000-0000-0000000000c1', '0000000d-0000-0000-0000-0000000000a1', '0000000d-0000-0000-0000-0000000000a0', '0000000b-0000-0000-0000-00000000000a', 'ota_update', '{"release_id":"0000000a-0000-0000-0000-000000000001","version":"0.6.3"}');
select test.service();
set local role service_role;
create temp table hb as select public.gateway_heartbeat('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object(
  'agent_version', '1.0.0', 'sensing', jsonb_build_object('reachable', true, 'source', 'esp32'),
  'nodes', jsonb_build_array(
    jsonb_build_object('node_id', 1, 'ip', '192.168.1.41', 'mac', 'aa:bb:cc:00:00:01', 'firmware_version', '0.6.2'),
    jsonb_build_object('node_id', 2, 'ip', '192.168.1.42', 'mac', 'de:ad:be:ef:00:02'),
    jsonb_build_object('node_id', 9, 'ip', '192.168.1.49'))), '203.0.113.5') as res;
reset role;
select test.ok((select jsonb_array_length(res->'node_map') = 2 from hb), 'heartbeat returns node map');
select test.ok((select jsonb_array_length(res->'commands') = 1 and res->'commands'->0->>'node_ip' = '192.168.1.41' from hb), 'heartbeat dispatches OTA with node ip');
select test.ok((select status = 'dispatched' from public.device_commands where id = '0000000a-0000-0000-0000-0000000000c1'), 'command marked dispatched');
select test.ok((select count(*) = 1 from public.events where event_type = 'device_identity_mismatch'), 'MAC mismatch flagged');
select test.ok((select count(*) = 1 from public.events where event_type = 'unregistered_node'), 'unregistered node flagged');
select test.ok((select firmware_version = '0.6.2' and host(last_ip) = '192.168.1.41' from public.devices where id = '0000000d-0000-0000-0000-0000000000a1'), 'node firmware/ip recorded');
select test.ok((select host(last_ip) = '203.0.113.5' from public.devices where id = '0000000d-0000-0000-0000-0000000000a0'), 'gateway public ip recorded');
set local role service_role;
select public.gateway_complete_command('0000000d-0000-0000-0000-0000000000a0', '0000000a-0000-0000-0000-0000000000c1', true, '{"version":"0.6.3"}', null);
select test.fails($$select public.gateway_complete_command('0000000d-0000-0000-0000-0000000000b0', '0000000a-0000-0000-0000-0000000000c1', true, '{}', null)$$, 'other gateway cannot complete the command');
reset role;
select test.ok((select firmware_version = '0.6.3' and firmware_release_id is not null from public.devices where id = '0000000d-0000-0000-0000-0000000000a1'), 'OTA success updates firmware');
select test.ok((select count(*) = 1 from public.events where event_type = 'firmware_update_succeeded'), 'firmware event');

-- degraded sensing (simulated source must never count as live)
set local role service_role;
select public.gateway_heartbeat('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object('sensing', jsonb_build_object('reachable', true, 'source', 'simulated')));
reset role;
select test.ok((select count(*) = 1 from public.events where event_type = 'sensing_degraded'), 'non-esp32 source raises sensing_degraded');

-- --------------------------------------------------------------- offline detection
update public.devices set last_seen_at = now() - interval '3 minutes' where id in ('0000000d-0000-0000-0000-0000000000a0', '0000000d-0000-0000-0000-0000000000a1');
update public.node_state set received_at = now() - interval '3 minutes';
set local role service_role;
create temp table mt as select public.run_maintenance() as res;
reset role;
select test.ok((select (res->>'nodes_offline')::int = 1 and (res->>'gateways_offline')::int = 1 from mt), 'maintenance marks node and gateway offline');
select test.ok((select count(*) = 1 from public.events where event_type = 'gateway_offline' and severity = 'critical'), 'gateway_offline is critical');
select test.ok((select bool_and(stale) from public.room_state where property_id = '0000000b-0000-0000-0000-00000000000a'), 'rooms without fresh data become stale (unknown, not empty)');
select test.ok((select count(*) >= 2 from public.device_status_log where device_id = '0000000d-0000-0000-0000-0000000000a1'), 'status transitions logged');
-- back online
set local role service_role;
select public.gateway_heartbeat('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object('sensing', jsonb_build_object('reachable', true, 'source', 'esp32')));
select public.ingest_telemetry('0000000d-0000-0000-0000-0000000000a0', jsonb_build_object('samples', jsonb_build_array(
  jsonb_build_object('node_id', 1, 'observed_at', now(), 'presence', false, 'source', 'merged'))));
reset role;
select test.ok((select count(*) = 1 from public.events where event_type = 'gateway_online') and (select count(*) = 1 from public.events where event_type = 'device_online'), 'recovery events');

-- --------------------------------------------------------------- enrollment
insert into public.devices (id, kind, model_id, name, property_id, status) values
  ('0000000d-0000-0000-0000-0000000000a9', 'gateway', 'gateway-linux', 'Spare gateway', '0000000b-0000-0000-0000-00000000000a', 'assigned');
insert into public.gateway_enrollments (device_id, code_hash, expires_at) values ('0000000d-0000-0000-0000-0000000000a9', 'code-hash-1', now() + interval '1 day');
insert into public.device_credentials (device_id, token_hash, token_prefix) values ('0000000d-0000-0000-0000-0000000000a9', 'old-token', 'gw_old');
set local role service_role;
select public.gateway_enroll('code-hash-1', 'new-token', 'gw_new', 'machine-z', '{"agent_version":"1.0.0","hostname":"pi"}');
select test.fails($$select public.gateway_enroll('code-hash-1', 'another', 'gw_x', 'machine-z', '{}')$$, 'enrollment code is single-use');
select test.ok(public.gateway_authenticate('new-token') = '0000000d-0000-0000-0000-0000000000a9', 'new token authenticates');
select test.ok(public.gateway_authenticate('old-token') is null, 're-enrollment revokes old token');
select test.ok(public.gateway_authenticate('nonsense') is null, 'unknown token rejected');
reset role;
select test.ok((select status = 'online' and hw_id = 'machine-z' from public.devices where id = '0000000d-0000-0000-0000-0000000000a9'), 'enrolled gateway online with hw id');
rollback;
