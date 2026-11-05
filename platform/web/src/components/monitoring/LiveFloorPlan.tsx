'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Users, Activity, WifiOff } from 'lucide-react';
import { MOTION_LABEL, timeAgo } from '@/lib/format';
import type { Floor, Room, RoomState } from '@/lib/types';
import { Badge, Card, CardHeader, StatusDot, cn } from '../ui';
import { useLiveRooms } from './useLiveRooms';

export interface FloorWithPlan extends Floor { plan_url: string | null }

function roomVisual(r: RoomState | undefined, stale: boolean) {
  if (stale) return { fill: 'var(--surface-2)', stroke: 'var(--border)', label: 'No data', tone: 'neutral' as const };
  if (r?.occupied) return { fill: 'color-mix(in srgb, var(--occupied) 28%, transparent)', stroke: 'var(--occupied)', label: MOTION_LABEL[r.motion_level] ?? 'Occupied', tone: 'occupied' as const };
  return { fill: 'color-mix(in srgb, var(--ok) 10%, transparent)', stroke: 'color-mix(in srgb, var(--ok) 55%, transparent)', label: 'Clear', tone: 'ok' as const };
}

export function LiveFloorPlan({ propertyId, floors, rooms, initialStates, roomHrefBase, title = 'Live view' }: {
  propertyId: string; floors: FloorWithPlan[]; rooms: Room[]; initialStates: RoomState[];
  /** Rooms link to `${roomHrefBase}/${roomId}` (a string: functions cannot cross the server→client boundary). */
  roomHrefBase?: string; title?: string;
}) {
  const roomHref = roomHrefBase ? (id: string) => `${roomHrefBase}/${id}` : undefined;
  const live = useLiveRooms(propertyId, initialStates);
  const [floorId, setFloorId] = useState<string | null>(floors[0]?.id ?? null);
  const floor = floors.find((f) => f.id === floorId) ?? null;
  // Rooms without a floor are always listed, so no monitored room can be hidden by the floor filter.
  const floorRooms = useMemo(() => rooms.filter((r) => (floor ? r.floor_id === floor.id || !r.floor_id : true)), [rooms, floor]);
  const mappedOnFloor = (r: Room) => !floor || r.floor_id === floor.id;
  const mapped = floorRooms.filter((r) => mappedOnFloor(r) && r.shape && r.shape.length >= 3);
  const aspect = floor?.plan_width && floor?.plan_height ? floor.plan_height / floor.plan_width : 0.62;
  const occupiedCount = rooms.filter((r) => live.rooms[r.id]?.occupied && !live.isStale(live.rooms[r.id])).length;
  const staleCount = rooms.filter((r) => r.monitoring_enabled && live.isStale(live.rooms[r.id])).length;

  return (
    <Card>
      <CardHeader title={title}
        subtitle={<span className="flex flex-wrap items-center gap-3">
          <StatusDot tone={live.connected ? 'ok' : 'warn'} live={live.connected} label={live.connected ? 'Live' : 'Connecting…'} />
          <span>{occupiedCount} occupied</span>
          {staleCount > 0 && <span className="text-warn">{staleCount} without data</span>}
        </span>}
        actions={floors.length > 1 && (
          <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
            {floors.map((f) => (
              <button key={f.id} onClick={() => setFloorId(f.id)} className={cn('rounded-md px-2.5 py-1 text-xs font-medium', f.id === floorId ? 'bg-surface shadow-sm' : 'text-muted')}>{f.name}</button>
            ))}
          </div>
        )} />
      {mapped.length > 0 && (
        <div className="p-4">
          <div className="relative w-full overflow-hidden rounded-lg border border-border bg-surface-2" style={{ paddingTop: `${aspect * 100}%` }}>
            {floor?.plan_url && (
              // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived Storage URL
              <img src={floor.plan_url} alt={`${floor.name} floor plan`} className="absolute inset-0 h-full w-full object-contain opacity-80" />
            )}
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label="Room occupancy map">
              {mapped.map((r) => {
                const st = live.rooms[r.id];
                const stale = live.isStale(st);
                const v = roomVisual(st, stale);
                const pts = r.shape!.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ');
                const cx = r.shape!.reduce((a, p) => a + p[0], 0) / r.shape!.length * 1000;
                const cy = r.shape!.reduce((a, p) => a + p[1], 0) / r.shape!.length * 1000;
                const el = (
                  <g key={r.id}>
                    <polygon points={pts} fill={v.fill} stroke={v.stroke} strokeWidth={4} vectorEffect="non-scaling-stroke" className="transition-[fill] duration-500" />
                    {st?.occupied && !stale && <circle cx={cx} cy={cy} r={14} fill="var(--occupied)" className="animate-pulse" />}
                    <title>{`${r.name}: ${v.label}`}</title>
                  </g>
                );
                return roomHref ? <a key={r.id} href={roomHref(r.id)}>{el}</a> : el;
              })}
            </svg>
            {mapped.map((r) => {
              const cx = r.shape!.reduce((a, p) => a + p[0], 0) / r.shape!.length * 100;
              const cy = r.shape!.reduce((a, p) => a + p[1], 0) / r.shape!.length * 100;
              return <span key={r.id} className="pointer-events-none absolute -translate-x-1/2 translate-y-3 rounded bg-surface/85 px-1.5 py-0.5 text-[11px] font-medium shadow-sm" style={{ left: `${cx}%`, top: `${cy}%` }}>{r.name}</span>;
            })}
          </div>
        </div>
      )}
      <div className="grid gap-3 p-4 pt-0 sm:grid-cols-2 2xl:grid-cols-3" style={mapped.length ? undefined : { paddingTop: 16 }}>
        {floorRooms.map((r) => {
          const st = live.rooms[r.id];
          const stale = live.isStale(st);
          const v = roomVisual(st, stale);
          const card = (
            <div className={cn('rounded-lg border p-3 transition', st?.occupied && !stale ? 'border-occupied/60 bg-occupied-soft' : 'border-border bg-surface')}>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-medium">{r.name}</p>
                {!r.monitoring_enabled ? <Badge className="shrink-0 whitespace-nowrap">Not monitored</Badge> : stale ? <Badge className="shrink-0 whitespace-nowrap"><WifiOff className="h-3 w-3" />No data</Badge> : <Badge tone={v.tone} className="shrink-0 whitespace-nowrap">{v.label}</Badge>}
              </div>
              <div className="mt-2 flex items-center gap-4 text-xs text-muted">
                {!stale && st?.occupied && <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />~{st.person_count} {st.person_count === 1 ? 'person' : 'people'}</span>}
                {st?.last_motion_at && <span className="flex items-center gap-1"><Activity className="h-3.5 w-3.5" />motion {timeAgo(st.last_motion_at, live.now)}</span>}
                {stale && st?.updated_at && <span>last update {timeAgo(st.updated_at, live.now)}</span>}
              </div>
            </div>
          );
          return roomHref ? <Link key={r.id} href={roomHref(r.id)} className="block hover:opacity-90">{card}</Link> : <div key={r.id}>{card}</div>;
        })}
        {floorRooms.length === 0 && <p className="text-sm text-muted">No rooms configured on this floor.</p>}
      </div>
      <p className="border-t border-border px-5 py-2.5 text-xs text-muted">
        Occupancy is inferred from WiFi channel-state sensing (RuView). Person counts are estimates. “No data” means the sensor or gateway has not reported in the last minute.
      </p>
    </Card>
  );
}
