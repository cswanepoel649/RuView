# RuView Monitoring Platform — Docker setup

One `docker compose` stack runs everything on a single machine:

| Service | What it is | URL |
|---|---|---|
| `web` | Operations console + client portal + gateway API (Next.js) | http://localhost:3000 |
| `api-gw`, `auth`, `rest`, `realtime`, `storage`, `db`, `meta`, `imgproxy` | Supabase (self-hosted, official images — see `supabase/UPSTREAM.md`) | http://localhost:8000 |
| `studio` | Supabase Studio (database admin), behind the dashboard password | http://localhost:8000 |
| `migrate` | Applies `../supabase/migrations` on start (idempotent), then exits | — |
| `scheduler` | Sends queued alert emails every minute, runs maintenance | — |
| `mail` | Local mail catcher — invitation and password-reset emails land here | http://localhost:9000 |
| `sensing-server`, `gateway-agent` | Optional test home gateway (`--profile gateway`) | UDP 5005 |

## Requirements

- Docker Desktop 4.27+ (Windows/macOS) or Docker Engine with Compose v2.24+ (Linux)
- 4 GB free RAM, ~6 GB disk for images
- Free ports: 3000, 8000, 9000 (and 5005/udp for the gateway profile)

## 1. Configure

A ready `.env` with fresh secrets sits next to this file. To create a new one (this rotates every
secret, so only do it before the first start or after `reset`):

```bash
node generate-env.mjs --force
```

No Node installed? Run the generator in a container instead (Windows PowerShell: replace `$PWD` with `${PWD}`):

```bash
docker run --rm -v "$PWD:/w" -w /w node:22-alpine node generate-env.mjs --force
```

To open the platform from other devices on your network (phones, tablets), generate it with your
computer's LAN address, e.g. `node generate-env.mjs --force --host 192.168.1.50`.

## 2. Start

From this folder (`platform/docker`):

```bash
docker compose up -d --build
```

The first build takes a few minutes. Check that everything is up (`migrate` shows *exited (0)*):

```bash
docker compose ps -a
```

## 3. Create your administrator account

Public sign-up is disabled; create the first admin with the helper inside the web container:

```bash
docker compose exec web node /app/docker/create-admin.mjs you@example.com 'YourStrongPassw0rd'
```

The password needs 12+ characters with upper- and lower-case letters and a digit. Then sign in
at **http://localhost:3000**. Clients and staff you invite from the console receive their
invitation in the mail catcher at **http://localhost:9000** (until you configure real SMTP).

## 4. Everyday commands

| Task | Command |
|---|---|
| Stop | `docker compose down` |
| Logs | `docker compose logs -f web` |
| Update after pulling new code | `docker compose up -d --build` (new migrations apply automatically) |
| Changed `SUPABASE_PUBLIC_URL` or `ANON_KEY` | `docker compose up -d --build` — these are compiled into the web app |
| Supabase Studio login | user `supabase`, password `DASHBOARD_PASSWORD` from `.env` |
| Wipe all data | `docker compose down -v`, then delete `supabase/volumes/db/data` and `supabase/volumes/storage` |
| Optional Supabase services (Edge Functions, Postgres pooler on 127.0.0.1:5432) | add `--profile extras` |

## 5. Optional: test gateway with real ESP32 boards

1. In the console: Installations → start the wizard for a property → Home gateway → **Add gateway** → **Generate enrollment code**.
2. Put the code in `.env` as `GATEWAY_ENROLLMENT_CODE=...`, then:
   ```bash
   docker compose --profile gateway up -d
   ```
3. Provision boards in the wizard (Chrome/Edge, USB) with your computer's LAN IP as the gateway IP.

Docker Desktop hides the boards' real IP/MAC behind NAT, so over-the-air updates and MAC identity
checks only work with a real gateway (Linux host networking — the installer the console shows for
each gateway). This profile is for trying the data path, not for production homes.

## Production notes

- Put a TLS reverse proxy in front of ports 3000 and 8000, regenerate `.env` with your domain
  (`APP_URL`, `SITE_URL`, `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`, redirect URLs) and rebuild.
- Configure real SMTP (`SMTP_*` in `.env`) and optionally `RESEND_API_KEY` / `EMAIL_FROM` for alert emails.
- Back up `supabase/volumes/db/data` (or use `pg_dump`) and keep `DEVICE_SECRET_KEY` safe —
  without it the stored OTA keys cannot be decrypted.
- A hosted Supabase project is the alternative to self-hosting; see `../docs/DEPLOYMENT.md`.

## Troubleshooting

- **Port already in use** — change `WEB_PORT`, `API_GW_HTTP_PORT`/`KONG_HTTP_PORT` or `MAIL_UI_PORT` in `.env`
  (if you change the API port, regenerate the URLs too and rebuild).
- **`migrate` failed** — `docker compose logs migrate`; fix and run `docker compose up -d` again (applied
  migrations are recorded and skipped).
- **Sign-in loops back to /login** — `APP_URL` must be exactly the address in your browser's address bar.
- **Invite email not arriving** — check http://localhost:9000 and `docker compose logs auth`.
