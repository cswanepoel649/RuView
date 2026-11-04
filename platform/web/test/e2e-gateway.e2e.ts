/**
 * End-to-end gateway path with no mocks of our own code:
 *   ESP32 UDP packets (firmware byte layout) → ruview-agent (real) → HTTP →
 *   Next.js route handlers (real) → Postgres functions/RLS schema (real).
 * Only the supabase-js transport is replaced: rpc() executes the same SQL
 * function directly over pg (PostgREST itself is not available in CI here).
 * Run with: bash platform/supabase/tests/e2e.sh
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import dgram from 'node:dgram';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { encodeVitals } from '@ruview/shared/esp32';

const pool = new pg.Pool({ connectionString: process.env.PG_TEST_URL });

vi.mock('@/lib/supabase/admin', () => ({
  adminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      if (!/^[a-z_]+$/.test(fn)) throw new Error('bad fn');
      const keys = Object.keys(args);
      const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
      try {
        const { rows } = await pool.query(sql, keys.map((k) => { const v = args[k]; return v == null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v); }));
        return { data: rows[0].r, error: null };
      } catch (e) {
        const err = e as { code?: string; message: string };
        return { data: null, error: { code: err.code, message: err.message } };
      }
    },
    from: () => { throw new Error('table access not expected on this path'); },
  }),
}));

const { POST: enroll } = await import('../src/app/api/gateway/v1/enroll/route');
const { POST: heartbeat } = await import('../src/app/api/gateway/v1/heartbeat/route');
const { POST: telemetry } = await import('../src/app/api/gateway/v1/telemetry/route');
const { POST: events } = await import('../src/app/api/gateway/v1/events/route');
const { GET: health } = await import('../src/app/api/health/route');
const { Agent } = await import('../../gateway-agent/src/agent');
const { loadConfig } = await import('../../gateway-agent/src/config');
const { setLogSink } = await import('../../gateway-agent/src/log');
setLogSink(() => {}, 'error');

const ROUTES: Record<string, (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>> = {
  'POST /api/gateway/v1/enroll': enroll, 'POST /api/gateway/v1/heartbeat': heartbeat,
  'POST /api/gateway/v1/telemetry': telemetry, 'POST /api/gateway/v1/events': events,
};

const IDS = {
  client: '0000000c-0000-0000-0000-0000000000e1', property: '0000000b-0000-0000-0000-0000000000e1',
  room: '00000001-0000-0000-0000-0000000000e1', gateway: '0000000d-0000-0000-0000-0000000000e0', sensor: '0000000d-0000-0000-0000-0000000000e1',
};
const CODE = 'ABCD-EFGH-JKMN';
const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;

let server: http.Server;
let base: string;
let agent: InstanceType<typeof Agent>;
const esp = dgram.createSocket('udp4');
let tapPort = 0;
const sensing = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(req.url === '/health' ? '{"status":"ok","source":"esp32","tick":1}' : '{"nodes":[]}'); });

beforeAll(async () => {
  await q(`insert into public.clients (id, display_name) values ($1, 'E2E household')`, [IDS.client]);
  await q(`insert into public.properties (id, client_id, name, exit_delay_s) values ($1, $2, 'E2E home', 0)`, [IDS.property, IDS.client]);
  await q(`insert into public.rooms (id, property_id, client_id, name) values ($1, $2, $3, 'Lounge')`, [IDS.room, IDS.property, IDS.client]);
  await q(`insert into public.devices (id, kind, model_id, name, property_id, status) values ($1, 'gateway', 'gateway-rpi', 'E2E gw', $2, 'assigned')`, [IDS.gateway, IDS.property]);
  await q(`insert into public.devices (id, kind, model_id, name, property_id, room_id, gateway_id, node_id, status, hw_id) values ($1, 'sensor_node', 'esp32s3-8mb', 'Lounge node', $2, $3, $4, 1, 'provisioned', 'aa:bb:cc:dd:ee:01')`, [IDS.sensor, IDS.property, IDS.room, IDS.gateway]);
  await q(`insert into public.gateway_enrollments (device_id, code_hash, expires_at) values ($1, $2, now() + interval '1 day')`, [IDS.gateway, createHash('sha256').update(CODE).digest('hex')]);

  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const url = new URL(req.url!, 'http://127.0.0.1');
    const key = `${req.method} ${url.pathname}`;
    const handler = ROUTES[key];
    const r = url.pathname === '/api/health' ? health() : handler
      ? await handler(new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: chunks.length ? Buffer.concat(chunks) : undefined }), { params: Promise.resolve({}) })
      : new Response('{"error":"not found"}', { status: 404 });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await new Promise<void>((ok) => sensing.listen(0, '127.0.0.1', () => ok()));
  const probe = dgram.createSocket('udp4');
  await new Promise<void>((ok) => probe.bind(0, '127.0.0.1', () => ok()));
  tapPort = probe.address().port;
  await new Promise<void>((ok) => probe.close(() => ok()));
  const sink = dgram.createSocket('udp4');
  await new Promise<void>((ok) => sink.bind(0, '127.0.0.1', () => ok()));
  agent = new Agent(loadConfig({
    RUVIEW_CLOUD_URL: base, RUVIEW_STATE_DIR: mkdtempSync(join(tmpdir(), 'e2e-agent-')), RUVIEW_ENROLLMENT_CODE: 'abcd efgh jkmn',
    RUVIEW_HW_ID: 'mid:e2e00000000000000000000000000001', RUVIEW_UDP_LISTEN: `127.0.0.1:${tapPort}`, RUVIEW_UDP_FORWARD: `127.0.0.1:${sink.address().port}`,
    RUVIEW_SENSING_WS: 'ws://127.0.0.1:1/ws', RUVIEW_SENSING_HTTP: `http://127.0.0.1:${(sensing.address() as AddressInfo).port}`,
  } as unknown as NodeJS.ProcessEnv), { arp: () => new Map([['127.0.0.1', 'aa:bb:cc:dd:ee:01']]) });
  await agent.start();
});

afterAll(async () => {
  await agent?.stop();
  server?.close(); sensing.close(); esp.close();
  await pool.end();
});

const send = (b: Uint8Array) => new Promise<void>((ok) => esp.send(b, tapPort, '127.0.0.1', () => ok()));
const vit = (o: Partial<Parameters<typeof encodeVitals>[0]> = {}) => encodeVitals({ nodeId: 1, presence: true, fall: false, motion: true, breathingBpm: 15, heartBpm: 70, rssi: -58, persons: 1, motionEnergy: 0.4, presenceScore: 2, timestampMs: 1, ...o });

describe('gateway end-to-end', () => {
  it('enrolls with a normalised one-time code and comes online', async () => {
    const [gw] = await q(`select status, hw_id from public.devices where id = $1`, [IDS.gateway]);
    expect(gw).toMatchObject({ status: 'online', hw_id: 'mid:e2e00000000000000000000000000001' });
    const [{ n }] = await q(`select count(*)::int n from public.device_credentials where device_id = $1 and revoked_at is null`, [IDS.gateway]);
    expect(n).toBe(1);
  });

  it('turns edge vitals into live node + room state', async () => {
    await send(vit());
    await new Promise((r) => setTimeout(r, 100));
    await agent.telemetryTick();
    const [room] = await q(`select occupied, stale, person_count from public.room_state where room_id = $1`, [IDS.room]);
    expect(room).toMatchObject({ occupied: true, stale: false, person_count: 1 });
    const [node] = await q(`select source, rssi, presence from public.node_state where device_id = $1`, [IDS.sensor]);
    expect(node).toMatchObject({ source: 'edge', rssi: -58, presence: true });
    const [dev] = await q(`select status from public.devices where id = $1`, [IDS.sensor]);
    expect(dev.status).toBe('online');
  });

  it('raises an intrusion alarm when armed', async () => {
    await q(`update public.properties set security_mode = 'armed_away', security_mode_changed_at = now() - interval '5 minutes' where id = $1`, [IDS.property]);
    await send(vit());
    await new Promise((r) => setTimeout(r, 100));
    await agent.telemetryTick();
    const rows = await q(`select severity from public.events where property_id = $1 and event_type = 'intrusion_detected'`, [IDS.property]);
    expect(rows).toEqual([{ severity: 'critical' }]);
  });

  it('forwards on-device fall flags as critical events', async () => {
    await send(vit({ fall: true }));
    await new Promise((r) => setTimeout(r, 300));
    await agent.flushEvents();
    const rows = await q(`select count(*)::int n from public.events where property_id = $1 and event_type = 'fall_detected'`, [IDS.property]);
    expect(rows[0].n).toBe(1);
  });

  it('records node identity from heartbeat', async () => {
    await agent.heartbeat();
    const [dev] = await q(`select host(last_ip) ip, health->>'mac_observed' mac from public.devices where id = $1`, [IDS.sensor]);
    expect(dev).toEqual({ ip: '127.0.0.1', mac: 'aa:bb:cc:dd:ee:01' });
  });

  it('rejects bad tokens and malformed payloads at the boundary', async () => {
    const bad = await fetch(`${base}/api/gateway/v1/telemetry`, { method: 'POST', headers: { authorization: `Bearer gw_${'x'.repeat(43)}`, 'content-type': 'application/json' }, body: '{}' });
    expect(bad.status).toBe(401);
    const tok = agent.cloud.token!;
    const malformed = await fetch(`${base}/api/gateway/v1/telemetry`, { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ samples: [{ node_id: 1, presence: 'yes' }] }) });
    expect(malformed.status).toBe(422);
    const reuse = await fetch(`${base}/api/gateway/v1/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrollment_code: CODE, hw_id: 'mid:attacker000000000000000000000', hostname: 'x', agent_version: '1', platform: 'x' }) });
    expect(reuse.status).toBe(403);
  });

  it('stops sending after the token is revoked', async () => {
    await q(`update public.device_credentials set revoked_at = now() where device_id = $1`, [IDS.gateway]);
    await agent.heartbeat();
    expect(agent.status().revoked).toBe(true);
  });
});
