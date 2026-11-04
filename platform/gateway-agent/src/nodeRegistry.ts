/**
 * Per-node observations derived directly from the UDP datagrams (authoritative
 * for liveness, source IP, RSSI and on-device edge analytics).
 */
import type { DecodedPacket, EdgeVitals } from '@ruview/shared/esp32';

export interface NodeObservation {
  nodeId: number;
  ip: string;
  ipChanged: boolean;
  firstSeen: number;
  lastSeen: number;
  rssi: number | null;
  counts: Record<string, number>;
  /** timestamps (ms) of recent packets per kind for rate estimation (10 s window) */
  recent: Record<string, number[]>;
  vitals: (EdgeVitals & { receivedAt: number }) | null;
  lastFallAt: number;
}

export interface FallEvent {
  nodeId: number;
  occurredAt: number;
  dedupeKey: string;
  data: Record<string, unknown>;
}

const RATE_WINDOW_MS = 10_000;
const FALL_DEBOUNCE_MS = 10_000;

export class NodeRegistry {
  private readonly nodes = new Map<number, NodeObservation>();
  private readonly fallListeners: ((e: FallEvent) => void)[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  onFall(fn: (e: FallEvent) => void) {
    this.fallListeners.push(fn);
  }

  observe(pkt: DecodedPacket, ip: string) {
    const t = this.now();
    let n = this.nodes.get(pkt.nodeId);
    if (!n) {
      n = { nodeId: pkt.nodeId, ip, ipChanged: false, firstSeen: t, lastSeen: t, rssi: null, counts: {}, recent: {}, vitals: null, lastFallAt: -Infinity };
      this.nodes.set(pkt.nodeId, n);
    }
    if (n.ip !== ip) {
      n.ipChanged = true;
      n.ip = ip;
    }
    n.lastSeen = t;
    n.counts[pkt.kind] = (n.counts[pkt.kind] ?? 0) + 1;
    const r = (n.recent[pkt.kind] ??= []);
    r.push(t);
    while (r.length && r[0]! < t - RATE_WINDOW_MS) r.shift();

    if (pkt.kind === 'csi') {
      if (pkt.rssi < 0) n.rssi = pkt.rssi;
    } else if (pkt.kind === 'vitals' || pkt.kind === 'fused') {
      if (pkt.rssi < 0) n.rssi = pkt.rssi;
      const prevFall = n.vitals?.fall ?? false;
      n.vitals = { ...pkt, receivedAt: t };
      // Rising edge of the on-device fall flag (firmware already applies a 5 s cooldown).
      if (pkt.fall && !prevFall && t - n.lastFallAt > FALL_DEBOUNCE_MS) {
        n.lastFallAt = t;
        const ev: FallEvent = {
          nodeId: pkt.nodeId,
          occurredAt: t,
          dedupeKey: `fall:${pkt.nodeId}:${Math.floor(t / 1000)}`,
          data: { motion_energy: pkt.motionEnergy, presence_score: pkt.presenceScore, device_ts_ms: pkt.timestampMs, packet: pkt.kind },
        };
        for (const l of this.fallListeners) l(ev);
      }
    }
  }

  rate(nodeId: number, kind?: string): number {
    const n = this.nodes.get(nodeId);
    if (!n) return 0;
    const t = this.now();
    const kinds = kind ? [kind] : Object.keys(n.recent);
    let c = 0;
    for (const k of kinds) c += (n.recent[k] ?? []).filter((x) => x >= t - RATE_WINDOW_MS).length;
    return c / (RATE_WINDOW_MS / 1000);
  }

  /** Highest edge tier evidenced by traffic: vitals ⇒ ≥1/2, csi only ⇒ 0. */
  edgeTier(nodeId: number): number | null {
    const n = this.nodes.get(nodeId);
    if (!n) return null;
    if ((n.counts.vitals ?? 0) + (n.counts.fused ?? 0) > 0) return 2;
    return (n.counts.csi ?? 0) > 0 ? 0 : null;
  }

  get(nodeId: number) {
    return this.nodes.get(nodeId);
  }

  all(): NodeObservation[] {
    return [...this.nodes.values()];
  }

  /** Fresh edge vitals (≤ maxAgeMs). */
  freshVitals(nodeId: number, maxAgeMs = 3000) {
    const v = this.nodes.get(nodeId)?.vitals;
    return v && this.now() - v.receivedAt <= maxAgeMs ? v : null;
  }
}
