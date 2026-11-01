# todoer: agent guide

A shared todo app for exactly two people, **Maxim** (`maxim`, the owner) and **German** (`german`, his
teammate). It is in daily use. **Production runs from this checkout**, so read the safety rules
before running anything.

- Web: https://todo.customsai.org (Next.js 16, `apps/web`)
- API: https://api.todo.customsai.org (Express 5 + Postgres 16, plain JS ESM, `apps/api`)
- Agent/LLM instructions for the API: https://todo.customsai.org/agent (source: `apps/api/src/lib/agent.md`)
- Product + API contract: [`SPEC.md`](SPEC.md). Keep it in sync with any behaviour change.
- Next.js 16 differs from older versions: read [`apps/web/AGENTS.md`](apps/web/AGENTS.md) and
  `node_modules/next/dist/docs/` before changing web code.

## Repo layout

```
package.json            npm workspaces root (one root package-lock.json; run npm install here)
apps/api                @todoer/api: src/app.js (routes wiring), src/routes/*, src/lib/*, migrations/*.sql,
                        scripts/{migrate,seed}.js, test/*.test.js (node --test + supertest)
apps/web                @todoer/web: app/(app)/* routes, app/login, components/*, hooks/*, lib/*,
                        scripts/mock-api.mjs (dev mock), tests/*.spec.ts (Playwright), assets/app-icon.svg
deploy/                 systemd units, Caddy snippet, redeploy.sh, staging.sh, README.md (runbook)
```

## Safety rules (read first)

1. **The production database is `todoer` (local Postgres) with real data.** Don't run tests that
   write to it, don't run the seed against it, and never delete or modify rows you didn't create.
   For anything interactive, use **staging** (below). The API test suite is safe: it uses an isolated
   schema and cleans up after itself.
2. If you must touch production data (e.g. a smoke test), prefix everything with `QA ` and delete it
   afterwards. Don't change anyone's password, display name, or `activeProjectId`.
3. Don't bind dev servers to the production ports **3200/4200**. Local dev uses 3000/4000, and
   staging uses 3400/4400.
4. Never commit or print secrets: `apps/api/.env*`, `apps/api/.seed-credentials.txt`,
   `apps/api/.staging-credentials.txt` (all gitignored).
5. Maxim changed his own password, so the one in `.seed-credentials.txt` is stale. **Don't reset it.**
   For Maxim-side API checks use his seed API token from that file. In the browser, log in as `german`.
6. The public reverse proxy is **shared with other sites** (watermark remover, finstrat, devcom,
   Nextcloud). Only ever *append* to its Caddyfile (see Operations), and validate before reloading.

## Production topology

| Piece | Where |
|---|---|
| `todoer-web.service` | `next start` on `172.20.0.1:3200`, WorkingDirectory `apps/web`, runs as `mkabaev` |
| `todoer-api.service` | `node src/server.js` on `172.20.0.1:4200`, env set in the unit (`deploy/todoer-api.service`) plus `apps/api/.env` |
| Reverse proxy / TLS | Docker container **`infra-caddy-1`** (ports 80/443), config bind-mounted from `/opt/watermark-remover/infra/Caddyfile`; our blocks are in `deploy/Caddyfile.todoer` |
| Network | `172.20.0.1` is the `infra_frontend` Docker bridge gateway; ufw allows only `172.20.0.0/16` → 3200/4200 |
| Database | Postgres 16 on `localhost:5432`, DB `todoer` (prod) and `todoer_staging`, role `todoer` (URL in `apps/api/.env`) |
| Uploads | `apps/api/uploads/` (prod images; back up with the DB) |
| DNS | Cloudflare, **DNS-only (grey cloud)** for both hostnames. `api.todo…` is two levels deep, so Cloudflare's proxy certificate can't cover it |

The web app proxies `/api/*` and `/agent` to the API via Next rewrites. `API_URL` and `NEXT_PUBLIC_*` are
**baked in at build time**, so changing them requires a rebuild.

Production API env (in the unit): `NODE_ENV=production`, `API_HOST=172.20.0.1`, `API_PORT=4200`,
`PUBLIC_API_URL`, `PUBLIC_WEB_URL`, `COOKIE_SECURE=true`, `TRUST_PROXY=loopback,172.20.0.0/16`,
`EMAIL_FROM`. `RESEND_API_KEY` (email digests via Resend, domain `todo.customsai.org`) lives in `apps/api/.env`.
On staging, use `delivered+<label>@resend.dev` addresses so test digests never reach real inboxes.
All variables are documented in `apps/api/.env.example` and `apps/web/.env.example`.

## Operations

```sh
# Status / health
systemctl status todoer-api todoer-web
curl -fsS https://api.todo.customsai.org/api/health && curl -fsS -o /dev/null -w '%{http_code}\n' https://todo.customsai.org/login

# Logs
journalctl -u todoer-api -f
journalctl -u todoer-web -f
sudo docker logs --since 10m infra-caddy-1

# Restart (no code change)
sudo systemctl restart todoer-api            # API only
sudo systemctl restart todoer-web            # web only (serves the existing build in apps/web/.next)

# Deploy code changes (install, tests, clean build, migrate, restart, health check; stops on first failure)
deploy/redeploy.sh

# Database
npm run db:migrate                           # applies new apps/api/migrations/*.sql (redeploy.sh does this)
psql "$(grep ^DATABASE_URL apps/api/.env | cut -d= -f2-)"

# Caddy (shared!): append only, validate, then reload
sudo docker exec infra-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker exec infra-caddy-1 caddy reload   --config /etc/caddy/Caddyfile --adapter caddyfile
```

More detail: [`deploy/README.md`](deploy/README.md).

## Development and testing

```sh
npm install                                   # at repo root
npm test                                      # API test suite (isolated schema; safe)
cd apps/web && npm run lint && npm run typecheck && npm test && npm run build
```

- **Staging** (real API + real Postgres, throwaway data): `deploy/staging.sh start|stop|status|migrate`
  serves http://localhost:3400 (API on :4400) against `todoer_staging`. Config is in `apps/api/.env.staging`,
  and logins for both users are in `apps/api/.staging-credentials.txt`. Run `deploy/staging.sh migrate`
  after adding a migration. Browser QA uses Playwright (already installed); `headless` +
  `--no-sandbox` works on this host. The built-in T3 browser preview is blocked by AppArmor.
- **Mock API** (no DB): `MOCK_PORT=4001 npm run mock --workspace=@todoer/web`, then
  `API_URL=http://localhost:4001 npx next dev --port 3001` in `apps/web`. The mock users are
  `maxim`/`teammate` with password `todoer`. The Playwright suite targets the mock:
  `WEB_URL=http://localhost:3001 npm run test:e2e` in `apps/web`. Keep `scripts/mock-api.mjs` in sync with API behaviour.
- Isolated work: use a git worktree. Copy `apps/api/.env` (or `.env.staging`) into it, since env files are gitignored.

## Product rules worth knowing (details in SPEC.md)

- No field is ever required; an empty task is valid. Capture must stay instant (optimistic, no
  pre-flight requests).
- Users: exactly two, seeded. There is no signup. Browser sessions never expire (the 400-day cookie
  is renewed on `GET /api/me`), and API tokens (`tdr_…`, Settings → Agent tokens) never expire until revoked.
- Identifiers accepted by the API: user id, username, display name, `me`, `teammate`; tag names.
- `POST /api/tasks/:id/handoff {to}` sets assignees to **exactly** `[to]`.
- **Later** (`list=later`) tasks never have assignees. Assigning anyone moves the task to `now`.
- **Active project**: each user has one site-wide `activeProjectId` (`null` = All projects), set only
  via `PATCH /api/me`. The UI scopes every view and count to it. The server never defaults `projectId`.
- Every task has a shareable URL `/tasks/:id`, and the API returns it as `webUrl`.
- When you change API behaviour, update `SPEC.md`, `apps/api/src/lib/agent.md`, the API tests, and the mock.

## Gotchas learned the hard way

- **Always build from a clean `apps/web/.next`** (redeploy.sh does). Stale generated route types fail
  `next build`, and a failed build followed by a restart takes the site down.
- Don't pipe build/deploy output through `grep`/`tail` in a way that hides the exit status. Use `set -euo pipefail`.
- Migrations run **right before** the API restart, so the old API never runs on a newer schema. For a
  breaking schema change, deploy the backend and frontend together.
- The Caddyfile is a **single-file bind mount**: edit it in place (`>>` append). Tools that replace
  the file (new inode) break the mount.
- systemd `Environment=` values containing spaces must be quoted (`Environment="KEY=a, b"`).
- `TRUST_PROXY` must include the Docker bridge (`172.20.0.0/16`), otherwise client IPs and the login rate limiter break.
- Multer needs `defParamCharset: 'utf8'`. macOS screenshot names contain U+202F.
- Emoji render as boxes in this host's headless Chromium (no emoji font). That's expected.
- Home Screen icons: `apps/web/assets/app-icon.svg` (full-bleed, since iOS rounds it) →
  `node scripts/render-icons.mjs` (in `apps/web`) writes `app/apple-icon.png` and `public/icons/*`.

## Conventions

- Plain JS (ESM) in the API, TypeScript in the web app. Match the surrounding style.
- Commit on a branch or worktree with clear messages. The owner usually has UI work built by
  OpenAI Sol agents, with Claude reviewing, testing end to end, and deploying.
- Don't push or deploy unless asked. When you deploy, verify on the live site afterwards.
