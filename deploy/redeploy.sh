#!/usr/bin/env bash
# Rebuild and restart production. Aborts before touching the running services if anything fails.
set -euo pipefail
cd "$(dirname "$0")/.."
npm install
npm test
# Build into a fresh .next: stale generated types from older routes break the type check.
# API_URL and NEXT_PUBLIC_* are baked in at build time.
sudo systemctl stop todoer-web
trap 'echo "Build failed; restarting the previous web service is not possible (.next was replaced). Fix and rerun." >&2' ERR
rm -rf apps/web/.next
API_URL=http://172.20.0.1:4200 NEXT_PUBLIC_API_PUBLIC_URL=https://api.todo.customsai.org npm run build
trap - ERR
# Migrate only now, right before the API restart, so the old API never runs against a newer schema.
npm run db:migrate
sudo cp deploy/todoer-api.service deploy/todoer-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart todoer-api
sudo systemctl start todoer-web
sleep 4
curl -fsS -o /dev/null https://todo.customsai.org/login && curl -fsS https://api.todo.customsai.org/api/health && echo " deployed"
