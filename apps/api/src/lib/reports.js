import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { resolveUser } from '../auth.js';
import { HttpError } from './errors.js';
import { applyRelations, getTask, resolveTags, taskWebUrl } from './tasks.js';
import { recordReport } from './notifications.js';
import { dateFromToday, SCORE } from './score.js';
import { identifier, taskSchema, z } from './validation.js';

// Reports: tasks created by another server with a create-only token. The content is untrusted, so
// titles and names are kept to one line (they become email subjects) and NULs, which Postgres
// rejects, are dropped rather than failing a report that would then be retried forever.
const withoutNul = z.string().transform((value) => value.replaceAll('\0', ''));
const line = (max) => withoutNul.transform((value) => value.replace(/\s+/g, ' ').trim()).pipe(z.string().max(max));
// Strict on purpose: a field a create-only token may not set (done, position, …) is an error, not ignored.
const { notes, list, dueDate, priority, projectId, assignees, tags } = taskSchema.shape;
export const reportSchema = z.strictObject({
  title: line(500).optional(), notes: withoutNul.pipe(notes.unwrap()).optional(),
  list, dueDate, priority, projectId, assignees, tags,
  externalId: withoutNul.pipe(identifier).optional(),
  reportedBy: line(200).nullable().optional(),
});

// Returns { task: { id, webUrl? }, duplicate }: never the stored task, which the token may not read.
export async function createReport(req) {
  if (!req.is('application/json')) throw new HttpError(415, 'Create-only tokens accept JSON only');
  const body = reportSchema.parse(req.body);
  const project = req.token.projectId;
  if (body.projectId !== undefined && body.projectId !== project) throw new HttpError(403, 'This token can only create tasks in its own project');
  const later = body.list === 'later';
  let people = [];
  // The usual error lists the users, which is more than a create-only token may know.
  try { people = later ? [] : (body.assignees ?? []).map((value) => resolveUser(value, req)); }
  catch { throw new HttpError(400, 'Unknown user in assignees'); }
  return transaction(async (db) => {
    const taskId = randomUUID();
    if (body.externalId) {
      // A concurrent retry waits here for the first request, then sees its row (or inserts if it rolled back).
      const { rowCount } = await db.query('INSERT INTO task_external_ids (project_id, external_id, task_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [project, body.externalId, taskId]);
      if (!rowCount) {
        const { rows: [seen] } = await db.query('SELECT task_id FROM task_external_ids WHERE project_id = $1 AND external_id = $2', [project, body.externalId]);
        return { task: { id: seen.task_id, ...taskWebUrl(seen.task_id) }, duplicate: true };
      }
    }
    const due = body.dueDate === undefined && !later ? dateFromToday(SCORE.defaultDays) : body.dueDate ?? null;
    await db.query(`INSERT INTO tasks (id, title, notes, list, due_date, priority, project_id, created_by, position, reported_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [taskId, body.title ?? '', body.notes ?? '', body.list ?? 'now', due, body.priority ?? 0, project, req.user.id, Date.now(),
      body.reportedBy || req.token.name || 'Report']);
    // Only existing tags are attached; unknown names are skipped, so a token cannot create tags.
    await applyRelations(taskId, { assignees: people, tags: await resolveTags(body.tags ?? [], db, false) }, req, db);
    await recordReport(db, await getTask(taskId, db));
    return { task: { id: taskId, ...taskWebUrl(taskId) }, duplicate: false };
  });
}
