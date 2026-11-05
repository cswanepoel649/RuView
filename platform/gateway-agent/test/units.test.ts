import { describe, expect, it } from 'vitest';
import { encodeCsiFrame, encodeVitals, decodePacket } from '@ruview/shared/esp32';
import { NodeRegistry } from '../src/nodeRegistry';
import { SensingClient } from '../src/sensingClient';
import { buildSample } from '../src/merge';
import { MinuteAggregator } from '../src/aggregator';
import { parseArp } from '../src/host';
import { loadConfig } from '../src/config';

const vit = (o: Partial<Parameters<typeof encodeVitals>[0]> = {}) => decodePacket(encodeVitals({
  nodeId: 1, presence: true, fall: false, motion: true, breathingBpm: 15, heartBpm: 70, rssi: -55, persons: 2,
  motionEnergy: 0.3, presenceScore: 2.1, timestampMs: 1, ...o }))!;

describe('NodeRegistry', () => {
  it('tracks ip, rssi (correct offset), rates and edge tier', () => {
    let t = 1_000_000;
    const r = new NodeRegistry(() => t);
    for (let i = 0; i < 20; i++) { r.observe(decodePacket(encodeCsiFrame({ nodeId: 4, subcarriers: 64, freqMhz: 2437, sequence: i, rssi: -47, noiseFloor: -90 }))!, '10.0.0.4'); t += 50; }
    expect(r.get(4)!.rssi).toBe(-47);
    expect(r.rate(4, 'csi')).toBe(2);
    expect(r.edgeTier(4)).toBe(0);
    r.observe({ ...vit(), nodeId: 4 } as never, '10.0.0.5');
    expect(r.edgeTier(4)).toBe(2);
    expect(r.get(4)!.ipChanged).toBe(true);
  });
  it('emits a fall event on the rising edge only, debounced', () => {
    let t = 0;
    const r = new NodeRegistry(() => t);
    const falls: number[] = [];
    r.onFall((e) => falls.push(e.occurredAt));
    r.observe(vit({ fall: true }), 'ip'); t += 1000;
    r.observe(vit({ fall: true }), 'ip'); t += 1000;
    r.observe(vit({ fall: false }), 'ip'); t += 1000;
    r.observe(vit({ fall: true }), 'ip');           // within 10 s debounce
    t += 20_000; r.observe(vit({ fall: false }), 'ip'); r.observe(vit({ fall: true }), 'ip');
    expect(falls).toEqual([0, 23_000]);
  });
});

describe('merge', () => {
  it('prefers edge presence, server motion level, and never emits without fresh data', () => {
    let t = 50_000;
    const reg = new NodeRegistry(() => t);
    const s = new SensingClient('ws://x', 'http://x', () => t);
    expect(buildSample(1, reg, s, false, t)).toBeNull();
    reg.observe(vit({ presence: true, motion: false }), '10.0.0.9');
    let sample = buildSample(1, reg, s, false, t)!;
    expect(sample).toMatchObject({ presence: true, motion_level: 'present_still', person_count: 2, source: 'edge', rssi: -55 });
    expect(sample.vitals).toBeUndefined();
    s.health = { reachable: true, source: 'esp32', tick: 1, clients: 0, error: null, checkedAt: t };
    s.handleMessage(JSON.stringify({ type: 'sensing_update', source: 'esp32', node_features: [{ node_id: 1, classification: { presence: true, motion_level: 'active', confidence: 0.9 }, frame_rate_hz: 19.5, stale: false }] }));
    sample = buildSample(1, reg, s, true, t)!;
    expect(sample).toMatchObject({ motion_level: 'active', confidence: 0.9, source: 'merged' });
    expect(sample.vitals).toEqual({ breathing_bpm: 15, heart_bpm: 70, source: 'edge' });
    t += 5000; // both stale
    expect(buildSample(1, reg, s, true, t)).toBeNull();
  });
  it('drops non-live (simulated) sensing-server data', () => {
    const s = new SensingClient('ws://x', 'http://x');
    s.handleMessage(JSON.stringify({ type: 'sensing_update', source: 'simulated', node_features: [{ node_id: 1, classification: { presence: true, motion_level: 'active' } }] }));
    expect(s.node(1)).toBeNull();
    expect(s.droppedNonLive).toBe(1);
  });
  it('forces motion absent when not present', () => {
    const reg = new NodeRegistry();
    const s = new SensingClient('ws://x', 'http://x');
    reg.observe(vit({ presence: false, motion: true, persons: 0 }), 'ip');
    expect(buildSample(1, reg, s, false)).toMatchObject({ presence: false, motion_level: 'absent', person_count: 0 });
  });
});

describe('SensingClient start-up grace', () => {
  it('waits for a late sensing-server and gives up after the bound', async () => {
    const http = await import('node:http');
    let up = false;
    const srv = http.createServer((_, res) => { if (!up) { res.destroy(); return; } res.end('{"status":"ok","source":"esp32","tick":1}'); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as { port: number }).port;
    const s = new SensingClient('ws://127.0.0.1:1/ws', `http://127.0.0.1:${port}`);
    setTimeout(() => { up = true; }, 150);
    expect(await s.waitUntilReachable(3000, 50)).toBe(true);
    expect(s.health.source).toBe('esp32');
    const dead = new SensingClient('ws://127.0.0.1:1/ws', 'http://127.0.0.1:1');
    expect(await dead.waitUntilReachable(120, 40)).toBe(false);
    srv.close();
  });
});

describe('MinuteAggregator', () => {
  it('closes buckets on rollover and when stale', () => {
    const a = new MinuteAggregator();
    const base = Date.UTC(2026, 0, 1, 10, 0, 0);
    const mk = (t: number, presence: boolean) => ({ node_id: 1, observed_at: new Date(t).toISOString(), presence, motion_level: presence ? 'active' as const : 'absent' as const,
      person_count: presence ? 1 : 0, source: 'edge' as const, rssi: -50, motion_energy: presence ? 0.5 : 0.1 });
    expect(a.add(mk(base + 1000, true))).toEqual([]);
    a.add(mk(base + 6000, false));
    const closed = a.add(mk(base + 61_000, true));
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ bucket: new Date(base).toISOString(), samples: 2, presence_ratio: 0.5, max_persons: 1, active_ratio: 0.5, avg_rssi: -50, max_motion_energy: 0.5 });
    expect(a.add(mk(base + 2000, true))).toEqual([]); // late sample dropped
    expect(a.flushStale(base + 125_000)).toHaveLength(1);
  });
});

describe('host + config', () => {
  it('parses /proc/net/arp', () => {
    const m = parseArp(`IP address       HW type     Flags       HW address            Mask     Device
192.168.1.41     0x1         0x2         AA:BB:CC:00:00:01     *        eth0
192.168.1.50     0x1         0x0         00:00:00:00:00:00     *        eth0`);
    expect([...m]).toEqual([['192.168.1.41', 'aa:bb:cc:00:00:01']]);
  });
  it('requires https cloud url and distinct udp ports', () => {
    expect(() => loadConfig({})).toThrow(/RUVIEW_CLOUD_URL/);
    expect(() => loadConfig({ RUVIEW_CLOUD_URL: 'http://monitor.example.com' })).toThrow(/https/);
    expect(loadConfig({ RUVIEW_CLOUD_URL: 'http://localhost:3000' }).cloudUrl).toBe('http://localhost:3000');
    expect(loadConfig({ RUVIEW_CLOUD_URL: 'https://x.test', RUVIEW_ARP: 'off' }).arpEnabled).toBe(false);
    expect(() => loadConfig({ RUVIEW_CLOUD_URL: 'https://x.test', RUVIEW_UDP_FORWARD: '127.0.0.1:5005' })).toThrow(/differ/);
  });
});
