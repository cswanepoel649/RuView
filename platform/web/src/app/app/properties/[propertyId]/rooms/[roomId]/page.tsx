import { notFound } from 'next/navigation';
import { Badge, Card, CardBody, CardHeader, Notice, Stat } from '@/components/ui';
import { OccupancyBars } from '@/components/monitoring/charts';
import { EventList } from '@/components/monitoring/EventList';
import { DeviceStatusBadge, SignalBars } from '@/components/monitoring/badges';
import { requireClientUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { EVENT_SELECT, flattenEvents } from '@/lib/queries';
import { slotSeries, type MinuteRow } from '@/lib/analytics';
import { MOTION_LABEL, timeAgo } from '@/lib/format';
import type { Device, NodeState, Property, Room, RoomState } from '@/lib/types';

export default async function RoomPage({ params }: { params: Promise<{ propertyId: string; roomId: string }> }) {
  await requireClientUser();
  const { propertyId, roomId } = await params;
  const db = await createClient();
  const { data: room } = await db.from('rooms').select('*').eq('id', roomId).eq('property_id', propertyId).maybeSingle();
  if (!room) notFound();
  const to = new Date();
  const from = new Date(Math.floor((to.getTime() - 86_400_000) / 1_800_000) * 1_800_000);
  const [{ data: prop }, { data: state }, { data: devices }, { data: minutes }, { data: events }, { data: zones }] = await Promise.all([
    db.from('properties').select('timezone, features').eq('id', propertyId).single(),
    db.from('room_state').select('*').eq('room_id', roomId).maybeSingle(),
    db.from('devices').select('*').eq('room_id', roomId),
    db.from('telemetry_minutes').select('device_id, room_id, bucket, presence_ratio, max_persons, avg_motion_energy').eq('room_id', roomId).gte('bucket', from.toISOString()).order('bucket').limit(5000),
    db.from('events').select(EVENT_SELECT).eq('room_id', roomId).order('occurred_at', { ascending: false }).limit(25),
    db.from('zone_rooms').select('security_zones(name, active_modes)').eq('room_id', roomId),
  ]);
  const r = room as Room;
  const p = prop as Pick<Property, 'timezone' | 'features'>;
  const st = state as RoomState | null;
  const devs = (devices ?? []) as Device[];
  const { data: nodeStates } = devs.length ? await db.from('node_state').select('*').in('device_id', devs.map((d) => d.id)) : { data: [] };
  const vitalsOn = p.features.wellness_vitals === true;
  const vit = ((nodeStates ?? []) as NodeState[]).map((n) => n.vitals).find((v) => v && (v.breathing_bpm || v.heart_bpm));
  const stale = !st || st.stale;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{r.name}</h2>
        {stale ? <Badge>No live data</Badge> : st.occupied ? <Badge tone="occupied">{MOTION_LABEL[st.motion_level]}</Badge> : <Badge tone="ok">Clear</Badge>}
        {((zones ?? []) as unknown as { security_zones: { name: string } | null }[]).map((z) => z.security_zones && <Badge key={z.security_zones.name} tone="brand">Zone: {z.security_zones.name}</Badge>)}
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="People (estimate)" value={stale ? '—' : st.occupied ? `~${st.person_count}` : 0} />
        <Stat label="Last motion" value={st?.last_motion_at ? timeAgo(st.last_motion_at) : '—'} />
        <Stat label="Last change" value={st?.last_change_at ? timeAgo(st.last_change_at) : '—'} />
        <Stat label="Sensors" value={`${devs.filter((d) => d.status === 'online').length}/${devs.length} online`} />
      </div>
      {vitalsOn && (
        <Card><CardHeader title="Wellness (experimental)" subtitle="Contactless estimates from WiFi sensing. Not a medical device — do not use for diagnosis." /><CardBody>
          {vit && st?.occupied && !stale ? (
            <div className="flex gap-8 text-sm"><p><span className="text-2xl font-semibold tabular">{vit.breathing_bpm ?? '—'}</span> breaths/min</p><p><span className="text-2xl font-semibold tabular">{vit.heart_bpm ?? '—'}</span> beats/min</p><Badge>{vit.source}</Badge></div>
          ) : <p className="text-sm text-muted">Estimates appear when one person is present and still.</p>}
        </CardBody></Card>
      )}
      <Card><CardHeader title="Last 24 hours" subtitle={`Occupancy per 30 minutes (${p.timezone})`} /><CardBody>
        <OccupancyBars data={slotSeries((minutes ?? []) as MinuteRow[], from, to, 30, p.timezone)} />
      </CardBody></Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader title="Room activity" /><EventList events={flattenEvents(events)} tz={p.timezone} hrefFor={(e) => `/app/alerts?event=${e.id}`} /></Card>
        <Card><CardHeader title="Sensors in this room" />
          {devs.length === 0 ? <CardBody><Notice tone="warn">No sensor is installed in this room.</Notice></CardBody> : (
            <ul className="divide-y divide-border">{devs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3"><span className="text-sm font-medium">{d.name}</span><span className="flex items-center gap-4"><SignalBars rssi={d.last_rssi} /><DeviceStatusBadge status={d.status} lastSeen={d.last_seen_at} /></span></li>
            ))}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}
