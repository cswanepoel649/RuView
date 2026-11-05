/** Pure aggregation helpers for occupancy analytics (time-zone aware, gaps stay null). */
export interface MinuteRow { device_id: string; room_id: string | null; bucket: string; presence_ratio: number; max_persons: number; avg_motion_energy: number | null }
export interface HourlyRow { room_id: string; hour: string; occupied_ratio: number; max_persons: number; minutes: number }

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', hourCycle: 'h23' });
  const o = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday!);
  return { dow: wd, hour: Number(o.hour), minute: Number(o.minute), label: `${o.hour}:${o.minute}`, day: `${o.day} ${o.month}` };
}

/**
 * Room occupancy over [from, to) in fixed slots. A minute counts as occupied
 * by the max presence_ratio across the room's nodes; slots with no rows → null.
 */
export function slotSeries(rows: MinuteRow[], from: Date, to: Date, slotMin: number, tz: string) {
  const slotMs = slotMin * 60_000;
  const n = Math.ceil((to.getTime() - from.getTime()) / slotMs);
  const perMinute = new Map<number, number>();
  for (const r of rows) {
    const t = Date.parse(r.bucket);
    perMinute.set(t, Math.max(perMinute.get(t) ?? 0, r.presence_ratio));
  }
  const sums = new Array<number>(n).fill(0), counts = new Array<number>(n).fill(0);
  for (const [t, v] of perMinute) {
    const i = Math.floor((t - from.getTime()) / slotMs);
    if (i >= 0 && i < n) { sums[i]! += v; counts[i]!++; }
  }
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(from.getTime() + i * slotMs);
    const p = parts(start, tz);
    return { t: start.toISOString(), label: p.label, detail: `${p.day} ${p.label}`, value: counts[i] ? (sums[i]! / counts[i]!) * 100 : null };
  });
}

/** Average occupancy by weekday (Mon-first) × hour from hourly rollups. Any room occupied → property occupied (max). */
export function weekHeatmap(rows: HourlyRow[], tz: string) {
  const byHour = new Map<string, number>();
  for (const r of rows) byHour.set(r.hour, Math.max(byHour.get(r.hour) ?? 0, r.occupied_ratio));
  const acc = new Map<string, { s: number; n: number }>();
  for (const [h, v] of byHour) {
    const p = parts(new Date(h), tz);
    const day = (p.dow + 6) % 7; // Monday = 0
    const k = `${day}:${p.hour}`;
    const a = acc.get(k) ?? { s: 0, n: 0 };
    a.s += v; a.n++;
    acc.set(k, a);
  }
  return [...acc].map(([k, a]) => { const [day, hour] = k.split(':').map(Number); return { day: day!, hour: hour!, value: (a.s / a.n) * 100 }; });
}

/** Share of covered time each room was occupied. */
export function roomShare(rows: HourlyRow[]) {
  const acc = new Map<string, { occ: number; min: number }>();
  for (const r of rows) {
    const a = acc.get(r.room_id) ?? { occ: 0, min: 0 };
    a.occ += r.occupied_ratio * r.minutes; a.min += r.minutes;
    acc.set(r.room_id, a);
  }
  return new Map([...acc].map(([k, a]) => [k, a.min ? (a.occ / a.min) * 100 : null]));
}
