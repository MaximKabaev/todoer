import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, transaction } from '../db.js';
import { authenticate, cookieName, cookieOptions, dummyPassword, newToken, publicUser, sessionHash, cookieLifetime, tokenHash, userColumns } from '../auth.js';
import { HttpError } from '../lib/errors.js';
import { id, z } from '../lib/validation.js';

export const authRouter = Router();
// Cap failure buckets as well as attempts, and compare a real bcrypt hash even for unknown users.
const failures = new Map();
authRouter.post('/auth/login', async (req, res) => {
  const body = z.object({ username: z.string().trim().min(1).max(200), password: z.string().max(1000) }).parse(req.body);
  const key = req.ip;
  const now = Date.now();
  const bucket = failures.get(key);
  if (bucket && bucket.until > now && bucket.count >= 20) throw new HttpError(429, 'Too many login attempts; try again in 15 minutes');
  const { rows } = await pool.query(`SELECT ${userColumns}, password_hash FROM users WHERE lower(username) = lower($1)`, [body.username]);
  const user = rows[0];
  const valid = await bcrypt.compare(body.password, user?.password_hash || dummyPassword);
  if (!user || !valid) {
    if (failures.size > 10000) {
      for (const [ip, entry] of failures) if (entry.until <= now) failures.delete(ip);
      if (failures.size > 10000) failures.delete(failures.keys().next().value);
    }
    failures.set(key, { count: bucket?.until > now ? bucket.count + 1 : 1, until: bucket?.until > now ? bucket.until : now + 15 * 60 * 1000 });
    throw new HttpError(401, 'unauthorized');
  }
  failures.delete(key);
  const secret = randomBytes(32).toString('base64url');
  await transaction(async (db) => {
    await db.query('DELETE FROM sessions WHERE expires_at <= now()');
    await db.query("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, 'infinity')", [sessionHash(secret), user.id]);
  });
  res.cookie(cookieName, secret, { ...cookieOptions(), maxAge: cookieLifetime }).json({ user: publicUser(user) });
});

authRouter.use(authenticate);
authRouter.post('/auth/logout', async (req, res) => {
  if (req.sessionId) await pool.query('DELETE FROM sessions WHERE id = $1', [req.sessionId]);
  res.clearCookie(cookieName, cookieOptions()).json({ ok: true });
});
authRouter.get('/me', (req, res) => {
  if (req.sessionSecret) res.cookie(cookieName, req.sessionSecret, { ...cookieOptions(), maxAge: cookieLifetime });
  res.json({ user: req.user, teammate: req.teammate ?? null });
});
authRouter.get('/users', (req, res) => res.json({ users: req.users }));
authRouter.patch('/me', async (req, res) => {
  const body = z.object({
    displayName: z.string().trim().min(1).max(200).optional(),
    activeProjectId: id.nullable().optional(),
    password: z.string().min(1).max(72).optional(), currentPassword: z.string().max(1000).optional(),
  }).parse(req.body);
  const user = await transaction(async (db) => {
    const { rows: [current] } = await db.query('SELECT password_hash FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    let hash;
    if (body.password !== undefined) {
      if (!body.currentPassword || !(await bcrypt.compare(body.currentPassword, current.password_hash))) throw new HttpError(400, 'Current password is required and must match');
      if (Buffer.byteLength(body.password) > 72) throw new HttpError(400, 'Password must be at most 72 UTF-8 bytes');
      hash = await bcrypt.hash(body.password, 12);
    }
    const { rows } = await db.query(`UPDATE users SET display_name = COALESCE($2, display_name), password_hash = COALESCE($3, password_hash),
      active_project_id = CASE WHEN $4 THEN $5::uuid ELSE active_project_id END
      WHERE id = $1 RETURNING ${userColumns}, active_project_id AS "activeProjectId"`,
    [req.user.id, body.displayName, hash, body.activeProjectId !== undefined, body.activeProjectId ?? null]);
    return rows[0];
  });
  res.json({ user });
});
authRouter.get('/tokens', async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, created_at AS "createdAt", last_used_at AS "lastUsedAt" FROM api_tokens WHERE user_id = $1 ORDER BY created_at', [req.user.id]);
  res.json({ tokens: rows });
});
authRouter.post('/tokens', async (req, res) => {
  const { name = 'Agent token' } = z.object({ name: z.string().trim().max(200).optional() }).parse(req.body ?? {});
  const secret = newToken();
  const { rows } = await pool.query('INSERT INTO api_tokens (user_id, name, token_hash) VALUES ($1,$2,$3) RETURNING id, name, created_at AS "createdAt"', [req.user.id, name, tokenHash(secret)]);
  res.status(201).json({ token: rows[0], secret });
});
authRouter.delete('/tokens/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM api_tokens WHERE id = $1 AND user_id = $2', [id.parse(req.params.id), req.user.id]);
  if (!rowCount) throw new HttpError(404, 'Token not found');
  res.json({ ok: true });
});
