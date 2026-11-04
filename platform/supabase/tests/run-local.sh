#!/usr/bin/env bash
# Applies the Supabase shim + all migrations to a throwaway Postgres cluster and
# runs every tests/*.test.sql file. Exit code is non-zero on any failure.
#   bash platform/supabase/tests/run-local.sh       (PGBIN=/path/to/pg/bin to override)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/pg-cluster.sh"
trap pg_cluster_stop EXIT
echo "==> starting cluster and applying migrations"
pg_cluster_start
fail=0
for t in "$HERE"/*.test.sql; do
  echo "==> test $(basename "$t")"
  if ! "${PSQL[@]}" -f "$t" 2>&1 | grep -E 'ok - |ERROR|ASSERTION' | sed 's/^psql:[^ ]* NOTICE:  /  /'; then :; fi
  if ! "${PSQL[@]}" -f "$t" >/dev/null 2>&1; then fail=1; echo "FAILED: $(basename "$t")"; fi
done
[ "$fail" = 0 ] && echo "ALL DATABASE TESTS PASSED" || { echo "DATABASE TESTS FAILED"; exit 1; }
