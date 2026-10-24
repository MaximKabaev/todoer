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

## Redeploy after changes

```sh
cd ~/.t3/projects/todoer
git pull            # or merge your branch
npm install
npm run db:migrate
# API_URL and NEXT_PUBLIC_* are baked in at build time
API_URL=http://172.20.0.1:4200 NEXT_PUBLIC_API_PUBLIC_URL=https://api.todo.customsai.org npm run build
sudo systemctl restart todoer-api todoer-web
```

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
