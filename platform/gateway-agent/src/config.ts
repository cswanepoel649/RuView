import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';

export interface AgentConfig {
  cloudUrl: string;
  stateDir: string;
  enrollmentCode: string | null;
  hwId: string;
  udpListenHost: string;
  udpListenPort: number;
  udpForwardHost: string;
  udpForwardPort: number;
  sensingWsUrl: string;
  sensingHttpUrl: string;
  nodeOtaPort: number;
  /** Max minute buckets kept on disk while the cloud is unreachable (~7 days for 2 nodes). */
  outboxMaxMinutes: number;
  /** Read /proc/net/arp to report node MACs. Off when the agent runs behind Docker NAT (it would see the bridge MAC). */
  arpEnabled: boolean;
  agentVersion: string;
}

export const AGENT_VERSION = '1.0.0';

function hostPort(v: string, defHost: string, defPort: number): [string, number] {
  const m = /^(?:(.*):)?(\d{1,5})$/.exec(v.trim());
  if (!m) throw new Error(`invalid host:port "${v}"`);
  const port = Number(m[2]);
  if (port < 1 || port > 65535) throw new Error(`invalid port in "${v}"`);
  return [m[1] || defHost, port];
}

function machineId(): string {
  for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const id = readFileSync(p, 'utf8').trim();
      if (/^[0-9a-f]{32}$/.test(id)) return `mid:${id}`;
    } catch {
      /* try next */
    }
  }
  return `host:${hostname().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100)}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const cloudUrl = (env.RUVIEW_CLOUD_URL || '').replace(/\/+$/, '');
  if (!cloudUrl) throw new Error('RUVIEW_CLOUD_URL is required (e.g. https://monitor.example.com)');
  const u = new URL(cloudUrl);
  const localhost = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(localhost || env.RUVIEW_ALLOW_INSECURE_HTTP === '1')) {
    throw new Error('RUVIEW_CLOUD_URL must use https:// (set RUVIEW_ALLOW_INSECURE_HTTP=1 only for lab testing)');
  }
  const [lh, lp] = hostPort(env.RUVIEW_UDP_LISTEN || '0.0.0.0:5005', '0.0.0.0', 5005);
  const [fh, fp] = hostPort(env.RUVIEW_UDP_FORWARD || '127.0.0.1:5006', '127.0.0.1', 5006);
  if (lp === fp && (fh === lh || lh === '0.0.0.0')) {
    throw new Error('UDP listen and forward ports must differ (sensing-server must run with --udp-port <forward port>)');
  }
  return {
    cloudUrl,
    stateDir: env.RUVIEW_STATE_DIR || '/var/lib/ruview-agent',
    enrollmentCode: env.RUVIEW_ENROLLMENT_CODE?.trim() || null,
    hwId: env.RUVIEW_HW_ID?.trim() || machineId(),
    udpListenHost: lh,
    udpListenPort: lp,
    udpForwardHost: fh,
    udpForwardPort: fp,
    sensingWsUrl: env.RUVIEW_SENSING_WS || 'ws://127.0.0.1:8765/ws/sensing',
    sensingHttpUrl: (env.RUVIEW_SENSING_HTTP || 'http://127.0.0.1:8080').replace(/\/+$/, ''),
    nodeOtaPort: Number(env.RUVIEW_NODE_OTA_PORT || 8032),
    outboxMaxMinutes: Number(env.RUVIEW_OUTBOX_MAX_MINUTES || 30000),
    arpEnabled: (env.RUVIEW_ARP || 'on').toLowerCase() !== 'off',
    agentVersion: AGENT_VERSION,
  };
}
