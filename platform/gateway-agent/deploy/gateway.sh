#!/usr/bin/env bash
# RuView home gateway installer.
#   curl -fsSL https://<platform>/install/gateway.sh | sudo RUVIEW_CLOUD_URL=https://<platform> RUVIEW_ENROLLMENT_CODE=XXXX-XXXX-XXXX bash
# Installs to /opt/ruview: docker compose stack (RuView sensing-server + ruview-agent).
set -euo pipefail
: "${RUVIEW_CLOUD_URL:?set RUVIEW_CLOUD_URL}"
DIR=/opt/ruview
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
case "$RUVIEW_CLOUD_URL" in https://*) ;; *) [ "${RUVIEW_ALLOW_INSECURE_HTTP:-0}" = 1 ] || { echo "RUVIEW_CLOUD_URL must be https://"; exit 1; } ;; esac

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine with the compose plugin is required."
  echo "Install it from https://docs.docker.com/engine/install/ (Raspberry Pi OS: Debian instructions), then re-run."
  exit 1
fi

mkdir -p "$DIR/state"
chown 1000:1000 "$DIR/state"; chmod 700 "$DIR/state"
cd "$DIR"
echo "Downloading gateway files from $RUVIEW_CLOUD_URL ..."
curl -fsSL "$RUVIEW_CLOUD_URL/install/docker-compose.yml" -o docker-compose.yml
curl -fsSL "$RUVIEW_CLOUD_URL/install/ruview-agent.mjs" -o ruview-agent.mjs.new
curl -fsSL "$RUVIEW_CLOUD_URL/install/ruview-agent.mjs.sha256" -o ruview-agent.mjs.sha256
echo "$(cat ruview-agent.mjs.sha256)  ruview-agent.mjs.new" | sha256sum -c - >/dev/null || { echo "agent checksum mismatch — aborting"; exit 1; }
mv ruview-agent.mjs.new ruview-agent.mjs

if [ -n "${RUVIEW_ENROLLMENT_CODE:-}" ] || [ ! -f agent.env ]; then
  umask 077
  { echo "RUVIEW_CLOUD_URL=$RUVIEW_CLOUD_URL"; [ -n "${RUVIEW_ENROLLMENT_CODE:-}" ] && echo "RUVIEW_ENROLLMENT_CODE=$RUVIEW_ENROLLMENT_CODE"
    [ "${RUVIEW_ALLOW_INSECURE_HTTP:-0}" = 1 ] && echo "RUVIEW_ALLOW_INSECURE_HTTP=1"; } > agent.env
  chown 1000:1000 agent.env
fi

# Keep the sensing-server's raw UDP port off the LAN (only the agent should feed it).
if command -v ufw >/dev/null && ufw status | grep -q active; then
  ufw allow 5005/udp comment 'RuView ESP32 nodes' >/dev/null
  ufw deny 5006/udp comment 'RuView sensing-server (local only)' >/dev/null
fi

docker compose pull
docker compose up -d
echo
echo "Gateway started. It enrolls automatically and appears online in the platform within a minute."
echo "Diagnostics: docker compose -f $DIR/docker-compose.yml exec ruview-agent node /opt/ruview/ruview-agent.mjs doctor"
echo "LAN address(es) for sensors to stream to: $(hostname -I 2>/dev/null || true)"
