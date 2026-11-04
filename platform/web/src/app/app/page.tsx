import Link from 'next/link';
import { ShieldAlert, Users, WifiOff } from 'lucide-react';
import { Badge, Card, EmptyState, PageHeader, StatusDot } from '@/components/ui';
import { ModeBadge } from '@/components/monitoring/badges';
import { requireClientUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatAddress, timeAgo } from '@/lib/format';
import type { Device, EventRow, Property, RoomState } from '@/lib/types';

export const metadata = { title: 'My properties' };

export default async function ClientHome() {
  const s = await requireClientUser();
  const db = await createClient();
  const [{ data: props }, { data: states }, { data: devices }, { data: alerts }] = await Promise.all([
    db.from('properties').select('*').neq('status', 'archived').order('name'),
    db.from('room_state').select('*'),
    db.from('devices').select('id, property_id, kind, status'),
    db.from('events').select('*').eq('severity', 'critical').is('resolved_at', null).order('occurred_at', { ascending: false }).limit(20),
  ]);
  const properties = (props ?? []) as Property[];
  return (
    <>
      <PageHeader title={`Welcome${s.profile.full_name ? `, ${s.profile.full_name.split(' ')[0]}` : ''}`} subtitle="Your monitored properties at a glance." />
      {properties.length === 0 ? <Card><EmptyState title="No properties yet.">Your installer is setting things up.</EmptyState></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((p) => {
            const rs = ((states ?? []) as RoomState[]).filter((r) => r.property_id === p.id);
            const fresh = rs.filter((r) => !r.stale);
            const occupied = fresh.filter((r) => r.occupied).length;
            const devs = ((devices ?? []) as Device[]).filter((d) => d.property_id === p.id);
            const offline = devs.filter((d) => d.status === 'offline').length;
            const gwOffline = devs.some((d) => d.kind === 'gateway' && d.status === 'offline');
            const crit = ((alerts ?? []) as EventRow[]).filter((e) => e.property_id === p.id);
            return (
              <Link key={p.id} href={`/app/properties/${p.id}`} className="group">
                <Card className="h-full p-5 transition group-hover:border-brand/50 group-hover:shadow-md">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="truncate text-lg font-semibold">{p.name}</p><p className="truncate text-sm text-muted">{formatAddress(p)}</p></div>
                    <ModeBadge mode={p.security_mode} />
                  </div>
                  <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg bg-surface-2 py-3"><Users className="mx-auto h-4 w-4 text-occupied" /><p className="mt-1 text-lg font-semibold tabular">{fresh.length ? occupied : '—'}</p><p className="text-[11px] text-muted">rooms occupied</p></div>
                    <div className="rounded-lg bg-surface-2 py-3"><WifiOff className={`mx-auto h-4 w-4 ${offline ? 'text-bad' : 'text-muted'}`} /><p className="mt-1 text-lg font-semibold tabular">{offline}</p><p className="text-[11px] text-muted">devices offline</p></div>
                    <div className="rounded-lg bg-surface-2 py-3"><ShieldAlert className={`mx-auto h-4 w-4 ${crit.length ? 'text-bad' : 'text-muted'}`} /><p className="mt-1 text-lg font-semibold tabular">{crit.length}</p><p className="text-[11px] text-muted">open alarms</p></div>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs text-muted">
                    {gwOffline ? <StatusDot tone="bad" label="Gateway offline — monitoring paused" /> : fresh.length ? <StatusDot tone="ok" live label="Monitoring live" /> : <StatusDot tone="warn" label="Waiting for sensor data" />}
                    {crit[0] && <Badge tone="bad">{timeAgo(crit[0].occurred_at)}</Badge>}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
