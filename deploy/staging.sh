#!/usr/bin/env bash
# Local staging: API on :4400 + Next dev on :3400 against the todoer_staging database.
# Safe to use for testing; never touches production data or services.
#   deploy/staging.sh start | stop | status | migrate
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
ENV_FILE=apps/api/.env.staging
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE (see AGENTS.md → Staging)" >&2; exit 1; }
load_env() { set -a; . "$ROOT/$ENV_FILE"; set +a; }
pids() { { ss -ltnp 2>/dev/null | grep -E ':(3400|4400) ' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u; } || true; }
case "${1:-}" in
  start)
    load_env
    mkdir -p "$API_UPLOAD_DIR"
    (cd apps/api && nohup node src/server.js > /tmp/todoer-staging-api.log 2>&1 &)
    (cd apps/web && API_URL=http://localhost:4400 nohup "$ROOT/node_modules/.bin/next" dev --port 3400 > /tmp/todoer-staging-web.log 2>&1 &)
    for _ in $(seq 1 60); do curl -fs -o /dev/null http://localhost:3400/login && break; sleep 1; done
    curl -fsS http://localhost:3400/api/health && echo "  staging up: http://localhost:3400 (logins: apps/api/.staging-credentials.txt)"
    ;;
  stop) for p in $(pids); do kill "$p"; done; echo "staging stopped" ;;
  status) if [ -n "$(pids)" ]; then pids | sed 's/^/pid /'; else echo "not running"; fi ;;
  migrate) load_env; (cd apps/api && node scripts/migrate.js) ;;
  *) echo "usage: $0 start|stop|status|migrate" >&2; exit 1 ;;
esac
