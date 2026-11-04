-- =============================================================================
-- 0008 storage buckets & policies, realtime publication, scheduled jobs
-- =============================================================================

-- Telemetry partitions for the current window (cron keeps creating ahead).
select private.ensure_telemetry_partitions(3);

-- ---------------------------------------------------------------------------
-- Storage
--   floor-plans/{client_id}/{property_id}/{file}   (members read, staff write)
--   firmware/{family}/{version}/{flash}MB/{file}    (staff read, admin write)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('floor-plans', 'floor-plans', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('firmware', 'firmware', false, 8388608, array['application/octet-stream', 'application/macbinary', 'binary/octet-stream'])
on conflict (id) do nothing;

create or replace function private.storage_client_id(p_name text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return (string_to_array(p_name, '/'))[1]::uuid;
exception when others then
  return null;
end $$;
grant execute on function private.storage_client_id(text) to authenticated;

create policy floor_plans_read on storage.objects for select to authenticated
  using (bucket_id = 'floor-plans' and (select private.can_read(private.storage_client_id(name))));
create policy floor_plans_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'floor-plans' and (select private.is_staff())
              and private.storage_client_id(name) is not null);
create policy floor_plans_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'floor-plans' and (select private.is_staff()));
create policy floor_plans_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'floor-plans' and (select private.is_staff()));

create policy firmware_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'firmware' and (select private.is_staff()));
create policy firmware_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'firmware' and (select private.is_admin()));
create policy firmware_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'firmware' and (select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Realtime (postgres_changes honours RLS for the subscribing user)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.room_state, public.node_state, public.events, public.notifications, public.devices,
      public.device_commands, public.installations;
  end if;
end $$;

alter table public.room_state replica identity full;
alter table public.devices replica identity full;

-- ---------------------------------------------------------------------------
-- Scheduled jobs (pg_cron is available on Supabase; skipped where absent)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('ruview-maintenance', '* * * * *', 'select public.run_maintenance()');
    perform cron.schedule('ruview-telemetry-partitions', '0 3 * * *', 'select private.ensure_telemetry_partitions(3)');
    perform cron.schedule('ruview-telemetry-retention', '30 3 1 * *', 'select private.drop_old_telemetry_partitions(13)');
    perform cron.schedule('ruview-event-retention', '45 3 * * *',
      $job$delete from public.events where event_type in ('presence_detected', 'presence_cleared')
           and occurred_at < now() - interval '90 days'$job$);
  else
    raise notice 'pg_cron not available: schedule public.run_maintenance() via /api/cron/maintenance';
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;
