<img src="assets/icon.svg" width="64" height="64" alt="">

# todoer

A simple shared todo app for two people (Maxim and German). Live at **https://todo.customsai.org**.

- `apps/web`: Next.js frontend (Apple-style, responsive, drag-and-drop images → tasks)
- `apps/api`: Express + Postgres API, including agent instructions at `/agent`
- `SPEC.md`: the product and API contract
- `deploy/`: production services and Caddy config ([deploy/README.md](deploy/README.md))

## Local development

```sh
npm install
npm run db:migrate
npm run dev        # API on :4000, web on :3000
npm test           # API tests
```

## AI agents

Point your agent at `https://todo.customsai.org/agent` (or `https://api.todo.customsai.org/agent`)
and give it a token from **Settings → Agent tokens**.
