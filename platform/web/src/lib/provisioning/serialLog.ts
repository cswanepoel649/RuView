/**
 * Parses the esp32-csi-node boot log (firmware/esp32-csi-node/main/main.c,
 * nvs_config.c, ota_update.c) to confirm a freshly provisioned node is healthy.
 */
export interface BootStatus {
  booted: boolean;
  chip: string | null;
  version: string | null;
  nodeId: number | null;
  ssid: string | null;
  wifiRetries: number;
  wifiFailed: boolean;
  ip: string | null;
  streamingTo: string | null;
  edgeTier: number | null;
  otaAuth: boolean | null;
  mmwave: boolean | null;
  panic: boolean;
}

export const emptyBoot = (): BootStatus => ({
  booted: false, chip: null, version: null, nodeId: null, ssid: null, wifiRetries: 0, wifiFailed: false, ip: null,
  streamingTo: null, edgeTier: null, otaAuth: null, mmwave: null, panic: false,
});

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

export function parseBootLine(raw: string, s: BootStatus): BootStatus {
  const line = raw.replace(ANSI, '');
  const n = { ...s };
  let m: RegExpMatchArray | null;
  // ≤ v0.6: "ESP32-S3 CSI Node (ADR-018) — v0.6.2 — Node ID: 3"
  // ≥ v0.7: "ESP32-S3 CSI Node (ADR-018 / ADR-110) — v0.8.17 — Node ID: 3"
  if ((m = line.match(/(ESP32[\w-]*) CSI Node \(ADR-018[^)]*\) \S+ v(\S+) \S+ Node ID: (\d+)/))) {
    n.booted = true; n.chip = m[1]!; n.version = m[2]!; n.nodeId = Number(m[3]);
  }
  if ((m = line.match(/connecting to SSID: (.+)$/))) n.ssid = m[1]!.trim();
  if ((m = line.match(/Retrying WiFi connection \((\d+)\/\d+\)/) ?? line.match(/Reconnecting in \d+ ms \(attempt (\d+)\)/))) n.wifiRetries = Number(m[1]);
  // ≥ v0.7 keeps retrying in the background after "Not connected after N attempts"
  if (/Failed to connect to WiFi after|Not connected after \d+ attempts/.test(line)) n.wifiFailed = true;
  if ((m = line.match(/Got IP: (\d+\.\d+\.\d+\.\d+)/))) { n.ip = m[1]!; n.wifiFailed = false; }
  if ((m = line.match(/CSI streaming active \S+ (\d+\.\d+\.\d+\.\d+:\d+) \(edge_tier=(\d)/))) { n.streamingTo = m[1]!; n.edgeTier = Number(m[2]); }
  if (/OTA PSK loaded from NVS/.test(line)) n.otaAuth = true;
  if (/OTA authentication DISABLED|No OTA PSK in NVS/.test(line)) n.otaAuth = false;
  if ((m = line.match(/mmWave=(\w+)/))) n.mmwave = m[1] === 'active';
  if (/Guru Meditation|abort\(\) was called|assert failed|Stack overflow/.test(line)) n.panic = true;
  return n;
}

/** Splits a chunked serial stream into lines, keeping the partial tail. */
export class LineBuffer {
  private tail = '';
  private readonly dec = new TextDecoder();
  push(chunk: Uint8Array): string[] {
    const text = this.tail + this.dec.decode(chunk, { stream: true });
    const parts = text.split(/\r?\n/);
    this.tail = parts.pop() ?? '';
    return parts;
  }
}
