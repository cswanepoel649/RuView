/** Host facts for heartbeat: LAN IPs, ARP (IP→MAC), load/memory/disk/temperature. */
import { networkInterfaces, loadavg, freemem, totalmem, hostname, platform, arch } from 'node:os';
import { readFileSync, statfsSync } from 'node:fs';
import type { HeartbeatRequest } from '@ruview/shared/protocol';

export function lanIps(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out.slice(0, 8);
}

/** Parse /proc/net/arp → Map<ip, mac>. ESP32 base MAC == WiFi STA MAC seen here. */
export function parseArp(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const [ip, , flags, mac] = cols as [string, string, string, string];
    if (flags === '0x0' || !/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(mac) || mac === '00:00:00:00:00:00') continue;
    m.set(ip, mac.toLowerCase());
  }
  return m;
}

export function readArp(): Map<string, string> {
  try {
    return parseArp(readFileSync('/proc/net/arp', 'utf8'));
  } catch {
    return new Map();
  }
}

export function systemInfo(stateDir: string): NonNullable<HeartbeatRequest['system']> {
  let disk: number | null = null;
  try {
    const s = statfsSync(stateDir);
    disk = Math.round((s.bavail * s.bsize) / 1048576);
  } catch { /* not available */ }
  let temp: number | null = null;
  try {
    const t = Number(readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim());
    if (Number.isFinite(t)) temp = Math.round(t / 100) / 10;
  } catch { /* not available */ }
  return {
    hostname: hostname().slice(0, 128),
    platform: `${platform()}-${arch()}`,
    load1: Math.round(loadavg()[0]! * 100) / 100,
    mem_free_mb: Math.round(freemem() / 1048576),
    mem_total_mb: Math.round(totalmem() / 1048576),
    disk_free_mb: disk,
    cpu_temp_c: temp,
  };
}
