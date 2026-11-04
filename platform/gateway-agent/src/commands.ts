/**
 * Executes cloud commands against ESP32 nodes on the LAN.
 *
 * ota_update → firmware/esp32-csi-node/main/ota_update.c:
 *   GET  http://<node>:8032/ota/status   {"version","running_partition",...}
 *   POST http://<node>:8032/ota          raw app image, "Authorization: Bearer <psk>"
 * Current firmware accepts images up to the OTA partition and reports that limit
 * as `max_size` in /ota/status (firmware ≤ v0.6.x reported its fixed 900 KB gate),
 * so the node's own reported limit is checked before transferring.
 */
import { createHash } from 'node:crypto';
import type { GatewayCommand } from '@ruview/shared/protocol';
import type { NodeRegistry } from './nodeRegistry';
import { errMsg, log } from './log';

export interface CommandOutcome {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export interface OtaStatus {
  reachable: boolean;
  version: string | null;
  running_partition: string | null;
  ota_state: string | null;
  max_size: number | null;
  checked_at: string;
}

export async function getOtaStatus(ip: string, port: number, timeoutMs = 3000): Promise<OtaStatus> {
  const checked_at = new Date().toISOString();
  try {
    const res = await fetch(`http://${ip}:${port}/ota/status`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { reachable: true, version: null, running_partition: null, ota_state: null, max_size: null, checked_at };
    const j = (await res.json()) as Record<string, unknown>;
    const max = Number(j.max_size);
    return {
      reachable: true,
      version: typeof j.version === 'string' ? j.version.slice(0, 64) : null,
      running_partition: typeof j.running_partition === 'string' ? j.running_partition.slice(0, 32) : null,
      ota_state: typeof j.ota_state === 'string' ? j.ota_state.slice(0, 32) : null,
      max_size: Number.isInteger(max) && max > 0 ? max : null,
      checked_at,
    };
  } catch {
    return { reachable: false, version: null, running_partition: null, ota_state: null, max_size: null, checked_at };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class CommandRunner {
  private readonly inFlight = new Set<string>();
  /** completed ids → avoid re-running a re-dispatched command whose result failed to upload */
  private readonly done = new Map<string, CommandOutcome>();

  constructor(
    private readonly registry: NodeRegistry,
    private readonly otaPort: number,
    private readonly opts: { rebootWaitMs?: number; pollMs?: number } = {},
  ) {}

  isBusy(id: string) {
    return this.inFlight.has(id);
  }

  async run(cmd: GatewayCommand, onRestart?: () => void): Promise<CommandOutcome | null> {
    if (this.inFlight.has(cmd.id)) return null;
    const cached = this.done.get(cmd.id);
    if (cached) return cached;
    this.inFlight.add(cmd.id);
    try {
      let out: CommandOutcome;
      switch (cmd.type) {
        case 'ota_update': out = await this.ota(cmd); break;
        case 'probe_node': out = await this.probe(cmd); break;
        case 'restart_agent':
          out = { success: true, result: { restarting: true } };
          setTimeout(() => onRestart?.(), 500);
          break;
      }
      this.done.set(cmd.id, out);
      if (this.done.size > 200) this.done.delete(this.done.keys().next().value!);
      return out;
    } catch (e) {
      return { success: false, error: errMsg(e).slice(0, 2000) };
    } finally {
      this.inFlight.delete(cmd.id);
    }
  }

  /** Prefer the IP we actually see packets from; fall back to the cloud's last known IP. */
  private nodeIp(cmd: GatewayCommand): string {
    const live = cmd.node_id != null ? this.registry.get(cmd.node_id)?.ip : undefined;
    const ip = live ?? cmd.node_ip;
    if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error('node IP unknown — node has not been seen by this gateway');
    return ip;
  }

  private async probe(cmd: GatewayCommand): Promise<CommandOutcome> {
    const st = await getOtaStatus(this.nodeIp(cmd), this.otaPort);
    if (!st.reachable) return { success: false, error: 'node OTA endpoint unreachable on port ' + this.otaPort };
    return { success: true, result: { ...st } };
  }

  private async ota(cmd: Extract<GatewayCommand, { type: 'ota_update' }>): Promise<CommandOutcome> {
    const p = cmd.payload;
    const ip = this.nodeIp(cmd);
    const before = await getOtaStatus(ip, this.otaPort);
    if (!before.reachable) return { success: false, error: `node ${ip}:${this.otaPort} unreachable` };
    if (before.max_size != null && p.size > before.max_size) {
      return { success: false, error: `image is ${p.size} bytes; this node's firmware OTA limit is ${before.max_size} bytes — flash over USB instead` };
    }

    log.info('ota: downloading image', { command: cmd.id, version: p.version, size: p.size });
    const dl = await fetch(p.url, { signal: AbortSignal.timeout(120_000) });
    if (!dl.ok) return { success: false, error: `firmware download failed: HTTP ${dl.status}` };
    const img = new Uint8Array(await dl.arrayBuffer());
    if (img.length !== p.size) return { success: false, error: `size mismatch: expected ${p.size}, got ${img.length}` };
    const sha = createHash('sha256').update(img).digest('hex');
    if (sha !== p.sha256) return { success: false, error: 'sha256 mismatch — refusing to flash' };
    if (img[0] !== 0xe9) return { success: false, error: 'not an ESP32 application image (missing 0xE9 magic)' };

    log.info('ota: pushing to node', { command: cmd.id, ip });
    let res: Response;
    try {
      res = await fetch(`http://${ip}:${this.otaPort}/ota`, {
        method: 'POST',
        headers: { authorization: `Bearer ${p.psk}`, 'content-type': 'application/octet-stream' },
        body: img,
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      return { success: false, error: `upload failed: ${errMsg(e)}` };
    }
    const body = (await res.text()).slice(0, 500);
    if (res.status === 403) return { success: false, error: 'node rejected OTA PSK (403) — device may need re-provisioning' };
    if (!res.ok) return { success: false, error: `node returned HTTP ${res.status}: ${body}` };

    // Device reboots ~1 s after a successful upload; wait for it to come back.
    const deadline = Date.now() + (this.opts.rebootWaitMs ?? 120_000);
    await sleep(this.opts.pollMs ?? 5000);
    while (Date.now() < deadline) {
      const st = await getOtaStatus(ip, this.otaPort);
      if (st.reachable && st.version) {
        const ok = st.version === p.version || st.version !== before.version || st.running_partition !== before.running_partition;
        return ok
          ? { success: true, result: { version: st.version, previous_version: before.version, running_partition: st.running_partition, ota_state: st.ota_state, max_size: st.max_size } }
          : { success: false, error: `node came back still running ${st.version} (rollback?)` };
      }
      await sleep(this.opts.pollMs ?? 5000);
    }
    return { success: false, error: 'node did not come back within the reboot window' };
  }
}
