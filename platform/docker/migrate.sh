#!/usr/bin/env bash
# Applies platform/supabase/migrations/*.sql in order, each in its own transaction,
# and records applied versions in supabase_migrations.schema_migrations (the table the
# Supabase CLI uses, so `supabase db push` against this database stays consistent).
set -euo pipefail
PSQL=(psql -v ON_ERROR_STOP=1 -X -q)
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"

echo "migrate: waiting for Supabase schemas (auth.users, storage.buckets)..."
for i in $(seq 1 60); do
  if "${PSQL[@]}" -tAc "select to_regclass('auth.users') is not null and to_regclass('storage.buckets') is not null" 2>/dev/null | grep -q t; then
    break
  fi
  [ "$i" = 60 ] && { echo "migrate: Supabase schemas not ready after 120 s" >&2; exit 1; }
  sleep 2
done

"${PSQL[@]}" <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text);
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
SQL

applied=0
for f in "$MIGRATIONS_DIR"/*.sql; do
  base="$(basename "$f" .sql)"
  version="${base%%_*}"
  name="${base#*_}"
  if "${PSQL[@]}" -tAc "select 1 from supabase_migrations.schema_migrations where version = '$version'" | grep -q 1; then
    continue
  fi
  echo "migrate: applying $base"
  "${PSQL[@]}" -1 -f "$f" \
    -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')"
  applied=$((applied + 1))
done
echo "migrate: done ($applied applied)"
