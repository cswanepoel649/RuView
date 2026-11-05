/**
 * Consumes the local RuView sensing-server (unchanged RuView component):
 *   - WS  /ws/sensing      → `sensing_update` messages with per-node classification
 *   - GET /api/v1/nodes    → per-node person_count / motion_level
 *   - GET /health          → source + tick (liveness)
 *
 * Data whose `source` is not exactly "esp32" (e.g. "simulated", "esp32:offline")
 * is discarded: the platform never presents synthetic data as real.
 */
import { MotionLevel } from '@ruview/shared/protocol';
import { errMsg, log } from './log';

export interface ServerNodeView {
  nodeId: number;
  presence: boolean;
  motionLevel: MotionLevel;
  confidence: number | null;
  personCount: number | null;
  stale: boolean;
  frameRateHz: number | null;
  receivedAt: number;
}

export interface SensingHealth {
  reachable: boolean;
  source: string | null;
  tick: number | null;
  clients: number | null;
  error: string | null;
  checkedAt: number;
}

const parseMotion = (m: unknown): MotionLevel => {
  const r = MotionLevel.safeParse(m);
  return r.success ? r.data : 'absent';
};

export class SensingClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private backoffMs = 1000;
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly nodes = new Map<number, ServerNodeView>();
  health: SensingHealth = { reachable: false, source: null, tick: null, clients: null, error: 'not started', checkedAt: 0 };
  lastLiveUpdateAt = 0;
  droppedNonLive = 0;

  constructor(private readonly wsUrl: string, private readonly httpUrl: string, private readonly now: () => number = Date.now) {}

  start() {
    this.stopped = false;
    this.connect();
    const poll = async () => {
      await this.pollOnce();
      if (!this.stopped) this.pollTimer = setTimeout(poll, 5000);
    };
    void poll();
  }

  /** Waits (bounded) until the sensing-server answers, so start-up races are not reported as outages. */
  async waitUntilReachable(timeoutMs: number, stepMs = 1000): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      if (this.health.reachable) return true;
      if (Date.now() >= end || this.stopped) return false;
      await new Promise((r) => setTimeout(r, stepMs));
      await this.pollOnce();
    }
  }

  stop() {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.ws?.close();
  }

  node(nodeId: number, maxAgeMs = 3000): ServerNodeView | null {
    const n = this.nodes.get(nodeId);
    return n && this.now() - n.receivedAt <= maxAgeMs && !n.stale ? n : null;
  }

  isLive(): boolean {
    return this.health.reachable && this.health.source === 'esp32';
  }

  private connect() {
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl);
    } catch (e) {
      log.warn('sensing ws connect failed', { error: errMsg(e) });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.backoffMs = 1000;
      log.info('connected to sensing-server websocket', { url: this.wsUrl });
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') this.handleMessage(ev.data);
    });
    ws.addEventListener('close', () => {
      this.ws = null;
      this.scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      /* close follows */
    });
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    setTimeout(() => this.connect(), delay).unref?.();
  }

  /** Exposed for tests. */
  handleMessage(raw: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type !== 'sensing_update') return;
    if (msg.source !== 'esp32') {
      this.droppedNonLive++;
      return;
    }
    const t = this.now();
    this.lastLiveUpdateAt = t;
    const nf = Array.isArray(msg.node_features) ? (msg.node_features as Record<string, unknown>[]) : [];
    for (const f of nf) {
      const nodeId = Number(f.node_id);
      if (!Number.isInteger(nodeId) || nodeId < 0 || nodeId > 255) continue;
      const cls = (f.classification ?? {}) as Record<string, unknown>;
      const prev = this.nodes.get(nodeId);
      const conf = Number(cls.confidence);
      const fr = Number(f.frame_rate_hz);
      this.nodes.set(nodeId, {
        nodeId,
        presence: cls.presence === true,
        motionLevel: parseMotion(cls.motion_level),
        confidence: Number.isFinite(conf) ? Math.min(Math.max(conf, 0), 1) : null,
        personCount: prev?.personCount ?? null,
        stale: f.stale === true,
        frameRateHz: Number.isFinite(fr) ? fr : null,
        receivedAt: t,
      });
    }
  }

  /** Exposed for tests. */
  async pollOnce() {
    const t = this.now();
    try {
      const h = await fetchJson(`${this.httpUrl}/health`);
      this.health = {
        reachable: true,
        source: typeof h.source === 'string' ? h.source : null,
        tick: Number.isFinite(Number(h.tick)) ? Number(h.tick) : null,
        clients: Number.isFinite(Number(h.clients)) ? Number(h.clients) : null,
        error: null,
        checkedAt: t,
      };
    } catch (e) {
      this.health = { reachable: false, source: null, tick: null, clients: null, error: errMsg(e).slice(0, 200), checkedAt: t };
      return;
    }
    if (this.health.source !== 'esp32') return;
    try {
      const body = await fetchJson(`${this.httpUrl}/api/v1/nodes`);
      const list = Array.isArray(body.nodes) ? (body.nodes as Record<string, unknown>[]) : [];
      for (const n of list) {
        const nodeId = Number(n.node_id);
        const existing = this.nodes.get(nodeId);
        if (!existing) continue;
        const pc = Number(n.person_count);
        existing.personCount = Number.isInteger(pc) && pc >= 0 && pc <= 16 ? pc : existing.personCount;
        if (n.status === 'stale') existing.stale = true;
      }
    } catch (e) {
      log.debug('nodes poll failed', { error: errMsg(e) });
    }
  }
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const j = (await res.json()) as unknown;
  if (!j || typeof j !== 'object') throw new Error('non-object JSON');
  return j as Record<string, unknown>;
}
