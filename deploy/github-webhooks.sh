#!/usr/bin/env bash
# Connect GitHub repos to todoer's activity webhook (pushes + merged PRs count against the AFK penalty).
# Usage: deploy/github-webhooks.sh owner/repo [owner/repo ...]
# Needs: gh authenticated with admin on each repo, GITHUB_WEBHOOK_SECRET in apps/api/.env.
# Idempotent: an existing todoer hook on a repo is updated (events, secret) instead of duplicated.
set -euo pipefail
cd "$(dirname "$0")/.."
url="${TODOER_WEBHOOK_URL:-https://api.todo.customsai.org/api/github/webhook}"
secret="$(grep -E '^GITHUB_WEBHOOK_SECRET=' apps/api/.env | cut -d= -f2-)"
[ -n "$secret" ] || { echo "GITHUB_WEBHOOK_SECRET is not set in apps/api/.env" >&2; exit 1; }
[ "$#" -gt 0 ] || { echo "usage: $0 owner/repo [owner/repo ...]" >&2; exit 1; }
for repo in "$@"; do
  existing="$(gh api "repos/$repo/hooks" --jq ".[] | select(.config.url == \"$url\") | .id" | head -n1)"
  body="$(jq -n --arg url "$url" --arg secret "$secret" '{active: true, events: ["push", "pull_request"],
    config: {url: $url, content_type: "json", secret: $secret, insecure_ssl: "0"}}')"
  if [ -n "$existing" ]; then
    gh api -X PATCH "repos/$repo/hooks/$existing" --input - <<<"$body" >/dev/null
    echo "$repo: updated hook $existing"
  else
    id="$(gh api -X POST "repos/$repo/hooks" --input - --jq .id <<<"$(jq '. + {name: "web"}' <<<"$body")")"
    echo "$repo: created hook $id"
  fi
done
