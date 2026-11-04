import { notFound } from 'next/navigation';
import { Button, Card, CardBody, CardHeader, Select, Stat } from '@/components/ui';
import { ActivityHeatmap, OccupancyBars, RoomShareBars } from '@/components/monitoring/charts';
import { EventList } from '@/components/monitoring/EventList';
import { requireClientUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { EVENT_SELECT, flattenEvents } from '@/lib/queries';
import { roomShare, weekHeatmap, type HourlyRow } from '@/lib/analytics';
import type { Property, Room } from '@/lib/types';

export const metadata = { title: 'History & insights' };
const RANGES = { '1': 1, '7': 7, '30': 30 } as const;

export default async function History({ params, searchParams }: { params: Promise<{ propertyId: string }>; searchParams: Promise<{ days?: string; type?: string }> }) {
  await requireClientUser();
  const { propertyId } = await params;
  const sp = await searchParams;
  const days = RANGES[(sp.days ?? '7') as keyof typeof RANGES] ?? 7;
  const db = await createClient();
  const { data: prop } = await db.from('properties').select('id, timezone').eq('id', propertyId).maybeSingle();
  if (!prop) notFound();
  const p = prop as Pick<Property, 'id' | 'timezone'>;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  let evq = db.from('events').select(EVENT_SELECT).eq('property_id', propertyId).gte('occurred_at', from.toISOString()).order('occurred_at', { ascending: false }).limit(200);
  if (sp.type) evq = sp.type === 'alarms' ? evq.in('severity', ['critical', 'warning']) : evq.like('event_type', `${sp.type.replace(/[^a-z_]/g, '')}%`);
  const [{ data: hourly }, { data: rooms }, { data: events }, { count: alarms }] = await Promise.all([
    db.rpc('room_occupancy_hourly', { p_property: propertyId, p_from: from.toISOString(), p_to: to.toISOString() }),
    db.from('rooms').select('id, name, monitoring_enabled').eq('property_id', propertyId).order('sort_order'),
    evq,
    db.from('events').select('id', { count: 'exact', head: true }).eq('property_id', propertyId).eq('event_type', 'intrusion_detected').gte('occurred_at', from.toISOString()),
  ]);
  const rows = (hourly ?? []) as HourlyRow[];
  const share = roomShare(rows);
  const anyByHour = new Map<string, number>();
  for (const r of rows) anyByHour.set(r.hour, Math.max(anyByHour.get(r.hour) ?? 0, r.occupied_ratio));
  // property-level series: hourly (1-7 days) or daily (30 days)
  const slotH = days > 7 ? 24 : 1;
  const series = Array.from({ length: Math.ceil((days * 24) / slotH) }, (_, i) => {
    const start = new Date(Math.floor(from.getTime() / 3_600_000) * 3_600_000 + i * slotH * 3_600_000);
    let s = 0, n = 0;
    for (let h = 0; h < slotH; h++) { const v = anyByHour.get(new Date(start.getTime() + h * 3_600_000).toISOString()); if (v != null) { s += v; n++; } }
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: p.timezone, ...(slotH === 24 ? { day: '2-digit', month: 'short' } : { weekday: days > 1 ? 'short' : undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) });
    return { t: start.toISOString(), label: fmt.format(start), value: n ? (s / n) * 100 : null };
  });
  const covered = new Set(rows.map((r) => r.hour)).size;
  const roomList = ((rooms ?? []) as Room[]).filter((r) => r.monitoring_enabled);
  return (
    <div className="space-y-6">
      <form className="flex flex-wrap items-center gap-2">
        <Select name="days" defaultValue={String(days)} className="max-w-[160px]"><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></Select>
        <Select name="type" defaultValue={sp.type ?? ''} className="max-w-[180px]"><option value="">All events</option><option value="alarms">Alarms & warnings</option><option value="presence">Presence</option><option value="security">Arming</option><option value="device">Devices</option></Select>
        <Button variant="secondary" type="submit">Apply</Button>
      </form>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Hours with data" value={`${covered} / ${days * 24}`} hint="Coverage of the selected period" />
        <Stat label="Most occupied room" value={[...share].sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0] ? roomList.find((r) => r.id === [...share].sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]![0])?.name ?? '—' : '—'} />
        <Stat label="Intrusion alarms" value={alarms ?? 0} tone={(alarms ?? 0) > 0 ? 'bad' : undefined} />
        <Stat label="Events" value={(events ?? []).length} />
      </div>
      <Card><CardHeader title="Occupancy over time" subtitle={`Share of each ${slotH === 24 ? 'day' : 'hour'} with presence in any room (times in ${p.timezone})`} /><CardBody><OccupancyBars data={series} /></CardBody></Card>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card><CardHeader title="Typical week" subtitle="Average occupancy by weekday and hour" /><CardBody><ActivityHeatmap cells={weekHeatmap(rows, p.timezone)} days={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']} /></CardBody></Card>
        <Card><CardHeader title="Time occupied by room" subtitle="Of the time each room had sensor data" /><CardBody>
          <RoomShareBars rows={roomList.map((r) => ({ name: r.name, value: share.get(r.id) ?? null, href: `/app/properties/${propertyId}/rooms/${r.id}` }))} />
        </CardBody></Card>
      </div>
      <Card><CardHeader title="Activity timeline" /><EventList events={flattenEvents(events)} tz={p.timezone} hrefFor={(e) => `/app/alerts?event=${e.id}`} empty="No events in this period." /></Card>
    </div>
  );
}
