import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { githubRepoPattern, id, projectSchema, tagSchema } from '../lib/validation.js';

export const catalogRouter = Router();
const parseProject = (body) => {
  const project = projectSchema.parse(body);
  const invalid = project.githubRepos?.find((repo) => !githubRepoPattern.test(repo));
  if (invalid) throw new HttpError(400, `Enter each GitHub repo as owner/name ("${invalid.slice(0, 80)}" isn't)`);
  return project;
};
// githubRepo (the first repo, or null) is kept for older API clients.
const repoColumns = (p = '') => `${p}github_repos AS "githubRepos", ${p}github_repos[1] AS "githubRepo"`;
const projectColumns = `id, name, color, emoji, position, ${repoColumns()}, created_at AS "createdAt"`;

catalogRouter.get('/projects', async (req, res) => {
  const { rows } = await pool.query(`SELECT p.id, p.name, p.color, p.emoji, p.position, ${repoColumns('p.')}, p.created_at AS "createdAt",
    (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND NOT t.done) AS "openCount"
    FROM projects p ORDER BY p.position DESC, p.created_at DESC`);
  res.json({ projects: rows });
});
catalogRouter.post('/projects', async (req, res) => {
  const body = parseProject(req.body ?? {});
  const { rows } = await pool.query(`INSERT INTO projects (name, color, emoji, position, github_repos) VALUES ($1,$2,$3,$4,$5) RETURNING ${projectColumns}`, [body.name ?? 'New Project', body.color ?? 'blue', body.emoji ?? null, body.position ?? Date.now(), body.githubRepos ?? []]);
  res.status(201).json({ project: rows[0] });
});
catalogRouter.patch('/projects/:id', async (req, res) => {
  const body = parseProject(req.body);
  const values = [id.parse(req.params.id)];
  const assignments = [];
  for (const [field, column] of [['name', 'name'], ['color', 'color'], ['emoji', 'emoji'], ['position', 'position'], ['githubRepos', 'github_repos']]) {
    if (body[field] === undefined) continue;
    values.push(body[field]);
    assignments.push(`${column} = $${values.length}`);
  }
  const { rows } = await pool.query(`UPDATE projects SET ${assignments.length ? assignments.join(', ') : 'name = name'} WHERE id = $1 RETURNING ${projectColumns}`, values);
  if (!rows.length) throw new HttpError(404, 'Project not found');
  res.json({ project: rows[0] });
});
catalogRouter.delete('/projects/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM projects WHERE id = $1', [id.parse(req.params.id)]);
  if (!rowCount) throw new HttpError(404, 'Project not found');
  res.json({ ok: true });
});
// Optional ?projectId=<uuid> scopes counts to one project (the UI's active project).
const scopeProject = (req) => (req.query.projectId === undefined ? null : id.parse(req.query.projectId));

catalogRouter.get('/tags', async (req, res) => {
  const { rows } = await pool.query(`SELECT g.id, g.name, g.color,
    (SELECT count(*)::int FROM task_tags tt JOIN tasks t ON t.id = tt.task_id
      WHERE tt.tag_id = g.id AND NOT t.done AND ($1::uuid IS NULL OR t.project_id = $1)) AS count
    FROM tags g ORDER BY lower(g.name)`, [scopeProject(req)]);
  res.json({ tags: rows });
});
catalogRouter.post('/tags', async (req, res) => {
  const body = tagSchema.parse(req.body);
  const { rows } = await pool.query(`INSERT INTO tags (name, color) VALUES ($1,$2) ON CONFLICT (lower(name)) DO NOTHING RETURNING id, name, color`, [body.name, body.color ?? 'gray']);
  if (rows.length) return res.status(201).json({ tag: rows[0] });
  const { rows: existing } = await pool.query('SELECT id, name, color FROM tags WHERE lower(name) = lower($1)', [body.name]);
  res.json({ tag: existing[0] });
});
catalogRouter.patch('/tags/:id', async (req, res) => {
  const body = tagSchema.partial().parse(req.body);
  const { rows } = await pool.query('UPDATE tags SET name = COALESCE($2, name), color = COALESCE($3, color) WHERE id = $1 RETURNING id, name, color', [id.parse(req.params.id), body.name, body.color]);
  if (!rows.length) throw new HttpError(404, 'Tag not found');
  res.json({ tag: rows[0] });
});
catalogRouter.delete('/tags/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM tags WHERE id = $1', [id.parse(req.params.id)]);
  if (!rowCount) throw new HttpError(404, 'Tag not found');
  res.json({ ok: true });
});
catalogRouter.get('/counts', async (req, res) => {
  const { rows: [counts] } = await pool.query(`WITH flags AS (
    SELECT t.*, EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = $1) AS mine,
      EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = $2) AS teammate,
      NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id) AS unassigned FROM tasks t
      WHERE $3::uuid IS NULL OR t.project_id = $3
    ) SELECT
      count(*) FILTER (WHERE NOT done AND list = 'now' AND mine)::int AS mine,
      count(*) FILTER (WHERE NOT done AND list = 'now' AND mine AND created_by = $1)::int AS "mineCreated",
      count(*) FILTER (WHERE NOT done AND list = 'now' AND mine AND created_by = $2)::int AS "mineFromTeammate",
      count(*) FILTER (WHERE NOT done AND list = 'now' AND teammate)::int AS teammate,
      count(*) FILTER (WHERE NOT done AND list = 'later')::int AS later,
      count(*) FILTER (WHERE NOT done AND list = 'now' AND unassigned)::int AS unassigned,
      count(*) FILTER (WHERE done)::int AS completed FROM flags`, [req.user.id, req.teammate?.id ?? null, scopeProject(req)]);
  res.json(counts);
});
