import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { md5Hex } from '../src/lib/provisioning/md5';
import { emptyBoot, LineBuffer, parseBootLine } from '../src/lib/provisioning/serialLog';

describe('md5', () => {
  it('matches node:crypto for various sizes', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 70_001]) {
      const buf = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);
      expect(md5Hex(buf)).toBe(createHash('md5').update(buf).digest('hex'));
    }
  });
});

describe('boot log parser (strings from firmware main.c)', () => {
  const log = [
    '\x1b[0;32mI (321) main: ESP32-S3 CSI Node (ADR-018) — v0.6.2 — Node ID: 3\x1b[0m',
    'I (330) ota_update: OTA PSK loaded from NVS (64 chars) — authentication enabled',
    'I (345) main: WiFi STA initialized, connecting to SSID: HomeNet-2G',
    'I (900) main: Retrying WiFi connection (1/10)',
    'I (1023) main: Got IP: 192.168.1.41',
    'I (1025) main: CSI streaming active → 192.168.1.20:5005 (edge_tier=2, OTA=ready, WASM=ready, mmWave=off, swarm=off, adapt=on)',
  ];
  it('extracts health facts', () => {
    const s = log.reduce((acc, l) => parseBootLine(l, acc), emptyBoot());
    expect(s).toMatchObject({ booted: true, version: '0.6.2', nodeId: 3, ssid: 'HomeNet-2G', wifiRetries: 1, ip: '192.168.1.41',
      streamingTo: '192.168.1.20:5005', edgeTier: 2, otaAuth: true, mmwave: false, panic: false, wifiFailed: false });
  });
  it('detects wifi failure and panics', () => {
    let s = parseBootLine('E (9000) main: Failed to connect to WiFi after 10 retries', emptyBoot());
    expect(s.wifiFailed).toBe(true);
    s = parseBootLine('Guru Meditation Error: Core  1 panic', s);
    expect(s.panic).toBe(true);
  });
  it('reassembles lines across chunks', () => {
    const lb = new LineBuffer();
    const enc = new TextEncoder();
    expect(lb.push(enc.encode('I (1) main: Got '))).toEqual([]);
    expect(lb.push(enc.encode('IP: 10.0.0.9\r\nI (2) x'))).toEqual(['I (1) main: Got IP: 10.0.0.9']);
  });
});
