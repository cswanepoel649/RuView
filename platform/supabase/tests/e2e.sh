#!/usr/bin/env bash
# End-to-end: real ruview-agent → real Next.js gateway route handlers → real schema/functions.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/pg-cluster.sh"
trap pg_cluster_stop EXIT
pg_cluster_start
cd "$HERE/../../web" && PG_TEST_URL="$PG_TEST_URL" npx vitest run test/e2e-gateway.e2e.ts --config vitest.e2e.config.ts
