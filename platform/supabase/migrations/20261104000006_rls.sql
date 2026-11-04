-- =============================================================================
-- 0006 Row Level Security. Default-deny on every table; explicit policies only.
-- Pattern: (select fn()) so Postgres evaluates the helper once per statement.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'clients', 'client_members', 'client_contacts', 'properties', 'floors', 'rooms',
    'security_zones', 'zone_rooms', 'device_models', 'devices', 'device_status_log',
    'device_credentials', 'gateway_enrollments', 'device_secrets', 'firmware_releases',
    'device_commands', 'installations', 'node_state', 'room_state', 'telemetry_minutes',
    'event_types', 'events', 'pending_alarms', 'alert_rules', 'notification_preferences',
    'notifications', 'support_tickets', 'ticket_messages', 'audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Anonymous users get nothing from the data API.
revoke usage on schema private from anon;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid())
         or (select private.is_staff())
         -- household members can see each other's names
         or exists (select 1 from public.client_members me
                    join public.client_members other on other.client_id = me.client_id
                    where me.user_id = (select auth.uid()) and other.user_id = profiles.id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()))
  with check (id = (select auth.uid()) or (select private.is_admin()));

-- ---------------------------------------------------------------------------
-- clients / membership / contacts
-- ---------------------------------------------------------------------------
create policy clients_select on public.clients for select to authenticated
  using ((select private.is_staff()) or (select private.is_member(id)));
create policy clients_admin_write on public.clients for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy client_members_select on public.client_members for select to authenticated
  using ((select private.is_staff()) or (select private.is_member(client_id)));
create policy client_members_admin_write on public.client_members for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy client_contacts_select on public.client_contacts for select to authenticated
  using ((select private.can_read(client_id)));
create policy client_contacts_write on public.client_contacts for all to authenticated
  using ((select private.is_staff()) or (select private.is_owner(client_id)))
  with check ((select private.is_staff()) or (select private.is_owner(client_id)));

-- ---------------------------------------------------------------------------
-- properties, floors, rooms (structure is staff-managed; clients read)
-- ---------------------------------------------------------------------------
create policy properties_select on public.properties for select to authenticated
  using ((select private.can_read(client_id)));
create policy properties_staff_insert on public.properties for insert to authenticated
  with check ((select private.is_staff()));
create policy properties_staff_update on public.properties for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy properties_admin_delete on public.properties for delete to authenticated
  using ((select private.is_admin()));

create policy floors_select on public.floors for select to authenticated
  using ((select private.can_read(client_id)));
create policy floors_staff_write on public.floors for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

create policy rooms_select on public.rooms for select to authenticated
  using ((select private.can_read(client_id)));
create policy rooms_staff_write on public.rooms for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- ---------------------------------------------------------------------------
-- security zones: clients (owner/member) configure their own
-- ---------------------------------------------------------------------------
create policy security_zones_select on public.security_zones for select to authenticated
  using ((select private.can_read(client_id)));
create policy security_zones_write on public.security_zones for all to authenticated
  using ((select private.is_staff()) or (select private.can_operate(client_id)))
  with check ((select private.is_staff())
              or exists (select 1 from public.properties p
                         where p.id = property_id and private.can_operate(p.client_id)));

create policy zone_rooms_select on public.zone_rooms for select to authenticated
  using ((select private.can_read(client_id)));
create policy zone_rooms_write on public.zone_rooms for all to authenticated
  using ((select private.is_staff()) or (select private.can_operate(client_id)))
  with check ((select private.is_staff())
              or exists (select 1 from public.security_zones z
                         where z.id = zone_id and private.can_operate(z.client_id)));

-- ---------------------------------------------------------------------------
-- hardware
-- ---------------------------------------------------------------------------
create policy device_models_select on public.device_models for select to authenticated using (true);
create policy device_models_admin_write on public.device_models for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy devices_select on public.devices for select to authenticated
  using ((select private.is_staff()) or (client_id is not null and (select private.is_member(client_id))));
create policy devices_staff_write on public.devices for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

create policy device_status_log_select on public.device_status_log for select to authenticated
  using ((select private.is_staff()) or (client_id is not null and (select private.is_member(client_id))));

-- Credential metadata visible to staff (token_hash is never selected by the app; column revoked below).
create policy device_credentials_staff_select on public.device_credentials for select to authenticated
  using ((select private.is_staff()));
create policy device_credentials_staff_revoke on public.device_credentials for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
-- Column privileges: table-level grants would override column revokes, so revoke
-- the table grant and re-grant only the non-secret columns.
revoke select, insert, update, delete on public.device_credentials from authenticated;
grant select (id, device_id, token_prefix, created_by, created_at, last_used_at, revoked_at)
  on public.device_credentials to authenticated;
grant update (revoked_at) on public.device_credentials to authenticated;

create policy gateway_enrollments_staff_select on public.gateway_enrollments for select to authenticated
  using ((select private.is_staff()));
revoke select, insert, update, delete on public.gateway_enrollments from authenticated;
grant select (id, device_id, expires_at, used_at, created_by, created_at)
  on public.gateway_enrollments to authenticated;
revoke all on public.device_secrets from authenticated;
-- device_secrets: NO policies → service role only.

create policy firmware_releases_staff_select on public.firmware_releases for select to authenticated
  using ((select private.is_staff()));
create policy firmware_releases_admin_write on public.firmware_releases for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy device_commands_staff on public.device_commands for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

create policy installations_select on public.installations for select to authenticated
  using ((select private.can_read(client_id)));
create policy installations_staff_write on public.installations for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- ---------------------------------------------------------------------------
-- monitoring: read-only for tenants; writes via service role functions
-- ---------------------------------------------------------------------------
create policy node_state_select on public.node_state for select to authenticated
  using ((select private.can_read(client_id)));
create policy room_state_select on public.room_state for select to authenticated
  using ((select private.can_read(client_id)));
create policy telemetry_minutes_select on public.telemetry_minutes for select to authenticated
  using ((select private.can_read(client_id)));
create policy event_types_select on public.event_types for select to authenticated using (true);
create policy events_select on public.events for select to authenticated
  using ((select private.can_read(client_id)));
create policy pending_alarms_select on public.pending_alarms for select to authenticated
  using ((select private.can_read(client_id)));

create policy alert_rules_select on public.alert_rules for select to authenticated
  using ((select private.can_read(client_id)));
create policy alert_rules_write on public.alert_rules for all to authenticated
  using ((select private.is_staff()) or (select private.can_operate(client_id)))
  with check ((select private.is_staff()) or (select private.can_operate(client_id)));

create policy notification_preferences_own on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select private.is_member(client_id)));
create policy notification_preferences_staff_select on public.notification_preferences for select to authenticated
  using ((select private.is_staff()));

create policy notifications_own_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_own_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- support
-- ---------------------------------------------------------------------------
create policy support_tickets_select on public.support_tickets for select to authenticated
  using ((select private.can_read(client_id)));
create policy support_tickets_client_insert on public.support_tickets for insert to authenticated
  with check ((select private.is_staff()) or (select private.can_operate(client_id)));
create policy support_tickets_update on public.support_tickets for update to authenticated
  using ((select private.is_staff()) or (select private.can_operate(client_id)))
  with check ((select private.is_staff()) or (select private.can_operate(client_id)));

create policy ticket_messages_select on public.ticket_messages for select to authenticated
  using ((select private.is_staff()) or ((select private.is_member(client_id)) and not internal));
create policy ticket_messages_insert on public.ticket_messages for insert to authenticated
  with check ((select private.is_staff()) or ((select private.can_operate(client_id)) and not internal));

create policy audit_log_admin_select on public.audit_log for select to authenticated
  using ((select private.is_admin()));

-- Telemetry/state tables are written only by service-role functions.
revoke insert, update, delete on public.node_state, public.room_state, public.telemetry_minutes,
  public.pending_alarms, public.device_status_log, public.audit_log, public.event_types
  from authenticated;
revoke insert, update, delete on public.events from authenticated;

-- Functions are EXECUTE-able by PUBLIC by default; lock everything down, then
-- grant only the RLS helpers needed inside policies.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_staff(), private.is_admin(), private.is_member(uuid), private.member_role(uuid),
  private.can_operate(uuid), private.is_owner(uuid), private.can_read(uuid), private.is_privileged()
  to authenticated;
grant execute on all functions in schema private to service_role;
