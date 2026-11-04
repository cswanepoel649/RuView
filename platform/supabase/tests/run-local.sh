#!/usr/bin/env bash
# Applies the Supabase shim + all migrations to a throwaway Postgres cluster and
# runs every tests/*.test.sql file. Exit code is non-zero on any failure.
#
#   bash platform/supabase/tests/run-local.sh            # uses pg binaries on PATH or /usr/lib/postgresql/*/bin
#   PGBIN=/opt/pg16/bin bash platform/supabase/tests/run-local.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PGPORT_TEST:-54329}"
WORK="$(mktemp -d)"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  chown postgres "$WORK"
  RUN_AS=(sudo -u postgres)
  command -v sudo >/dev/null || RUN_AS=(su postgres -s /bin/sh -c)
fi
run() { if [ "${RUN_AS[0]:-}" = "su" ]; then "${RUN_AS[@]}" "$*"; else "${RUN_AS[@]}" "$@"; fi; }

cleanup() { run "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

run "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
run "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start >/dev/null
for _ in $(seq 1 50); do run "$PGBIN/pg_isready" -h "$WORK" -p "$PORT" >/dev/null 2>&1 && break; sleep 0.2; done

PSQL=("$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X -o /dev/null)
echo "==> applying shim"
"${PSQL[@]}" -f "$HERE/supabase_shim.sql"
for f in "$ROOT"/migrations/*.sql; do
  echo "==> migration $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
fail=0
for t in "$HERE"/*.test.sql; do
  echo "==> test $(basename "$t")"
  if ! "${PSQL[@]}" -f "$t"; then fail=1; echo "FAILED: $(basename "$t")"; fi
done
[ "$fail" = 0 ] && echo "ALL DATABASE TESTS PASSED" || { echo "DATABASE TESTS FAILED"; exit 1; }
