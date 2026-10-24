# @todoer/api

Node 24 / npm 11, Express 5, plain ESM JavaScript, PostgreSQL 16.

From the repository root:

```sh
npm install
npm run db:migrate
npm run db:seed
npm run dev:api
npm test
```

The standalone package also supports `npm install --prefix apps/api --workspaces=false`.
Run workspace scripts with `npm run <script> --workspace=@todoer/api`; `start` runs without watching.
`apps/api/.env` must provide `DATABASE_URL`, `SESSION_SECRET`, and optionally `API_PORT` (4000).
Seed overrides: `SEED_USER1_USERNAME`, `SEED_USER1_NAME`, `SEED_USER1_PASSWORD`, and the same for `USER2`.
Seed prints new credentials and tokens and saves them privately in `.seed-credentials.txt` (gitignored).
Rerunning preserves existing passwords and seed tokens. It only creates examples if tasks is empty.
If the credentials file is lost, existing password hashes and tokens cannot be recovered; create a new token from Settings.

`GET /api/agent` (also `/agent`) is the complete curl guide. The frontend proxies `/api/*` to this server.
Sessions last 90 days; API tokens are SHA-256 hashed and cookie secrets are HMAC hashed at rest.
Rotating `SESSION_SECRET` invalidates existing browser sessions. Failed logins are limited to 20 per IP per 15 minutes.

SQL lives in `migrations/`; `scripts/migrate.js` tracks migrations in `schema_migrations` and serializes runners.
Routes are in `src/routes/`; shared validation, task hydration, uploads, and agent instructions are in `src/lib/`.
Images are stored in `uploads/<attachmentId>.<ext>` (created on boot, gitignored). Back up this directory with Postgres.
Images can be uploaded together in one request, each at most 20 MB. File headers must match the declared allowed image MIME type.

Integration tests use a randomly named schema in the existing database and a temporary child of uploads.
They drop only their own schema and files after running; they never delete public-schema tasks or users.
`API_DB_SCHEMA` and `API_UPLOAD_DIR` are internal overrides for isolated test runs.
