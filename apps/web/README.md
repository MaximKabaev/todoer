# todoer web

A shared task space for two people, built with Next.js 16.4.3, React 19, TypeScript, SWR, Lucide icons, and custom CSS. All application code and the development mock live in `apps/web`; nothing in `apps/api` is changed.

## Run with the real API

From the repository root, using Node 24 and npm 11:

```sh
npm install
npm run dev --workspace=@todoer/web
```

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
- `docs/screenshots/`: committed 1440×900 desktop and 390×844 mobile captures, including light/dark mode and task details.

Task capture inherits the current list, person, project, or tag. Images dropped on the window create one task with all images in one multipart request; images dropped on the inspector attach to that task. Images pasted outside text fields or into the composer create a task. SVG and files over 20 MiB are rejected before upload. HEIC/HEIF previews depend on browser image support; the original file is preserved.

Click a row title to edit it inline. Use its chevron or the rest of the row to open details. Keyboard: `N` focuses capture, `⌘/Ctrl K` opens list search, arrows navigate focused task rows, Space toggles completion, Enter opens details, Delete/Backspace asks before deleting, and Escape closes the top dialog. The mobile inspector can be dismissed by dragging its handle down. Task completion leaves the list after approximately one second and offers Undo. Destructive actions ask for confirmation.

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

Coverage includes the auth guard, capture parsing and retained input focus, optimistic completion and Undo, empty task creation, title/notes autosave and retry after a failed request, dual assignment and handoff, confirmed deletion, multipart capture, inspector uploads and lightbox, window drop and composer paste, mobile navigation and contextual project capture, token creation/revocation/logout, and an actual 20 MiB upload and byte-for-byte length check through the Next rewrite.

## Contract and integration notes

No changes or deviations to `SPEC.md` are required. The frontend interprets projects/tag views as open tasks, projects grouped Now/Later, and Completed as newest completion first. My Tasks additionally groups urgent/due work under “Up next.” Unassigned remains available even when empty. Capture in Completed creates a completed task. Capturing in “From teammate” returns to All, and capture clears a text search, so the new task can appear immediately. Mobile swipe actions are optional and are not implemented.

The backend must return the exact public task JSON shape, especially nested `createdBy`, `assignees`, `tags`, `attachments`, and nullable `project`. Sidebar badges use `/api/counts`; project/tag badges use their respective list endpoints. Cookie authentication must work through same-origin rewrites. Multipart fields use JSON array strings for assignees/tags and repeated `files` parts; uploads are sent without manually setting `Content-Type` so the browser supplies its boundary. Attachment URLs must be authenticated same-origin paths. Password changes send both `password` and `currentPassword`. Token secrets are displayed only from the creation response.

Next rewrites `/api/:path*` to `${API_URL}/api/:path*` and `/agent` to `${API_URL}/api/agent`. There are no Next route handlers or Server Actions in the upload path. The experimental `proxyClientMaxBodySize` setting is raised from Next’s 10 MB default to 100 MB to provide multipart headroom if Proxy buffering is used; the existing rewrite was verified with a full 20 MiB file. A production ingress proxy must also allow the intended upload sizes. See the [Next documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize).

Dependency manifests and a lockfile stay inside `apps/web` to respect the frontend-only scope. The repository owner can consolidate workspace lockfiles when integrating the independently developed API.
