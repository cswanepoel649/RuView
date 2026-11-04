import type { AgentConfig } from './config';
import { CloudClient, CloudError, loadCredentials, saveCredentials, type Credentials } from './cloudClient';
import { CommandRunner, getOtaStatus, type OtaStatus } from './commands';
import { lanIps, readArp, systemInfo } from './host';
import { errMsg, log } from './log';
import { MinuteAggregator } from './aggregator';
import { buildSample } from './merge';
import { NodeRegistry } from './nodeRegistry';
import { Outbox } from './outbox';
import { SensingClient } from './sensingClient';
import { UdpTap } from './udpTap';
import type { GatewayCommand, HeartbeatRequest, HeartbeatResponse, NodeSample } from '@ruview/shared/protocol';

export interface AgentDeps {
  arp?: () => Map<string, string>;
  now?: () => number;
  otaPollMs?: number;
  otaRebootWaitMs?: number;
}

export class Agent {
  readonly registry: NodeRegistry;
  readonly sensing: SensingClient;
  readonly tap: UdpTap;
  readonly cloud: CloudClient;
  readonly outbox: Outbox;
  readonly aggregator = new MinuteAggregator();
  readonly commands: CommandRunner;
  private creds: Credentials | null = null;
  private config: HeartbeatResponse['config'] = { telemetry_interval_s: 5, heartbeat_interval_s: 30, vitals_enabled: false };
  private knownNodes = new Set<number>();
  private timers: NodeJS.Timeout[] = [];
  private readonly startedAt = Date.now();
  private readonly otaCache = new Map<number, OtaStatus>();
  private revoked = false;
  private stopping = false;
  lastHeartbeatOk = 0;
  lastTelemetryOk = 0;

  constructor(private readonly cfg: AgentConfig, private readonly deps: AgentDeps = {}) {
    const now = deps.now ?? Date.now;
    this.registry = new NodeRegistry(now);
    this.sensing = new SensingClient(cfg.sensingWsUrl, cfg.sensingHttpUrl, now);
    this.tap = new UdpTap(this.registry, { host: cfg.udpListenHost, port: cfg.udpListenPort }, { host: cfg.udpForwardHost, port: cfg.udpForwardPort });
    this.cloud = new CloudClient(cfg.cloudUrl, `ruview-agent/${cfg.agentVersion}`);
    this.outbox = new Outbox(cfg.stateDir, cfg.outboxMaxMinutes);
    this.commands = new CommandRunner(this.registry, cfg.nodeOtaPort, { pollMs: deps.otaPollMs, rebootWaitMs: deps.otaRebootWaitMs });
    this.registry.onFall((e) => {
      log.warn('edge fall flag', { node_id: e.nodeId });
      this.outbox.pushEvent({ type: 'fall_detected', node_id: e.nodeId, occurred_at: new Date(e.occurredAt).toISOString(), dedupe_key: e.dedupeKey, data: e.data });
      void this.flushEvents();
    });
  }

  async start() {
    await this.ensureEnrolled();
    await this.tap.start();
    this.sensing.start();
    await this.heartbeat();
    this.schedule(() => this.heartbeat(), () => this.config.heartbeat_interval_s * 1000);
    this.schedule(() => this.telemetryTick(), () => this.config.telemetry_interval_s * 1000);
    this.schedule(() => this.probeNodes(), () => 600_000, 15_000);
    this.schedule(async () => this.outbox.persist(), () => 10_000);
  }

  async stop() {
    this.stopping = true;
    for (const t of this.timers) clearTimeout(t);
    this.sensing.stop();
    this.outbox.pushMinutes(this.aggregator.flushStale(Date.now() + 120_000));
    this.outbox.persist();
    await this.tap.stop();
  }

  private schedule(fn: () => Promise<void>, intervalMs: () => number, firstDelayMs?: number) {
    const loop = async () => {
      if (this.stopping) return;
      try {
        await fn();
      } catch (e) {
        log.error('scheduled task failed', { error: errMsg(e) });
      }
      if (!this.stopping) this.timers.push(setTimeout(loop, intervalMs()));
    };
    this.timers.push(setTimeout(loop, firstDelayMs ?? intervalMs()));
  }

  private async ensureEnrolled() {
    this.creds = loadCredentials(this.cfg.stateDir);
    if (!this.creds) {
      if (!this.cfg.enrollmentCode) {
        throw new Error('gateway is not enrolled: set RUVIEW_ENROLLMENT_CODE (generated in the admin portal) and restart');
      }
      const sys = systemInfo(this.cfg.stateDir);
      const res = await this.cloud.enroll({
        enrollment_code: this.cfg.enrollmentCode,
        hw_id: this.cfg.hwId,
        hostname: sys.hostname ?? 'gateway',
        agent_version: this.cfg.agentVersion,
        platform: sys.platform ?? 'unknown',
      });
      this.creds = { gatewayId: res.gateway_id, token: res.token, propertyId: res.property_id, enrolledAt: new Date().toISOString() };
      saveCredentials(this.cfg.stateDir, this.creds);
      log.info('gateway enrolled', { gateway_id: res.gateway_id });
    }
    this.cloud.token = this.creds.token;
  }

  private handleCloudError(where: string, e: unknown) {
    if (e instanceof CloudError && e.status === 401) {
      if (!this.revoked) log.error('gateway token rejected (revoked?) — re-enroll this gateway from the admin portal', { where });
      this.revoked = true;
      return;
    }
    log.warn(`${where} failed`, { error: errMsg(e) });
  }

  buildHeartbeat(): HeartbeatRequest {
    const arp = (this.deps.arp ?? readArp)();
    const now = (this.deps.now ?? Date.now)();
    return {
      protocol: 1,
      agent_version: this.cfg.agentVersion,
      uptime_s: Math.floor((Date.now() - this.startedAt) / 1000),
      lan_ips: lanIps(),
      sensing: {
        reachable: this.sensing.health.reachable,
        source: this.sensing.health.source,
        tick: this.sensing.health.tick,
        clients: this.sensing.health.clients,
        error: this.sensing.health.error,
      },
      system: systemInfo(this.cfg.stateDir),
      buffer: { pending_minutes: this.outbox.minutes.length, pending_events: this.outbox.events.length },
      nodes: this.registry.all().slice(0, 64).map((n) => {
        const types: Record<string, number> = {};
        for (const [k, v] of Object.entries(n.counts)) types[k] = v;
        const ota = this.otaCache.get(n.nodeId);
        return {
          node_id: n.nodeId,
          ip: n.ip,
          mac: arp.get(n.ip) ?? null,
          last_seen_ms: Math.max(0, now - n.lastSeen),
          packets_per_s: Math.round(this.registry.rate(n.nodeId) * 10) / 10,
          packet_types: types,
          rssi: n.rssi,
          edge_tier_observed: this.registry.edgeTier(n.nodeId),
          firmware_version: ota?.version ?? null,
          ota: ota ?? null,
        };
      }),
    };
  }

  async heartbeat() {
    if (this.revoked) return;
    try {
      const res = await this.cloud.heartbeat(this.buildHeartbeat());
      this.lastHeartbeatOk = Date.now();
      this.config = res.config;
      this.knownNodes = new Set(res.node_map.map((n) => n.node_id));
      this.pending = res.commands.map((c) => this.execute(c));
    } catch (e) {
      this.handleCloudError('heartbeat', e);
    }
  }

  /** Resolves when all commands dispatched by the last heartbeat have finished (tests/diagnostics). */
  pending: Promise<void>[] = [];

  private async execute(c: GatewayCommand) {
    log.info('executing command', { id: c.id, type: c.type, node_id: c.node_id });
    const out = await this.commands.run(c, () => {
      log.info('restart requested by platform');
      void this.stop().then(() => process.exit(0));
    });
    if (!out) return;
    if (c.type === 'probe_node' && out.success && c.node_id != null) {
      this.otaCache.set(c.node_id, out.result as unknown as OtaStatus);
    }
    try {
      await this.cloud.commandResult(c.id, out);
    } catch (e) {
      this.handleCloudError('command result', e);
    }
  }

  /** Builds current samples for all nodes with fresh data. */
  collectSamples(now = Date.now()): NodeSample[] {
    const ids = new Set<number>([...this.registry.all().map((n) => n.nodeId)]);
    const out: NodeSample[] = [];
    for (const id of ids) {
      const s = buildSample(id, this.registry, this.sensing, this.config.vitals_enabled, now);
      if (s) out.push(s);
    }
    return out;
  }

  async telemetryTick() {
    const samples = this.collectSamples();
    for (const s of samples) this.outbox.pushMinutes(this.aggregator.add(s));
    this.outbox.pushMinutes(this.aggregator.flushStale());
    if (this.revoked) return;
    const minutes = this.outbox.takeMinutes(500);
    if (!samples.length && !minutes.length) return;
    try {
      const res = await this.cloud.telemetry({ samples, minutes });
      this.outbox.ackMinutes(minutes.length);
      this.lastTelemetryOk = Date.now();
      if (res.unknown_nodes.length) log.debug('cloud reports unregistered nodes', { nodes: res.unknown_nodes });
    } catch (e) {
      // Live samples are not buffered (stale by definition); minute buckets stay queued.
      this.handleCloudError('telemetry', e);
    }
    await this.flushEvents();
  }

  async flushEvents() {
    if (this.revoked || !this.outbox.events.length) return;
    const batch = this.outbox.takeEvents(200);
    try {
      await this.cloud.events({ events: batch });
      this.outbox.ackEvents(batch.length);
    } catch (e) {
      this.handleCloudError('events', e);
    }
  }

  async probeNodes() {
    for (const n of this.registry.all()) {
      if (Date.now() - n.lastSeen > 60_000) continue;
      this.otaCache.set(n.nodeId, await getOtaStatus(n.ip, this.cfg.nodeOtaPort));
    }
  }

  status() {
    return {
      gateway_id: this.creds?.gatewayId ?? null,
      revoked: this.revoked,
      known_nodes: [...this.knownNodes],
      seen_nodes: this.registry.all().map((n) => n.nodeId),
      udp: this.tap.stats,
      sensing: this.sensing.health,
      sensing_dropped_non_live: this.sensing.droppedNonLive,
      outbox: { minutes: this.outbox.minutes.length, events: this.outbox.events.length, dropped: this.outbox.dropped },
      last_heartbeat_ok: this.lastHeartbeatOk ? new Date(this.lastHeartbeatOk).toISOString() : null,
      last_telemetry_ok: this.lastTelemetryOk ? new Date(this.lastTelemetryOk).toISOString() : null,
    };
  }
}
