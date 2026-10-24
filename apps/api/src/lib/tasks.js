import { pool } from '../db.js';
import { resolveUser } from '../auth.js';
import { HttpError } from './errors.js';

export const taskColumns = `t.id, t.title, t.notes, t.done, t.done_at AS "doneAt", t.list,
  to_char(t.due_date, 'YYYY-MM-DD') AS "dueDate", t.priority, t.project_id AS "projectId",
  t.created_by AS "creatorId", t.position, t.created_at AS "createdAt", t.updated_at AS "updatedAt"`;
export const attachmentColumns = `id, task_id AS "taskId", filename, mime_type AS "mimeType", size, width, height,
  '/api/attachments/' || id || '/file' AS url, created_at AS "createdAt"`;

// Five bounded queries regardless of how many tasks are returned; no per-task lookups.
export async function hydrate(rows, db = pool) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const queries = [
    () => db.query(`SELECT u.id, u.username, u.display_name AS "displayName", u.color, a.task_id AS "taskId"
      FROM users u LEFT JOIN task_assignees a ON a.user_id = u.id AND a.task_id = ANY($1::uuid[])
      ORDER BY u.created_at, u.id`, [ids]),
    () => db.query('SELECT id, name, color, emoji FROM projects WHERE id = ANY($1::uuid[])', [rows.map((row) => row.projectId).filter(Boolean)]),
    () => db.query('SELECT g.id, g.name, g.color, tt.task_id AS "taskId" FROM tags g JOIN task_tags tt ON tt.tag_id = g.id WHERE tt.task_id = ANY($1::uuid[]) ORDER BY lower(g.name)', [ids]),
    () => db.query(`SELECT ${attachmentColumns} FROM attachments WHERE task_id = ANY($1::uuid[]) ORDER BY created_at, id`, [ids]),
  ];
  // A pool can run independent reads concurrently; a transaction has one serial client.
  const results = [];
  if (db === pool) results.push(...await Promise.all(queries.map((query) => query())));
  else for (const query of queries) results.push(await query());
  const [users, projects, tags, attachments] = results;
  const userMap = new Map();
  const assigned = new Map(ids.map((id) => [id, []]));
  const tagged = new Map(ids.map((id) => [id, []]));
  const attached = new Map(ids.map((id) => [id, []]));
  for (const { taskId, ...user } of users.rows) {
    userMap.set(user.id, user);
    if (taskId) assigned.get(taskId).push(user);
  }
  for (const { taskId, ...tag } of tags.rows) tagged.get(taskId).push(tag);
  for (const attachment of attachments.rows) attached.get(attachment.taskId).push(attachment);
  const projectMap = new Map(projects.rows.map((project) => [project.id, project]));
  return rows.map(({ creatorId, ...row }) => ({
    ...row,
    ...(process.env.PUBLIC_WEB_URL ? { webUrl: `${process.env.PUBLIC_WEB_URL.replace(/\/+$/, '')}/tasks/${row.id}` } : {}),
    project: projectMap.get(row.projectId) ?? null, createdBy: userMap.get(creatorId),
    assignees: assigned.get(row.id), tags: tagged.get(row.id), attachments: attached.get(row.id),
  }));
}

export async function getTask(id, db = pool) {
  const { rows } = await db.query(`SELECT ${taskColumns} FROM tasks t WHERE t.id = $1`, [id]);
  if (!rows.length) throw new HttpError(404, 'Task not found');
  return (await hydrate(rows, db))[0];
}

export async function resolveTags(values, db, create = true) {
  const ids = [];
  for (const value of values) {
    const { rows: [found] } = await db.query('SELECT id FROM tags WHERE id::text = lower($1) OR lower(name) = lower($1)', [value]);
    if (found) ids.push(found.id);
    else if (create) {
      const { rows: [tag] } = await db.query(`INSERT INTO tags (name) VALUES ($1)
        ON CONFLICT (lower(name)) DO UPDATE SET name = tags.name RETURNING id`, [value]);
      ids.push(tag.id);
    }
  }
  return [...new Set(ids)];
}

export async function applyRelations(taskId, body, req, db) {
  for (const [field, table, column, resolve] of [
    ['Assignees', 'task_assignees', 'user_id', async (values) => [...new Set(values.map((value) => resolveUser(value, req))) ]],
    ['Tags', 'task_tags', 'tag_id', (values, create) => resolveTags(values, db, create)],
  ]) {
    const base = field.toLowerCase();
    if (body[base] !== undefined) {
      const ids = await resolve(body[base], true);
      await db.query(`DELETE FROM ${table} WHERE task_id = $1`, [taskId]);
      if (ids.length) await db.query(`INSERT INTO ${table} (task_id, ${column}) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, [taskId, ids]);
    }
    if (body[`add${field}`]) {
      const ids = await resolve(body[`add${field}`], true);
      if (ids.length) await db.query(`INSERT INTO ${table} (task_id, ${column}) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, [taskId, ids]);
    }
    if (body[`remove${field}`]) {
      const ids = await resolve(body[`remove${field}`], false);
      await db.query(`DELETE FROM ${table} WHERE task_id = $1 AND ${column} = ANY($2::uuid[])`, [taskId, ids]);
    }
  }
}
