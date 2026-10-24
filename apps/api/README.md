# @todoer/api

Node 24 / npm 11, Express 5, plain ESM JavaScript, PostgreSQL 16.

From the repository root:

```sh
npm install
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env with the database connection and a random SESSION_SECRET.
npm run db:migrate
npm run dev:api
npm test --workspace=@todoer/api
```

Use the repository root for `npm install`; both apps share the root lockfile.
Run workspace scripts with `npm run <script> --workspace=@todoer/api`.
All settings are documented in [.env.example](.env.example). `DATABASE_URL` and `SESSION_SECRET` are required.
The API listens on `API_HOST` (default `127.0.0.1`) and `API_PORT` (default `4000`).
Run `npm run db:seed` only for initial setup of a new database; the shared local database is already seeded.
Seed overrides: `SEED_USER1_USERNAME`, `SEED_USER1_NAME`, `SEED_USER1_PASSWORD`, and the same for `USER2`.
Seed prints new credentials and tokens and saves them privately in `.seed-credentials.txt` (gitignored).
Rerunning preserves existing passwords and seed tokens. It only creates examples if tasks is empty.
If the credentials file is lost, existing password hashes and tokens cannot be recovered; create a new token from Settings.

`GET /api/agent` (also `/agent`) is the complete curl guide. The frontend proxies `/api/*` to this server.
Set `PUBLIC_API_URL` to the preferred direct API origin to keep all agent examples correct even
when the Next proxy sends a localhost Host header. Without it, the guide derives its base from the request
protocol and Host and includes local development hints.
Browser sessions never expire (the 400-day cookie is renewed on every app load via GET /api/me); agent tokens never expire until revoked; API tokens are SHA-256 hashed and cookie secrets are HMAC hashed at rest.
Rotating `SESSION_SECRET` invalidates existing browser sessions. Failed logins are limited to 20 per IP per 15 minutes.
Session cookies have `Secure` when `COOKIE_SECURE=true` or `NODE_ENV=production`; localhost defaults to off.
Forwarded client IP and protocol headers are trusted only from loopback connections (`127.0.0.1` / `::1`).

For production behind Caddy, set these in `apps/api/.env` (or the service environment):

```dotenv
NODE_ENV=production
API_HOST=127.0.0.1
API_PORT=4000
PUBLIC_API_URL=https://api.todo.customsai.org
COOKIE_SECURE=true
```

Keep `DATABASE_URL` and a random `SESSION_SECRET` configured too. Serve `https://api.todo.customsai.org`
through Caddy with `reverse_proxy 127.0.0.1:4000`; Caddy preserves the original Host and sends
forwarded protocol/client headers. The web app at `https://todo.customsai.org` proxies `/api/*`
to the same localhost API (web env `API_URL=http://127.0.0.1:4000`).
Start the API from the root with `npm start --workspace=@todoer/api` under your process supervisor.
This runs Node without watch mode. SIGTERM/SIGINT stop accepting connections and close the DB pool,
with a 10-second shutdown deadline. For integration work while the reviewer uses ports 3000/4000,
override `API_PORT=4200` and stop the process afterward.

SQL lives in `migrations/`; `scripts/migrate.js` tracks migrations in `schema_migrations` and serializes runners.
Routes are in `src/routes/`; shared validation, task hydration, uploads, and agent instructions are in `src/lib/`.
Images are stored in `uploads/<attachmentId>.<ext>` (created on boot, gitignored). Back up this directory with Postgres.
Images can be uploaded together in one request, each at most 20 MB. File headers must match the declared allowed image MIME type.

Integration tests use a randomly named schema in the existing database and a temporary child of uploads.
They drop only their own schema and files after running; they never delete public-schema tasks or users.
`API_DB_SCHEMA` isolates tests; `API_UPLOAD_DIR` can also select a persistent production storage directory.
