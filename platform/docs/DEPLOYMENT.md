# Deployment Guide

Three things get deployed: the **Supabase project** (database, auth, storage, realtime), the
**Next.js web app** (operations console, client portal, gateway API), and one **home gateway**
per monitored property. ESP32 nodes are flashed in the browser during installation.

---

## 0. Local development (laptop)

> **Simplest option:** `platform/docker/` runs the whole stack (self-hosted Supabase, migrations, web app,
> scheduler, mail catcher, optional test gateway) with one `docker compose up -d --build` — see
> `docker/README.md`. The steps below use the Supabase CLI instead.

Prerequisites: Node 20+, Docker Desktop (for the local Supabase stack), `openssl`.

```bash
cd platform
npm ci
npx supabase@2.58.5 start        # starts Postgres/Auth/Storage/Realtime and applies supabase/migrations
npx supabase@2.58.5 status       # prints API URL, publishable (anon) + secret (service_role) keys, Studio and Mailpit URLs
```

Create `web/.env.local` (git-ignored) from `web/.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon / publishable key from status>
SUPABASE_SECRET_KEY=<service_role / secret key from status>
APP_URL=http://localhost:3000
DEVICE_SECRET_KEY=<openssl rand -hex 32>
CRON_SECRET=<openssl rand -hex 32>
```

Create the first administrator (sign-ups are disabled): open Studio (`http://127.0.0.1:54323`) →
Authentication → **Add user** (email + password, auto-confirm), then in the SQL editor:

```sql
update public.profiles set platform_role = 'platform_admin' where email = 'you@example.com';
```

Run the app and sign in at `http://localhost:3000`:

```bash
npm run dev -w @ruview/web
```

Invite emails sent by the local stack land in Mailpit (`http://127.0.0.1:54324`). `pg_cron` runs
offline detection every minute; to deliver queued alert emails locally call
`curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/notifications`.
Re-create the database from the migrations at any time with `npx supabase@2.58.5 db reset`.

Testing a real gateway against your laptop: build and publish the gateway kit
(`npm run build -w @ruview/gateway-agent && node scripts/publish-gateway-kit.mjs`), start the
app on the LAN (`npm run dev -w @ruview/web -- -H 0.0.0.0`), set `APP_URL=http://<laptop-ip>:3000`,
and add `RUVIEW_ALLOW_INSECURE_HTTP=1` to the installer command (the agent otherwise requires https).

---

## 1. Supabase project

1. Create a project (Pro plan recommended for production: daily backups, PITR, pg_cron).
2. Link and push the schema from `platform/`:
   ```bash
   npx supabase@2.58.5 link --project-ref <ref>
   npx supabase@2.58.5 db push
   ```
   Migrations create all tables, RLS policies, functions, the `floor-plans` and `firmware`
   storage buckets, the Realtime publication and the pg_cron jobs. If pg_cron is not enabled,
   enable it (Database → Extensions) and re-run the last migration's `cron.schedule` block, or rely
   on the Vercel cron fallback (§2).
3. **Authentication → Providers → Email**: keep email/password on, **disable sign-ups** (accounts are
   created by invitation only), minimum password length 12.
4. **Authentication → URL configuration**: Site URL = `APP_URL`; add redirect URLs
   `APP_URL/auth/confirm`, `APP_URL/auth/callback`, `APP_URL/update-password`.
5. **Authentication → Email templates** — invite and recovery links must use the token-hash flow:
   - Invite: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
   (templates in `supabase/templates/` are used automatically by the local CLI).
6. **SMTP**: configure a production SMTP provider (the built-in sender is rate-limited and not for
   production). Invite emails come from Supabase Auth; alert emails come from the app (Resend).
7. **Realtime** is enabled by the migration for `room_state`, `node_state`, `events`, `notifications`,
   `devices`, `device_commands`, `installations`. Postgres-changes respects RLS per subscriber.

### First administrator
Sign-ups are disabled, so bootstrap the first admin once:
1. Authentication → Users → **Invite user** (your email). Accept the invite and set a password.
2. SQL editor:
   ```sql
   update public.profiles set platform_role = 'platform_admin' where email = 'you@example.com';
   ```
All further staff and client users are invited from the console (Team / Clients).

## 2. Web app (Vercel or any Node 20+ host)

Environment variables (see `web/.env.example`):

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable/anon key (browser-safe; RLS enforces access) |
| `SUPABASE_SECRET_KEY` | Secret/service-role key — **server only** |
| `APP_URL` | Public HTTPS origin, e.g. `https://monitor.example.com` |
| `DEVICE_SECRET_KEY` | `openssl rand -hex 32` — encrypts OTA PSKs at rest. Back it up; losing it means re-provisioning nodes over USB to restore OTA. |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional. Without them alert emails are marked *skipped* (in-app alerts still work). |

`NEXT_PUBLIC_*` variables are inlined at **build time** (browser client and the Content-Security-Policy's
Supabase origin), so they must be present when building, not only at runtime.

Build from the workspace root so the gateway kit is published with the app:
```bash
cd platform
npm ci
npm run build          # builds ruview-agent, copies the gateway kit to web/public/install, builds Next.js
```
On Vercel set the project root to `platform/web`, install command `cd .. && npm ci`, build command
`cd .. && npm run build`. `web/vercel.json` schedules `/api/cron/notifications` (every minute) and
`/api/cron/maintenance` (every 5 min; pg_cron already runs it every minute). Self-hosting: run
`npm run start -w @ruview/web` behind a TLS reverse proxy and call the cron URLs with
`Authorization: Bearer $CRON_SECRET` from any scheduler.

**Scaling notes.** Gateway rate limiting is in-memory per instance; with several instances put a
shared limiter (e.g. Upstash Redis) in `src/lib/ratelimit.ts`. The gateway API is stateless.

## 3. Firmware releases

Build per the repository's firmware release process (8 MB from `sdkconfig.defaults.template`, 4 MB
from `sdkconfig.defaults.4mb`, mock CSI **off**). In **Firmware → Upload release** add
`bootloader.bin`, `partition-table(-4mb).bin`, `ota_data_initial.bin` and the app image. The server
re-reads every file from Storage and verifies the ESP32-S3 chip id, image magic, partition-table
magic, OTA slot size and SHA-256, and scans for mock-CSI code (mock builds can never be published).
Test on a real board, then **Publish**.

> Current firmware accepts OTA images up to its partition size and reports the limit in
> `/ota/status`. Nodes still running older firmware (fixed 900 KB gate) must be re-flashed over
> USB once; the platform uses each node's reported limit and explains when USB is required.

## 4. Home gateway (per property)

**Hardware:** Raspberry Pi 4/5 (2 GB+) or x86_64/arm64 mini-PC, 64-bit Debian-family OS, Docker
Engine + compose plugin, wired Ethernet on the same subnet as the home WiFi. Reserve its IP in the
router (DHCP reservation) — sensors stream to that address.

**Install** (the console shows this command with a one-time code under the gateway device):
```bash
curl -fsSL https://monitor.example.com/install/gateway.sh | sudo RUVIEW_CLOUD_URL=https://monitor.example.com RUVIEW_ENROLLMENT_CODE=XXXX-XXXX-XXXX bash
```
This installs `/opt/ruview` with two containers (host networking):
- `sensing-server` — unmodified RuView, `--source esp32 --udp-port 5006 --bind-addr 127.0.0.1`
  (never `auto`: auto falls back to simulated data).
- `ruview-agent` — listens on UDP 5005 for the nodes, relays every datagram to 5006, enrolls,
  and connects **outbound only** over HTTPS. Credentials in `/opt/ruview/state` (mode 0700).

If `ufw` is active the installer allows 5005/udp and denies 5006/udp. No inbound ports from the
internet are needed. Pin `SENSING_IMAGE` to a digest in `/opt/ruview/.env` for production.

Diagnostics on the gateway:
```bash
docker compose -f /opt/ruview/docker-compose.yml exec ruview-agent node /opt/ruview/ruview-agent.mjs doctor
```
```bash
docker compose -f /opt/ruview/docker-compose.yml logs -f --tail=100
```
Re-enrolling (new code from the console) revokes the previous token. Without Docker, use
`ruview-agent.service` (systemd) with a separately installed sensing-server.

## 5. Operations

- **Retention:** monthly telemetry partitions, 13 months kept (`private.drop_old_telemetry_partitions`);
  presence events older than 90 days are deleted; alarms and device events are kept.
- **Backups:** Supabase daily backups/PITR. Also back up `DEVICE_SECRET_KEY` separately.
- **Monitoring:** `/api/health` for uptime; the Overview page lists offline hardware and open alarms.
- **Key rotation:** gateway tokens via re-enrollment; OTA PSKs rotate on each USB re-provisioning.

## 6. Verifying a deployment

```bash
cd platform
npm test          # unit tests: shared (NVS byte-exact, codecs), agent (incl. socket e2e), web
npm run test:db   # schema, RLS isolation, ingest/alarm logic on a throwaway Postgres
npm run test:e2e  # agent → Next.js gateway routes → Postgres functions
npm run lint && npm run typecheck && npm run build
```
