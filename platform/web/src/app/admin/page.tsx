import Link from 'next/link';
import { Card, CardBody, CardHeader, LinkButton, PageHeader, Stat, Table, Td, Th, EmptyState, Notice } from '@/components/ui';
import { EventList } from '@/components/monitoring/EventList';
import { DeviceStatusBadge } from '@/components/monitoring/badges';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { EVENT_SELECT, flattenEvents } from '@/lib/queries';
import type { Device } from '@/lib/types';

export const metadata = { title: 'Overview' };

export default async function AdminOverview({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const s = await requireStaff();
  const sp = await searchParams;
  const db = await createClient();
  const head = { count: 'exact' as const, head: true };
  const [clients, properties, online, offline, gwOffline, critical, tickets, installs, offlineList, events] = await Promise.all([
    db.from('clients').select('id', head).eq('status', 'active'),
    db.from('properties').select('id', head).neq('status', 'archived'),
    db.from('devices').select('id', head).eq('status', 'online').eq('kind', 'sensor_node'),
    db.from('devices').select('id', head).eq('status', 'offline'),
    db.from('devices').select('id', head).eq('status', 'offline').eq('kind', 'gateway'),
    db.from('events').select('id', head).eq('severity', 'critical').is('acknowledged_at', null),
    db.from('support_tickets').select('id', head).in('status', ['open', 'in_progress']),
    db.from('installations').select('id, status, scheduled_for, property_id, properties(name, clients(display_name))').in('status', ['draft', 'in_progress']).order('scheduled_for', { ascending: true, nullsFirst: false }).limit(6),
    db.from('devices').select('id, name, kind, status, last_seen_at, property_id, properties(name, clients(display_name))').eq('status', 'offline').order('last_seen_at', { ascending: true }).limit(8),
    db.from('events').select(EVENT_SELECT).in('severity', ['critical', 'warning']).order('occurred_at', { ascending: false }).limit(12),
  ]);
  type Joined = { properties: { name: string; clients: { display_name: string } | null } | null };
  return (
    <>
      <PageHeader title="Operations overview" subtitle={`Signed in as ${s.profile.full_name ?? s.email}. Fleet health and alerts across all clients.`}
        actions={<><LinkButton href="/admin/clients/new">New client</LinkButton><LinkButton href="/admin/installations" variant="primary">Start installation</LinkButton></>} />
      {sp.denied && <div className="mb-4"><Notice tone="warn">That area requires the platform administrator role.</Notice></div>}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Active clients" value={clients.count ?? 0} />
        <Stat label="Properties" value={properties.count ?? 0} />
        <Stat label="Sensors online" value={online.count ?? 0} tone="ok" />
        <Stat label="Devices offline" value={offline.count ?? 0} tone={(offline.count ?? 0) > 0 ? 'bad' : undefined} hint={`${gwOffline.count ?? 0} gateway(s)`} />
        <Stat label="Open critical alerts" value={critical.count ?? 0} tone={(critical.count ?? 0) > 0 ? 'bad' : undefined} />
        <Stat label="Open tickets" value={tickets.count ?? 0} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Recent alerts" subtitle="Critical and warning events, all clients" actions={<LinkButton href="/admin/alerts" variant="ghost">View all</LinkButton>} />
          <EventList events={flattenEvents(events.data)} context="admin" hrefFor={(e) => `/admin/alerts?event=${e.id}`} empty="No alerts. All quiet." />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Offline hardware" subtitle="Longest offline first" />
            {(offlineList.data ?? []).length === 0 ? <EmptyState title="Everything is online." /> : (
              <Table>
                <thead><tr><Th>Device</Th><Th>Client · property</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {((offlineList.data ?? []) as unknown as (Device & Joined)[]).map((d) => (
                    <tr key={d.id}>
                      <Td><Link href={`/admin/devices/${d.id}`} className="font-medium hover:underline">{d.name}</Link><p className="text-xs text-muted">{d.kind === 'gateway' ? 'Gateway' : 'Sensor'}</p></Td>
                      <Td className="text-sm">{d.properties?.clients?.display_name ?? '—'}<p className="text-xs text-muted">{d.properties?.name}</p></Td>
                      <Td><DeviceStatusBadge status={d.status} lastSeen={d.last_seen_at} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Installations" subtitle="Draft and in progress" actions={<LinkButton href="/admin/installations" variant="ghost">All</LinkButton>} />
            <CardBody className="space-y-2">
              {((installs.data ?? []) as unknown as { id: string; status: string; scheduled_for: string | null; properties: { name: string; clients: { display_name: string } | null } | null }[]).map((i) => (
                <Link key={i.id} href={`/admin/installations/${i.id}`} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 hover:bg-surface-2">
                  <span><span className="text-sm font-medium">{i.properties?.name}</span><span className="block text-xs text-muted">{i.properties?.clients?.display_name}</span></span>
                  <span className="text-xs text-muted">{i.status === 'draft' ? 'Draft' : 'In progress'}{i.scheduled_for ? ` · ${new Date(i.scheduled_for).toLocaleDateString()}` : ''}</span>
                </Link>
              ))}
              {(installs.data ?? []).length === 0 && <p className="text-sm text-muted">No installations scheduled.</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
