import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import request from 'supertest';

dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });
const schema = `todoer_test_${randomUUID().replaceAll('-', '')}`;
process.env.API_DB_SCHEMA = schema;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let app, pool, uploadDirectory, first, second;
const password = 'test-only-password';
const firstToken = `tdr_${randomUUID().replaceAll('-', '')}`;
const secondToken = `tdr_${randomUUID().replaceAll('-', '')}`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const api = (method, url, token = firstToken) => request(app)[method](url).set('Authorization', `Bearer ${token}`);
const create = async (body = {}, token = firstToken) => (await api('post', '/api/tasks', token).send(body).expect(201)).body.task;
const patch = async (id, body) => (await api('patch', `/api/tasks/${id}`).send(body).expect(200)).body.task;

// Generate an actual 1x1 RGBA PNG with valid checksums, rather than relying on a fixture file.
function png() {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  const uploadsRoot = fileURLToPath(new URL('../uploads/', import.meta.url));
  // app initialization creates the root on normal boot; tests always get a distinct child directory.
  const { mkdir } = await import('node:fs/promises');
  await mkdir(uploadsRoot, { recursive: true });
  uploadDirectory = await mkdtemp(path.join(uploadsRoot, 'integration-'));
  process.env.API_UPLOAD_DIR = uploadDirectory;
  ({ pool } = await import('../src/db.js'));
  const { migrate } = await import('../scripts/migrate.js');
  await migrate();
  await migrate(); // Applied migrations are safe to rerun.
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(`INSERT INTO users (username, display_name, color, password_hash) VALUES
    ('maxim_test', 'Maxim Test', 'blue', $1), ('partner_test', 'Teammate Test', 'orange', $1)
    RETURNING id, username, display_name AS "displayName", color`, [passwordHash]);
  [first, second] = rows;
  await pool.query('INSERT INTO api_tokens (user_id, token_hash) VALUES ($1,$2), ($3,$4)', [first.id, hash(firstToken), second.id, hash(secondToken)]);
  ({ app } = await import('../src/app.js'));
});

after(async () => {
  if (pool) await pool.end();
  // Only the randomly generated test schema is ever dropped; public data is untouched.
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
  if (uploadDirectory) await rm(uploadDirectory, { recursive: true, force: true });
});

test('health is public, API resources require authentication', async () => {
  assert.deepEqual((await request(app).get('/api/health').expect(200)).body, { ok: true });
  for (const url of ['/api/me', '/api/users', '/api/tasks', '/api/counts', '/api/projects', '/api/tags', '/api/tokens']) {
    assert.deepEqual((await request(app).get(url).expect(401)).body, { error: 'unauthorized' });
  }
  await api('get', '/api/me', 'tdr_invalid').expect(401);
  await request(app).get('/api/me').set('Cookie', 'todoer_session=%broken').expect(401);
});

test('login is case-insensitive, cookie sessions expire and logout revokes them', async () => {
  await request(app).post('/api/auth/login').send({ username: 'unknown', password }).expect(401);
  await request(app).post('/api/auth/login').send({ username: first.username, password: 'wrong' }).expect(401);
  const browser = request.agent(app);
  const login = await browser.post('/api/auth/login').send({ username: first.username.toUpperCase(), password }).expect(200);
  assert.deepEqual(login.body.user, first);
  const cookie = login.headers['set-cookie'][0];
  assert.match(cookie, /todoer_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /; Secure/);
  const session = (await pool.query('SELECT * FROM sessions')).rows[0];
  assert.ok(new Date(session.expires_at) - Date.now() > 89 * 86400000);
  assert.notEqual(session.id, cookie.split(';')[0].split('=')[1]);
  const me = await browser.get('/api/me').expect(200);
  assert.deepEqual(me.body, { user: first, teammate: second });
  await browser.post('/api/auth/logout').expect(200, { ok: true });
  await browser.get('/api/me').expect(401);
  await request(app).get('/api/me').set('Cookie', cookie.split(';')[0]).expect(401);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM sessions')).rows[0].count, 0);
  const tokenLogout = await browser.post('/api/auth/login').send({ username: first.username, password }).expect(200);
  await browser.post('/api/auth/logout').set('Authorization', `Bearer ${firstToken}`).expect(200);
  await request(app).get('/api/me').set('Cookie', tokenLogout.headers['set-cookie'][0].split(';')[0]).expect(401);
  await browser.post('/api/auth/login').send({ username: first.username, password }).expect(200);
  await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
  await browser.get('/api/me').expect(401);
});

test('bearer tokens act as their owner, are hashed, and update last_used_at', async () => {
  const me = await api('get', '/api/me', secondToken).expect(200);
  assert.deepEqual(me.body, { user: second, teammate: first });
  const token = (await pool.query('SELECT token_hash, last_used_at FROM api_tokens WHERE user_id = $1', [second.id])).rows[0];
  assert.equal(token.token_hash, hash(secondToken));
  assert.ok(token.last_used_at);
  assert.equal((await api('get', '/api/users').expect(200)).body.users.length, 2);
});

test('profile updates ignore unknown fields and password changes require current password', async () => {
  await api('patch', '/api/me').send({ password: 'new-password' }).expect(400);
  await api('patch', '/api/me').send({ password: 'new-password', currentPassword: 'incorrect' }).expect(400);
  const changed = await api('patch', '/api/me').send({ displayName: 'Temporary Name', password: 'new-password', currentPassword: password, color: 'red' }).expect(200);
  assert.equal(changed.body.user.displayName, 'Temporary Name');
  assert.equal(changed.body.user.color, 'blue');
  await request(app).post('/api/auth/login').send({ username: first.username, password: 'new-password' }).expect(200);
  await api('patch', '/api/me').send({ displayName: first.displayName, password, currentPassword: 'new-password' }).expect(200);
});

test('personal tokens support creation, listing, ownership checks, and revocation', async () => {
  const { body } = await api('post', '/api/tokens').send({ name: 'Test agent' }).expect(201);
  assert.match(body.secret, /^tdr_/);
  await api('get', '/api/me', body.secret).expect(200);
  const tokens = (await api('get', '/api/tokens').expect(200)).body.tokens;
  assert.ok(tokens.some((token) => token.id === body.token.id && token.lastUsedAt));
  assert.ok(tokens.every((token) => !('token_hash' in token) && !('secret' in token)));
  await api('delete', `/api/tokens/${body.token.id}`, secondToken).expect(404);
  await api('delete', `/api/tokens/${body.token.id}`).expect(200, { ok: true });
  await api('get', '/api/me', body.secret).expect(401);
});

test('create accepts no body at all and returns a fully hydrated default task', async () => {
  const start = Date.now();
  const task = (await api('post', '/api/tasks').expect(201)).body.task;
  assert.equal(task.title, ''); assert.equal(task.notes, '');
  assert.equal(task.done, false); assert.equal(task.doneAt, null);
  assert.equal(task.list, 'now'); assert.equal(task.priority, 0);
  assert.equal(task.dueDate, null); assert.equal(task.projectId, null); assert.equal(task.project, null);
  assert.deepEqual(task.assignees, [first]); assert.deepEqual(task.createdBy, first);
  assert.deepEqual(task.tags, []); assert.deepEqual(task.attachments, []);
  assert.ok(task.position >= start && task.position <= Date.now());
  assert.ok(task.createdAt && task.updatedAt);
  assert.deepEqual((await api('get', `/api/tasks/${task.id}`).expect(200)).body.task, task);
});

test('create ignores unknown fields, defaults assignees, and supports explicit unassigned', async () => {
  const task = await create({ title: '', createdBy: second.id, surprise: 'ignored', position: -123 });
  assert.equal(task.createdBy.id, first.id);
  assert.notEqual(task.position, -123);
  assert.ok(!('surprise' in task));
  assert.deepEqual((await create({ assignees: [] })).assignees, []);
});

test('assignees resolve me, teammate, usernames, display names, IDs, and deduplicate', async () => {
  for (const value of ['me', first.username.toUpperCase(), first.displayName.toUpperCase(), first.id]) {
    assert.deepEqual((await create({ assignees: [value] })).assignees, [first]);
  }
  for (const value of ['teammate', second.username.toUpperCase(), second.displayName.toLowerCase(), second.id]) {
    assert.deepEqual((await create({ assignees: [value] })).assignees, [second]);
  }
  const task = await create({ assignees: ['me', 'teammate', first.id] });
  assert.equal(task.assignees.length, 2);
  const other = await create({ assignees: ['me'] }, secondToken);
  assert.deepEqual(other.assignees, [second]);
});

test('unknown users return a helpful 400 and roll back task creation', async () => {
  const before = (await pool.query('SELECT count(*)::int AS count FROM tasks')).rows[0].count;
  const result = await api('post', '/api/tasks').send({ assignees: ['nobody'], tags: ['should-not-exist'] }).expect(400);
  assert.match(result.body.error, /Valid users/);
  assert.match(result.body.error, /partner_test/);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM tasks')).rows[0].count, before);
});

test('task fields validate dates and priorities, done toggles doneAt, and position is editable', async () => {
  let task = await create({ title: 'Fields', notes: 'Details', priority: 3, list: 'later', dueDate: '2028-02-29', done: true });
  assert.equal(task.dueDate, '2028-02-29'); assert.ok(task.doneAt);
  task = await patch(task.id, { done: false, position: 123.5, dueDate: null, notes: '' });
  assert.equal(task.doneAt, null); assert.equal(task.done, false); assert.equal(task.position, 123.5); assert.equal(task.dueDate, null);
  await api('post', '/api/tasks').send({ dueDate: '2027-02-29' }).expect(400);
  await api('post', '/api/tasks').send({ priority: 4 }).expect(400);
  await api('post', '/api/tasks').send({ list: 'someday' }).expect(400);
  await api('patch', `/api/tasks/${task.id}`).send({ done: 'true' }).expect(400);
});

test('every task view matches the shared contract and all includes both lists', async () => {
  const title = 'viewfixture';
  const mine = await create({ title });
  const fromOther = await create({ title, assignees: ['teammate'] }, secondToken);
  const theirs = await create({ title, assignees: ['teammate'] });
  const both = await create({ title, assignees: ['me', 'teammate'] });
  const unassigned = await create({ title, assignees: [] });
  const later = await create({ title, list: 'later', assignees: [] });
  const completed = await create({ title, done: true });
  const laterCompleted = await create({ title, list: 'later', done: true });
  const views = {
    mine: [mine, fromOther, both], mine_created: [mine, both], mine_from_teammate: [fromOther],
    teammate: [theirs, both], unassigned: [unassigned], later: [later],
    completed: [completed, laterCompleted], all: [mine, fromOther, theirs, both, unassigned, later],
  };
  for (const [view, expected] of Object.entries(views)) {
    const result = await api('get', '/api/tasks').query({ view, q: title }).expect(200);
    assert.deepEqual(result.body.tasks.map((task) => task.id).sort(), expected.map((task) => task.id).sort(), view);
    assert.ok(result.body.tasks.every((task) => task.createdBy && Array.isArray(task.assignees) && Array.isArray(task.attachments)));
  }
  assert.equal((await api('get', '/api/tasks').query({ view: 'all', done: 'all', q: title }).expect(200)).body.tasks.length, 8);
  assert.equal((await api('get', '/api/tasks').query({ view: 'later', done: 'all', q: title }).expect(200)).body.tasks.length, 2);
});

test('task filters combine, identifiers work in filters, limits validate, and search includes notes', async () => {
  const task = await create({ title: 'Filter case', notes: 'UniqueNeEdLe 100%_literal', tags: ['FilterTag'], assignees: ['teammate'] });
  const tagId = task.tags[0].id;
  for (const tag of ['filtertag', tagId]) {
    const result = await api('get', '/api/tasks').query({ assignee: second.displayName, createdBy: first.username.toUpperCase(), list: 'now', tag, q: 'uniqueneedle', done: 'false' }).expect(200);
    assert.deepEqual(result.body.tasks.map((row) => row.id), [task.id]);
  }
  assert.equal((await api('get', '/api/tasks').query({ q: '100%_literal' }).expect(200)).body.tasks.length, 1);
  assert.equal((await api('get', '/api/tasks').query({ limit: 1 }).expect(200)).body.tasks.length, 1);
  await api('get', '/api/tasks').query({ limit: 1001 }).expect(400);
  await api('get', '/api/tasks').query({ done: 'maybe' }).expect(400);
  await api('get', '/api/tasks').query({ assignee: 'unknown' }).expect(400);
  await api('get', '/api/tasks').query({ view: 'invalid' }).expect(400);
});

test('task lists sort by descending position and completed view by doneAt', async () => {
  const a = await create({ title: 'orderfixture A' });
  const b = await create({ title: 'orderfixture B' });
  await patch(a.id, { position: 10 }); await patch(b.id, { position: 20 });
  assert.deepEqual((await api('get', '/api/tasks').query({ q: 'orderfixture' }).expect(200)).body.tasks.map((task) => task.id), [b.id, a.id]);
  await patch(b.id, { done: true }); await patch(a.id, { done: true });
  assert.deepEqual((await api('get', '/api/tasks').query({ q: 'orderfixture', view: 'completed' }).expect(200)).body.tasks.map((task) => task.id), [a.id, b.id]);
});

test('handoff moves a single assignment and leaves only the teammate when both were assigned', async () => {
  for (const assignees of [['me'], ['me', 'teammate']]) {
    const task = await create({ assignees });
    const response = await api('post', `/api/tasks/${task.id}/handoff`).send({}).expect(200);
    assert.deepEqual(response.body.task.assignees, [second]);
    const returned = await api('post', `/api/tasks/${task.id}/handoff`, secondToken).send({ to: first.displayName }).expect(200);
    assert.deepEqual(returned.body.task.assignees, [first]);
  }
});

test('PATCH replaces, adds, removes, and deduplicates assignees and tags', async () => {
  let task = await create({ tags: ['alpha', 'beta'] });
  task = await patch(task.id, { addAssignees: ['teammate', 'me'], addTags: ['gamma', 'ALPHA'], removeTags: ['beta'] });
  assert.equal(task.assignees.length, 2);
  assert.deepEqual(task.tags.map((tag) => tag.name), ['alpha', 'gamma']);
  task = await patch(task.id, { removeAssignees: [first.displayName], removeTags: [task.tags[0].id, 'does-not-exist'] });
  assert.deepEqual(task.assignees, [second]); assert.deepEqual(task.tags.map((tag) => tag.name), ['gamma']);
  task = await patch(task.id, { assignees: [], tags: [] });
  assert.deepEqual(task.assignees, []); assert.deepEqual(task.tags, []);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM tags WHERE name = 'does-not-exist'")).rows[0].count, 0);
});

test('multipart creates an image task with JSON arrays, dimensions, and a private authenticated file', async () => {
  const result = await api('post', '/api/tasks').field('title', 'Image capture').field('assignees', '["me","teammate"]').field('tags', '["screenshot"]').field('priority', '2').field('done', 'false').attach('files', png(), { filename: 'tiny.png', contentType: 'image/png' }).expect(201);
  const task = result.body.task;
  assert.equal(task.assignees.length, 2); assert.equal(task.priority, 2);
  const attachment = task.attachments[0];
  assert.equal(attachment.width, 1); assert.equal(attachment.height, 1);
  assert.equal(attachment.mimeType, 'image/png'); assert.equal(attachment.filename, 'tiny.png');
  assert.equal(attachment.taskId, task.id); assert.ok(attachment.createdAt);
  assert.equal(attachment.url, `/api/attachments/${attachment.id}/file`);
  await request(app).get(attachment.url).expect(401);
  const image = await api('get', attachment.url).expect(200);
  assert.deepEqual(image.body, png());
  assert.equal(image.headers['content-type'], 'image/png');
  assert.equal(image.headers['cache-control'], 'private, max-age=31536000, immutable');
  assert.equal(image.headers['x-content-type-options'], 'nosniff');
  assert.ok((await readdir(uploadDirectory)).includes(`${attachment.id}.png`));
  await api('delete', `/api/attachments/${attachment.id}`).expect(200, { ok: true });
  await api('get', attachment.url).expect(404);
  await assert.rejects(stat(path.join(uploadDirectory, `${attachment.id}.png`)), { code: 'ENOENT' });
  assert.deepEqual((await api('get', `/api/tasks/${task.id}`).expect(200)).body.task.attachments, []);
});

test('multipart supports repeated fields, omitted assignees, empty fields, and JSON empty arrays', async () => {
  let response = await api('post', '/api/tasks').field('assignees', 'me').field('assignees', 'teammate').field('tags', 'repeat-a').field('tags', 'repeat-b').expect(201);
  assert.equal(response.body.task.assignees.length, 2); assert.equal(response.body.task.tags.length, 2);
  response = await api('post', '/api/tasks').field('title', 'Omitted assignees').expect(201);
  assert.deepEqual(response.body.task.assignees, [first]);
  for (const value of ['', '[]']) {
    response = await api('post', '/api/tasks').field('assignees', value).field('tags', value).expect(201);
    assert.deepEqual(response.body.task.assignees, []); assert.deepEqual(response.body.task.tags, []);
  }
  await api('post', '/api/tasks').field('assignees', '[broken').expect(400);
});

test('existing task uploads work and deleting a task deletes its files', async () => {
  const task = await create();
  const response = await api('post', `/api/tasks/${task.id}/attachments`).attach('files', png(), 'one.png').attach('files', png(), 'two.png').expect(200);
  assert.equal(response.body.task.attachments.length, 2);
  const names = response.body.task.attachments.map((attachment) => `${attachment.id}.png`);
  await api('delete', `/api/tasks/${task.id}`).expect(200, { ok: true });
  await api('get', `/api/tasks/${task.id}`).expect(404);
  for (const name of names) await assert.rejects(stat(path.join(uploadDirectory, name)), { code: 'ENOENT' });
});

test('SVG, false MIME declarations, and non-image uploads are rejected without creating files or tasks', async () => {
  const beforeFiles = await readdir(uploadDirectory);
  const beforeTasks = (await pool.query('SELECT count(*)::int AS count FROM tasks')).rows[0].count;
  for (const [buffer, filename, contentType] of [[Buffer.from('<svg/>'), 'bad.svg', 'image/svg+xml'], [Buffer.from('hello'), 'fake.png', 'image/png'], [Buffer.from('hello'), 'hello.txt', 'text/plain']]) {
    await api('post', '/api/tasks').attach('files', buffer, { filename, contentType }).expect(415);
  }
  // Failure after the first image was written must roll back both the task and that file.
  await api('post', '/api/tasks').attach('files', png(), 'good.png').attach('files', Buffer.from('bad'), { filename: 'bad.png', contentType: 'image/png' }).expect(415);
  assert.deepEqual(await readdir(uploadDirectory), beforeFiles);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM tasks')).rows[0].count, beforeTasks);
});

test('oversized images return 413 and empty attachment requests return 400', async () => {
  const response = await api('post', '/api/tasks').attach('files', Buffer.alloc(20 * 1024 * 1024 + 1), { filename: 'large.png', contentType: 'image/png' }).expect(413);
  assert.ok(response.body.error);
  const task = await create();
  await api('post', `/api/tasks/${task.id}/attachments`).field('title', 'no file').expect(400);
});

test('projects support CRUD, open counts, filters, hydration, and null tasks on deletion', async () => {
  const { body: initial } = await api('post', '/api/projects').send({}).expect(201);
  assert.equal(initial.project.name, 'New Project'); assert.equal(initial.project.color, 'blue');
  const id = initial.project.id;
  const updated = await api('patch', `/api/projects/${id}`).send({ name: 'Test Project', color: 'purple', emoji: '🌱', position: 12 }).expect(200);
  assert.equal(updated.body.project.emoji, '🌱');
  const open = await create({ projectId: id });
  await create({ projectId: id, done: true });
  assert.deepEqual(open.project, { id, name: 'Test Project', color: 'purple', emoji: '🌱' });
  assert.equal((await api('get', '/api/projects').expect(200)).body.projects.find((project) => project.id === id).openCount, 1);
  assert.equal((await api('get', '/api/tasks').query({ projectId: id, done: 'all' }).expect(200)).body.tasks.length, 2);
  await api('patch', `/api/projects/${id}`).send({ emoji: null }).expect(200);
  await api('delete', `/api/projects/${id}`).expect(200, { ok: true });
  const remaining = (await api('get', `/api/tasks/${open.id}`).expect(200)).body.task;
  assert.equal(remaining.projectId, null); assert.equal(remaining.project, null);
  await api('post', '/api/tasks').send({ projectId: randomUUID() }).expect(400);
});

test('tags deduplicate case-insensitively, support CRUD, and removal preserves tasks', async () => {
  const created = (await api('post', '/api/tags').send({ name: 'UniqueTag', color: 'red' }).expect(201)).body.tag;
  const existing = (await api('post', '/api/tags').send({ name: 'UNIQUETAG', color: 'blue' }).expect(200)).body.tag;
  assert.deepEqual(existing, created);
  const task = await create({ tags: [created.id, 'uniquetag'] });
  assert.deepEqual(task.tags, [created]);
  await create({ tags: [created.id], done: true });
  assert.equal((await api('get', '/api/tags').expect(200)).body.tags.find((tag) => tag.id === created.id).count, 1);
  const changed = await api('patch', `/api/tags/${created.id}`).send({ name: 'RenamedTag', color: 'green' }).expect(200);
  assert.equal(changed.body.tag.color, 'green');
  await api('delete', `/api/tags/${created.id}`).expect(200, { ok: true });
  assert.deepEqual((await api('get', `/api/tasks/${task.id}`).expect(200)).body.task.tags, []);
});

test('counts match each view for each authenticated user', async () => {
  for (const token of [firstToken, secondToken]) {
    const counts = (await api('get', '/api/counts', token).expect(200)).body;
    const mapping = { mine: 'mine', mineCreated: 'mine_created', mineFromTeammate: 'mine_from_teammate', teammate: 'teammate', later: 'later', unassigned: 'unassigned', completed: 'completed' };
    assert.deepEqual(Object.keys(counts).sort(), Object.keys(mapping).sort());
    for (const [key, view] of Object.entries(mapping)) {
      const tasks = (await api('get', '/api/tasks', token).query({ view, limit: 1000 }).expect(200)).body.tasks;
      assert.equal(counts[key], tasks.length, `${key} matches ${view}`);
    }
  }
});

test('agent instructions are public markdown, derive the request origin, and describe every endpoint', async () => {
  const result = await request(app).get('/api/agent').set('Host', 'localhost:3000').set('X-Forwarded-Proto', 'http').expect(200);
  assert.match(result.headers['content-type'], /^text\/markdown; charset=utf-8$/);
  for (const text of ['http://localhost:3000', '$TODOER_TOKEN', 'view=all&done=all', 'q=', 'Confirm before deleting', 'handoff', 'Maxim Test', 'Teammate Test', 'GET /api/health', 'PATCH /api/me', 'DELETE /api/tokens/:id', 'GET /api/counts', 'POST /api/tasks/:id/attachments']) assert.ok(result.text.includes(text), text);
  const alias = await request(app).get('/agent').set('Host', 'api.example.test').set('X-Forwarded-Proto', 'https').expect(200);
  assert.match(alias.text, /https:\/\/api.example.test/);
});

test('not found, invalid JSON, invalid UUID, and validation failures use consistent JSON errors', async () => {
  for (const [method, url] of [['get', '/api/tasks'], ['patch', '/api/tasks'], ['delete', '/api/tasks'], ['post', '/api/tasks/HANDOFF_PLACEHOLDER']]) {
    const path = url.includes('HANDOFF_PLACEHOLDER') ? `/api/tasks/${randomUUID()}/handoff` : `${url}/${randomUUID()}`;
    const result = await api(method, path).send({}).expect(404);
    assert.equal(typeof result.body.error, 'string');
  }
  await api('get', '/api/tasks/not-a-uuid').expect(400);
  await api('post', '/api/tasks').set('Content-Type', 'application/json').send('{broken').expect(400);
  const invalid = await api('post', '/api/tasks').send({ assignees: 'me' }).expect(400);
  assert.equal(invalid.body.error, 'Invalid request'); assert.ok(invalid.body.details);
  await api('get', '/api/unknown').expect(404);
});
