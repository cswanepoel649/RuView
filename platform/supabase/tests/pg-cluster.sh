#!/usr/bin/env bash
# Throwaway Postgres cluster with the Supabase shim + all migrations applied.
#   source pg-cluster.sh; pg_cluster_start; ...; pg_cluster_stop
# Exports PG_TEST_URL and PSQL (array).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PGPORT_TEST:-54339}"

_run() { if [ "$(id -u)" = "0" ]; then su postgres -s /bin/sh -c "$*"; else sh -c "$*"; fi; }

pg_cluster_start() {
  WORK="$(mktemp -d)"
  [ "$(id -u)" = "0" ] && chown postgres "$WORK"
  _run "'$PGBIN/initdb' -D '$WORK/data' -U postgres -A trust" >/dev/null
  _run "'$PGBIN/pg_ctl' -D '$WORK/data' -o \"-p $PORT -k $WORK -c listen_addresses=127.0.0.1\" -l '$WORK/log' start" >/dev/null
  for _ in $(seq 1 50); do "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1 && break; sleep 0.2; done
  PSQL=("$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X -o /dev/null)
  "${PSQL[@]}" -f "$HERE/supabase_shim.sql" 2>/dev/null
  for f in "$ROOT"/migrations/*.sql; do "${PSQL[@]}" -f "$f" 2>&1 | grep -v 'NOTICE\|^$' || true; done
  export PG_TEST_URL="postgres://postgres@127.0.0.1:$PORT/postgres" WORK
}

pg_cluster_stop() {
  _run "'$PGBIN/pg_ctl' -D '$WORK/data' -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
