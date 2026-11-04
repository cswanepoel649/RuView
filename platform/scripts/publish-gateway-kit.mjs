// Copies the bundled agent + deploy files into web/public/install so the platform
// can serve the gateway installer (no container registry needed).
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const out = new URL('../web/public/install/', import.meta.url);
mkdirSync(out, { recursive: true });
const agent = new URL('../gateway-agent/dist/ruview-agent.mjs', import.meta.url);
copyFileSync(agent, new URL('ruview-agent.mjs', out));
writeFileSync(new URL('ruview-agent.mjs.sha256', out), createHash('sha256').update(readFileSync(agent)).digest('hex') + '\n');
for (const f of ['docker-compose.yml', 'gateway.sh', 'ruview-agent.service']) copyFileSync(new URL(`../gateway-agent/deploy/${f}`, import.meta.url), new URL(f, out));
console.log('gateway kit published to web/public/install');
