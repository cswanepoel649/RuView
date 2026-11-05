#!/usr/bin/env bash
# Verifies platform/docker/migrate.sh (the Docker stack's migration runner): applies every
# migration once on a fresh database, records it, and is a no-op on the second run.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/pg-cluster.sh"
trap pg_cluster_stop EXIT
PG_CLUSTER_SKIP_MIGRATIONS=1 pg_cluster_start
export PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres PATH="$PGBIN:$PATH" MIGRATIONS_DIR="$ROOT/migrations"
first="$(bash "$ROOT/../docker/migrate.sh" 2>&1 | grep -v NOTICE | tail -1)"
second="$(bash "$ROOT/../docker/migrate.sh" 2>&1 | grep -v NOTICE | tail -1)"
count="$(psql -tAc 'select count(*) from supabase_migrations.schema_migrations')"
files="$(ls "$ROOT"/migrations/*.sql | wc -l | tr -d ' ')"
tables="$(psql -tAc "select count(*) from pg_tables where schemaname = 'public' and rowsecurity")"
echo "first run:  $first"
echo "second run: $second"
echo "recorded $count/$files migrations; $tables public tables with RLS"
[ "$count" = "$files" ] && [ "$second" = "migrate: done (0 applied)" ] && [ "$first" = "migrate: done ($files applied)" ] \
  && echo "MIGRATION RUNNER OK" || { echo "MIGRATION RUNNER FAILED"; exit 1; }
