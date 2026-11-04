begin;
\ir fixtures.sql
-- quiet hours covering the whole day (00:00-23:59) for alice
insert into public.notification_preferences (user_id, client_id, quiet_hours)
values ('00000000-0000-0000-0000-0000000000b1', '0000000c-0000-0000-0000-00000000000a', '{"start":"00:00","end":"23:59"}');
-- bob muted device_offline
insert into public.notification_preferences (user_id, client_id, muted_event_types, email_enabled)
values ('00000000-0000-0000-0000-0000000000b2', '0000000c-0000-0000-0000-00000000000a', array['device_offline'], false);

select private.emit_event('0000000c-0000-0000-0000-00000000000a', '0000000b-0000-0000-0000-00000000000a', 'device_offline', 'Sensor offline: x', null);
select test.ok((select count(*) = 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and channel = 'in_app'), 'in-app delivered during quiet hours');
select test.ok((select count(*) = 0 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b1' and channel = 'email'), 'non-critical email suppressed in quiet hours');
select test.ok((select count(*) = 0 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b2'), 'muted type suppressed for bob');

select private.emit_event('0000000c-0000-0000-0000-00000000000a', '0000000b-0000-0000-0000-00000000000a', 'fall_detected', 'Fall', null);
select test.ok((select count(*) = 1 from public.notifications n join public.events e on e.id = n.event_id
                where n.user_id = '00000000-0000-0000-0000-0000000000b1' and n.channel = 'email' and e.event_type = 'fall_detected'), 'critical email bypasses quiet hours');
select test.ok((select count(*) = 0 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b2' and channel = 'email'), 'email disabled for bob');

-- client-defined rule: presence in Bedroom at night only
insert into public.alert_rules (client_id, property_id, room_id, event_type, schedule, channels)
values ('0000000c-0000-0000-0000-00000000000a', '0000000b-0000-0000-0000-00000000000a', '00000001-0000-0000-0000-0000000000a2', 'presence_detected',
        jsonb_build_object('start', to_char((now() at time zone 'Africa/Johannesburg') - interval '1 hour', 'HH24:MI'),
                           'end',   to_char((now() at time zone 'Africa/Johannesburg') + interval '1 hour', 'HH24:MI')), array['in_app']);
select private.emit_event('0000000c-0000-0000-0000-00000000000a', '0000000b-0000-0000-0000-00000000000a', 'presence_detected', 'Presence: Bedroom', null, '{}', '00000001-0000-0000-0000-0000000000a2');
select private.emit_event('0000000c-0000-0000-0000-00000000000a', '0000000b-0000-0000-0000-00000000000a', 'presence_detected', 'Presence: Living', null, '{}', '00000001-0000-0000-0000-0000000000a1');
select test.ok((select count(*) = 2 from public.notifications where title = 'Presence: Bedroom' and channel = 'in_app'), 'room-scoped rule notifies');
select test.ok((select count(*) = 0 from public.notifications where title = 'Presence: Living'), 'rule does not leak to other rooms');
select test.ok((select count(*) = 0 from public.notifications where title = 'Presence: Bedroom' and channel = 'email'), 'rule channels respected');

-- schedule window helper
select test.ok(private.in_window('{"start":"22:00","end":"06:00"}', 'UTC', '2026-01-05 23:00:00+00'), 'overnight window late');
select test.ok(private.in_window('{"start":"22:00","end":"06:00"}', 'UTC', '2026-01-06 05:00:00+00'), 'overnight window early');
select test.ok(not private.in_window('{"start":"22:00","end":"06:00"}', 'UTC', '2026-01-06 12:00:00+00'), 'outside overnight window');
select test.ok(not private.in_window('{"start":"22:00","end":"06:00","days":[1]}', 'UTC', '2026-01-07 05:00:00+00'), 'overnight window day-of-week anchored to start day');
select test.ok(private.in_window('{"start":"22:00","end":"06:00","days":[1]}', 'UTC', '2026-01-06 05:00:00+00'), 'Monday night window includes Tuesday 05:00');

-- users can only mark their own notifications read and only read_at
select test.login('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
update public.notifications set read_at = now();
select test.fails($$update public.notifications set title = 'x'$$, 'only read_at is updatable');
select test.ok((select count(*) = 0 from public.notifications where user_id <> '00000000-0000-0000-0000-0000000000b1'), 'cannot see others notifications');
select test.fails($$insert into public.notification_preferences (user_id, client_id) values ('00000000-0000-0000-0000-0000000000b1', '0000000c-0000-0000-0000-00000000000b')$$, 'cannot set prefs for foreign client');
reset role;
select test.ok((select count(*) = 0 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b2' and read_at is not null), 'bob notifications untouched');

-- dispatcher claim
select test.service();
set local role service_role;
create temp table c as select * from public.claim_pending_notifications(10);
reset role;
select test.ok((select count(*) >= 1 from c) and (select bool_and(status = 'sending') from c), 'dispatcher claims pending emails');
rollback;
