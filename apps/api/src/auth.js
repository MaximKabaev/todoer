import { createHash, createHmac, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { HttpError } from './lib/errors.js';

export const userColumns = 'id, username, display_name AS "displayName", color';
export const publicUser = (user) => ({ id: user.id, username: user.username, displayName: user.displayName, color: user.color });
export const tokenHash = (secret) => createHash('sha256').update(secret).digest('hex');
export const newToken = () => `tdr_${randomBytes(32).toString('base64url')}`;
export const cookieName = 'todoer_session';
export const sessionLifetime = 90 * 24 * 60 * 60 * 1000;
export const cookieOptions = () => ({
  httpOnly: true, sameSite: 'lax', path: '/',
  secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
});
export const sessionHash = (secret) => {
  if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required');
  return createHmac('sha256', process.env.SESSION_SECRET).update(secret).digest('hex');
};
export const dummyPassword = await bcrypt.hash(randomBytes(32).toString('hex'), 12);

function cookie(req) {
  const entry = req.headers.cookie?.split(';').find((part) => part.trim().startsWith(`${cookieName}=`));
  if (!entry) return undefined;
  try { return decodeURIComponent(entry.trim().slice(cookieName.length + 1)); }
  catch { return undefined; }
}

export async function authenticate(req, res, next) {
  const authorization = req.get('authorization');
  const secret = cookie(req);
  if (secret) req.sessionId = sessionHash(secret);
  let userId;
  if (authorization) {
    const match = /^Bearer (tdr_[A-Za-z0-9_-]+)$/i.exec(authorization);
    if (match) {
      const { rows } = await pool.query(
        'UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1 RETURNING user_id', [tokenHash(match[1])],
      );
      userId = rows[0]?.user_id;
    }
  } else {
    if (secret) {
      const { rows } = await pool.query('SELECT user_id FROM sessions WHERE id = $1 AND expires_at > now()', [req.sessionId]);
      userId = rows[0]?.user_id;
    }
  }
  if (!userId) throw new HttpError(401, 'unauthorized');
  const { rows } = await pool.query(`SELECT ${userColumns} FROM users ORDER BY created_at, id`);
  req.users = rows;
  req.user = rows.find((user) => user.id === userId);
  req.teammate = rows.find((user) => user.id !== userId);
  if (!req.user) throw new HttpError(401, 'unauthorized');
  next();
}

export function resolveUser(value, req) {
  const key = value.toLowerCase();
  if (key === 'me') return req.user.id;
  if (key === 'teammate' && req.teammate) return req.teammate.id;
  const match = req.users.find((user) => [user.id, user.username, user.displayName].some((item) => item.toLowerCase() === key));
  if (!match) throw new HttpError(400, `Unknown user "${value}". Valid users: ${req.users.map((user) => `${user.username} (${user.displayName}, ${user.id})`).join(', ')}; shortcuts: me, teammate`);
  return match.id;
}
