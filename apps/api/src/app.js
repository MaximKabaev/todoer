import express from 'express';
import { readFile } from 'node:fs/promises';
import { pool } from './db.js';
import { errorHandler, HttpError } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { tasksRouter } from './routes/tasks.js';
import { scoreRouter } from './routes/score.js';
import { catalogRouter } from './routes/catalog.js';
import { attachmentsRouter } from './routes/attachments.js';

const instructions = await readFile(new URL('./lib/agent.md', import.meta.url), 'utf8');
export const app = express();
// Comma-separated addresses/subnets of reverse proxies (e.g. a Docker Caddy on a bridge network).
const trustedProxies = (process.env.TRUST_PROXY || '').split(',').map((entry) => entry.trim()).filter(Boolean);
app.set('trust proxy', trustedProxies.length ? trustedProxies : 'loopback');
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get(['/api/agent', '/agent'], async (req, res) => {
  const { rows } = await pool.query('SELECT username, display_name FROM users ORDER BY created_at, id');
  const users = rows.map((user) => `${user.display_name} (username: ${user.username})`).join(' and ');
  const publicUrl = process.env.PUBLIC_API_URL?.replace(/\/+$/, '');
  const base = publicUrl || `${req.protocol}://${req.get('host')}`;
  const connection = publicUrl
    ? 'Preferred direct API base URL: **{{BASE}}**. Use this base for all API calls.'
    : 'Base URL for this request: **{{BASE}}**. Through the web proxy this is normally `http://localhost:3000`; the API server normally uses `http://localhost:4000`. Use the origin where you obtained this document.';
  res.type('text/markdown').send(instructions.replaceAll('{{CONNECTION}}', connection).replaceAll('{{BASE}}', base).replaceAll('{{USERS}}', users));
});
// The auth router handles public login, then authenticates every following /api route.
app.use('/api', authRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/score', scoreRouter);
app.use('/api', catalogRouter);
app.use((req, res, next) => next(new HttpError(404, 'Not found')));
app.use(errorHandler);
export default app;
