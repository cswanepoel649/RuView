/**
 * End-to-end agent test on real sockets, no hardware:
 *   fake ESP32 (UDP packets built byte-exact to firmware layout + OTA HTTP server)
 *   → agent UDP tap → forwarded to a UDP socket standing in for sensing-server
 *   fake sensing-server (HTTP /health, /api/v1/nodes, minimal RFC6455 WS)
 *   fake cloud (enroll / heartbeat / telemetry / events / command result / firmware download)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import dgram from 'node:dgram';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { encodeCsiFrame, encodeVitals } from '@ruview/shared/esp32';
import { Agent } from '../src/agent';
import { loadConfig } from '../src/config';
import { setLogSink } from '../src/log';

setLogSink(() => {}, 'error');

const listen = (srv: http.Server) => new Promise<number>((r) => srv.listen(0, '127.0.0.1', () => r((srv.address() as AddressInfo).port)));
const readBody = (req: http.IncomingMessage) => new Promise<Buffer>((r) => { const c: Buffer[] = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await sleep(25); }
  throw new Error('condition not met in time');
}

// ---------------------------------------------------------------- fake cloud
const cloud = { enrolls: [] as unknown[], heartbeats: [] as any[], telemetry: [] as any[], events: [] as any[], results: [] as any[],
  commands: [] as unknown[], authFailures: 0 };
const TOKEN = 'gw_' + 'a'.repeat(43);
const FIRMWARE = Buffer.concat([Buffer.from([0xe9]), Buffer.alloc(4095, 7)]);
const FW_SHA = createHash('sha256').update(FIRMWARE).digest('hex');

const cloudSrv = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const json = (code: number, obj: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/fw.bin') { res.writeHead(200); res.end(FIRMWARE); return; }
  if (req.url === '/api/gateway/v1/enroll') {
    cloud.enrolls.push(JSON.parse(body.toString()));
    return json(200, { gateway_id: '7b0f6f3e-7a35-4b51-9e2b-0d7c0f9e1a11', property_id: null, token: TOKEN });
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) { cloud.authFailures++; return json(401, { error: 'bad token' }); }
  const j = JSON.parse(body.toString() || '{}');
  switch (true) {
    case req.url === '/api/gateway/v1/heartbeat':
      cloud.heartbeats.push(j);
      return json(200, { server_time: new Date().toISOString(), property_id: null,
        config: { telemetry_interval_s: 5, heartbeat_interval_s: 30, vitals_enabled: true },
        node_map: [{ node_id: 1, device_id: 'f1b2c3d4-0000-4000-8000-000000000001', room_id: null, name: 'Living', hw_id: null }],
        commands: cloud.commands.splice(0) });
    case req.url === '/api/gateway/v1/telemetry':
      cloud.telemetry.push(j);
      return json(200, { accepted: j.samples.length, minutes: j.minutes.length, rejected: 0, unknown_nodes: [] });
    case req.url === '/api/gateway/v1/events':
      cloud.events.push(...j.events); return json(200, { created: j.events.length });
    case /\/api\/gateway\/v1\/commands\/.+\/result/.test(req.url!):
      cloud.results.push({ url: req.url, ...j }); return json(200, { ok: true });
  }
  json(404, { error: 'nope' });
});

// ------------------------------------------------------ fake sensing-server
let wsSockets: import('node:net').Socket[] = [];
let sensingSource = 'esp32';
const sensingSrv = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok', source: sensingSource, tick: 42, clients: 1 }));
  if (req.url === '/api/v1/nodes') return res.end(JSON.stringify({ nodes: [{ node_id: 1, status: 'active', person_count: 1 }] }));
  res.end('{}');
});
sensingSrv.on('upgrade', (req, socket) => {
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  wsSockets.push(socket as import('node:net').Socket);
});
function wsSend(text: string) {
  const payload = Buffer.from(text);
  const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  for (const s of wsSockets) s.write(Buffer.concat([header, payload]));
}

// ------------------------------------------------- fake ESP32 OTA endpoint
let nodeVersion = '0.6.2';
let nodeMaxSize = 921_600; // legacy firmware reports its fixed 900 KB gate
let otaUploads: { auth?: string; size: number }[] = [];
const PSK = 'b'.repeat(64);
const otaSrv = http.createServer(async (req, res) => {
  if (req.url === '/ota/status') { res.writeHead(200); res.end(JSON.stringify({ version: nodeVersion, running_partition: nodeVersion === '0.6.2' ? 'ota_0' : 'ota_1', ota_state: 'valid', max_size: nodeMaxSize })); return; }
  if (req.url === '/ota' && req.method === 'POST') {
    const b = await readBody(req);
    otaUploads.push({ auth: req.headers.authorization, size: b.length });
    if (req.headers.authorization !== `Bearer ${PSK}`) { res.writeHead(403); res.end('forbidden'); return; }
    res.writeHead(200); res.end('{"status":"ok"}');
    nodeVersion = '0.6.3';
    return;
  }
  res.writeHead(404); res.end();
});

// --------------------------------------------------------------- harness
let agent: Agent;
let sensingUdp: dgram.Socket;
const forwarded: Buffer[] = [];
let ports: { cloud: number; sensing: number; ota: number; tap: number; fwd: number };
const esp = dgram.createSocket('udp4');

beforeAll(async () => {
  sensingUdp = dgram.createSocket('udp4');
  sensingUdp.on('message', (m) => forwarded.push(m));
  await new Promise<void>((r) => sensingUdp.bind(0, '127.0.0.1', () => r()));
  ports = { cloud: await listen(cloudSrv), sensing: await listen(sensingSrv), ota: await listen(otaSrv), tap: 0, fwd: sensingUdp.address().port };
  const probe = dgram.createSocket('udp4');
  await new Promise<void>((r) => probe.bind(0, '127.0.0.1', () => r()));
  ports.tap = probe.address().port;
  await new Promise<void>((r) => probe.close(() => r()));

  const cfg = loadConfig({
    RUVIEW_CLOUD_URL: `http://127.0.0.1:${ports.cloud}`,
    RUVIEW_STATE_DIR: mkdtempSync(join(tmpdir(), 'ruview-agent-')),
    RUVIEW_ENROLLMENT_CODE: 'ABCD-EFGH-JKLM',
    RUVIEW_HW_ID: 'mid:0123456789abcdef0123456789abcdef',
    RUVIEW_UDP_LISTEN: `127.0.0.1:${ports.tap}`,
    RUVIEW_UDP_FORWARD: `127.0.0.1:${ports.fwd}`,
    RUVIEW_SENSING_WS: `ws://127.0.0.1:${ports.sensing}/ws/sensing`,
    RUVIEW_SENSING_HTTP: `http://127.0.0.1:${ports.sensing}`,
    RUVIEW_NODE_OTA_PORT: String(ports.ota),
  });
  agent = new Agent(cfg, { arp: () => new Map([['127.0.0.1', 'aa:bb:cc:00:00:01']]), otaPollMs: 50, otaRebootWaitMs: 3000 });
  await agent.start();
  await until(() => wsSockets.length > 0);
});

afterAll(async () => {
  await agent.stop();
  for (const s of wsSockets) s.destroy();
  await Promise.all([cloudSrv, sensingSrv, otaSrv].map((s) => new Promise((r) => s.close(r))));
  sensingUdp.close();
  esp.close();
});

const send = (buf: Uint8Array) => new Promise<void>((r) => esp.send(buf, ports.tap, '127.0.0.1', () => r()));

describe('ruview-agent end to end', () => {
  it('enrolls with the one-time code and stores credentials', () => {
    expect(cloud.enrolls).toHaveLength(1);
    expect(cloud.enrolls[0]).toMatchObject({ enrollment_code: 'ABCD-EFGH-JKLM', hw_id: 'mid:0123456789abcdef0123456789abcdef' });
    expect(cloud.heartbeats.length).toBeGreaterThanOrEqual(1);
  });

  it('relays ESP32 datagrams byte-for-byte to the sensing server and reports the node', async () => {
    const csi = encodeCsiFrame({ nodeId: 1, subcarriers: 64, freqMhz: 2437, sequence: 9, rssi: -52, noiseFloor: -91 });
    const vit = encodeVitals({ nodeId: 1, presence: true, fall: false, motion: true, breathingBpm: 16, heartBpm: 66, rssi: -51,
      persons: 1, motionEnergy: 0.4, presenceScore: 3, timestampMs: 5000 });
    await send(csi);
    await send(vit);
    await until(() => forwarded.length >= 2);
    expect(Buffer.compare(forwarded[0]!, Buffer.from(csi))).toBe(0);
    expect(Buffer.compare(forwarded[1]!, Buffer.from(vit))).toBe(0);

    await agent.sensing.pollOnce();
    wsSend(JSON.stringify({ type: 'sensing_update', source: 'esp32', node_features: [{ node_id: 1, classification: { presence: true, motion_level: 'present_moving', confidence: 0.82 }, frame_rate_hz: 20, stale: false }] }));
    await until(() => agent.sensing.node(1) !== null);
    await agent.heartbeat();
    const hb = cloud.heartbeats.at(-1);
    expect(hb.sensing).toMatchObject({ reachable: true, source: 'esp32' });
    expect(hb.nodes[0]).toMatchObject({ node_id: 1, ip: '127.0.0.1', mac: 'aa:bb:cc:00:00:01', rssi: -51, edge_tier_observed: 2 });
  });

  it('sends merged live samples', async () => {
    await agent.telemetryTick();
    const t = cloud.telemetry.at(-1);
    expect(t.samples[0]).toMatchObject({ node_id: 1, presence: true, motion_level: 'present_moving', person_count: 1, confidence: 0.82, source: 'merged',
      vitals: { breathing_bpm: 16, heart_bpm: 66, source: 'edge' } });
  });

  it('refuses to forward simulated sensing data as live', async () => {
    sensingSource = 'simulated';
    await agent.sensing.pollOnce();
    wsSend(JSON.stringify({ type: 'sensing_update', source: 'simulated', node_features: [{ node_id: 2, classification: { presence: true, motion_level: 'active' } }] }));
    await sleep(100);
    expect(agent.sensing.node(2)).toBeNull();
    expect(agent.sensing.isLive()).toBe(false);
    sensingSource = 'esp32';
    await agent.sensing.pollOnce();
  });

  it('reports on-device fall flags as edge events', async () => {
    await send(encodeVitals({ nodeId: 1, presence: true, fall: true, motion: true, breathingBpm: 0, heartBpm: 0, rssi: -50, persons: 1, motionEnergy: 3, presenceScore: 4, timestampMs: 9000 }));
    await until(() => cloud.events.length === 1);
    expect(cloud.events[0]).toMatchObject({ type: 'fall_detected', node_id: 1 });
  });

  it('executes OTA: verifies hash, pushes with PSK, confirms new version', async () => {
    cloud.commands.push({ id: '3c1f5f1e-1111-4a22-8b33-444455556666', device_id: 'f1b2c3d4-0000-4000-8000-000000000001', attempt: 1,
      node_id: 1, node_ip: '10.9.9.9', type: 'ota_update',
      payload: { release_id: '9f1f5f1e-1111-4a22-8b33-444455556666', version: '0.6.3', url: `http://127.0.0.1:${ports.cloud}/fw.bin`,
        sha256: FW_SHA, size: FIRMWARE.length, psk: PSK } });
    await agent.heartbeat();
    await Promise.all(agent.pending);
    expect(otaUploads).toEqual([{ auth: `Bearer ${PSK}`, size: FIRMWARE.length }]);
    expect(cloud.results.at(-1)).toMatchObject({ success: true, result: { version: '0.6.3', previous_version: '0.6.2' } });
  });

  it('rejects OTA images with a bad hash or over the firmware size gate without touching the node', async () => {
    otaUploads = [];
    cloud.commands.push(
      { id: '4c1f5f1e-1111-4a22-8b33-444455556666', device_id: 'f1b2c3d4-0000-4000-8000-000000000001', attempt: 1, node_id: 1, node_ip: null, type: 'ota_update',
        payload: { release_id: '9f1f5f1e-1111-4a22-8b33-444455556666', version: '0.6.4', url: `http://127.0.0.1:${ports.cloud}/fw.bin`, sha256: 'c'.repeat(64), size: FIRMWARE.length, psk: PSK } },
      { id: '5c1f5f1e-1111-4a22-8b33-444455556666', device_id: 'f1b2c3d4-0000-4000-8000-000000000001', attempt: 1, node_id: 1, node_ip: null, type: 'ota_update',
        payload: { release_id: '9f1f5f1e-1111-4a22-8b33-444455556666', version: '0.6.4', url: `http://127.0.0.1:${ports.cloud}/fw.bin`, sha256: FW_SHA, size: 990_480, psk: PSK } });
    await agent.heartbeat();
    await Promise.all(agent.pending);
    const byId = (id: string) => cloud.results.find((r) => r.url.includes(id));
    expect(byId('4c1f5f1e')).toMatchObject({ success: false, error: expect.stringMatching(/sha256 mismatch/) });
    expect(byId('5c1f5f1e')).toMatchObject({ success: false, error: expect.stringMatching(/OTA limit is 921600/) });
    expect(otaUploads).toEqual([]);
  });

  it('uses the limit reported by current firmware (partition-sized OTA)', async () => {
    nodeMaxSize = 0x200000; // current firmware: ota_1 partition size
    otaUploads = [];
    const big = 1_120_384; // upstream 8 MB app image size
    cloud.commands.push({ id: '6c1f5f1e-1111-4a22-8b33-444455556666', device_id: 'f1b2c3d4-0000-4000-8000-000000000001', attempt: 1, node_id: 1, node_ip: null, type: 'ota_update',
      payload: { release_id: '9f1f5f1e-1111-4a22-8b33-444455556666', version: '0.8.17', url: `http://127.0.0.1:${ports.cloud}/fw.bin`, sha256: FW_SHA, size: big, psk: PSK } });
    await agent.heartbeat();
    await Promise.all(agent.pending);
    // passes the size gate and proceeds to download; fails only on the (deliberately) mismatched size
    expect(cloud.results.find((r) => r.url.includes('6c1f5f1e'))).toMatchObject({ success: false, error: expect.stringMatching(/size mismatch/) });
  });

  it('buffers minute buckets while the cloud is down and replays them', async () => {
    const before = agent.outbox.minutes.length;
    agent.outbox.pushMinutes([{ node_id: 1, bucket: new Date(Date.now() - 120_000).toISOString(), samples: 3, presence_ratio: 1, max_persons: 1 }]);
    expect(agent.outbox.minutes.length).toBe(before + 1);
    await agent.telemetryTick();
    expect(agent.outbox.minutes.length).toBe(0);
    expect(cloud.telemetry.at(-1).minutes.length).toBeGreaterThanOrEqual(1);
  });
});
