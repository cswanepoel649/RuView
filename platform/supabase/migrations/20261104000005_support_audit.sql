-- =============================================================================
-- 0005 support tickets & audit log
-- =============================================================================

create table public.support_tickets (
  id           uuid primary key default gen_random_uuid(),
  reference    bigint generated always as identity unique,
  client_id    uuid not null references public.clients(id) on delete cascade,
  property_id  uuid references public.properties(id) on delete set null,
  device_id    uuid references public.devices(id) on delete set null,
  opened_by    uuid references public.profiles(id) on delete set null,
  assigned_to  uuid references public.profiles(id) on delete set null,
  category     text not null default 'device' check (category in ('device', 'alert', 'installation', 'account', 'other')),
  priority     text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  subject      text not null check (length(trim(subject)) between 3 and 200),
  description  text not null check (length(description) <= 10000),
  status       public.ticket_status not null default 'open',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index support_tickets_client_idx on public.support_tickets(client_id, created_at desc);
create index support_tickets_status_idx on public.support_tickets(status) where status not in ('resolved', 'closed');
create trigger support_tickets_touch before update on public.support_tickets
  for each row execute function private.touch_updated_at();

create or replace function private.support_tickets_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.property_id is not null and not exists (
      select 1 from public.properties p where p.id = new.property_id and p.client_id = new.client_id) then
    raise exception 'property does not belong to client' using errcode = '23514';
  end if;
  if new.device_id is not null and not exists (
      select 1 from public.devices d where d.id = new.device_id and d.client_id = new.client_id) then
    raise exception 'device does not belong to client' using errcode = '23514';
  end if;
  -- Clients cannot self-assign, escalate status, or change ownership fields.
  if not (private.is_staff() or private.is_privileged()) then
    if tg_op = 'INSERT' then
      new.opened_by := auth.uid();
      new.assigned_to := null;
      new.status := 'open';
      if new.priority = 'urgent' then new.priority := 'high'; end if;
    else
      new.client_id := old.client_id;
      new.opened_by := old.opened_by;
      new.assigned_to := old.assigned_to;
      new.priority := old.priority;
      -- Clients may only close or re-open their tickets.
      if new.status not in ('closed', 'open') then new.status := old.status; end if;
    end if;
  end if;
  if new.status in ('resolved', 'closed') and new.resolved_at is null then
    new.resolved_at := now();
  end if;
  return new;
end $$;
create trigger support_tickets_validate before insert or update on public.support_tickets
  for each row execute function private.support_tickets_validate();

create table public.ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  body        text not null check (length(trim(body)) between 1 and 10000),
  internal    boolean not null default false,   -- staff-only note
  created_at  timestamptz not null default now()
);
create index ticket_messages_ticket_idx on public.ticket_messages(ticket_id, created_at);

create or replace function private.ticket_messages_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select t.client_id into new.client_id from public.support_tickets t where t.id = new.ticket_id;
  if new.client_id is null then
    raise exception 'ticket not found' using errcode = '23503';
  end if;
  if not (private.is_staff() or private.is_privileged()) then
    new.author_id := auth.uid();
    new.internal := false;
  end if;
  return new;
end $$;
create trigger ticket_messages_validate before insert on public.ticket_messages
  for each row execute function private.ticket_messages_validate();

-- Raise a 'problem_reported' timeline event for staff visibility.
create or replace function private.support_ticket_event()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.events (client_id, property_id, device_id, event_type, severity, title, message, data, actor_id)
  values (new.client_id, new.property_id, new.device_id, 'problem_reported', 'info',
          'Problem reported: ' || new.subject, left(new.description, 500),
          jsonb_build_object('ticket_id', new.id, 'reference', new.reference), new.opened_by);
  return null;
end $$;
create trigger support_tickets_event after insert on public.support_tickets
  for each row execute function private.support_ticket_event();

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_type  text not null default 'user' check (actor_type in ('user', 'gateway', 'system')),
  client_id   uuid,
  entity_type text not null,
  entity_id   text,
  action      text not null,
  changes     jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_client_idx on public.audit_log(client_id, created_at desc);
create index audit_log_entity_idx on public.audit_log(entity_type, entity_id, created_at desc);
create index audit_log_time_idx on public.audit_log(created_at desc);

create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_changes jsonb;
  v_client uuid;
  v_id text;
  k text;
begin
  if tg_op = 'UPDATE' then
    v_changes := '{}'::jsonb;
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at', 'last_seen_at', 'health', 'last_rssi', 'last_ip')
         and (v_new -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  else
    v_changes := coalesce(v_new, v_old);
  end if;
  -- never persist secrets in the audit trail
  v_changes := v_changes - 'token_hash' - 'code_hash' - 'ota_psk_ciphertext';
  v_client := coalesce((coalesce(v_new, v_old) ->> 'client_id')::uuid,
                       case when tg_table_name = 'clients' then (coalesce(v_new, v_old) ->> 'id')::uuid end);
  v_id := coalesce(v_new, v_old) ->> 'id';
  if v_id is null and tg_table_name = 'client_members' then
    v_id := (coalesce(v_new, v_old) ->> 'client_id') || ':' || (coalesce(v_new, v_old) ->> 'user_id');
  end if;
  insert into public.audit_log (actor_id, actor_type, client_id, entity_type, entity_id, action, changes)
  values (auth.uid(), case when auth.uid() is null then 'system' else 'user' end,
          v_client, tg_table_name, v_id, lower(tg_op), v_changes);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['clients', 'client_members', 'client_contacts', 'properties', 'floors', 'rooms',
                           'security_zones', 'devices', 'firmware_releases', 'device_commands',
                           'installations', 'alert_rules', 'profiles'] loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function private.audit_row()', t || '_audit', t);
  end loop;
end $$;
