/** Per-node, per-minute aggregation of live samples into history buckets. */
import type { MinuteBucket, NodeSample } from '@ruview/shared/protocol';

interface Acc {
  bucket: number;
  n: number;
  present: number;
  active: number;
  maxPersons: number;
  me: number; meN: number; meMax: number | null;
  rssi: number; rssiN: number;
  fr: number; frN: number;
  br: number; brN: number;
  hr: number; hrN: number;
}

const minuteOf = (t: number) => Math.floor(t / 60_000) * 60_000;

export class MinuteAggregator {
  private readonly acc = new Map<number, Acc>();

  /** Adds a sample; returns any buckets closed by a minute rollover. */
  add(s: NodeSample): MinuteBucket[] {
    const t = Date.parse(s.observed_at);
    const b = minuteOf(t);
    const closed: MinuteBucket[] = [];
    let a = this.acc.get(s.node_id);
    if (a && a.bucket !== b) {
      if (b < a.bucket) return closed; // late sample for an already-closed minute: drop
      closed.push(this.close(s.node_id, a));
      a = undefined;
    }
    if (!a) {
      a = { bucket: b, n: 0, present: 0, active: 0, maxPersons: 0, me: 0, meN: 0, meMax: null, rssi: 0, rssiN: 0, fr: 0, frN: 0, br: 0, brN: 0, hr: 0, hrN: 0 };
      this.acc.set(s.node_id, a);
    }
    a.n++;
    if (s.presence) a.present++;
    if (s.motion_level === 'present_moving' || s.motion_level === 'active') a.active++;
    a.maxPersons = Math.max(a.maxPersons, s.person_count);
    if (s.motion_energy != null) { a.me += s.motion_energy; a.meN++; a.meMax = Math.max(a.meMax ?? -Infinity, s.motion_energy); }
    if (s.rssi != null) { a.rssi += s.rssi; a.rssiN++; }
    if (s.frame_rate != null) { a.fr += s.frame_rate; a.frN++; }
    if (s.vitals?.breathing_bpm != null) { a.br += s.vitals.breathing_bpm; a.brN++; }
    if (s.vitals?.heart_bpm != null) { a.hr += s.vitals.heart_bpm; a.hrN++; }
    return closed;
  }

  /** Close buckets whose minute has passed even if no new sample arrived (node went silent). */
  flushStale(now = Date.now()): MinuteBucket[] {
    const out: MinuteBucket[] = [];
    for (const [nodeId, a] of this.acc) {
      if (a.bucket + 60_000 <= minuteOf(now)) out.push(this.close(nodeId, a));
    }
    return out;
  }

  private close(nodeId: number, a: Acc): MinuteBucket {
    this.acc.delete(nodeId);
    const avg = (s: number, n: number, digits = 3) => (n ? Number((s / n).toFixed(digits)) : null);
    return {
      node_id: nodeId,
      bucket: new Date(a.bucket).toISOString(),
      samples: a.n,
      presence_ratio: a.n ? Number((a.present / a.n).toFixed(3)) : 0,
      max_persons: a.maxPersons,
      avg_motion_energy: avg(a.me, a.meN, 4),
      max_motion_energy: a.meMax,
      active_ratio: a.n ? Number((a.active / a.n).toFixed(3)) : null,
      avg_rssi: avg(a.rssi, a.rssiN, 1),
      avg_frame_rate: avg(a.fr, a.frN, 1),
      avg_breathing_bpm: avg(a.br, a.brN, 1),
      avg_heart_bpm: avg(a.hr, a.hrN, 1),
    };
  }
}
