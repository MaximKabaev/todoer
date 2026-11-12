import { createHmac, timingSafeEqual } from 'node:crypto';
import { pool } from '../db.js';

// GitHub webhook receiver. Each connected repo has a webhook (push + pull_request events, JSON,
// secret GITHUB_WEBHOOK_SECRET) pointing at POST /api/github/webhook. Pushes to any branch and
// merged pull requests are recorded and credited to the authenticated sender's GitHub login.

export const githubLoginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
export const githubConfigured = () => Boolean(process.env.GITHUB_WEBHOOK_SECRET);

export function validSignature(secret, rawBody, header) {
  if (!secret || !rawBody || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Turn a webhook payload into an activity record, or null if it isn't activity.
export function eventFromPayload(event, payload) {
  const login = payload?.sender?.login;
  const repo = payload?.repository?.full_name;
  if (!login || !repo || payload.sender.type === 'Bot') return null;
  if (event === 'push') {
    const commits = Array.isArray(payload.commits) ? payload.commits.length : 0;
    // Branch deletions and pushes without commits (e.g. a new tag on an old commit) aren't work.
    if (payload.deleted || commits === 0) return null;
    return { kind: 'push', login, repo, ref: String(payload.ref || '').replace(/^refs\/heads\//, ''), commits, url: payload.compare || null };
  }
  if (event === 'pull_request' && payload.action === 'closed' && payload.pull_request?.merged) {
    // Credit whoever merged it (sender), which is the person acting.
    return { kind: 'merge', login: payload.pull_request.merged_by?.login || login, repo,
      ref: payload.pull_request.base?.ref ?? null, commits: Number(payload.pull_request.commits) || 0, url: payload.pull_request.html_url || null };
  }
  return null;
}

export async function recordGithubEvent(deliveryId, record, db = pool) {
  const { rowCount } = await db.query(`INSERT INTO github_events (delivery_id, kind, github_login, repo, ref, commits, url)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (delivery_id) DO NOTHING`,
  [deliveryId, record.kind, record.login, record.repo, record.ref, record.commits, record.url]);
  return rowCount > 0;
}
