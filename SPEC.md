# todoer — product & technical spec

A dead-simple shared todo app for exactly **two people** (the owner and their teammate).
This document is the contract between the backend (`apps/api`) and the frontend (`apps/web`).
If you need to deviate, update this file in the same change and say why.

## Monorepo layout

```
package.json          npm workspaces root ("apps/*")
apps/api              @todoer/api  — Node.js (plain JavaScript, ESM), Express 5, pg, Postgres 16
apps/web              @todoer/web  — Next.js (App Router, TypeScript, React)
SPEC.md               this file
```

- Node 24, npm 11. Use npm workspaces, no pnpm/yarn.
- API binds to `API_HOST` (default `127.0.0.1`) on `API_PORT` (default `4000`). Web listens on `http://localhost:3000`.
  Production uses Caddy at `https://api.todo.customsai.org` and the web app at `https://todo.customsai.org`.
  Set `PUBLIC_API_URL=https://api.todo.customsai.org` to advertise the preferred direct API base in agent examples.
  Forwarded headers are trusted only from loopback proxies (Caddy/Next), not remote clients.
- The web app proxies `/api/*` → `http://localhost:4000/api/*` via Next `rewrites()` so the browser
  only ever talks to its own origin (no CORS, cookies just work). The API base for server-side
  rewrites comes from env `API_URL` (default `http://localhost:4000`).
- `apps/api/.env` already exists (gitignored) with `DATABASE_URL`, `API_PORT`, `SESSION_SECRET`.
  The database `todoer` exists on the local Postgres and is owned by role `todoer`.

## Users & auth

- Exactly two seeded users. No signup UI or endpoint.
  - `maxim` — display name "Maxim" (the owner)
  - `german` — display name "German" (the teammate)
  - Usernames/display names/passwords come from env when present
    (`SEED_USER1_USERNAME`, `SEED_USER1_NAME`, `SEED_USER1_PASSWORD`, same for `USER2`);
    otherwise the seed generates random passwords and prints them once.
- Passwords hashed with bcrypt (`bcryptjs`).
- Browser auth: `POST /api/auth/login` sets an httpOnly, SameSite=Lax cookie `todoer_session`
  (opaque random id stored in a `sessions` table, never expires; the 400-day cookie is re-issued by `GET /api/me` so it never lapses). Logout deletes it. API tokens never expire until revoked.
  Cookies use Secure when `COOKIE_SECURE=true` or `NODE_ENV=production`; otherwise it is off for local development.
- Agent auth: `Authorization: Bearer <token>`. Each user can create personal API tokens
  (stored as sha256 hashes; plaintext shown once on creation). The seed creates one token per user
  and prints it. A request authenticated by token acts **as that user** (so "me" = token owner).
- Every endpoint except `POST /api/auth/login`, `GET /api/health` and `GET /api/agent` requires auth.
  401 → `{ "error": "unauthorized" }`.
- Both users can see and edit **everything**. There is no private data between them.

## Domain model

### Task
| field | type | notes |
|---|---|---|
| id | uuid | |
| webUrl | text (optional) | `${PUBLIC_WEB_URL}/tasks/${id}` when configured (trailing slashes removed); omitted when unset. Included on every task response. |
| title | text | may be empty string. **No field is ever required.** |
| notes | text | may be empty |
| done | boolean | default false |
| doneAt | timestamptz \| null | |
| list | `"now"` \| `"later"` | `later` = the shared "Future changes / things to look at" list. default `now` |
| dueDate | date (`YYYY-MM-DD`) \| null | Tasks created in Now default to today + 7 days when `dueDate` is omitted (explicit `null` = no date; tasks created in Later stay undated). Planning a Later task (list → now, assigning, handoff) sets today + 7 days if it has no due date or it is already past, unless the same request sets one. Dates and "today" use `SCORE_TIMEZONE` (default `UTC`). |
| priority | 0..3 | 0 none (default), 1 low, 2 medium, 3 high |
| projectId | uuid \| null | |
| createdBy | user id | set server-side from the authenticated user |
| assignees | user[] | 0, 1 or 2 users. Both people may be assigned to the same task. |
| tags | tag[] | |
| attachments | attachment[] | images |
| position | double | manual ordering within lists; new tasks go on top |
| createdAt / updatedAt | timestamptz | |

### Project
`id, name, color (one of: blue, purple, pink, red, orange, yellow, green, teal, gray), emoji (nullable text), position, createdAt`.
Projects are shared. Deleting a project sets its tasks' `projectId` to null.

### Tag
`id, name (unique, case-insensitive), color`. Created on the fly by name. Shared.

### Attachment
`id, taskId, filename, mimeType, size, width?, height?, url, createdAt`.
Files stored on disk under `apps/api/uploads/` (gitignored); `url` = `/api/attachments/:id/file`
(auth required, served with correct content-type and long cache headers).
Images only (png, jpeg, gif, webp, heic/heif, svg is NOT allowed). Max 20 MB per file.

### User (public shape)
`{ id, username, displayName, color }` — color is a UI accent (`blue` for user1, `orange` for user2).

## Views (what the UI shows)

"Me" = logged-in user, "Teammate" = the other user.

1. **My Tasks** — `list=now`, not done, assigned to me. Two segments:
   - *Made by me* (`createdBy = me`)
   - *From teammate* (`createdBy = teammate`)
   - plus an "All" segment showing both.
2. **Teammate's Tasks** — `list=now`, not done, assigned to teammate. Fully viewable and editable,
   either person can add to it (adding there pre-assigns the teammate).
3. **Later** — the shared "Future changes / things to look at" list (`list=later`). These are unplanned,
   so **Later tasks never have assignees** (enforced by the API):
   - Creating a task with `list: "later"` ignores `assignees` (no default "me" either).
   - Moving a task to Later (`PATCH list: "later"`) clears its assignees; an explicit `list: "later"` wins
     over assignees sent in the same request.
   - Assigning someone to a Later task (`assignees: [...]` non-empty, `addAssignees`, or handoff) plans it:
     the task moves to `now`.
4. **Unassigned** — `list=now`, no assignees (only shown if non-empty, or always as a small item — UI's call).
5. **Projects** — each project shows its tasks (all lists, grouped Now / Later).
6. **Completed** — done tasks, newest first.
7. Tag filter — tapping a tag shows tasks with that tag.

Creating a task inside a view pre-fills sensible context (assignee, list, project) but **nothing is
required** — an empty task is valid.

### Active project (site-wide)

Each user has one **active project** (`users.active_project_id`, `null` = All projects), chosen in a
single selector in the app menu. It is the only project control in the main UI:
- Every view (My Tasks and its segments, the teammate's list, Later, Unassigned, Completed, tags,
  search) and all sidebar counts are scoped to it via `projectId=` on `GET /api/tasks`,
  `GET /api/counts`, and `GET /api/tags`. "All projects" omits the filter.
- New tasks (typed, `+`, drop, paste, photo) get the active project; with "All projects" they get none.
- Only `PATCH /api/me { activeProjectId }` changes it (unknown project: 400; null = All). Deleting the
  project nulls it via the foreign key. Task POST/PATCH never change it, and the server never
  defaults `projectId` on task POST, so API clients stay explicit.
- A task's own project can still be changed in its detail panel (moving a task between projects).

"Pass on / hand off" = exclusive reassignment to the chosen recipient (default: my teammate).
All previous assignees are replaced with exactly `[to]`, including when `to` is `"me"`, or the
task was shared or unassigned.

## REST API

All JSON. Timestamps ISO 8601. Errors: `{ "error": string, "details"?: any }` with proper status codes.
Unknown body fields are ignored. Everything is camelCase.

### Meta
- `GET /api/health` → `{ ok: true }`
- `GET /api/agent` → **text/markdown** instructions for AI agents (no auth). See "Agent instructions".

### Auth
- `POST /api/auth/login` `{ username, password }` → `{ user }` + sets cookie. `username` accepts the username or the user's email, case-insensitively.
- `POST /api/auth/logout` → `{ ok: true }`
- `GET /api/me` → `{ user, teammate }` (current `user` also includes `activeProjectId: uuid | null`, `email: string | null`, `emailNotifications: boolean`; the teammate's email is never returned anywhere)
- `PATCH /api/me` `{ displayName?, password?, currentPassword?, activeProjectId?: uuid | null, email?: string | null, emailNotifications?: boolean }` → `{ user }` (password change requires currentPassword; email is trimmed, `""`/`null` clears it, invalid → 400, used by the other user → 409)
- `GET /api/users` → `{ users: User[] }` (both users)
- `GET /api/tokens` → `{ tokens: [{ id, name, createdAt, lastUsedAt }] }` (mine only)
- `POST /api/tokens` `{ name? }` → `{ token: { id, name, createdAt }, secret: "tdr_..." }` (secret shown once)
- `DELETE /api/tokens/:id` → `{ ok: true }`

### Tasks
- `GET /api/tasks` query params (all optional, combinable):
  - `view` = `mine` | `mine_created` | `mine_from_teammate` | `teammate` | `later` | `unassigned` | `completed` | `all`
  - `assignee` = username | user id | `me` | `teammate`
  - `createdBy` = username | user id | `me` | `teammate`
  - `list` = `now` | `later`
  - `done` = `true` | `false` | `all` (default `false`, except `view=completed` → true)
  - `projectId`, `tag` (tag name or id), `q` (case-insensitive search in title + notes)
  - `limit` (default 200, max 1000)
  → `{ tasks: Task[] }` ordered by `position desc, createdAt desc` (completed: `doneAt desc`).
- `GET /api/tasks/:id` → `{ task }`
- `POST /api/tasks` — **JSON or multipart/form-data**:
  - JSON body (every field optional): `{ title, notes, list, dueDate, priority, projectId, done,
    assignees: string[], tags: string[] }`
  - `assignees` entries may be user ids, usernames, display names (case-insensitive), `"me"` or `"teammate"`.
  - `tags` entries are tag names (created if missing) or tag ids.
  - If `assignees` is omitted entirely → defaults to `[me]`. If `[]` → unassigned.
  - multipart: same fields as form fields (`assignees` / `tags` may be repeated fields or a JSON
    array string) plus one or more `files` parts (images) → creates the task with attachments in one request.
    To explicitly leave a multipart task unassigned, send `assignees=""` (for example,
    `formData.append('assignees', '')`) or `assignees="[]"`; both mean an empty array.
    Omitting the field entirely still defaults to `[me]`.
    Empty optional scalar fields (`list`, `priority`, `done`, `dueDate`, `projectId`) are ignored;
    empty `title` and `notes` remain empty strings. Literal `"null"` sets dueDate/projectId to null.
    UTF-8 attachment filenames are preserved.
    This powers drag-and-drop: drop images → one request → one task.
  → `201 { task }`
- `PATCH /api/tasks/:id` — any subset of the POST JSON fields. `assignees`/`tags` replace the full set.
  Also accepts `addAssignees`, `removeAssignees`, `addTags`, `removeTags` (same identifier rules),
  and `position`. Transitioning false→true sets `doneAt`; repeating `done: true` preserves it.
  Setting `done: false` clears `doneAt`. → `{ task }`
- `POST /api/tasks/:id/handoff` `{ to?: identifier }` (default: the other user) → `{ task }`.
  Replaces all assignees with exactly `[to]`.
- `DELETE /api/tasks/:id` → `{ ok: true }` (deletes attachments' files too)
- `POST /api/tasks/:id/attachments` multipart `files` → `{ task }`
- `DELETE /api/attachments/:id` → `{ ok: true }`
- `GET /api/attachments/:id/file` → the image bytes

### Projects
- `GET /api/projects` → `{ projects: (Project & { openCount: number })[] }`
- `POST /api/projects` `{ name?, color?, emoji? }` → `201 { project }` (name defaults to "New Project")
- `PATCH /api/projects/:id` → `{ project }`
- `DELETE /api/projects/:id` → `{ ok: true }`

### Tags
- `GET /api/tags` → `{ tags: (Tag & { count: number })[] }`
- `POST /api/tags` `{ name, color? }` → `201 { tag }` (returns existing tag if name exists, 200)
- `PATCH /api/tags/:id`, `DELETE /api/tags/:id`

### Counts (sidebar badges)
- `GET /api/counts?projectId=` (optional scope) → `{ mine, mineCreated, mineFromTeammate, teammate, later, unassigned, completed }`

### Good boy score
- `GET /api/score` → `{ me: Entry, teammate: Entry | null, leader: "me" | "teammate" | null, lead: number }`
  where `Entry = { user, score (0-100 integer), label, trend, doneThisWeek, overdue }`. Not scoped by project.
  `leader` is null when tied; `lead` is the integer point gap.
- See the **Good boy score** section for how it is computed.

### Task JSON shape
```json
{
  "id": "uuid", "title": "", "notes": "", "done": false, "doneAt": null,
  "list": "now", "dueDate": null, "priority": 0, "projectId": null,
  "project": { "id": "...", "name": "...", "color": "blue", "emoji": null } | null,
  "createdBy": { "id": "...", "username": "maxim", "displayName": "Maxim", "color": "blue" },
  "assignees": [User], "tags": [{ "id": "...", "name": "bug", "color": "red" }],
  "attachments": [{ "id": "...", "filename": "shot.png", "mimeType": "image/png", "size": 1234,
                    "width": 800, "height": 600, "url": "/api/attachments/<id>/file" }],
  "position": 1729000000000, "createdAt": "...", "updatedAt": "..."
}
```

## Agent instructions (`GET /api/agent`)

Plain markdown written for an LLM agent (e.g. Claude) that will call the API with `curl`. Must include:
- Include a task’s `webUrl` as a clickable link when reporting a task created or found. The field is omitted when `PUBLIC_WEB_URL` is unset; never infer the web URL from the API origin.
- What the app is, the two users, and that "me" means the token owner.
- How to authenticate (Bearer token, where to get one: Settings → Agent tokens in the web app).
- The base URL: use `PUBLIC_API_URL` when set (preferred direct production API base), otherwise
  derive from the request protocol and host, e.g. `http://localhost:4000`. Omit localhost hints
  when `PUBLIC_API_URL` is set. All examples use this chosen base.
- Every endpoint above with concise examples, emphasising the identifier shortcuts
  (`"me"`, `"teammate"`, usernames, display names, tag names).
- Ready-made recipes: "list everything", "list my tasks", "add a task", "assign this to my teammate"
  (`POST /api/tasks/:id/handoff` for exclusive reassignment; `PATCH` with `addAssignees` to share), "mark done", "delete", "move to Later",
  "find a task by text" (`q=`), "add tags".
- A note that destructive actions (delete) should be confirmed with the human first.
- A short natural-language request → endpoint mapping, including taking a task, sharing with both,
  Later, mine, mine_from_teammate, and search/confirm/delete. Explain that `q=` searches title + notes
  and should be used before creating duplicates. Present tasks concisely with title, assignees, tags, due date, and list.
The web app also exposes this at `http://localhost:3000/agent` (simple rewrite/redirect to the API).

## UX requirements (frontend)

- **Apple-style**: feel like Apple Reminders / Things on macOS & iOS. SF Pro system font stack,
  generous whitespace, vibrancy/blur sidebar, subtle hairline separators, rounded corners,
  round checkbox circles, spring-y micro-animations, light **and** dark mode (follow system).
- **Responsive & great on mobile**: sidebar on desktop; on phones a list-of-lists home screen
  (like Reminders iOS) or bottom tab bar, large titles, safe-area insets, 44pt touch targets,
  bottom sheets for task details, no hover-only affordances.
- **Friction-free capture**: an always-available "new task" input at the top/bottom of each list —
  with a 24px gap below it (plus the safe-area inset on mobile).
  Type and hit Enter, done. Inline quick syntax is a nice bonus (e.g. `#tag`, `@teammate`/`@me`,
  `!` priority, "later" toggle) but must never block plain text. Empty title allowed.
  Keyboard shortcut `N` (or Cmd/Ctrl+N where possible) to focus new task. Enter on a fresh empty
  input can still create an empty task only if the user explicitly wants (e.g. pressing the + button).
- **Drag & drop images**: dropping image file(s) anywhere on the window shows a full-window drop
  overlay; releasing creates a new task in the current view containing the image(s). Dropping onto
  an open task's detail attaches to that task. Pasting an image (Cmd/Ctrl+V) creates a task too;
  pasting inside an open task's detail (including its notes) attaches to that task.
  On mobile, a camera/photo button in the composer does the same.
- Task row: checkbox, title (clicking it opens the task, like the rest of the row), metadata line (assignee avatars, tags as pills,
  due date, project, image thumbnail count). Click → detail panel (right side on desktop, sheet on mobile)
  with all fields editable, assignee toggles for both users, "Pass to <Teammate>" button,
  move to Later/Now, tags editor (type to create), image gallery with lightbox, delete.
- Completing a task animates and it leaves the list after a short delay (with undo toast).
- Data freshness: revalidate on window focus and poll every ~10 s so the two users see each other's changes.
- Settings: change display name/password, email and email notifications, manage agent tokens (create, copy once, revoke),
  link to `/agent` instructions, logout.

## Email notifications

- Each user may set an email (Settings or `PATCH /api/me`). It doubles as a login identifier.
- When one user creates, edits, completes/reopens, hands off, adds images to, or deletes a task that
  involves the other user (assigned to them before or after the change, or created by them), the
  change is queued for the other user, if they have an email and `emailNotifications` is on.
  Reordering alone is not reported, and nobody is emailed about their own changes.
- The API process batches a recipient's queued changes into one digest email once they have been
  quiet for 2 minutes (or 10 minutes after the first change), one block per task with each change
  listed once and a link to `/tasks/:id`. Sent via Resend (`RESEND_API_KEY`, `EMAIL_FROM`); disabled
  when either is unset. Failed sends are retried with the same idempotency key; undelivered changes
  are dropped after 2 days.

## Automatic Later review

Open Later tasks automatically move to Now after 14 days (336 hours) and are assigned exclusively to one of the two users, chosen independently at random each time. The timer starts at creation for tasks created in Later, or when a task moves back into Later; ordinary edits and repeated `list: "later"` patches do not reset it. Completed tasks are skipped. Resurfacing preserves future/current due dates and sets a fresh seven-day deadline when the date is missing or past, just like manual planning. A background worker checks at startup and every minute (up to 100 tasks per pass), including after downtime. Existing Later tasks use their creation date for their first review. The read-only `resurfacedAt` timestamp records the latest automatic return (null for tasks never automatically returned). It persists through edits and completion; the UI shows a purple boxed “From Later” label matching the Later icon outside Later. Earlier automatic returns cannot be identified retroactively. The task retains its project, content, tags, and attachments; either user can move it back to Later for another two weeks.

## Good boy score

A competition between the two users: each has a 0-100 rating of how well they handle the tasks
assigned to them, shown on My Tasks and on the teammate's tasks view and included in emails when a
task is completed. It is derived on the fly from the tasks (nothing stored), so reopening a task or
editing a due date is always reflected.

- **Scored tasks**: `list=now` tasks the user is assigned to (done or open). A task assigned to both
  people counts for both. Later tasks have no assignees and never count.
- **Deadline** of a task = the end of its due date; with no due date, the end of the day 7 days after it
  was created (in `SCORE_TIMEZONE`).
- **Grade** of one task: completed on time = 100; completed late = `max(30, 90 - 10 * lateDays)`;
  still open and overdue = `max(0, 60 - 10 * overdueDays)` (so completing an overdue task always
  improves the score). Open tasks that are not overdue are neutral.
- **Weight** = `1 + 0.5 * priority`; ×0.25 for a task completed within 10 minutes of being created;
  0 for a task with an empty title and notes.
- **Score** = running weighted average of the grades in chronological order, starting from a neutral
  50 that counts as 5 tasks and capped at a memory of 15 task-weights:
  `W = min(W + weight, 15); score += weight / W * (grade - score)`. Someone with no task events keeps
  exactly their score; the other person's workload never changes it.
- **Label** by score: ≥90 Best boy ever, ≥75 Very good boy, ≥60 Good boy, ≥45 Doing okay,
  ≥30 Naughty, otherwise Bad boy.
- `trend` = score now minus the score computed as of 7 days ago; `doneThisWeek` = tasks completed in the
  last 7 days; `overdue` = open assigned Now tasks past their deadline.
- **Emails**: a digest that contains a task completion ends with a "Good boy score" block: each
  person's score and label, the net change across the batch, and who leads. Edits and reopening alone
  carry no score block.

## Web routes

The persistent App Router workspace shell uses client navigation and keeps composer state and SWR
cache across list/detail/settings navigation. Unknown paths use Next’s not-found page.

| Page | URL |
|---|---|
| Home (mobile lists; desktop My Tasks) | `/` |
| My Tasks (All / Made by me / From teammate) | `/my`, `/my?show=created`, `/my?show=from-teammate` |
| Person’s tasks | `/people/:username` (viewer canonicalizes to `/my`; unknown username is not found) |
| Shared lists | `/later`, `/unassigned`, `/completed` |
| Project | `/projects/:id` |
| Tag | `/tags/:name` (URL-encoded name) |
| Search all tasks | `/search?q=…` |
| Task | `/tasks/:id` |
| Settings | `/settings` |
| Login | `/login?next=<original path+query>` |

Task/settings overlays retain the originating list and close through browser Back. Direct task
links fall back to My Tasks if assigned to the viewer, otherwise the sole other assignee’s person
page, otherwise Later, then its project, then Unassigned. Direct settings fall back to My Tasks.
A missing task renders a full friendly state with a My Tasks link and stops fetching that id.
Sidebar/home entries are native anchors. Mobile Lists returns Back or pushes `/` for a deep link.
Login accepts only same-origin relative `next` paths (starting `/`, excluding `//`, backslashes,
control characters and `/login`); default `/`. No protected UI is shown before authentication.
Page titles reflect the private view in the browser only. OpenGraph/Twitter metadata stays generic.
Task details offer Copy link and mobile native Share with a copy fallback.

### Task presentation
- Capture has no helper tagline or photo button; image paste and task-detail attachments remain available.
- The visible task count sits beside the list title. Task details has a prominent heading.
- The detail panel uses “Send it back to Later” to move to Later, explains the two-week random review, and offers “Okay, let’s do this” to move back to Now and assign it to yourself.
- Priority uses named None/Low/Medium/High choices, coloured badges, and orange/red row accents for medium/high priority. Existing sorting and scoring semantics remain unchanged.

### Completion rewards
- Tasks have a visible Done button in their row and a “Nailed it. Mark as done” action in details, alongside the existing checkbox, Space shortcut, and swipe gesture. Completed details offer Reopen.
- Completing a task gives immediate green row feedback and a short “Nailed it!” stamp. After a successful save, a celebratory toast offers Undo and a short confetti burst. Reduced-motion preferences disable animation and confetti.

Completing an open task with `PATCH /api/tasks/:id {done:true}` also returns `scoreChange: {before, after, delta}` for the authenticated user's Good boy rating. The comparison holds all other tasks and the scoring time constant, isolating this task edit's contribution; it is not a fixed points award. Zero and negative deltas are valid. Already-completed tasks, reopening, and unrelated edits omit this field. Completing a teammate-only or Later task does not raise your own rating.

Completion celebrations say “Who’s a good boy?” and display the server-reported rating delta and before/after scores. Zero reads “Goodboy rating unchanged”; a negative value keeps its minus sign. If a server omits the optional delta, completion and Undo still work without a rating badge.
