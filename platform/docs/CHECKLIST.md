# Development Checklist

Legend: ✅ done & automatically tested · 🟢 done, verified by build/typecheck only (UI) · 🟡 partial · ⬜ not started · 🔌 needs physical hardware to verify

## 1. Research & architecture
- ✅ Firmware, sensing-server, protocols, provisioning, OTA audited from source → `ARCHITECTURE.md` §1
- ✅ Integration defects documented with mitigations (L1–L7); L1, L2, L3 and L7 since fixed upstream (re-verified after syncing with `ruvnet/RuView` v0.8.17)
- ✅ NVS generator byte-identical to upstream `provision.py` (v0.8.17) including `security/ota_psk`
- ✅ Gateway requirement established (UDP-only LAN uplink, OTA on LAN) — matches RuView ADR-083

## 2. Data platform (Supabase)
- ✅ Multi-tenant schema: clients, members, contacts, properties, floors, rooms, zones, devices, firmware, commands, installations, telemetry, events, alerts, notifications, tickets, audit
- ✅ RLS on every table; trigger-derived `client_id`; column-level privileges for secrets — **57 isolation assertions**
- ✅ Ingest, room derivation (20 s freshness, 30 s clear hysteresis), exit/entry-delay alarms, dedupe, offline detection, heartbeat identity checks, enrollment, OTA command lifecycle — **54 assertions**
- ✅ Notification fan-out: rules × schedules × quiet hours × mute × channels — **18 assertions**
- ✅ Monthly telemetry partitions + retention, pg_cron jobs, storage buckets/policies, realtime publication
- ✅ Auth hardening: invite-only, 12-char passwords, token-hash email flows (`supabase/config.toml`)
- 🟡 Storage policies and Realtime verified against a shim, not a live Supabase instance (Docker images unavailable in CI sandbox)

- ✅ Docker Compose stack (`docker/`): official self-hosted Supabase + idempotent migration runner + web + scheduler + mail + optional gateway — run end-to-end on real images: clean first start, admin bootstrap, invite email → token-hash link → client portal, tenant isolation (404), viewer restrictions, gateway enrollment via wizard, ESP32-format UDP → agent → API → room state, browser Realtime update
- ✅ Migration runner tested on a fresh database (applies all, second run no-op) — `npm run test:docker-migrate`

## 3. Device communication & provisioning
- ✅ NVS partition generator byte-identical to ESP-IDF `nvs_partition_gen` (3 golden images incl. `provision.py` output, blobs, page overflow)
- ✅ ESP32 packet codecs per firmware layout (CSI header, vitals, fused vitals vs WASM disambiguation, features)
- ✅ Gateway protocol v1 (zod, shared by agent and API) with boundary validation tests
- ✅ ruview-agent: UDP tap/relay (byte-for-byte), merge rules, non-live data rejection, minute aggregation, durable outbox, enrollment, heartbeat (IP/MAC/firmware), fall events, OTA executor (sha256/size/magic, node-reported size limit), doctor — **17 tests incl. socket-level e2e**
- ✅ End-to-end: agent → Next.js gateway routes → Postgres functions — **7 tests** (`npm run test:e2e`)
- ✅ Firmware image validation (chip id, magic, slot size, mock scan) against the repo's real release binaries
- ✅ MD5 (flash verify) and boot-log parser tests
- 🟢 Browser flashing wizard (esptool-js, Web Serial) and NVS-download fallback
- 🔌 Flash + provision a real ESP32-S3 (8 MB and 4 MB) from Chrome; confirm boot-log checks
- 🔌 Gateway install script on a Raspberry Pi 4/5 with the published `ruvnet/wifi-densepose` image
- 🔌 OTA through the gateway on current firmware (8 MB and 4 MB) and the legacy-firmware block path
- 🔌 ARP MAC observation and identity-mismatch alert with real nodes

## 4. Operations console (admin)
- 🟢 Overview (fleet KPIs, offline hardware, alerts, installations)
- 🟢 Clients: search, create/edit, contacts, household invites (email or one-time link), roles
- 🟢 Properties: live floor plan, floors + plan upload, room outline editor, rooms, zones, devices, settings (incl. opt-in wellness vitals)
- 🟢 Devices: inventory, registration, assignment with node-id allocation, health, status history, commands, OTA queueing, probe, gateway enrollment codes, token revocation
- 🟢 Firmware releases: upload with server-side verification, publish/deprecate
- 🟢 Installation wizard: survey → gateway → sensors → walk test → handover
- 🟢 Alerts (cross-client), support desk, team (admin/installer), audit log

## 5. Client portal
- 🟢 Property overview cards, live view (Realtime floor plan + room cards, stale = "No data"), arm/disarm with exit delay
- 🟢 Room detail: live state, 24 h occupancy chart, activity, sensors, wellness (if enabled)
- 🟢 History & insights: occupancy over time, typical-week heatmap, time per room, filtered timeline
- 🟢 Security zones (owner/member edit, viewer read-only), device health + report problem
- 🟢 Alerts inbox + acknowledge/resolve, notification preferences, household alert rules, support tickets, account
- ✅ Analytics bucketing (timezone, gaps, weighting) unit-tested

## 6. Outstanding work
- ⬜ ESP32-C6 / C5 nodes (upstream research / release-candidate targets) in the device catalogue and wizard
- ⬜ Use upstream sensing-server semantic events (bed exit, no movement, fall risk, distress) as alert sources
- ⬜ Browser UI tests (Playwright) against a staging Supabase project — UI is currently verified by build/typecheck/lint and manual review only
- ⬜ Push (Web Push/PWA) and SMS notification channels — schema supports them; dispatcher marks them `skipped`
- ⬜ Staff MFA (Supabase TOTP) enforcement in the console
- ⬜ Shared rate limiter for multi-instance deployments (currently per instance)
- ⬜ WASM edge-module management (firmware tier 3 is alpha and needs a signing-key workflow)
- ⬜ Remote configuration changes (needs a firmware NVS-write endpoint — L6); today: re-provision via USB
- ⬜ Agent self-update channel (today: re-run the installer)
- ⬜ Data export / account deletion workflows (GDPR/POPIA), consent capture for wellness vitals
- ⬜ Sensor-uplink authentication (firmware work, ADR-032) — LAN spoofing risk documented (L5)
- 🟡 Entry-delay alarms fire on the next ingest (~5 s) or maintenance run (≤ 1 min) — sub-second timing not guaranteed

## 7. Test commands
```bash
cd platform
npm test            # shared 21 · agent 17 · web 12
npm run test:db     # 129 SQL assertions on a throwaway Postgres
npm run test:e2e    # 7 end-to-end gateway tests
npm run lint && npm run typecheck && npm run build
```
