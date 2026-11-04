/**
 * RuView esp32-csi-node provisioning → NVS entries.
 *
 * Key names, types and ordering mirror `firmware/esp32-csi-node/provision.py`
 * (`build_nvs_csv`) and the firmware reader `main/nvs_config.c` (namespace
 * "csi_cfg"). In addition the platform always writes the OTA pre-shared key
 * (`main/ota_update.c`, namespace "security", key "ota_psk") so the device's
 * OTA endpoint is never left unauthenticated.
 *
 * Full-replace semantics (provision.py issue #391): flashing this image at
 * 0x9000 replaces the whole NVS partition, so every value must be present.
 */
import { generateNvsImage, NvsError, type NvsEntry } from './generator';

/** NVS partition location for both 8 MB (partitions_display.csv) and 4 MB (partitions_4mb.csv) layouts. */
export const NVS_PARTITION_OFFSET = 0x9000;
export const NVS_PARTITION_SIZE = 0x6000;

export interface NodeProvisioningConfig {
  /** 2.4 GHz SSID (ESP32-S3 has no 5 GHz radio). */
  ssid: string;
  /** WPA2 passphrase; empty string = open network. */
  password: string;
  /** IPv4 of the home gateway running the ruview-agent UDP tap. */
  targetIp: string;
  targetPort?: number;
  nodeId: number;
  tdmSlot?: number;
  tdmTotal?: number;
  /** 0 = raw CSI only, 1 = basic DSP, 2 = full pipeline (presence/vitals/fall). */
  edgeTier?: 0 | 1 | 2;
  /** Presence threshold ×1000 (0 = auto-calibrate). */
  presThresh?: number;
  /** Fall threshold ×1000 (rad/s²). */
  fallThresh?: number;
  vitalWindow?: number;
  vitalIntervalMs?: number;
  topKSubcarriers?: number;
  /** Explicit CSI channel override (2.4 GHz 1-14). */
  channel?: number;
  filterMac?: string;
  hopChannels?: number[];
  hopDwellMs?: number;
  seedUrl?: string;
  seedToken?: string;
  zone?: string;
  swarmHeartbeatS?: number;
  swarmIngestS?: number;
  /** Platform additions (not in provision.py): */
  otaPsk?: string;
  wasmVerify?: boolean;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const MAC = /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/;

function intIn(name: string, v: number | undefined, lo: number, hi: number) {
  if (v === undefined) return;
  if (!Number.isInteger(v) || v < lo || v > hi) throw new NvsError(`${name} must be an integer in [${lo}, ${hi}]`);
}

/** Validates the config with the same rules as provision.py plus firmware field limits. */
export function validateProvisioningConfig(c: NodeProvisioningConfig): void {
  const enc = new TextEncoder();
  if (!c.ssid || enc.encode(c.ssid).length > 32) throw new NvsError('SSID is required and must be at most 32 bytes');
  if (enc.encode(c.password).length > 64) throw new NvsError('WiFi password must be at most 64 bytes');
  if (c.password.length > 0 && c.password.length < 8) throw new NvsError('WPA2 passwords must be at least 8 characters');
  if (!IPV4.test(c.targetIp)) throw new NvsError('Target (gateway) IP must be an IPv4 address');
  intIn('targetPort', c.targetPort, 1, 65535);
  intIn('nodeId', c.nodeId, 0, 255);
  if ((c.tdmSlot === undefined) !== (c.tdmTotal === undefined)) throw new NvsError('tdmSlot and tdmTotal must be set together');
  intIn('tdmTotal', c.tdmTotal, 1, 255);
  if (c.tdmSlot !== undefined && c.tdmTotal !== undefined && !(c.tdmSlot >= 0 && c.tdmSlot < c.tdmTotal)) {
    throw new NvsError('tdmSlot must be less than tdmTotal');
  }
  intIn('edgeTier', c.edgeTier, 0, 2);
  intIn('presThresh', c.presThresh, 0, 65535);
  intIn('fallThresh', c.fallThresh, 0, 65535);
  intIn('vitalWindow', c.vitalWindow, 32, 256);
  intIn('vitalIntervalMs', c.vitalIntervalMs, 100, 65535);
  intIn('topKSubcarriers', c.topKSubcarriers, 1, 32);
  if (c.channel !== undefined && !((c.channel >= 1 && c.channel <= 14) || (c.channel >= 36 && c.channel <= 177))) {
    throw new NvsError('channel must be 1-14 (2.4 GHz) or 36-177 (5 GHz)');
  }
  if (c.filterMac !== undefined && !MAC.test(c.filterMac)) throw new NvsError('filterMac must be AA:BB:CC:DD:EE:FF');
  if (c.hopChannels !== undefined) {
    if (c.hopChannels.length < 1 || c.hopChannels.length > 6) throw new NvsError('hopChannels must list 1-6 channels');
    c.hopChannels.forEach((ch) => intIn('hop channel', ch, 1, 177));
  }
  intIn('hopDwellMs', c.hopDwellMs, 10, 0xffffffff);
  if (c.seedUrl !== undefined && enc.encode(c.seedUrl).length > 63) throw new NvsError('seedUrl too long (max 63)');
  if (c.seedToken !== undefined && enc.encode(c.seedToken).length > 63) throw new NvsError('seedToken too long (max 63)');
  if (c.zone !== undefined && enc.encode(c.zone).length > 15) throw new NvsError('zone name too long (max 15)');
  intIn('swarmHeartbeatS', c.swarmHeartbeatS, 0, 65535);
  intIn('swarmIngestS', c.swarmIngestS, 0, 65535);
  if (c.otaPsk !== undefined && !/^[0-9a-f]{64}$/.test(c.otaPsk)) {
    throw new NvsError('otaPsk must be exactly 64 lowercase hex characters (firmware ota_psk buffer / provision.py)');
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Ordered entries — identical order to provision.py build_nvs_csv(), then platform extras. */
export function provisioningEntries(c: NodeProvisioningConfig): NvsEntry[] {
  validateProvisioningConfig(c);
  const e: NvsEntry[] = [{ type: 'namespace', key: 'csi_cfg' }];
  const str = (key: string, value: string) => e.push({ type: 'data', key, encoding: 'string', value });
  const u8 = (key: string, value: number) => e.push({ type: 'data', key, encoding: 'u8', value });
  const u16 = (key: string, value: number) => e.push({ type: 'data', key, encoding: 'u16', value });
  const u32 = (key: string, value: number) => e.push({ type: 'data', key, encoding: 'u32', value });
  const bin = (key: string, value: Uint8Array) => e.push({ type: 'data', key, encoding: 'binary', value });

  str('ssid', c.ssid);
  str('password', c.password);
  str('target_ip', c.targetIp);
  if (c.targetPort !== undefined) u16('target_port', c.targetPort);
  u8('node_id', c.nodeId);
  if (c.tdmSlot !== undefined) u8('tdm_slot', c.tdmSlot);
  if (c.tdmTotal !== undefined) u8('tdm_nodes', c.tdmTotal);
  if (c.edgeTier !== undefined) u8('edge_tier', c.edgeTier);
  if (c.presThresh !== undefined) u16('pres_thresh', c.presThresh);
  if (c.fallThresh !== undefined) u16('fall_thresh', c.fallThresh);
  if (c.vitalWindow !== undefined) u16('vital_win', c.vitalWindow);
  if (c.vitalIntervalMs !== undefined) u16('vital_int', c.vitalIntervalMs);
  if (c.topKSubcarriers !== undefined) u8('subk_count', c.topKSubcarriers);
  if (c.channel !== undefined) u8('csi_channel', c.channel);
  if (c.filterMac !== undefined) bin('filter_mac', hexToBytes(c.filterMac.replace(/:/g, '')));
  if (c.hopChannels !== undefined) {
    u8('hop_count', c.hopChannels.length);
    bin('chan_list', Uint8Array.from(c.hopChannels));
    u32('dwell_ms', c.hopDwellMs ?? 200);
  }
  if (c.seedUrl !== undefined) str('seed_url', c.seedUrl);
  if (c.seedToken !== undefined) str('seed_token', c.seedToken);
  if (c.zone !== undefined) str('zone_name', c.zone);
  if (c.swarmHeartbeatS !== undefined) u16('swarm_hb', c.swarmHeartbeatS);
  if (c.swarmIngestS !== undefined) u16('swarm_ingest', c.swarmIngestS);
  // ---- platform additions ----
  if (c.wasmVerify !== undefined) u8('wasm_verify', c.wasmVerify ? 1 : 0);
  if (c.otaPsk !== undefined) {
    e.push({ type: 'namespace', key: 'security' });
    str('ota_psk', c.otaPsk);
  }
  return e;
}

export function buildProvisioningNvs(c: NodeProvisioningConfig): Uint8Array {
  return generateNvsImage(provisioningEntries(c), NVS_PARTITION_SIZE);
}

/** Non-secret snapshot persisted server-side after provisioning (never includes passwords/PSKs). */
export function redactProvisioningConfig(c: NodeProvisioningConfig) {
  const { password: _p, otaPsk, seedToken, ...rest } = c;
  return { ...rest, passwordSet: c.password.length > 0, otaPskSet: !!otaPsk, seedTokenSet: !!seedToken };
}
