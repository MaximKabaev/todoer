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
// Assert development defaults independently of the real deployment's .env settings.
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = '';
process.env.PUBLIC_API_URL = '';
// Never send real email from tests; notification tests enable a fake sender explicitly.
process.env.RESEND_API_KEY = '';
process.env.EMAIL_FROM = '';
const schema = `todoer_test_${randomUUID().replaceAll('-', '')}`;
process.env.API_DB_SCHEMA = schema;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
// Modules that load src/db.js are imported dynamically in before(): a static import would build the
// connection pool before API_DB_SCHEMA is set, and the tests would run against the real schema.
let app, pool, uploadDirectory, first, second;
let dateFromToday, foldScore, gradeDone, gradeOpen, labelFor, scoreFor;
const password = 'test-only-password';
const firstToken = `tdr_${randomUUID().replaceAll('-', '')}`;
const secondToken = `tdr_${randomUUID().replaceAll('-', '')}`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const api = (method, url, token = firstToken) => request(app)[method](url).set('Authorization', `Bearer ${token}`);
const create = async (body = {}, token = firstToken) => (await api('post', '/api/tasks', token).send(body).expect(201)).body.task;
const patch = async (id, body) => (await api('patch', `/api/tasks/${id}`).send(body).expect(200)).body.task;

async function withEnv(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// Model a direct remote connection, rather than Supertest's loopback socket.
const remoteClient = (req, res) => {
  Object.defineProperty(req.socket, 'remoteAddress', { value: '203.0.113.10' });
  app(req, res);
};

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
  // Safety net: every test writes and deletes rows, so refuse to run unless the pool is confined to the throwaway schema.
  const { rows: [{ search_path: searchPath }] } = await pool.query('SHOW search_path');
  if (searchPath !== schema) throw new Error(`Refusing to run: connection search_path is "${searchPath}", expected the isolated test schema "${schema}"`);
  ({ dateFromToday, foldScore, gradeDone, gradeOpen, labelFor, scoreFor } = await import('../src/lib/score.js'));
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
  assert.match(cookie, /Max-Age=34560000/);
  const session = (await pool.query("SELECT *, expires_at = 'infinity' AS forever FROM sessions")).rows[0];
  assert.equal(session.forever, true);
  assert.notEqual(session.id, cookie.split(';')[0].split('=')[1]);
  const me = await browser.get('/api/me').expect(200);
  assert.deepEqual(me.body, { user: { ...first, activeProjectId: null, email: null, emailNotifications: true }, teammate: second });
  // Each app load renews the cookie so a browser session never lapses.
  const renewed = me.headers['set-cookie']?.[0] ?? '';
  assert.equal(renewed.split(';')[0], cookie.split(';')[0]);
  assert.match(renewed, /Max-Age=34560000/);
  assert.match(renewed, /HttpOnly/);
  const tokenMe = await request(app).get('/api/me').set('Authorization', `Bearer ${firstToken}`).expect(200);
  assert.equal(tokenMe.headers['set-cookie'], undefined);
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

test('session cookies use Secure for COOKIE_SECURE=true or production, including logout', async (t) => {
  for (const [name, nodeEnv, secureEnv, secure] of [
    ['development default', 'development', undefined, false],
    ['explicit secure cookies', 'development', 'true', true],
    ['production default', 'production', undefined, true],
    ['production with COOKIE_SECURE=false', 'production', 'false', true],
  ]) {
    await t.test(name, () => withEnv({ NODE_ENV: nodeEnv, COOKIE_SECURE: secureEnv }, async () => {
      const login = await request(app).post('/api/auth/login').send({ username: first.username, password }).expect(200);
      const cookie = login.headers['set-cookie'][0];
      assert.equal(/; Secure(?:;|$)/.test(cookie), secure);
      assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/);
      const logout = await api('post', '/api/auth/logout').set('Cookie', cookie.split(';')[0]).expect(200);
      assert.equal(/; Secure(?:;|$)/.test(logout.headers['set-cookie'][0]), secure);
    }));
  }
});

test('only loopback proxies can supply forwarded client IPs and protocol', async () => {
  assert.equal(app.get('trust proxy'), 'loopback');
  const trust = app.get('trust proxy fn');
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(trust(ip), true, ip);
  for (const ip of ['203.0.113.10', '10.0.0.1', '2001:db8::1']) assert.equal(trust(ip), false, ip);

  const remote = await request(remoteClient).get('/api/agent').set('Host', 'api.example.test')
    .set('X-Forwarded-Proto', 'https').set('X-Forwarded-For', '198.51.100.1').expect(200);
  assert.ok(remote.text.includes('**http://api.example.test**'));
  const proxied = await request(app).get('/api/agent').set('Host', 'api.example.test')
    .set('X-Forwarded-Proto', 'https').expect(200);
  assert.ok(proxied.text.includes('**https://api.example.test**'));
});

test('remote clients cannot bypass the login rate limit by changing X-Forwarded-For', async () => {
  for (let i = 0; i < 21; i++) {
    await request(remoteClient).post('/api/auth/login').set('X-Forwarded-For', `198.51.100.${i + 1}`)
      .send({ username: first.username, password: 'wrong' }).expect(i < 20 ? 401 : 429);
  }
});

test('bearer tokens act as their owner, are hashed, and update last_used_at', async () => {
  const me = await api('get', '/api/me', secondToken).expect(200);
  assert.deepEqual(me.body, { user: { ...second, activeProjectId: null, email: null, emailNotifications: true }, teammate: first });
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
  assert.equal(task.dueDate, dateFromToday(7)); assert.equal(task.projectId, null); assert.equal(task.project, null);
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

test('PATCH done true preserves doneAt until a false-to-true transition', async () => {
  let task = await create({ done: true });
  const originalDoneAt = '2001-02-03T04:05:06.000Z';
  await pool.query('UPDATE tasks SET done_at = $2 WHERE id = $1', [task.id, originalDoneAt]);
  task = await patch(task.id, { done: true, title: 'Still done' });
  assert.equal(task.done, true); assert.equal(task.doneAt, originalDoneAt);
  task = await patch(task.id, { notes: 'Edit without toggling completion' });
  assert.equal(task.doneAt, originalDoneAt);
  task = await patch(task.id, { done: false });
  assert.equal(task.doneAt, null);
  const start = Date.now();
  task = await patch(task.id, { done: true });
  assert.ok(Date.parse(task.doneAt) >= start);
  assert.equal((await patch(task.id, { done: true })).doneAt, task.doneAt);
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

test('handoff exclusively assigns the recipient from every initial assignment', async (t) => {
  for (const [name, assignees, to, expected] of [
    ['me-only → teammate (default)', ['me'], undefined, second],
    ['both → teammate', ['me', 'teammate'], 'teammate', second],
    ['teammate-only → me', ['teammate'], 'me', first],
    ['unassigned → teammate', [], 'teammate', second],
  ]) {
    await t.test(name, async () => {
      const task = await create({ assignees });
      const response = await api('post', `/api/tasks/${task.id}/handoff`).send(to ? { to } : {}).expect(200);
      assert.deepEqual(response.body.task.assignees, [expected]);
      const returned = await api('post', `/api/tasks/${task.id}/handoff`, secondToken).send({ to: first.displayName }).expect(200);
      assert.deepEqual(returned.body.task.assignees, [first]);
    });
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

test('multipart preserves UTF-8 macOS screenshot and non-Latin filenames on both upload routes', async () => {
  for (const filename of ['Screenshot 2026-10-24 at 10.00.00 AM.png', 'скриншот.png']) {
    const created = await api('post', '/api/tasks').attach('files', png(), { filename, contentType: 'image/png' }).expect(201);
    const task = created.body.task;
    assert.equal(task.attachments[0].filename, filename);
    const attached = await api('post', `/api/tasks/${task.id}/attachments`)
      .attach('files', png(), { filename, contentType: 'image/png' }).expect(200);
    assert.deepEqual(attached.body.task.attachments.map((attachment) => attachment.filename), [filename, filename]);
    const stored = await pool.query('SELECT filename FROM attachments WHERE task_id = $1', [task.id]);
    assert.ok(stored.rows.every((row) => row.filename === filename));
  }
});

test('multipart ignores empty optional scalars while preserving empty title and notes', async () => {
  const response = await api('post', '/api/tasks').field('title', '').field('notes', '')
    .field('list', '').field('priority', '').field('done', '').field('dueDate', '').field('projectId', '')
    .attach('files', png(), 'empty-fields.png').expect(201);
  const task = response.body.task;
  assert.equal(task.title, ''); assert.equal(task.notes, '');
  assert.equal(task.list, 'now'); assert.equal(task.priority, 0);
  assert.equal(task.done, false); assert.equal(task.doneAt, null);
  assert.equal(task.dueDate, dateFromToday(7)); assert.equal(task.projectId, null);
  assert.deepEqual(task.assignees, [first]);
  assert.equal(task.attachments.length, 1);
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

test('Later tasks never have assignees; assigning someone moves the task to Now', async () => {
  const ids = [];
  const track = (task) => { ids.push(task.id); return task; };
  const names = (task) => task.assignees.map((u) => u.username).sort();
  try {
    // Create in Later: default and explicit assignees are dropped (explicit list wins).
    const a = track(await create({ title: 'QA later default', list: 'later' }));
    assert.deepEqual([a.list, names(a)], ['later', []]);
    const b = track(await create({ title: 'QA later explicit', list: 'later', assignees: ['me', 'teammate'] }));
    assert.deepEqual([b.list, names(b)], ['later', []]);
    // Moving to Later clears assignees.
    const c = track(await create({ title: 'QA now both', assignees: ['me', 'teammate'] }));
    assert.deepEqual(names(await patch(c.id, { list: 'later' })), []);
    // Assigning (replace or add) plans the task: it moves to Now.
    let moved = await patch(a.id, { addAssignees: ['teammate'] });
    assert.deepEqual([moved.list, names(moved)], ['now', [second.username]]);
    moved = await patch(b.id, { assignees: ['me'] });
    assert.deepEqual([moved.list, names(moved)], ['now', [first.username]]);
    // Same request says Later explicitly: Later wins, nobody assigned.
    const both = await patch(c.id, { list: 'later', assignees: ['me'] });
    assert.deepEqual([both.list, names(both)], ['later', []]);
    // Clearing or removing assignees on a Later task keeps it on Later.
    assert.equal((await patch(c.id, { assignees: [] })).list, 'later');
    assert.equal((await patch(c.id, { removeAssignees: ['me'] })).list, 'later');
    // Handoff plans it too.
    const handed = (await api('post', `/api/tasks/${c.id}/handoff`).send({ to: 'teammate' }).expect(200)).body.task;
    assert.deepEqual([handed.list, names(handed)], ['now', [second.username]]);
    // Multipart create in Later also ignores assignees.
    const upload = (await api('post', '/api/tasks').field('title', 'QA later upload').field('list', 'later').field('assignees', 'me').expect(201)).body.task;
    track(upload);
    assert.deepEqual([upload.list, names(upload)], ['later', []]);
  } finally {
    for (const id of ids) await api('delete', `/api/tasks/${id}`);
  }
});

test('counts and tag counts can be scoped to one project', async () => {
  const { project } = (await api('post', '/api/projects').send({ name: 'QA scoped counts' }).expect(201)).body;
  const tag = `qa-scope-${randomUUID().slice(0, 8)}`;
  const tasks = [];
  try {
    tasks.push(await create({ title: 'QA scoped mine', projectId: project.id, tags: [tag] }));
    tasks.push(await create({ title: 'QA scoped later', projectId: project.id, list: 'later', assignees: [] }));
    tasks.push(await create({ title: 'QA unscoped', tags: [tag] }));
    const scoped = (await api('get', '/api/counts').query({ projectId: project.id }).expect(200)).body;
    assert.deepEqual(scoped, { mine: 1, mineCreated: 1, mineFromTeammate: 0, teammate: 0, later: 1, unassigned: 0, completed: 0 });
    for (const [key, view] of Object.entries({ mine: 'mine', later: 'later', unassigned: 'unassigned' })) {
      const list = (await api('get', '/api/tasks').query({ view, projectId: project.id }).expect(200)).body.tasks;
      assert.equal(scoped[key], list.length, key);
    }
    const all = (await api('get', '/api/counts').expect(200)).body;
    assert.ok(all.mine >= 2);
    const tagCount = (query) => api('get', '/api/tags').query(query).expect(200).then((r) => r.body.tags.find((t) => t.name === tag).count);
    assert.equal(await tagCount({ projectId: project.id }), 1);
    assert.equal(await tagCount({}), 2);
    await api('get', '/api/counts').query({ projectId: 'nope' }).expect(400);
  } finally {
    for (const task of tasks) await api('delete', `/api/tasks/${task.id}`);
    await api('delete', `/api/projects/${project.id}`);
    const { tags } = (await api('get', '/api/tags').expect(200)).body;
    const created = tags.find((t) => t.name === tag);
    if (created) await api('delete', `/api/tags/${created.id}`);
  }
});

test('agent instructions are public markdown, derive the request origin, and describe every endpoint', async () => {
  const result = await request(app).get('/api/agent').set('Host', 'localhost:3000').set('X-Forwarded-Proto', 'http').expect(200);
  assert.match(result.headers['content-type'], /^text\/markdown; charset=utf-8$/);
  for (const text of ['http://localhost:3000', '$TODOER_TOKEN', 'view=all&done=all', 'q=', 'Confirm before deleting', 'handoff', 'Maxim Test', 'Teammate Test', 'GET /api/health', 'PATCH /api/me', 'DELETE /api/tokens/:id', 'GET /api/counts', 'POST /api/tasks/:id/attachments']) assert.ok(result.text.includes(text), text);
  const alias = await request(app).get('/agent').set('Host', 'api.example.test').set('X-Forwarded-Proto', 'https').expect(200);
  assert.match(alias.text, /https:\/\/api.example.test/);
});

test('PUBLIC_API_URL overrides proxy origins everywhere in both agent routes and drops localhost hints', async () => {
  for (const base of ['https://api.todo.customsai.org', 'https://custom-api.example.test/']) {
    await withEnv({ PUBLIC_API_URL: base }, async () => {
      for (const route of ['/api/agent', '/agent']) {
        const response = await request(app).get(route).set('Host', 'localhost:4000')
          .set('X-Forwarded-Proto', 'http').expect(200);
        const normalized = base.replace(/\/$/, '');
        assert.ok(response.text.includes(`Preferred direct API base URL: **${normalized}**`));
        assert.ok(response.text.includes(`export TODOER_BASE='${normalized}'`));
        assert.doesNotMatch(response.text, /localhost|\{\{[A-Z]+\}\}/);
        if (base.includes('custom-api')) assert.ok(!response.text.includes('api.todo.customsai.org'));
      }
    });
  }
});

test('agent guide maps common requests to exclusive handoff, sharing, views, search, and concise task summaries', async () => {
  const { text } = await request(app).get('/api/agent').expect(200);
  for (const phrase of ['Common requests → what to call', 'pass to German', 'Give it to me', '"to": "me"',
    '"to": "teammate"', '"addAssignees": ["me", "teammate"]', '"list": "later"',
    'view=mine', 'view=mine_from_teammate', 'Remove/delete X', 'confirm with the human',
    'exactly the recipient', 'both title and notes', 'search before creating',
    'title (use "Untitled" if empty)', 'assignees (or "Unassigned")', 'tags, due date if present, and list']) {
    assert.ok(text.includes(phrase), phrase);
  }
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


test('active project is an explicit per-user UI preference, validated and cleared on deletion', async () => {
  const { project } = (await api('post', '/api/projects').send({ name: 'QA active project' }).expect(201)).body;
  let task;
  try {
    assert.equal((await api('get', '/api/me').expect(200)).body.user.activeProjectId, null);
    assert.equal((await api('patch', '/api/me').send({ activeProjectId: project.id }).expect(200)).body.user.activeProjectId, project.id);
    assert.equal((await api('get', '/api/me').expect(200)).body.user.activeProjectId, project.id);
    assert.equal((await api('get', '/api/me', secondToken).expect(200)).body.user.activeProjectId, null);
    for (const activeProjectId of ['invalid', randomUUID()]) {
      await api('patch', '/api/me').send({ activeProjectId }).expect(400);
    }
    // Agent task calls neither apply nor change the preference.
    task = await create({ title: 'QA preference isolation' });
    assert.equal(task.projectId, null);
    await patch(task.id, { projectId: project.id });
    await patch(task.id, { projectId: null });
    assert.equal((await api('get', '/api/me').expect(200)).body.user.activeProjectId, project.id);
    await api('patch', '/api/me').send({ displayName: first.displayName }).expect(200);
    assert.equal((await api('get', '/api/me').expect(200)).body.user.activeProjectId, project.id);
    assert.equal((await api('patch', '/api/me').send({ activeProjectId: null }).expect(200)).body.user.activeProjectId, null);
    await api('patch', '/api/me').send({ activeProjectId: project.id }).expect(200);
    await api('delete', `/api/projects/${project.id}`, secondToken).expect(200);
    assert.equal((await api('get', '/api/me').expect(200)).body.user.activeProjectId, null);
    assert.equal((await api('get', '/api/me', secondToken).expect(200)).body.user.activeProjectId, null);
    const users = (await api('get', '/api/users').expect(200)).body.users;
    assert.ok(users.every((u) => !('activeProjectId' in u)));
    assert.ok(!('activeProjectId' in task.createdBy));
  } finally {
    if (task) await api('delete', `/api/tasks/${task.id}`);
    await api('delete', `/api/projects/${project.id}`);
    await api('patch', '/api/me').send({ activeProjectId: null });
    await api('patch', '/api/me', secondToken).send({ activeProjectId: null });
  }
});


test('task webUrl is omitted when unset, included on every response when configured', async () => {
  await withEnv({ PUBLIC_WEB_URL: undefined }, async () => {
    const task = await create({ title: 'QA no web origin' });
    assert.equal(Object.hasOwn(task, 'webUrl'), false);
    const found = await api('get', `/api/tasks/${task.id}`).expect(200);
    assert.equal(Object.hasOwn(found.body.task, 'webUrl'), false);
    const list = await api('get', '/api/tasks?view=all').expect(200);
    assert.ok(list.body.tasks.every((t) => !Object.hasOwn(t, 'webUrl')));
  });
  await withEnv({ PUBLIC_WEB_URL: 'https://todo.customsai.org///' }, async () => {
    const task = await create({ title: 'QA web link' });
    const expected = `https://todo.customsai.org/tasks/${task.id}`;
    assert.equal(task.webUrl, expected);
    assert.equal((await api('get', `/api/tasks/${task.id}`).expect(200)).body.task.webUrl, expected);
    assert.equal((await patch(task.id, { notes: 'QA edit' })).webUrl, expected);
    assert.equal((await api('post', `/api/tasks/${task.id}/handoff`).send({}).expect(200)).body.task.webUrl, expected);
    const list = await api('get', '/api/tasks?view=all').expect(200);
    assert.ok(list.body.tasks.every((t) => t.webUrl === `https://todo.customsai.org/tasks/${t.id}`));
    const instructions = await request(app).get('/api/agent').expect(200);
    assert.match(instructions.text, /webUrl.*clickable Markdown link/);
  });
});

test('email is private to its owner, editable, unique, and a login identifier', async () => {
  const me = await api('get', '/api/me').expect(200);
  assert.equal(me.body.user.email, null);
  assert.equal(me.body.user.emailNotifications, true);
  assert.equal(Object.hasOwn(me.body.teammate, 'email'), false);
  assert.equal((await api('patch', '/api/me').send({ email: 'not an email' }).expect(400)).body.error, 'Enter a valid email address');
  const set = await api('patch', '/api/me').send({ email: '  Maxim.Test@Example.com ' }).expect(200);
  assert.equal(set.body.user.email, 'Maxim.Test@Example.com');
  assert.equal(set.body.user.activeProjectId, null);
  const taken = await api('patch', '/api/me', secondToken).send({ email: 'maxim.test@example.COM' }).expect(409);
  assert.equal(taken.body.error, 'That email is already in use');
  const users = await api('get', '/api/users').expect(200);
  assert.ok(users.body.users.every((user) => !Object.hasOwn(user, 'email')));
  const login = await request(app).post('/api/auth/login').send({ username: 'MAXIM.TEST@example.com', password }).expect(200);
  assert.equal(login.body.user.id, first.id);
  assert.equal(Object.hasOwn(login.body.user, 'email'), false);
  await request(app).post('/api/auth/login').send({ username: 'maxim.test@example.com', password: 'wrong' }).expect(401);
  const off = await api('patch', '/api/me').send({ emailNotifications: false }).expect(200);
  assert.deepEqual([off.body.user.email, off.body.user.emailNotifications], ['Maxim.Test@Example.com', false]);
  const cleared = await api('patch', '/api/me').send({ email: '', emailNotifications: true }).expect(200);
  assert.equal(cleared.body.user.email, null);
  await request(app).post('/api/auth/login').send({ username: 'maxim.test@example.com', password }).expect(401);
  await api('patch', '/api/me').send({ email: null }).expect(200);
});

test('task changes involving the teammate are batched into one email digest per recipient', async () => {
  const { flushNotifications } = await import('../src/lib/notifications.js');
  const outbox = [];
  const send = async (message) => { outbox.push(message); };
  const flush = () => flushNotifications({ send, quiet: 0, maxWait: 0 });
  await withEnv({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'todoer <todo@example.com>', PUBLIC_WEB_URL: 'https://todo.example.com' }, async () => {
    await pool.query('DELETE FROM notification_events');
    // No email on file: nothing is queued.
    await create({ title: 'QA no email yet', assignees: ['teammate'] });
    assert.equal((await pool.query('SELECT 1 FROM notification_events')).rowCount, 0);
    await api('patch', '/api/me', secondToken).send({ email: 'partner@example.com' }).expect(200);

    const handed = await create({ title: 'QA handed over' });
    await api('post', `/api/tasks/${handed.id}/handoff`).send({ to: 'teammate' }).expect(200);
    await patch(handed.id, { title: 'QA handed over v2', notes: 'one' });
    await patch(handed.id, { notes: 'two' });
    await patch(handed.id, { position: 12345 }); // Reordering alone is not news.
    const own = await create({ title: 'QA not involved' });
    await patch(own.id, { done: true });
    const theirs = await create({ title: 'QA theirs' }, secondToken);
    await patch(theirs.id, { done: true, dueDate: '2026-11-05', priority: 3, addTags: ['qa-mail'] });
    await api('patch', `/api/tasks/${theirs.id}`, secondToken).send({ done: false }).expect(200); // Their own edit.
    const doomed = await create({ title: 'QA doomed', assignees: ['teammate'] });
    await api('delete', `/api/tasks/${doomed.id}`).expect(200);

    assert.equal(await flush(), 1);
    assert.equal(outbox.length, 1);
    const [mail] = outbox;
    assert.equal(mail.to, 'partner@example.com');
    assert.equal(mail.subject, 'Maxim Test updated 3 tasks');
    assert.match(mail.idempotencyKey, /^todoer-[0-9a-f]{32}$/);
    assert.match(mail.text, /^Hi Teammate Test,/);
    assert.match(mail.text, /“QA handed over v2”\n  - Maxim Test assigned it to you\n  - Maxim Test dropped it\n  - Maxim Test renamed it \(was “QA handed over”\)\n  - Maxim Test edited the notes\n  https:\/\/todo\.example\.com\/tasks\//);
    assert.equal(mail.text.match(/edited the notes/g).length, 1);
    assert.match(mail.text, /Maxim Test completed it\n  - Maxim Test set the due date to Nov 5\n  - Maxim Test set the priority to high\n  - Maxim Test added the tag #qa-mail/);
    assert.match(mail.text, /“QA doomed”\n  - Maxim Test created it\n  - Maxim Test assigned it to you\n  - Maxim Test deleted it\n\n/);
    assert.doesNotMatch(mail.text, /not involved|no email yet|reopened|position/);
    assert.match(mail.html, /<a href="https:\/\/todo\.example\.com\/tasks\/[0-9a-f-]+"/);
    assert.equal((await pool.query('SELECT 1 FROM notification_events')).rowCount, 0);
    assert.equal(await flush(), 0);

    // Not yet quiet: held back. A failed send keeps events for a retry with the same key.
    await patch(handed.id, { title: '<b>QA & co</b>' });
    assert.equal(await flushNotifications({ send, quiet: 60000, maxWait: 60000 }), 0);
    const failing = async (message) => { outbox.push(message); throw new Error('boom'); };
    const originalError = console.error;
    console.error = () => {};
    try { assert.equal(await flushNotifications({ send: failing, quiet: 0, maxWait: 0 }), 0); }
    finally { console.error = originalError; }
    assert.equal(await flush(), 1);
    assert.equal(outbox.at(-1).idempotencyKey, outbox.at(-2).idempotencyKey);
    assert.equal(outbox.at(-1).subject, 'Maxim Test updated “<b>QA & co</b>”');
    assert.match(outbox.at(-1).html, /&lt;b&gt;QA &amp; co&lt;\/b&gt;/);

    // Notifications off: nothing is queued.
    await api('patch', '/api/me', secondToken).send({ emailNotifications: false }).expect(200);
    await patch(handed.id, { done: true });
    assert.equal((await pool.query('SELECT 1 FROM notification_events')).rowCount, 0);
    await api('patch', '/api/me', secondToken).send({ email: null, emailNotifications: true }).expect(200);
  });
});

const backdate = (id, days) => pool.query("UPDATE tasks SET created_at = created_at - $2 * interval '1 day' WHERE id = $1", [id, days]);
const board = async (token = firstToken) => (await api('get', '/api/score', token).expect(200)).body;

test('tasks planned for Now default to a one-week due date; Later stays undated until planned', async () => {
  assert.equal((await create({ title: 'QA default due' })).dueDate, dateFromToday(7));
  assert.equal((await create({ title: 'QA explicit', dueDate: '2030-01-02' })).dueDate, '2030-01-02');
  assert.equal((await create({ title: 'QA no date wanted', dueDate: null })).dueDate, null);
  const later = await create({ title: 'QA later', list: 'later' });
  assert.equal(later.dueDate, null);
  // Assigning someone plans it: it moves to Now with a fresh week.
  assert.equal((await patch(later.id, { assignees: ['me'] })).dueDate, dateFromToday(7));
  // Planning an old task with a past date refreshes it; an explicit date in the same request wins.
  const stale = await create({ title: 'QA stale', list: 'later' });
  await pool.query("UPDATE tasks SET due_date = '2020-01-01' WHERE id = $1", [stale.id]);
  assert.equal((await patch(stale.id, { list: 'now' })).dueDate, dateFromToday(7));
  await patch(stale.id, { list: 'later' });
  assert.equal((await patch(stale.id, { list: 'now', dueDate: '2031-05-06' })).dueDate, '2031-05-06');
  // A future date survives planning, and handoff plans a Later task the same way.
  await patch(stale.id, { list: 'later', dueDate: '2031-05-06' });
  assert.equal((await patch(stale.id, { list: 'now' })).dueDate, '2031-05-06');
  const handed = await create({ title: 'QA handoff later', list: 'later' });
  assert.equal((await api('post', `/api/tasks/${handed.id}/handoff`).send({ to: 'teammate' }).expect(200)).body.task.dueDate, dateFromToday(7));
});

test('score grading, weighting and labels', () => {
  assert.deepEqual([0, 1, 2, 7, 30].map(gradeDone), [100, 80, 70, 30, 30]);
  assert.deepEqual([1, 2, 6, 9].map(gradeOpen), [50, 40, 0, 0]);
  assert.equal(foldScore([]), 50);
  // Only weight and grade matter, not insertion order; zero-weight events are ignored.
  const events = [{ key: 'a', time: 2, weight: 1, grade: 100 }, { key: 'b', time: 1, weight: 1, grade: 0 }, { key: 'c', time: 3, weight: 0, grade: 0 }];
  assert.equal(foldScore(events), foldScore([...events].reverse()));
  assert.equal(foldScore([{ key: 'a', time: 1, weight: 1, grade: 100 }]), 58); // one task can't swing a fresh score
  assert.ok(foldScore(Array.from({ length: 40 }, (_, i) => ({ key: `${i}`, time: i, weight: 1, grade: 100 }))) > 95);
  assert.deepEqual([95, 80, 65, 50, 35, 10].map(labelFor), ['Best boy ever', 'Very good boy', 'Good boy', 'Doing okay', 'Naughty', 'Bad boy']);
  // Replay: tasks created after asOf are ignored and later completions count as still open.
  const day = 86400000, now = new Date('2026-06-15T12:00:00Z');
  const row = { id: 't', userId: 'u', done: true, doneAt: now, createdAt: new Date(now - 3 * day), priority: 0, empty: false, deadline: new Date(now - 1 * day) };
  assert.equal(scoreFor([row], 'u', now), foldScore([{ key: 't', time: now, weight: 1, grade: 80 }]));
  assert.equal(scoreFor([row], 'u', new Date(now - 2 * day)), 50);
  assert.equal(scoreFor([row], 'u', new Date(now - 4 * day)), 50);
  assert.equal(scoreFor([{ ...row, done: false, doneAt: null }], 'u', now), foldScore([{ key: 't', time: now, weight: 1, grade: 50 }]));
});

test('scoreboard: idle people keep their score, completions on time win, neglect and reopening are reflected', async () => {
  await pool.query('DELETE FROM tasks');
  let state = await board();
  assert.deepEqual([state.me.score, state.teammate.score, state.leader, state.lead, state.me.label], [50, 50, null, 0, 'Doing okay']);
  assert.deepEqual(state.me.user, first);
  assert.deepEqual(state.teammate.user, second);

  // German works through 3 tasks on time: German rises, Maxim (nothing assigned) does not move.
  const theirs = [];
  for (const title of ['QA one', 'QA two', 'QA three']) {
    const task = await create({ title, assignees: ['partner_test'] });
    await backdate(task.id, 1);
    theirs.push(task);
  }
  assert.equal((await board()).teammate.score, 50); // open and on time is neutral
  for (const task of theirs) await api('patch', `/api/tasks/${task.id}`, secondToken).send({ done: true }).expect(200);
  state = await board();
  assert.equal(state.me.score, 50);
  assert.equal(state.teammate.score, 69);
  assert.deepEqual([state.leader, state.lead, state.teammate.label], ['teammate', 19, 'Good boy']);
  assert.deepEqual([state.teammate.doneThisWeek, state.teammate.trend, state.teammate.overdue, state.me.doneThisWeek], [3, 19, 0, 0]);
  // The mirror view for German.
  const mirror = await board(secondToken);
  assert.deepEqual([mirror.me.score, mirror.teammate.score, mirror.leader, mirror.lead], [69, 50, 'me', 19]);

  // Maxim sits on an overdue task: his score drops while it is open, recovers (not fully) once done,
  // and reopening brings the penalty back.
  const late = await create({ title: 'QA overdue', dueDate: dateFromToday(-3) });
  state = await board();
  assert.equal(state.me.overdue, 1);
  assert.ok(state.me.score < 50, `expected a penalty, got ${state.me.score}`);
  const penalized = state.me.score;
  await patch(late.id, { done: true });
  const redeemed = (await board()).me.score;
  assert.ok(redeemed > penalized && redeemed <= 50, `done late should beat open overdue: ${penalized} -> ${redeemed}`);
  await patch(late.id, { done: false });
  assert.equal((await board()).me.score, penalized);
  await patch(late.id, { dueDate: dateFromToday(7) });
  assert.equal((await board()).me.score, 50);

  // Quick-add-and-done, empty tasks and Later tasks barely or never count; a shared task counts for both.
  const before = (await board()).me.score;
  await create({ title: 'QA instant', done: true });
  await create({ done: true });
  await create({ title: 'QA parked', list: 'later' });
  assert.ok(Math.abs((await board()).me.score - before) <= 2);
  const shared = await create({ title: 'QA shared', assignees: ['me', 'partner_test'], dueDate: dateFromToday(-4) });
  state = await board();
  assert.equal(state.me.overdue, 1); assert.equal(state.teammate.overdue, 1);
});

test('email digests carry the good boy score when a task is completed', async () => {
  const { flushNotifications } = await import('../src/lib/notifications.js');
  const outbox = [];
  await withEnv({ RESEND_API_KEY: 're_test', EMAIL_FROM: 'todoer <todo@example.com>', PUBLIC_WEB_URL: 'https://todo.example.com' }, async () => {
    await pool.query('DELETE FROM tasks'); await pool.query('DELETE FROM notification_events');
    await api('patch', '/api/me', secondToken).send({ email: 'partner@example.com' }).expect(200);
    // German creates a task for Maxim, who finishes it a day after creating it, on time.
    const task = await create({ title: 'QA score mail', assignees: [first.username] }, secondToken);
    await backdate(task.id, 1);
    await pool.query('DELETE FROM notification_events');
    await patch(task.id, { title: 'QA score mail!' }); // not a completion: no score yet
    await patch(task.id, { done: true });
    const send = async (message) => { outbox.push(message); };
    assert.equal(await flushNotifications({ send, quiet: 0, maxWait: 0 }), 1);
    const [mail] = outbox;
    assert.match(mail.text, /Good boy score\n  Teammate Test \(you\): 50 · Doing okay \(±0\)\n  Maxim Test: 58 · Doing okay \(\+8\)\n  Maxim Test leads by 8\n/);
    assert.match(mail.html, /Good boy score/);
    assert.match(mail.html, /<strong[^>]*>58<\/strong> · Doing okay \(\+8\)/);
    // Edits and reopening alone carry no score block.
    await patch(task.id, { done: false });
    outbox.length = 0;
    assert.equal(await flushNotifications({ send, quiet: 0, maxWait: 0 }), 1);
    assert.doesNotMatch(outbox[0].text, /Good boy score/);
    await api('patch', '/api/me', secondToken).send({ email: null }).expect(200);
  });
});


test('Later review respects age, completion, snoozing, due dates and concurrent workers', async () => {
  const { resurfaceLaterTasks } = await import('../src/lib/later-review.js');
  const old = await create({ title: 'Review me', list: 'later', dueDate: '2020-01-01' });
  const fresh = await create({ title: 'Too soon', list: 'later' });
  const done = await create({ title: 'Finished', list: 'later', done: true });
  const future = await create({ title: 'Future date', list: 'later', dueDate: '2099-01-01' });
  const ids = [old.id, fresh.id, done.id, future.id];
  try {
    const { rows: [initial] } = await pool.query('SELECT later_since = created_at AS matches FROM tasks WHERE id = $1', [fresh.id]);
    assert.equal(initial.matches, true);
    await pool.query("UPDATE tasks SET later_since = now() - interval '15 days' WHERE id = ANY($1::uuid[])", [[old.id, done.id, future.id]]);
    await pool.query("UPDATE tasks SET later_since = now() - interval '335 hours' WHERE id = $1", [fresh.id]);
    await patch(old.id, { title: 'Edited without snoozing', list: 'later' });
    await Promise.all([resurfaceLaterTasks(), resurfaceLaterTasks()]);
    const get = async (id) => (await api('get', `/api/tasks/${id}`).expect(200)).body.task;
    const reviewed = await get(old.id);
    assert.equal(reviewed.list, 'now');
    assert.ok(Math.abs(Date.now() - Date.parse(reviewed.resurfacedAt)) < 5000);
    assert.equal((await get(fresh.id)).resurfacedAt, null);
    assert.equal((await patch(old.id, { notes: 'Keep origin' })).resurfacedAt, reviewed.resurfacedAt);
    assert.equal(reviewed.assignees.length, 1);
    assert.ok([first.id, second.id].includes(reviewed.assignees[0].id));
    assert.equal(reviewed.dueDate, dateFromToday(7));
    assert.equal((await get(future.id)).dueDate, '2099-01-01');
    assert.equal((await get(fresh.id)).list, 'later');
    assert.equal((await get(done.id)).list, 'later');
    const snoozed = await patch(old.id, { list: 'later' });
    assert.equal(snoozed.assignees.length, 0);
    const { rows: [timer] } = await pool.query('SELECT later_since FROM tasks WHERE id = $1', [old.id]);
    assert.ok(Math.abs(Date.now() - timer.later_since.getTime()) < 5000);
    await resurfaceLaterTasks();
    assert.equal((await get(old.id)).list, 'later');
    await pool.query("UPDATE tasks SET later_since = now() - interval '336 hours' WHERE id = $1", [old.id]);
    await resurfaceLaterTasks();
    assert.equal((await get(old.id)).list, 'now');
    const { rows: [cleared] } = await pool.query('SELECT later_since FROM tasks WHERE id = $1', [old.id]);
    assert.equal(cleared.later_since, null);
  } finally {
    await pool.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [ids]);
  }
});
