# todoer web

The todoer web app, built with Next.js 16.4.3, React 19, TypeScript, SWR, Lucide icons, and custom CSS. All application code and the development mock live in `apps/web`.

## Run with the real API

From the repository root, using Node 24 and npm 11:

```sh
npm install
npm run dev --workspace=@todoer/web
```

Copy `apps/web/.env.example` to `apps/web/.env.local` and adjust the origins, or export them in your shell. `API_URL` is the private Express origin (including loopback, e.g. `http://127.0.0.1:4000`). `NEXT_PUBLIC_API_PUBLIC_URL` is optional and shows the direct API address in Settings; browser requests still use same-origin rewrites.

Open <http://localhost:3000>. Start the real API separately on port 4000 and use its seeded credentials. To use another API, set `API_URL=http://localhost:4001` when starting Next in development. For production, set `API_URL` when building as well, because rewrites are recorded at build time. No mock data is bundled into the UI.

## Run with the mock

Start these two processes in separate terminals:

```sh
npm run mock --workspace=@todoer/web
npm run dev --workspace=@todoer/web
```

The standalone mock is **never started by `dev`, `build`, or `start`**. Its default port is 4000. Both mock accounts use password `todoer`: `maxim` and `teammate`. All mock state is in memory and resets on restart. The mock supports sessions, both accounts, tasks and filters, multipart image storage and authenticated file serving, handoff, projects, tags, counts, profile/password changes, and personal tokens. Its `/agent` response identifies itself as a mock; the backend supplies the complete agent instructions.

If port 4000 is occupied:

```sh
MOCK_PORT=4001 npm run mock --workspace=@todoer/web
API_URL=http://localhost:4001 npm run dev --workspace=@todoer/web
```

## Structure

- `app/`: guarded workspace, login, metadata, icon, and CSS design tokens; follows the system appearance and reduced-motion setting.
- `components/`: desktop sidebar, mobile list home, contextual composer, inline-editable rows, task inspector/mobile sheet, image lightbox, project editor, settings, dialogs, toasts, and skeletons.
- `lib/api.ts`: shared domain types and a typed client for every endpoint in `SPEC.md`.
- `lib/quick-syntax.ts`: capture parsing for `#tags`, known `@mentions`, `@both`, `!` / `!!` / `!!!`, and `^later`. Unknown text is preserved. Chips preview the parsed title and fields without interrupting typing.
- `hooks/`: SWR workspace data, optimistic updates and per-task mutation queues, dialog focus handling, and media queries. Data polls every 10 seconds and revalidates on focus.
- `scripts/mock-api.mjs`: opt-in development API.
- `tests/`: Playwright interaction coverage. `lib/*.test.ts`: parser tests.
- `docs/screenshots/`: real-API captures at 1440×900, 375×667, 430×932, and 820×1180, in light/dark mode, including both accounts and task details.

The menu has one active-project selector, saved per user on the server. Every list, search, count and tag count uses that scope. All projects shows everything and creates tasks without a project. Capture inherits the active project plus the current list, person or tag. Tasks can be moved between projects in their inspector; old `/projects/:id` links activate the project and redirect to My Tasks. Images dropped on the window create one task with all images in one multipart request; images dropped on the inspector attach to that task. Images pasted outside text fields or into the composer create a task. SVG and files over 20 MiB are rejected before upload. HEIC/HEIF previews depend on browser image support; the original file is preserved.

Click a row title to edit it inline. Use its chevron or the rest of the row to open details. Keyboard: `N` focuses capture, `⌘/Ctrl K` opens list search, arrows navigate focused task rows, Space toggles completion, Enter opens details, Delete/Backspace asks before deleting, and Escape closes the top dialog. On mobile, swipe a row right to complete (or reopen); swipe left to reveal Pass/Take and Delete. Gestures lock horizontally before capturing the pointer, so vertical scrolling stays native. A damped spring settles rows; reduced motion snaps immediately. The mobile inspector can be dismissed by dragging its handle down. Task completion leaves the list after approximately one second and offers Undo. Destructive actions ask for confirmation.

## Verification

```sh
npm run build --workspace=@todoer/web
npm run lint --workspace=@todoer/web
npm run typecheck --workspace=@todoer/web
npm run test --workspace=@todoer/web
npx playwright install chromium
npm run test:e2e --workspace=@todoer/web
npm run screenshots --workspace=@todoer/web
```

The browser tests and screenshot script expect the web server and **development mock** above to be running. They use only mock credentials. Browser tests create and clean up their own tasks/projects/tokens. The screenshot script expects a freshly started mock for reproducible fixtures. `WEB_URL` can override the test origin. Playwright is a development dependency and is not shipped in the client.

Coverage includes the auth guard, capture parsing and retained input focus, optimistic completion and Undo, empty task creation, title/notes autosave and retry after a failed request, dual assignment and handoff, confirmed deletion, multipart capture, inspector uploads and lightbox, window drop and composer paste, mobile navigation and active-project capture, token creation/revocation/logout, and an actual 20 MiB upload and byte-for-byte length check through the Next rewrite.

For the isolated active-project and routing checks, configure the API with a staging database first, then start it on 4300 and Next on 3300:

```sh
API_PORT=4300 npm run dev --workspace=@todoer/api
# In apps/web:
API_URL=http://localhost:4300 npx next dev --port 3300
WEB_URL=http://localhost:3300 ROUTING_REAL_API=1 npm run test:e2e
```

These suites read both staging users' passwords from `/tmp/todoer-staging-credentials.txt` at runtime. They create and clean up their own fixtures and restore each user's active project. Active-project coverage runs at 1440×900 and iPhone 13 sizes, including server-side persistence across browser contexts, all scoped endpoints, project editing/deletion, shared links, and mobile photo capture. Screenshots are saved to `/tmp/todoer-active-project-shots/staging/` (or `mock/` for mock runs). The mock suite additionally injects a deletion during capture to verify the quiet retry and checks that the optimistic row does not wait for `/api/me`.

## Contract and integration notes

Tag views show open tasks in the active project; Completed shows newest completion first. My Tasks groups tasks under “Today & overdue,” “Upcoming,” and “No date,” hiding empty groups. Unassigned remains available even when empty. Capture in Completed creates a completed task. Capturing in “From teammate” returns to All, and capture clears a text search so the new task appears immediately. Mobile swipe actions are implemented.

The frontend and mock follow the updated exclusive handoff contract in `SPEC.md`: both Pass and Take replace assignees with exactly the destination user. Take sends `{to: "me"}`.

The backend must return the exact public task JSON shape, especially nested `createdBy`, `assignees`, `tags`, `attachments`, and nullable `project`. Sidebar badges use `/api/counts?projectId=…`; tag counts use `/api/tags?projectId=…`. All projects omits the query parameter. Project menu counts come from `/api/projects`. Cookie authentication must work through same-origin rewrites. Multipart fields use JSON array strings for assignees/tags and repeated `files` parts; uploads are sent without manually setting `Content-Type` so the browser supplies its boundary. Attachment URLs must be authenticated same-origin paths. Password changes send both `password` and `currentPassword`. Token secrets are displayed only from the creation response.

Next rewrites `/api/:path*` to `${API_URL}/api/:path*` and `/agent` to `${API_URL}/api/agent`. There are no Next route handlers or Server Actions in the upload path. The experimental `proxyClientMaxBodySize` setting is raised from Next’s 10 MB default to 100 MB to provide multipart headroom if Proxy buffering is used; the existing rewrite was verified with a full 20 MiB file. A production ingress proxy must also allow the intended upload sizes. See the [Next documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize).

This is one npm workspace. Install dependencies at the repository root and keep the single root `package-lock.json`; do not create a web-local lockfile.

## Production

Build and run from `apps/web` (set both origins at build time; rewrites and public variables are embedded):

```sh
API_URL=http://127.0.0.1:4000 NEXT_PUBLIC_API_PUBLIC_URL=https://api.todo.customsai.org npm run build
npm start
```

To use another web port without touching port 3000, run `PORT=3102 npm start`. The API stays a separate service. `/agent` proxies to the backend's public agent instructions; Settings shows the web origin's `/agent` URL.

## Real API smoke and screenshots

```sh
# From the repository root; these ports must be free.
API_PORT=4100 npm run dev --workspace=@todoer/api
# In apps/web, another terminal:
API_URL=http://localhost:4100 npx next dev --port 3101
WEB_URL=http://localhost:3101 node scripts/real-smoke.mjs
```

The smoke reads passwords at runtime from `REAL_CREDENTIALS_PATH` (defaults to the owner's external seed-credentials file). It never writes them to the repository. It creates only `QA ` fixtures, tracks their IDs, and deletes them in `finally`. An image-only fixture retains a `QA ` marker in its notes. It changes Maxim's display name and password briefly, verifies login with the temporary password, then restores both even on failure. Tokens are named `QA `, exercised, and revoked. It logs no secrets. Set `REAL_SCREENSHOTS=1` to replace the committed screenshots, or add `REAL_VISUAL_ONLY=1` to recapture them without repeating the account and mutation checks. Don't run this against another owner's database without their authorization. Stop the servers you started afterward.
