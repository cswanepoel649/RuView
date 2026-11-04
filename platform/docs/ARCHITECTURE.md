# RuView Home Monitoring Platform — Technical Assessment & Architecture

Status: **v1 architecture, implemented in `platform/`**
Scope: multi-tenant installer/operator platform built on top of the RuView
(wifi-densepose) sensing stack. RuView itself is **not modified or duplicated**;
the platform wraps it.

---

## 1. Technical assessment of RuView (verified against source)

Everything in this section was verified by reading the code in this repository
(paths given). Marketing claims in the top-level README that are not backed by
code paths used here are deliberately *not* relied on.

### 1.1 ESP32 sensor node firmware (`firmware/esp32-csi-node/`)

| Aspect | Verified behaviour | Source |
|---|---|---|
| Supported chip | ESP32-S3 (8 MB and 4 MB flash builds). Original ESP32 / C3 unsupported. ESP32-S3 radio is **2.4 GHz only**. | `README.md`, `sdkconfig.defaults*` |
| Network role | WiFi **station**, WPA2-PSK (or open if password empty). No AP/captive-portal/BLE provisioning. | `main/main.c` `wifi_init_sta()` |
| Uplink | **Unauthenticated, unencrypted UDP unicast** to `target_ip:target_port` (IPv4 literal only, no DNS). | `main/stream_sender.c` |
| Packets | `0xC5110001` raw CSI (~20 Hz, always sent) · `0xC5110002` 32-byte edge vitals (1 Hz, tier ≥ 1/2) · `0xC5110004` 48-byte fused vitals **instead of** `…02` when an mmWave sensor is attached · `0xC5110004` WASM output (same magic, different layout) · `0xC5110003` feature vector · `0xC5110006` ADR-081 feature state | `main/edge_processing.h`, `main/wasm_runtime.h`, `main/rv_feature_state.h` |
| Edge analytics (tier 2) | presence flag + score (auto-calibrated over first ~60 s of ambient), motion flag + motion energy, person estimate (≤ 4), fall flag (phase-acceleration threshold, 5 s cooldown), breathing/heart-rate BPM | `main/edge_processing.c` |
| Configuration | NVS namespace `csi_cfg` read once at boot (ssid, password, target_ip, target_port, node_id, edge_tier, thresholds, hop list, TDM, MAC filter, seed bridge…). Namespace `security` key `ota_psk`. **No runtime config endpoint** — config changes require rewriting NVS over USB. | `main/nvs_config.c`, `main/ota_update.c` |
| Provisioning | `provision.py` builds an NVS partition image (0x9000, 0x6000 bytes) and writes it with esptool over USB serial. **Full-replace semantics.** | `provision.py` |
| Flash layout | bootloader `0x0`, partition table `0x8000`, NVS `0x9000`, otadata `0xF000`, app `0x20000` (both 8 MB and 4 MB tables) | `partitions_display.csv`, `partitions_4mb.csv` |
| OTA | HTTP server on **port 8032 (LAN)**: `GET /ota/status`, `POST /ota` (raw app image). Bearer PSK auth **only if `security/ota_psk` is provisioned** (otherwise open). Rollback-capable dual slots. **Size gate 900 KB.** | `main/ota_update.c` |
| WASM (tier 3, alpha) | `/wasm/upload|list|start|stop|delete` on port 8032, Ed25519-signed RVF containers | `main/wasm_upload.c` |
| Identity | Only an 8-bit `node_id` is carried in packets. No MAC/serial in the wire protocol. | `main/csi_collector.c` |
| Cognitum Seed bridge | Optional HTTP POST of 8-dim vectors to a Seed device (`seed_url`, bearer token) | `main/swarm_bridge.c` |

### 1.2 Sensing server (`v2/crates/wifi-densepose-sensing-server/`)

* Rust/Axum binary. UDP listener (default 5005), REST on `--http-port`, WebSocket
  `/ws/sensing` on `--ws-port` and the HTTP port.
* Server-side per-node pipeline from raw CSI: motion level classification
  (`absent | present_still | present_moving | active`), presence, confidence,
  person estimate, vital signs estimate, per-node features (`node_features`).
* `GET /api/v1/nodes` – per-node status (active/stale), motion level, person count.
* **`--source auto` silently falls back to simulated data** when no ESP32 is heard.
  `effective_source()` reports `esp32`, `esp32:offline`, `simulated`, `wifi`.
* Pose keypoints from `derive_pose_from_sensing()` are **procedurally generated
  from aggregate features**, not a trained pose model, unless a model is loaded.
  `/api/v1/pose/zones/summary` returns **hard-coded zones**.

### 1.3 Defects / limitations found during the audit (affect integration)

| # | Finding | Impact on the platform | Platform mitigation |
|---|---|---|---|
| L1 | Sensing-server `parse_esp32_frame` (in `main.rs` and `csi.rs`) reads sequence at bytes 10–13 and RSSI at byte 14; firmware writes them at 12–15 and 16 (the hardware crate parser `esp32_parser.rs` is correct). | RSSI/sequence derived from raw CSI by the sensing server are wrong. | Gateway agent decodes RSSI itself from the correct offsets and from vitals packets. |
| L2 | Fused vitals (mmWave nodes) and WASM output share magic `0xC5110004`; sensing server parses fused vitals as WASM events. | Presence/fall from mmWave-equipped nodes never reaches sensing-server edge-vitals. | Agent disambiguates by layout (48-byte fused vs `8+5n` WASM) and decodes fused packets directly. |
| L3 | OTA size gate is 900 KB but the current 8 MB app image is ~990 KB (4 MB image ~774 KB). | `POST /ota` rejects the 8 MB build. | Platform blocks OTA dispatch when `app_size > 900 KB` with an explicit message; USB re-flash via the wizard remains available. |
| L4 | `--source auto` fabricates data when hardware is silent. | Simulated data could be shown as real. | Gateway runs sensing-server with `--source esp32`; agent **drops any update whose source is not `esp32`**. |
| L5 | No authentication/encryption on the UDP uplink. | A LAN attacker can spoof sensor packets. | Documented risk; nodes are bound to a gateway + node_id + ARP-observed MAC; the agent flags MAC/IP changes. Hardening requires firmware work (ADR-032 secure TDM). |
| L6 | No remote NVS write. | Remote config (thresholds, WiFi) impossible without USB. | Platform keeps *desired* vs *provisioned* config and flags drift; re-provisioning happens through the browser wizard. |
| L7 | OTA open if no PSK. | Anyone on the LAN can reflash. | Platform **always** generates a per-device 256-bit OTA PSK and writes it into NVS at provisioning. |

### 1.4 Is a local gateway required? — **Yes.**

1. Nodes emit raw UDP to an IPv4 literal; there is no TLS, auth, DNS or NAT
   traversal. Sending this across the internet is unsafe and unreliable.
2. The useful analytics (server classification, multi-node fusion) run in the
   sensing server, which needs ~20 Hz × N raw CSI frames per home.
3. OTA (`:8032`) is only reachable from the LAN.

This matches the project's own ADR-083 ("one Pi per cluster of 3–6 sensor nodes").
**Per-home hardware:** 1 × gateway (Raspberry Pi 4/5 2 GB+, or any x86/ARM64 Linux
mini-PC, wired Ethernet recommended) + N × ESP32-S3 nodes (1 per room minimum;
2–3 for larger rooms) on the home's **2.4 GHz** WiFi, same L2 subnet as the gateway.

---

## 2. System architecture

```
 Home (LAN)                                                Cloud
 ┌────────────────────────────────────────────────┐        ┌──────────────────────────────────────┐
 │ ESP32-S3 node ×N ──UDP 5005──► ruview-agent ───┼─HTTPS─►│ Next.js (platform/web)               │
 │   (unmodified RuView fw)        │ UDP tap      │ (out-  │  • /api/gateway/v1/* (ingest, cmds)  │
 │        ▲                        ▼ relay :5006  │ bound  │  • Admin portal  /admin/*            │
 │        │ HTTP :8032 (OTA)   sensing-server     │  only) │  • Client portal /app/*              │
 │        └──────────────── (RuView, --source     │        │  • cron: offline detection, email    │
 │                           esp32, 127.0.0.1)    │        └──────────────┬───────────────────────┘
 │                 ws://127.0.0.1/ws/sensing ─────┘                       │ service role / user JWT
 └────────────────────────────────────────────────┘        ┌──────────────▼───────────────────────┐
                                                           │ Supabase                              │
 Installer laptop (Chrome/Edge)                            │  Auth · Postgres + RLS · Realtime     │
   Web Serial + esptool-js ── USB ──► ESP32 (flash+NVS)    │  Storage (firmware, floor-plans)      │
                                                           │  pg_cron (offline detection)          │
                                                           └───────────────────────────────────────┘
```

### 2.1 Components

| Component | Location | Responsibility |
|---|---|---|
| **RuView firmware** | `firmware/esp32-csi-node` (unchanged) | CSI capture, tier-2 edge analytics, OTA server |
| **RuView sensing server** | `v2/crates/wifi-densepose-sensing-server` (unchanged) | Server-side classification per node, WS stream |
| **ruview-agent** | `platform/gateway-agent` | UDP tap/relay, packet decode, per-node liveness + MAC (ARP), merge edge + server signals, minute aggregation, outbound HTTPS to cloud, offline buffer, command execution (OTA, node probe) |
| **shared** | `platform/shared` | Wire-protocol schemas (zod), ESP32 packet codecs, NVS partition generator (byte-compatible with ESP-IDF `nvs_partition_gen`), capability catalog |
| **web** | `platform/web` | Next.js App Router app: admin portal, client portal, gateway API, Web Serial provisioning |
| **database** | `platform/supabase` | Schema, RLS, ingest/derivation functions, triggers, storage policies, cron |

### 2.2 Why this split
* **No RuView duplication**: analytics stay in RuView; the agent only *taps* the UDP stream
  (to learn source IP/MAC and decode the packets the server mis-parses) and relays every
  datagram byte-for-byte to the sensing server.
* **Outbound-only gateway**: no port forwarding into homes; commands are pulled on heartbeat.
* **Cloud is the single source of truth for topology** (node → room → zone); gateways
  are dumb about rooms, so re-assigning a device never requires touching the home.
* **Derivation in Postgres** (`ingest_telemetry`) gives atomic, race-free room-state and
  alarm evaluation that is directly testable with SQL.

---

## 3. Multi-tenancy & access control

### 3.1 Roles
| Level | Role | Capabilities |
|---|---|---|
| Platform | `platform_admin` | Everything: clients, users, firmware, devices, audit |
| Platform | `installer` | Read all client data; manage properties, rooms, devices, installations, commands. No client/user/firmware administration. |
| Client | `owner` | Their client account: all properties, zones, alert rules, arm/disarm, acknowledge, tickets, household users (via staff) |
| Client | `member` | Same as owner except account administration |
| Client | `viewer` | Read-only + own notification preferences |

### 3.2 Isolation strategy
* Every tenant-owned row carries `client_id` (denormalised, **set by trigger from the parent
  property**, never trusted from the caller) and is indexed for RLS performance.
* RLS on **every** public table; helper functions in a non-exposed `private` schema
  (`security definer`, `stable`, fixed `search_path`).
* Clients never get write access to telemetry/state/device tables. Mutations a client may
  make that have side-effects (arm/disarm, acknowledge) go through `security definer` RPCs
  that re-check membership and emit audit/events.
* Gateway API uses the service role **only after** authenticating the gateway token; the
  gateway's property/client are derived from its DB record, not from the payload.
* Device secrets (`device_secrets`, `device_credentials.token_hash`, enrollment codes) have
  **no** policies for `authenticated` — only the service role can read them. OTA PSKs are
  additionally AES-256-GCM encrypted with `DEVICE_SECRET_KEY`.
* Storage: `floor-plans/{client_id}/…` readable by that client's members; `firmware/` staff-only
  (gateways receive short-lived signed URLs).
* Isolation is verified by `platform/supabase/tests/*.sql` against a real Postgres.

---

## 4. Data model (summary — full DDL in `supabase/migrations`)

```
profiles ─┐               device_models (catalog, capabilities[])
          │                        │
clients ──┼── client_members       │
   │      └── client_contacts      │
   ├── properties ── floors ── rooms ──┐
   │       │  security_mode            │
   │       ├── security_zones ── zone_rooms
   │       ├── installations
   │       └── devices (gateway | sensor_node) ─ gateway_id, node_id, room_id
   │                 ├── device_credentials / device_secrets / gateway_enrollments
   │                 ├── device_commands (OTA, probe…)
   │                 ├── device_status_log
   │                 └── node_state (current)
   ├── room_state (current, Realtime)
   ├── telemetry_minutes (per node per minute, partitioned monthly)
   ├── events (timeline + alarms, Realtime) ── event_types (catalog)
   ├── alert_rules · notification_preferences · notifications (Realtime)
   ├── support_tickets ── ticket_messages
   └── audit_log
firmware_releases (Storage-backed)
```

Extensibility: new hardware = a `device_models` row with `capabilities`; new signals land
in `node_state.extra` / `telemetry_minutes.extra` (jsonb) without migrations; new alarm kinds
= an `event_types` row. The gateway protocol is versioned (`/api/gateway/v1`).

---

## 5. Device communication & provisioning architecture

### 5.1 Gateway protocol (`/api/gateway/v1`, JSON over HTTPS, bearer token)
| Endpoint | Purpose |
|---|---|
| `POST /enroll` | One-time enrollment code (24 h, single use, hashed) → long-lived gateway token (32 random bytes, stored SHA-256 only) |
| `POST /heartbeat` (30 s) | agent/sensing-server health, LAN IPs, nodes seen (node_id, IP, MAC via ARP, packets/s, RSSI, firmware) → returns node map + pending commands |
| `POST /telemetry` (5 s) | per-node live samples + closed minute buckets → `ingest_telemetry()` updates node/room state, history, presence & intrusion events |
| `POST /events` | edge events detected on-device (fall) with dedupe keys |
| `POST /commands/{id}/result` | command outcome |

The agent persists unsent minute buckets/events to disk (bounded) and replays them, so
history survives internet outages.

### 5.2 Browser provisioning (installer laptop, Chrome/Edge desktop)
1. Web Serial + `esptool-js` connect to the board → chip check (must be ESP32-S3), base MAC
   (= WiFi STA MAC → unique hardware id), flash size (selects 8 MB vs 4 MB image).
2. Device auto-registered/matched by MAC; installer assigns property/room; platform allocates
   a `node_id` unique per gateway.
3. Platform issues the provisioning bundle (target = gateway LAN IP reported by heartbeat,
   node_id, edge tier, per-device OTA PSK). WiFi password is typed by the installer and
   **never sent to or stored by the server**.
4. NVS image generated **in the browser** (`shared/src/nvs`, byte-identical to ESP-IDF's
   generator, verified by tests), flashed with bootloader/partition/otadata/app images
   streamed from the `firmware` bucket via an authenticated route.
5. Hard reset, then the wizard reads the serial boot log (WiFi connect / IP / "CSI streaming
   active") and waits for the gateway to report the node → device becomes `online`.
6. Walk test per room (live presence via Realtime) → installation completed.

Fallback when Web Serial is unavailable (Safari/Firefox/mobile): the wizard produces the
exact `esptool` + `provision.py` commands with the allocated values.

### 5.3 OTA
Admin selects a published release → `device_commands(ota_update)` → delivered on next
heartbeat with a 1 h signed URL, SHA-256, size and decrypted PSK → agent verifies hash, POSTs to
`http://<node-ip>:8032/ota`, polls `/ota/status` for the new version. Platform refuses dispatch
when the image exceeds the firmware's 900 KB gate (L3).

---

## 6. Monitoring & security features (what is real)

| Feature | Data source | Status |
|---|---|---|
| Presence / occupancy per room | edge vitals presence (tier 2) ∨ sensing-server node classification; room = any node present, persons = max over room nodes, 30 s clear hysteresis | Implemented |
| Motion level | sensing-server `motion_level`; edge motion flag/energy | Implemented |
| Person estimate | edge `n_persons` / server estimate (marked "estimate") | Implemented |
| Intrusion alarm | presence in a room of a zone armed for the current security mode | Implemented |
| Fall detection | edge fall flag (tier 2) | Implemented, labelled *experimental* |
| Breathing / heart rate | edge vitals | Opt-in per property (`features.wellness_vitals`), *not a medical device* |
| Device / gateway offline | heartbeat & last-seen (pg_cron, 1 min) | Implemented |
| Signal quality (RSSI, frame rate) | agent | Implemented |
| History & analytics | `telemetry_minutes`, `events` | Implemented |
| Pose skeleton / RF field / zone summary | sensing-server synthetic outputs | **Deliberately not shown** (L4/§1.2) |
| WASM module management | firmware alpha, requires signing keys | Not in v1 (documented) |

---

## 7. Scalability notes
* Write volume: 1 row/node/minute into `telemetry_minutes` (monthly partitions, retention job);
  live state is *upserted* (`node_state`, `room_state`) so it does not grow.
* 1,000 homes × 3 nodes ≈ 3k rows/min history, ≈ 600 req/s telemetry at 5 s — well within a
  single Supabase Pro instance; telemetry interval is server-controlled via heartbeat config.
* Realtime fan-out is per-property filtered channels on `room_state` / `events` (RLS-enforced).
* Next.js API routes are stateless; rate limiting is per-instance (swap for a shared store when
  horizontally scaled).
