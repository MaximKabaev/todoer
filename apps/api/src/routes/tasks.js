import { Router } from 'express';
import { pool, transaction } from '../db.js';
import { resolveUser } from '../auth.js';
import { HttpError } from '../lib/errors.js';
import { id, identifier, querySchema, taskBody, taskPatchSchema, taskSchema, z } from '../lib/validation.js';
import { applyRelations, getTask, hydrate, taskColumns } from '../lib/tasks.js';
import { removeFiles, saveAttachments, upload, withUploadCleanup } from '../lib/uploads.js';
import { recordChange } from '../lib/notifications.js';

export const tasksRouter = Router();

tasksRouter.get('/', async (req, res) => {
  const query = querySchema.parse(req.query);
  const values = [];
  const clauses = [];
  const param = (value) => { values.push(value); return `$${values.length}`; };
  const assigned = (userId) => `EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = ${param(userId)})`;
  if (['mine', 'mine_created', 'mine_from_teammate'].includes(query.view)) {
    clauses.push("t.list = 'now'", assigned(req.user.id));
    if (query.view === 'mine_created') clauses.push(`t.created_by = ${param(req.user.id)}`);
    if (query.view === 'mine_from_teammate') clauses.push(`t.created_by = ${param(req.teammate?.id ?? null)}`);
  } else if (query.view === 'teammate') clauses.push("t.list = 'now'", assigned(req.teammate?.id ?? null));
  else if (query.view === 'later') clauses.push("t.list = 'later'");
  else if (query.view === 'unassigned') clauses.push("t.list = 'now'", 'NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id)');
  const done = query.done ?? (query.view === 'completed' ? 'true' : 'false');
  if (done !== 'all') clauses.push(`t.done = ${param(done === 'true')}`);
  if (query.assignee) clauses.push(assigned(resolveUser(query.assignee, req)));
  if (query.createdBy) clauses.push(`t.created_by = ${param(resolveUser(query.createdBy, req))}`);
  if (query.list) clauses.push(`t.list = ${param(query.list)}`);
  if (query.projectId) clauses.push(`t.project_id = ${param(query.projectId)}`);
  if (query.tag) clauses.push(`EXISTS (SELECT 1 FROM task_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.task_id = t.id AND (g.id::text = lower(${param(query.tag)}) OR lower(g.name) = lower($${values.length})))`);
  if (query.q) {
    // Treat %, _ and backslash as literal search text, rather than LIKE wildcards.
    const search = param(`%${query.q.replace(/[\\%_]/g, '\\$&')}%`);
    clauses.push(`(t.title ILIKE ${search} OR t.notes ILIKE ${search})`);
  }
  const order = query.view === 'completed' ? 't.done_at DESC NULLS LAST, t.created_at DESC' : 't.position DESC, t.created_at DESC';
  const { rows } = await pool.query(`SELECT ${taskColumns} FROM tasks t ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ${param(query.limit)}`, values);
  res.json({ tasks: await hydrate(rows) });
});

tasksRouter.get('/:id', async (req, res) => res.json({ task: await getTask(id.parse(req.params.id)) }));
tasksRouter.post('/', upload, async (req, res) => {
  const body = taskSchema.parse(taskBody(req));
  const task = await withUploadCleanup((written) => transaction(async (db) => {
    const { rows: [row] } = await db.query(`INSERT INTO tasks (title, notes, list, due_date, priority, project_id, done, done_at, created_by, position)
      VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7 THEN now() ELSE NULL END,$8,$9) RETURNING id`,
    [body.title ?? '', body.notes ?? '', body.list ?? 'now', body.dueDate ?? null, body.priority ?? 0, body.projectId ?? null, body.done ?? false, req.user.id, Date.now()]);
    // Later tasks are unplanned and never assigned; an explicit list wins over assignees.
    const later = body.list === 'later';
    await applyRelations(row.id, { ...body, assignees: later ? [] : body.assignees ?? ['me'], addAssignees: undefined }, req, db);
    await saveAttachments(db, row.id, req.files, written);
    const created = await getTask(row.id, db);
    await recordChange(db, req, null, created);
    return created;
  }));
  res.status(201).json({ task });
});

tasksRouter.patch('/:id', async (req, res) => {
  const taskId = id.parse(req.params.id);
  const body = taskPatchSchema.parse(req.body);
  const task = await transaction(async (db) => {
    const { rows: [current] } = await db.query('SELECT list FROM tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (!current) throw new HttpError(404, 'Task not found');
    const before = await getTask(taskId, db);
    const assigning = Boolean(body.assignees?.length || body.addAssignees?.length);
    // Later tasks have no assignees: assigning someone plans the task (moves it to Now),
    // unless this same request explicitly puts it on Later, which wins.
    if (assigning && body.list === undefined && current.list === 'later') body.list = 'now';
    const values = [taskId];
    const assignments = ['updated_at = now()'];
    for (const [field, column] of Object.entries({ title: 'title', notes: 'notes', list: 'list', dueDate: 'due_date', priority: 'priority', projectId: 'project_id', done: 'done', position: 'position' })) {
      if (body[field] === undefined) continue;
      values.push(body[field]);
      assignments.push(`${column} = $${values.length}`);
    }
    if (body.done !== undefined) assignments.push(body.done ? 'done_at = CASE WHEN done THEN done_at ELSE now() END' : 'done_at = NULL');
    await db.query(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = $1`, values);
    await applyRelations(taskId, body, req, db);
    await db.query("DELETE FROM task_assignees a USING tasks t WHERE t.id = a.task_id AND t.id = $1 AND t.list = 'later'", [taskId]);
    const updated = await getTask(taskId, db);
    await recordChange(db, req, before, updated);
    return updated;
  });
  res.json({ task });
});
tasksRouter.post('/:id/handoff', async (req, res) => {
  const taskId = id.parse(req.params.id);
  const { to = 'teammate' } = z.object({ to: identifier.optional() }).parse(req.body ?? {});
  const userId = resolveUser(to, req);
  const task = await transaction(async (db) => {
    const { rowCount: found } = await db.query('SELECT id FROM tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (!found) throw new HttpError(404, 'Task not found');
    const before = await getTask(taskId, db);
    // Handing a Later task to someone plans it, so it moves to Now.
    await db.query("UPDATE tasks SET updated_at = now(), list = 'now' WHERE id = $1", [taskId]);
    await db.query('DELETE FROM task_assignees WHERE task_id = $1', [taskId]);
    await db.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [taskId, userId]);
    const updated = await getTask(taskId, db);
    await recordChange(db, req, before, updated);
    return updated;
  });
  res.json({ task });
});
tasksRouter.delete('/:id', async (req, res) => {
  const taskId = id.parse(req.params.id);
  const names = await transaction(async (db) => {
    const { rowCount } = await db.query('SELECT id FROM tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (!rowCount) throw new HttpError(404, 'Task not found');
    await recordChange(db, req, await getTask(taskId, db), null);
    const { rows } = await db.query('SELECT storage_name FROM attachments WHERE task_id = $1', [taskId]);
    await db.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    return rows.map((row) => row.storage_name);
  });
  await removeFiles(names);
  res.json({ ok: true });
});
tasksRouter.post('/:id/attachments', upload, async (req, res) => {
  const taskId = id.parse(req.params.id);
  if (!req.files?.length) throw new HttpError(400, 'At least one files image part is required');
  const task = await withUploadCleanup((written) => transaction(async (db) => {
    const { rowCount } = await db.query('SELECT id FROM tasks WHERE id = $1 FOR UPDATE', [taskId]);
    if (!rowCount) throw new HttpError(404, 'Task not found');
    const before = await getTask(taskId, db);
    await db.query('UPDATE tasks SET updated_at = now() WHERE id = $1', [taskId]);
    await saveAttachments(db, taskId, req.files, written);
    const updated = await getTask(taskId, db);
    await recordChange(db, req, before, updated);
    return updated;
  }));
  res.json({ task });
});
