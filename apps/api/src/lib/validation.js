import { z } from 'zod';
import { HttpError } from './errors.js';

export { z };
export const colors = z.enum(['blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'teal', 'gray']);
export const identifier = z.string().trim().min(1).max(200);
export const id = z.uuid();
const identifiers = z.array(identifier).max(100);
export const taskSchema = z.object({
  title: z.string().max(10000).optional(),
  notes: z.string().max(100000).optional(),
  list: z.enum(['now', 'later']).optional(),
  dueDate: z.iso.date().nullable().optional(),
  priority: z.number().int().min(0).max(3).optional(),
  projectId: id.nullable().optional(),
  done: z.boolean().optional(),
  assignees: identifiers.optional(),
  tags: identifiers.optional(),
});
export const taskPatchSchema = taskSchema.extend({
  position: z.number().finite().optional(),
  addAssignees: identifiers.optional(), removeAssignees: identifiers.optional(),
  addTags: identifiers.optional(), removeTags: identifiers.optional(),
});
// A project's GitHub repos: each "owner/name" or a github.com URL (optional .git or trailing slash),
// normalized to "owner/name". Blank entries are dropped, duplicates (case-insensitive) collapse, and
// [] or null clears. The legacy single `githubRepo` field sets a one-repo list ("" or null clears).
// Routes check githubRepoPattern themselves so the 400 carries a readable message.
export const githubRepoPattern = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/[A-Za-z0-9._-]{1,100}$/;
const normalizeRepo = (value) => value.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/\/+$/, '').replace(/\.git$/i, '');
const uniqueRepos = (repos) => {
  const seen = new Set();
  return repos.map(normalizeRepo).filter((repo) => repo && !seen.has(repo.toLowerCase()) && seen.add(repo.toLowerCase()));
};
export const projectSchema = z.object({
  name: z.string().max(500).optional(), color: colors.optional(),
  emoji: z.string().max(100).nullable().optional(), position: z.number().finite().optional(),
  githubRepos: z.array(z.string().max(300)).max(20).nullable().optional(),
  githubRepo: z.string().max(300).nullable().optional(),
}).transform(({ githubRepo, githubRepos, ...project }) => {
  if (githubRepos !== undefined) return { ...project, githubRepos: uniqueRepos(githubRepos ?? []) };
  if (githubRepo !== undefined) return { ...project, githubRepos: uniqueRepos(githubRepo ? [githubRepo] : []) };
  return project;
});
export const tagSchema = z.object({ name: identifier, color: colors.optional() });
export const querySchema = z.object({
  view: z.enum(['mine', 'mine_created', 'mine_from_teammate', 'teammate', 'later', 'unassigned', 'completed', 'all']).optional(),
  assignee: identifier.optional(), createdBy: identifier.optional(),
  list: z.enum(['now', 'later']).optional(), done: z.enum(['true', 'false', 'all']).optional(),
  projectId: id.optional(), tag: identifier.optional(), q: z.string().max(10000).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});

export function taskBody(req) {
  if (!req.is('multipart/form-data')) return req.body ?? {};
  const body = { ...req.body };
  for (const field of ['list', 'dueDate', 'priority', 'projectId', 'done']) {
    if (body[field] === '') delete body[field];
  }
  for (const field of ['assignees', 'tags']) {
    if (!(field in body)) continue;
    if (body[field] === '') { body[field] = []; continue; }
    if (typeof body[field] === 'string') {
      if (body[field].trim().startsWith('[')) {
        try { body[field] = JSON.parse(body[field]); }
        catch { throw new HttpError(400, `${field} must be a JSON array or repeated fields`); }
      } else body[field] = [body[field]];
    }
  }
  for (const field of ['priority']) {
    if (typeof body[field] === 'string' && body[field].trim() !== '') body[field] = Number(body[field]);
  }
  if (body.done === 'true') body.done = true;
  if (body.done === 'false') body.done = false;
  for (const field of ['dueDate', 'projectId']) {
    if (body[field] === 'null') body[field] = null;
  }
  return body;
}
