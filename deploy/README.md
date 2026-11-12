# Deploying todoer

Production runs on the VPS as two systemd services behind the shared Docker Caddy
(`infra-caddy-1`, config at `/opt/watermark-remover/infra/Caddyfile`).

| | URL | Upstream |
|---|---|---|
| Web (Next.js) | https://todo.customsai.org | `todoer-web.service` → `172.20.0.1:3200` |
| API (Express) | https://api.todo.customsai.org | `todoer-api.service` → `172.20.0.1:4200` |

`172.20.0.1` is the gateway of the `infra_frontend` Docker network, so the Caddy container can reach
the services while they stay off the public interface. ufw allows only `172.20.0.0/16` → ports 3200/4200.
Postgres is the local `todoer` database. Uploaded images live in `apps/api/uploads/`, so back them up with the DB.

## Automatic deploys (GitHub Actions)

Every push to `main` on GitHub runs `.github/workflows/deploy.yml` (it can also be started by hand from the
Actions tab). The workflow SSHes in as `mkabaev` with a key that can only run `deploy/ci-deploy.sh`: it's a
forced command in `~/.ssh/authorized_keys` (`restrict,command="…/deploy/ci-deploy.sh"`, comment
`github-actions-todoer-deploy`). That script:

- refuses to deploy if this checkout isn't on `main`, has uncommitted changes to tracked files
  (`apps/web/next-env.d.ts` is reset, since builds regenerate it), or has diverged from `origin/main`.
  **Don't leave work in progress in the production checkout.** Use a branch or a worktree.
- fast-forwards to `origin/main` and runs `deploy/redeploy.sh`, then records the SHA in
  `~/.local/state/todoer-deploy/deployed-sha`. It skips the deploy if that SHA is already deployed.
- runs detached from the SSH session (a dropped connection can't kill a half-done build), streams the log
  back to the Action, and holds a lock so pushes deploy one at a time. Logs: `~/.local/state/todoer-deploy/`.

Repository secrets: `DEPLOY_HOST` (VPS IP), `DEPLOY_USER`, `DEPLOY_SSH_KEY` (private key),
`DEPLOY_KNOWN_HOSTS` (the host's ed25519 key). To rotate the key, generate a new one, replace the
`github-actions-todoer-deploy` line in `authorized_keys`, and run `gh secret set DEPLOY_SSH_KEY < key`.
To pause auto-deploys, disable the workflow: `gh workflow disable deploy.yml`.

## Redeploy by hand

```sh
cd ~/.t3/projects/todoer
git pull            # or merge your branch
deploy/redeploy.sh  # install, test, migrate, clean build, restart, health check; stops on the first failure
```

Always build from a clean `apps/web/.next`. Stale generated route types fail the build, and a failed
build must never be followed by a restart (the script uses `set -euo pipefail` for this).

## Restart without deploying

```sh
sudo systemctl restart todoer-api      # or todoer-web; web serves the existing apps/web/.next build
systemctl status todoer-api todoer-web
```

## GitHub activity webhooks

Pushes (any branch) and merged PRs in connected repos count as activity for the AFK penalty. The secret
is `GITHUB_WEBHOOK_SECRET` in `apps/api/.env` (restart the API after changing it). To connect repos
(idempotent; updates an existing todoer hook):

```sh
deploy/github-webhooks.sh MaximKabaev/todoer MaximKabaev/customs-ai
```

Check deliveries in the repo's Settings → Webhooks, or `gh api repos/OWNER/REPO/hooks`. People link their
GitHub username in todoer Settings.

## Staging

`deploy/staging.sh start|stop|status|migrate` runs the current checkout on http://localhost:3400
(API :4400) against the `todoer_staging` database (config `apps/api/.env.staging`, logins in
`apps/api/.staging-credentials.txt`). Use it for anything that writes data.

## First-time setup (already done)

```sh
sudo cp deploy/todoer-*.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now todoer-api todoer-web
sudo ufw allow from 172.20.0.0/16 to 172.20.0.1 port 3200 proto tcp comment 'todoer web Caddy upstream'
sudo ufw allow from 172.20.0.0/16 to 172.20.0.1 port 4200 proto tcp comment 'todoer API Caddy upstream'
# Append (don't replace: the file is bind-mounted into the container) and reload
cat deploy/Caddyfile.todoer >> /opt/watermark-remover/infra/Caddyfile
sudo docker exec infra-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker exec infra-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

## Logs

```sh
journalctl -u todoer-api -f
journalctl -u todoer-web -f
```
