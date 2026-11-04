# Installer Field Guide

From empty boxes to a live, verified home in one visit. Everything is driven from
**Operations → Installations → (property)** — the wizard tracks progress and refreshes live.

## What to bring
- Gateway: Raspberry Pi 4/5 + PSU + microSD with 64-bit Raspberry Pi OS and Docker installed, Ethernet cable.
- ESP32-S3 boards (8 MB or 4 MB flash) — one per monitored room, two for large rooms — with USB cables and 5 V supplies.
  *Original ESP32 and ESP32-C3 boards are not supported.*
- A laptop with **Chrome or Edge** (Web Serial). On other browsers the wizard falls back to downloading the
  configuration image for manual `esptool` flashing.
- The home's **2.4 GHz** WiFi name and password (the client types it or tells you; it is never stored).

## Before the visit
1. Client and property exist (Clients → client → Add property).
2. Floors and rooms are entered; optionally upload floor plans and outline rooms (Properties → Floors & rooms).
3. Start the installation wizard from the property page.

## 1 · Site survey
Confirm rooms, plan node positions: ~1–1.5 m high, clear line of sight across the room, away from metal
cabinets, microwave ovens and the router itself. Fans, curtains in drafts and pets can cause motion.

## 2 · Gateway
1. Add the gateway in the wizard, then **Generate enrollment code** (valid 24 h, single use).
2. Connect the Pi by Ethernet, SSH in and paste the displayed install command.
3. In the router, reserve the Pi's LAN IP.
4. The wizard turns green when the gateway is online and the sensing service reports `esp32`.

## 3 · Sensor nodes (repeat per board)
1. Enter the WiFi SSID/password once; the gateway LAN IP is pre-filled from the gateway's report.
2. Plug in a board → **Connect board** → choose the serial port. (If not detected: hold BOOT, tap RESET, release BOOT.)
3. The wizard reads chip, MAC and flash size, registers the board by MAC and allocates its node id.
4. Name it, choose its room, keep **Firmware + configuration** and the latest release → **Provision board**.
5. Watch the checklist: firmware booted → joined WiFi → streaming to gateway → OTA authentication.
   **Confirm & save**. Unplug, mount, power from a 5 V supply.
6. The node shows *Online* in the table once the gateway receives its packets.

Common failures: *Joined WiFi* fails → wrong password or 5 GHz-only SSID; *streaming to* shows a
different IP → wrong gateway IP; node never online → gateway firewall/subnet, or node out of WiFi range
(signal bars on the device page; aim for better than −70 dBm).

## 4 · Walk test
Power-cycle nothing for 60 s while rooms are empty (on-device presence calibration). Then walk into each
room, stand still a few seconds, confirm it lights up on the live plan, and **Mark verified**.

## 5 · Handover
Invite the client's users (Clients → Portal users), review security zones and alert rules with them,
explain arming (exit delay) and that occupancy is inferred from WiFi signals. **Complete installation**
sets the property live.

## Manual fallback (no Web Serial)
Download the NVS image from the wizard, then:
```bash
python -m esptool --chip esp32s3 --port <PORT> --baud 460800 write_flash 0x0 bootloader.bin 0x8000 partition-table.bin 0xf000 ota_data_initial.bin 0x20000 esp32-csi-node.bin 0x9000 nvs-node<N>.bin
```
Then press **Save anyway** in the wizard after verifying the serial log (`python -m serial.tools.miniterm <PORT> 115200`).
