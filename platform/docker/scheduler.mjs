// Calls the platform's cron endpoints on a fixed cadence (Docker replacement for Vercel Cron).
const base = process.env.APP_INTERNAL_URL ?? 'http://web:3000';
const secret = process.env.CRON_SECRET;
if (!secret) { console.error('CRON_SECRET is required'); process.exit(1); }

async function call(path) {
  try {
    const res = await fetch(base + path, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(55_000) });
    const body = await res.text();
    if (!res.ok) console.error(`${new Date().toISOString()} ${path} -> HTTP ${res.status} ${body.slice(0, 200)}`);
    else if (body !== '{"sent":0}') console.log(`${new Date().toISOString()} ${path} -> ${body.slice(0, 200)}`);
  } catch (e) {
    console.error(`${new Date().toISOString()} ${path} failed: ${e.message}`);
  }
}

let tick = 0;
async function loop() {
  await call('/api/cron/notifications');
  if (tick % 5 === 0) await call('/api/cron/maintenance');
  tick++;
}
await loop();
setInterval(loop, 60_000);
process.on('SIGTERM', () => process.exit(0));
