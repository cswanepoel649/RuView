import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardBody, CardHeader, LinkButton, Notice } from '@/components/ui';
import { LiveFloorPlan } from '@/components/monitoring/LiveFloorPlan';
import { SecurityModeControl } from '@/components/monitoring/SecurityModeControl';
import { EventList } from '@/components/monitoring/EventList';
import { DeviceStatusBadge } from '@/components/monitoring/badges';
import { canOperate, requireClientUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadProperty } from '@/lib/property-data';
import { EVENT_SELECT, flattenEvents } from '@/lib/queries';

export const metadata = { title: 'Live' };

export default async function ClientPropertyLive({ params }: { params: Promise<{ propertyId: string }> }) {
  const s = await requireClientUser();
  const { propertyId } = await params;
  const data = await loadProperty(propertyId);
  if (!data) notFound();
  const { property: p, floors, rooms, states, devices } = data;
  const db = await createClient();
  const [{ data: open }, { data: recent }] = await Promise.all([
    db.from('events').select(EVENT_SELECT).eq('property_id', propertyId).in('severity', ['critical', 'warning']).is('resolved_at', null).order('occurred_at', { ascending: false }).limit(5),
    db.from('events').select(EVENT_SELECT).eq('property_id', propertyId).order('occurred_at', { ascending: false }).limit(12),
  ]);
  const gateway = devices.find((d) => d.kind === 'gateway');
  const sensors = devices.filter((d) => d.kind === 'sensor_node');
  const offline = devices.filter((d) => d.status === 'offline');
  return (
    <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
      <div className="space-y-6 min-w-0">
        {gateway?.status === 'offline' && <Notice tone="bad" title="Home gateway offline">Live monitoring and intrusion alarms are paused until the gateway reconnects. Check its power and internet connection.</Notice>}
        {(open ?? []).length > 0 && (
          <Card className="border-bad/40">
            <CardHeader title="Needs your attention" actions={<LinkButton href="/app/alerts" variant="ghost">All alerts</LinkButton>} />
            <EventList events={flattenEvents(open)} tz={p.timezone} hrefFor={(e) => `/app/alerts?event=${e.id}`} />
          </Card>
        )}
        <LiveFloorPlan propertyId={p.id} floors={floors} rooms={rooms.filter((r) => r.monitoring_enabled)} initialStates={states} roomHref={(id) => `/app/properties/${p.id}/rooms/${id}`} />
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Security" subtitle="Arming enables intrusion alarms for your zones." />
          <CardBody><SecurityModeControl propertyId={p.id} mode={p.security_mode} changedAt={p.security_mode_changed_at} exitDelayS={p.exit_delay_s} canOperate={canOperate(s, p.client_id)} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="System health" actions={<LinkButton href={`/app/properties/${p.id}/devices`} variant="ghost">Details</LinkButton>} />
          <CardBody className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Gateway</span>{gateway ? <DeviceStatusBadge status={gateway.status} lastSeen={gateway.last_seen_at} /> : <span className="text-muted">not installed</span>}</div>
            <div className="flex justify-between"><span>Sensors online</span><span className="font-medium tabular">{sensors.filter((d) => d.status === 'online').length} / {sensors.length}</span></div>
            {offline.length > 0 && <p className="text-xs text-bad">{offline.map((d) => d.name).join(', ')} offline</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent activity" actions={<Link href={`/app/properties/${p.id}/history`} className="text-sm text-brand hover:underline">Timeline</Link>} />
          <EventList events={flattenEvents(recent)} tz={p.timezone} hrefFor={(e) => `/app/alerts?event=${e.id}`} />
        </Card>
      </div>
    </div>
  );
}
