# todoer: your shared task list

todoer is a shared workspace for exactly two people: {{USERS}}. Both users can read and edit everything. "me" always means the authenticated token owner; "teammate" means the other person. A task can have zero, one, or both users assigned. No task field is required; an empty task is valid.

## Connect

{{CONNECTION}}

Create a personal token in **Settings → Agent tokens** in the web app. Keep the secret private: it is shown only once. Every API request requires `Authorization: Bearer $TODOER_TOKEN`, except health, login, and this document. Tokens act as their owner. Browser clients may instead use the non-expiring httpOnly `todoer_session` cookie from login. Tokens never expire until revoked.

```sh
export TODOER_BASE='{{BASE}}'
export TODOER_TOKEN='tdr_REPLACE_WITH_YOUR_TOKEN'
curl -sS "$TODOER_BASE/api/me" -H "Authorization: Bearer $TODOER_TOKEN"
```

Use JSON and `Content-Type: application/json` unless uploading. Responses use camelCase and ISO timestamps. Errors are `{ "error": "message", "details": ... }`; check the HTTP status. Unknown body fields are ignored. Do not retry mutations blindly after an ambiguous network failure: search for the result first.

## Endpoint reference

| Method and path | Body / query | Result |
| --- | --- | --- |
| GET /api/health | Public | `{ok:true}` |
| GET /api/agent, GET /agent | Public | This markdown document |
| POST /api/auth/login | `{username,password}`; username or email, case-insensitive | `{user}` + session cookie |
| POST /api/auth/logout | None | `{ok:true}`; clears session |
| GET /api/me | None | `{user,teammate}`; `user` includes your `email` and `emailNotifications` |
| PATCH /api/me | `{displayName?,password?,currentPassword?,email?,emailNotifications?}`; currentPassword required to change password; `email: ""` or `null` clears it | `{user}` |
| GET /api/users | None | `{users:[User]}` |
| GET /api/tokens | None | `{tokens:[{id,name,createdAt,lastUsedAt}]}`; yours only |
| POST /api/tokens | `{name?}` | `201 {token:{id,name,createdAt},secret:"tdr_..."}` |
| DELETE /api/tokens/:id | None; yours only | `{ok:true}` |
| GET /api/tasks | Filters below | `{tasks:[Task]}` |
| GET /api/tasks/:id | None | `{task}` |
| POST /api/tasks | Every field optional: `{title,notes,list,dueDate,priority,projectId,done,assignees,tags}`; or multipart fields + repeated `files` | `201 {task}` |
| PATCH /api/tasks/:id | Any create fields; `position`; `addAssignees`, `removeAssignees`, `addTags`, `removeTags` | `{task}` |
| POST /api/tasks/:id/handoff | `{to?}`; defaults to teammate | `{task}`; replaces all assignees with exactly the recipient |
| DELETE /api/tasks/:id | Confirm with human first | `{ok:true}`; also deletes images |
| POST /api/tasks/:id/attachments | Multipart, repeated `files` | `{task}` |
| DELETE /api/attachments/:id | Confirm with human first | `{ok:true}` |
| GET /api/attachments/:id/file | Auth required | Image bytes |
| GET /api/projects | None | `{projects:[Project & {openCount}]}` |
| POST /api/projects | `{name?,color?,emoji?}`; defaults to New Project, blue | `201 {project}` |
| PATCH /api/projects/:id | `{name?,color?,emoji?,position?}` | `{project}` |
| DELETE /api/projects/:id | Confirm first; tasks keep existing, projectId becomes null | `{ok:true}` |
| GET /api/tags | None | `{tags:[Tag & {count}]}`; count of open tasks |
| POST /api/tags | `{name,color?}` | `201 {tag}`, or `200 {tag}` if existing |
| PATCH /api/tags/:id | `{name?,color?}` | `{tag}` |
| DELETE /api/tags/:id | Confirm first; removes tag associations, keeps tasks | `{ok:true}` |
| GET /api/score | None | `{me,teammate,leader,lead}`: each entry `{user,score,label,trend,doneThisWeek,overdue}`. The 0-100 "good boy" score of how well each person handles assigned tasks (on-time completions raise it, overdue tasks lower it) |
| GET /api/counts | None | `{mine,mineCreated,mineFromTeammate,teammate,later,unassigned,completed}` |


Open Later tasks automatically move to Now after 14 days (336 hours) and are assigned exclusively to one of the two users, chosen independently at random each time. The timer starts at creation for tasks created in Later, or when a task moves back into Later; ordinary edits and repeated `list: "later"` patches do not reset it. Completed tasks are skipped. Resurfacing preserves future/current due dates and sets a fresh seven-day deadline when the date is missing or past, just like manual planning. A background worker checks at startup and every minute (up to 100 tasks per pass), including after downtime. Existing Later tasks use their creation date for their first review. The read-only `resurfacedAt` timestamp records the latest automatic return (null for tasks never automatically returned). It persists through edits and completion; the UI shows a “From Later” label outside Later. Earlier automatic returns cannot be identified retroactively. The task retains its project, content, tags, and attachments; either user can move it back to Later for another two weeks.

Task filters combine with AND: `view=mine|mine_created|mine_from_teammate|teammate|later|unassigned|completed|all`, `assignee=IDENTIFIER`, `createdBy=IDENTIFIER`, `list=now|later`, `done=true|false|all`, `projectId=UUID`, `tag=NAME_OR_ID`, `q=TEXT`, `limit=1..1000` (default 200). Default `done=false`, except `view=completed` defaults true. **To list absolutely everything, use `view=all&done=all`**, and raise limit if needed. Results order by position descending, then createdAt descending; completed view uses doneAt descending. There is no pagination cursor; at most 1000 tasks per response.

User identifiers in assignees, createdBy, filters, and `to`: UUID, username, display name (case-insensitive), `me`, `teammate`. Use GET /api/users to disambiguate. Tags accept names (case-insensitive, created if missing when adding) or existing IDs. `assignees`/`tags` replace the complete set on PATCH; use `add*`/`remove*` to preserve others. Omitted assignees on create defaults to `["me"]`; `[]` is explicitly unassigned.

`list` defaults to `now`; `later` is the shared Future changes / things to look at list. **Later tasks never have assignees**: creating or moving a task to Later drops its assignees, and assigning anyone (assignees, addAssignees, or handoff) moves it to Now. Priority is 0 none, 1 low, 2 medium, 3 high. dueDate is `YYYY-MM-DD` or null (tasks created in Now default to a due date one week out; pass `dueDate: null` for none; Later tasks stay undated until planned); projectId is a UUID or null. Transitioning from open to done records doneAt; repeating done true preserves it; false clears it. Colors: blue, purple, pink, red, orange, yellow, green, teal, gray.

## Common requests → what to call

| Human request | Call |
| --- | --- |
| "Assign this to my teammate" / "pass to German" | POST `/api/tasks/:id/handoff` with `{ "to": "teammate" }` |
| "Give it to me" / "I'll take it" | POST `/api/tasks/:id/handoff` with `{ "to": "me" }` |
| "Share with both of us" | PATCH `/api/tasks/:id` with `{ "addAssignees": ["me", "teammate"] }` |
| "Put it on the later list" / "future changes" | PATCH `/api/tasks/:id` with `{ "list": "later" }`  (this unassigns it) |
| "What's on my plate" | GET `/api/tasks?view=mine` |
| "What did German give me" | GET `/api/tasks?view=mine_from_teammate` (tasks created by the teammate and assigned to me) |
| "What's in that screenshot?" / "look at the image on X" | GET the task, download each `attachments[].url` with the Bearer header, then view the files |
| "Remove/delete X" | Search with `q=`, identify the task, confirm with the human, then DELETE `/api/tasks/:id` |

Handoff is exclusive reassignment: after either handoff call, only the recipient is assigned, including when the task was shared or unassigned. Resolve named people against GET `/api/users` and the token owner's identity.

Present tasks concisely, one line per task: title (use "Untitled" if empty), assignees (or "Unassigned"), tags, due date if present, and list (Now/Later). For example: `Fix login bug — Maxim, German · #bug · due 2026-12-01 · Now`. Avoid dumping raw JSON unless requested. `q=` searches both title and notes, case-insensitively; search before creating a task to avoid duplicates.

## Images

Tasks often carry screenshots or photos in `attachments`, and image-only tasks are common: someone dropped a screenshot without typing a title. **For those, the image is the task.** Look at it before summarising, acting on, or deleting the task.

- Each attachment has a relative `url` (`/api/attachments/<id>/file`). Prefix it with the base URL and send the same Bearer header; it returns the raw image bytes.
- Download to a temporary file, then open that file with your image-viewing / file-reading tool to see it:

```sh
curl -sS "$TODOER_BASE/api/attachments/ATTACHMENT_UUID/file" -H "Authorization: Bearer $TODOER_TOKEN" -o /tmp/todoer-ATTACHMENT_UUID.png
```

- Use the attachment's `mimeType` for the file extension (png, jpg, gif, webp, heic). When listing tasks, mention image counts (e.g. `· 2 images`). For an untitled task, describe it from the image, and offer to set a title.

## Task example

```json
{
  "id": "e3f2f625-2f97-42ee-a135-5b9018804d3b",
  "title": "Fix login bug", "notes": "Reproduce on mobile", "done": false, "doneAt": null,
  "list": "now", "dueDate": null, "priority": 3, "projectId": null, "project": null,
  "createdBy": { "id": "USER_UUID", "username": "maxim", "displayName": "Maxim", "color": "blue" },
  "assignees": [{ "id": "USER_UUID", "username": "maxim", "displayName": "Maxim", "color": "blue" }],
  "tags": [{ "id": "TAG_UUID", "name": "bug", "color": "red" }], "attachments": [],
  "position": 1792800000000, "createdAt": "2026-10-24T00:00:00.000Z", "updatedAt": "2026-10-24T00:00:00.000Z"
}
```

## Recipes

Resolve which task the human means by searching with `q=` first. Read the candidates, then GET the chosen ID to check its latest state. If multiple tasks match, ask the human which one. **Confirm before deleting tasks, images, tags, projects, or tokens.** Prefer **handoff** when the human says "pass this to X"; adding an assignee leaves existing assignees in place. Set the chosen UUID before the mutation recipes:

```sh
export TASK_ID='REPLACE_WITH_TASK_UUID'
```

List everything, my open tasks, tasks from my teammate, and completed tasks:

```sh
curl -sS "$TODOER_BASE/api/tasks?view=all&done=all&limit=1000" -H "Authorization: Bearer $TODOER_TOKEN"
curl -sS "$TODOER_BASE/api/tasks?view=mine" -H "Authorization: Bearer $TODOER_TOKEN"
curl -sS "$TODOER_BASE/api/tasks?view=mine_from_teammate" -H "Authorization: Bearer $TODOER_TOKEN"
curl -sS "$TODOER_BASE/api/tasks?view=completed" -H "Authorization: Bearer $TODOER_TOKEN"
```

Find a task by text (including completed and Later), then inspect it:

```sh
curl -sS -G "$TODOER_BASE/api/tasks" -H "Authorization: Bearer $TODOER_TOKEN" --data-urlencode 'q=login bug' --data-urlencode 'done=all'
curl -sS "$TODOER_BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TODOER_TOKEN"
```

Add a task tagged bug, an empty task, or a task for the teammate:

```sh
curl -sS -X POST "$TODOER_BASE/api/tasks" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"title":"Fix login bug","tags":["bug"]}'
curl -sS -X POST "$TODOER_BASE/api/tasks" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{}'
curl -sS -X POST "$TODOER_BASE/api/tasks" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"title":"Review the welcome screen","assignees":["teammate"]}'
```

Pass a task exclusively to the teammate, take it yourself, or share it with both people:

```sh
curl -sS -X POST "$TODOER_BASE/api/tasks/$TASK_ID/handoff" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"to":"teammate"}'
curl -sS -X POST "$TODOER_BASE/api/tasks/$TASK_ID/handoff" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"to":"me"}'
curl -sS -X PATCH "$TODOER_BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"addAssignees":["me","teammate"]}'
```

Mark done, reopen, move to Later, unassign, add/remove tags, and remove an assignee:

```sh
curl -sS -X PATCH "$TODOER_BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"done":true}'
curl -sS -X PATCH "$TODOER_BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"done":false}'
curl -sS -X PATCH "$TODOER_BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"list":"later"}'
curl -sS -X PATCH "$TODOER_BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"assignees":[]}'
curl -sS -X PATCH "$TODOER_BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"addTags":["bug","urgent"],"removeTags":["idea"]}'
curl -sS -X PATCH "$TODOER_BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"removeAssignees":["me"]}'
```

Create a task from an image, or attach images to an existing task. Images: PNG, JPEG, GIF, WebP, HEIC/HEIF; max 20 MB each. UTF-8 filenames are preserved. SVG is rejected. Multipart arrays may be repeated fields or JSON arrays. `-F 'assignees='` and `-F 'assignees=[]'` explicitly mean unassigned; omitting the field assigns me. Empty optional scalar fields (`list`, `priority`, `done`, `dueDate`, `projectId`) are ignored; empty `title` and `notes` remain empty strings. Use the literal `null` for null dueDate/projectId.

```sh
curl -sS -X POST "$TODOER_BASE/api/tasks" -H "Authorization: Bearer $TODOER_TOKEN" -F 'title=Review screenshot' -F 'assignees=[]' -F 'tags=["design"]' -F 'files=@screenshot.png;type=image/png'
curl -sS -X POST "$TODOER_BASE/api/tasks/$TASK_ID/attachments" -H "Authorization: Bearer $TODOER_TOKEN" -F 'files=@screenshot.png;type=image/png'
curl -sS "$TODOER_BASE/api/attachments/ATTACHMENT_UUID/file" -H "Authorization: Bearer $TODOER_TOKEN" -o screenshot.png
```

Projects, tags, users, counts, and token management:

```sh
curl -sS "$TODOER_BASE/api/users" -H "Authorization: Bearer $TODOER_TOKEN"
curl -sS "$TODOER_BASE/api/counts" -H "Authorization: Bearer $TODOER_TOKEN"
curl -sS "$TODOER_BASE/api/projects" -H "Authorization: Bearer $TODOER_TOKEN"
curl -sS -X POST "$TODOER_BASE/api/projects" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"name":"Website","color":"teal","emoji":"🌐"}'
curl -sS -X PATCH "$TODOER_BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"projectId":"PROJECT_UUID","dueDate":"2026-12-01","priority":2}'
curl -sS -G "$TODOER_BASE/api/tasks" -H "Authorization: Bearer $TODOER_TOKEN" --data-urlencode 'projectId=PROJECT_UUID' --data-urlencode 'done=all'
curl -sS "$TODOER_BASE/api/tags" -H "Authorization: Bearer $TODOER_TOKEN"
curl -sS -X POST "$TODOER_BASE/api/tags" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"name":"bug","color":"red"}'
curl -sS -G "$TODOER_BASE/api/tasks" -H "Authorization: Bearer $TODOER_TOKEN" --data-urlencode 'tag=bug'
curl -sS "$TODOER_BASE/api/tokens" -H "Authorization: Bearer $TODOER_TOKEN"
curl -sS -X POST "$TODOER_BASE/api/tokens" -H "Authorization: Bearer $TODOER_TOKEN" -H 'Content-Type: application/json' -d '{"name":"Claude"}'
```

After the human confirms deletion:

```sh
curl -sS -X DELETE "$TODOER_BASE/api/tasks/$TASK_ID" -H "Authorization: Bearer $TODOER_TOKEN"
curl -sS -X DELETE "$TODOER_BASE/api/attachments/ATTACHMENT_UUID" -H "Authorization: Bearer $TODOER_TOKEN"
curl -sS -X DELETE "$TODOER_BASE/api/projects/PROJECT_UUID" -H "Authorization: Bearer $TODOER_TOKEN"
curl -sS -X DELETE "$TODOER_BASE/api/tags/TAG_UUID" -H "Authorization: Bearer $TODOER_TOKEN"
curl -sS -X DELETE "$TODOER_BASE/api/tokens/TOKEN_UUID" -H "Authorization: Bearer $TODOER_TOKEN"
```
## Active project

Each person works inside one **active project**, chosen in the web app's menu. `GET /api/me` returns it as `user.activeProjectId` (`null` = All projects). Treat it as the default context:
- When creating a task, set `projectId` to the human's `activeProjectId` unless they name another project (or it is null).
- When the human asks "what's on my plate" etc., scope lists with `projectId=<activeProjectId>` and mention that other projects exist if relevant. `GET /api/counts?projectId=` and `GET /api/tags?projectId=` scope counts the same way.
- Do not change `activeProjectId` (`PATCH /api/me`) unless the human explicitly asks to switch projects.

When reporting a task you created or found, include its `webUrl` as a clickable Markdown link,
for example `[Task title](webUrl)`. This opens the task directly in the private web app.
`webUrl` is included on every task when the server's `PUBLIC_WEB_URL` is configured;
when it is absent, the field is omitted. Do not invent a URL from the API origin.
