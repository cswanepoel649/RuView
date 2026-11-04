import dgram from 'node:dgram';
import { Agent } from './agent';
import { loadCredentials } from './cloudClient';
import { loadConfig } from './config';
import { errMsg, log } from './log';

async function doctor() {
  const lines: [string, boolean, string][] = [];
  let cfg;
  try {
    cfg = loadConfig();
    lines.push(['configuration', true, `cloud=${cfg.cloudUrl} state=${cfg.stateDir}`]);
  } catch (e) {
    lines.push(['configuration', false, errMsg(e)]);
    return print(lines);
  }
  const creds = loadCredentials(cfg.stateDir);
  lines.push(['enrollment', !!creds || !!cfg.enrollmentCode, creds ? `enrolled as ${creds.gatewayId}` : cfg.enrollmentCode ? 'enrollment code present (will enroll on start)' : 'not enrolled and no RUVIEW_ENROLLMENT_CODE']);
  try {
    const r = await fetch(`${cfg.cloudUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
    lines.push(['cloud reachable', r.ok, `HTTP ${r.status}`]);
  } catch (e) {
    lines.push(['cloud reachable', false, errMsg(e)]);
  }
  try {
    const r = await fetch(`${cfg.sensingHttpUrl}/health`, { signal: AbortSignal.timeout(3000) });
    const j = (await r.json()) as { source?: string };
    lines.push(['sensing-server', j.source === 'esp32', `source=${j.source} (must be "esp32"; run sensing-server with --source esp32 --udp-port ${cfg.udpForwardPort})`]);
  } catch (e) {
    lines.push(['sensing-server', false, `${cfg.sensingHttpUrl} unreachable: ${errMsg(e)}`]);
  }
  await new Promise<void>((resolve) => {
    const s = dgram.createSocket('udp4');
    s.once('error', (e) => {
      lines.push(['udp listen port', (e as NodeJS.ErrnoException).code === 'EADDRINUSE', (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `${cfg!.udpListenPort} in use (expected if the agent is running)` : e.message]);
      resolve();
    });
    s.bind(cfg!.udpListenPort, cfg!.udpListenHost, () => {
      lines.push(['udp listen port', true, `${cfg!.udpListenHost}:${cfg!.udpListenPort} free`]);
      s.close(() => resolve());
    });
  });
  print(lines);
}

function print(lines: [string, boolean, string][]) {
  for (const [name, ok, detail] of lines) process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(18)} ${detail}\n`);
  process.exitCode = lines.every((l) => l[1]) ? 0 : 1;
}

async function run() {
  const cfg = loadConfig();
  const agent = new Agent(cfg);
  const shutdown = async (sig: string) => {
    log.info('shutting down', { signal: sig });
    await agent.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGUSR1', () => log.info('status', agent.status()));
  await agent.start();
  log.info('ruview-agent running', { version: cfg.agentVersion, hw_id: cfg.hwId });
}

const cmd = process.argv[2] ?? 'run';
(cmd === 'doctor' ? doctor() : run()).catch((e) => {
  log.error('fatal', { error: errMsg(e) });
  process.exit(1);
});
