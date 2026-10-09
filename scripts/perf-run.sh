#!/usr/bin/env bash
# One-shot latency benchmark: starts xyra-core with PERF_TRACE on, runs the
# perf-waterfall workload against it, stops it. Same workload wherever it runs,
# so results from different hosts (dev laptop vs. us-east-1) are comparable.
#
# Needs in xyra-core/: node_modules (npm ci), .cdsrc-private.json (DB creds),
# .env with JWT_SECRET and DEV_MODE=true.
# Usage: bash scripts/perf-run.sh [runsPerEndpoint]
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-4011}
LOG="perf-$(hostname)-$(date +%Y%m%d-%H%M%S).log"

PERF_TRACE=true PORT=$PORT npx cds serve all > "$LOG" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 1; done
sleep 3 # let TenantDirectory's first refresh land

node scripts/perf-waterfall.js "$LOG" "http://localhost:$PORT" "${1:-20}" | tee "${LOG%.log}-waterfall.txt"
