import { createHash } from 'node:crypto';
import { pool } from '../db.js';
import { labelFor, scoreSnapshot } from './score.js';

// Email digests: every task change that involves the teammate (assigned to them now or before,
// or created by them) is queued in notification_events inside the same transaction, then the
// API process batches a recipient's events into one email once they have been quiet for a while.
export const quietMs = 2 * 60 * 1000;
export const maxWaitMs = 10 * 60 * 1000;
const staleMs = 2 * 24 * 60 * 60 * 1000;
const priorities = ['none', 'low', 'medium', 'high'];

export const notificationsConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
const webUrl = () => process.env.PUBLIC_WEB_URL?.replace(/\/+$/, '') || '';
const day = (value) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const quote = (title) => `“${title || 'Untitled task'}”`;

// Describe what changed between two hydrated tasks (either may be null), from the recipient's view.
export function describeChanges(before, after, recipientId, actorId) {
  if (!before) return ['created it', ...(after.assignees.some((user) => user.id === recipientId) ? ['assigned it to you'] : [])];
  if (!after) return ['deleted it'];
  const changes = [];
  const ids = (task) => new Set(task.assignees.map((user) => user.id));
  const [was, now] = [ids(before), ids(after)];
  for (const user of after.assignees) {
    if (was.has(user.id)) continue;
    changes.push(user.id === recipientId ? 'assigned it to you' : user.id === actorId ? 'took it on' : `assigned it to ${user.displayName}`);
  }
  for (const user of before.assignees) {
    if (now.has(user.id)) continue;
    changes.push(user.id === recipientId ? 'unassigned you' : user.id === actorId ? 'dropped it' : `unassigned ${user.displayName}`);
  }
  if (before.done !== after.done) changes.push(after.done ? 'completed it' : 'reopened it');
  if (before.title !== after.title) changes.push(before.title ? `renamed it (was ${quote(before.title)})` : 'gave it a title');
  if (before.notes !== after.notes) changes.push('edited the notes');
  if (before.dueDate !== after.dueDate) changes.push(after.dueDate ? `set the due date to ${day(after.dueDate)}` : 'removed the due date');
  if (before.priority !== after.priority) changes.push(after.priority ? `set the priority to ${priorities[after.priority]}` : 'removed the priority');
  if (before.project?.id !== after.project?.id) changes.push(after.project ? `moved it to the ${after.project.name || 'untitled'} project` : 'removed it from its project');
  if (before.list !== after.list) changes.push(after.list === 'later' ? 'moved it to Later' : 'moved it to Now');
  const tagNames = (task) => new Set(task.tags.map((tag) => tag.name));
  const [oldTags, newTags] = [tagNames(before), tagNames(after)];
  for (const name of newTags) if (!oldTags.has(name)) changes.push(`added the tag #${name}`);
  for (const name of oldTags) if (!newTags.has(name)) changes.push(`removed the tag #${name}`);
  const added = after.attachments.length - before.attachments.length;
  if (added > 0) changes.push(added === 1 ? 'added an image' : `added ${added} images`);
  return changes;
}

// Queue a change for the teammate if the task involves them and they want email.
export async function recordChange(db, req, before, after, scoresBefore = null) {
  if (!notificationsConfigured() || !req.teammate) return;
  const recipientId = req.teammate.id;
  const involved = [before, after].some((task) => task && (task.createdBy?.id === recipientId || task.assignees.some((user) => user.id === recipientId)));
  if (!involved) return;
  const { rows: [recipient] } = await db.query('SELECT email, email_notifications FROM users WHERE id = $1', [recipientId]);
  if (!recipient?.email || !recipient.email_notifications) return;
  const changes = describeChanges(before, after, recipientId, req.user.id);
  if (!changes.length) return;
  const task = after ?? before;
  // A completion carries the good boy scores from just before and after it.
  let scores = null;
  if (scoresBefore && after?.done && !before?.done) {
    const scoresAfter = await scoreSnapshot(db);
    scores = req.users.map((user) => ({ id: user.id, name: user.displayName, before: scoresBefore[user.id], after: scoresAfter[user.id] }));
  }
  await db.query('INSERT INTO notification_events (recipient_id, actor_id, task_id, task_title, changes, scores) VALUES ($1,$2,$3,$4,$5,$6)',
    [recipientId, req.user.id, task.id, task.title, changes, scores && JSON.stringify(scores)]);
}

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

const signed = (delta) => (delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : '±0');

// The good boy score section of a digest: net change across the batch's completions, the latest
// standings, and who leads. Null when the batch has no completion.
export function scoreSummary(events, recipientId) {
  const scored = events.filter((event) => event.scores);
  if (!scored.length) return null;
  const first = scored[0].scores;
  const last = scored.at(-1).scores;
  const people = last.map((person) => ({
    ...person, you: person.id === recipientId, before: first.find((entry) => entry.id === person.id)?.before ?? person.before,
  })).sort((a, b) => Number(b.you) - Number(a.you));
  const rows = people.map((person) => ({
    name: person.you ? `${person.name} (you)` : person.name, score: person.after, label: labelFor(person.after), delta: person.after - person.before,
  }));
  const [top, runnerUp] = [...people].sort((a, b) => b.after - a.after);
  const headline = !runnerUp || top.after === runnerUp.after ? 'Neck and neck'
    : `${top.you ? 'You lead' : `${top.name} leads`} by ${top.after - runnerUp.after}`;
  return { rows, headline };
}

// Merge a recipient's events into one email: one block per task, each change listed once.
export function composeDigest(events, recipientName, recipientId = null) {
  const summary = scoreSummary(events, recipientId);
  const tasks = new Map();
  for (const event of events) {
    const entry = tasks.get(event.taskId) ?? { id: event.taskId, title: event.taskTitle, lines: [], deleted: false };
    entry.title = event.taskTitle;
    for (const change of event.changes) {
      const line = `${event.actorName} ${change}`;
      if (!entry.lines.includes(line)) entry.lines.push(line);
      if (change === 'deleted it') entry.deleted = true;
    }
    tasks.set(event.taskId, entry);
  }
  const blocks = [...tasks.values()];
  const actors = [...new Set(events.map((event) => event.actorName))].join(' and ');
  const subject = blocks.length === 1 ? `${actors} updated ${quote(blocks[0].title)}` : `${actors} updated ${blocks.length} tasks`;
  const base = webUrl();
  const link = (block) => (!block.deleted && base ? `${base}/tasks/${block.id}` : '');
  const text = [
    `Hi ${recipientName},`, '',
    ...blocks.flatMap((block) => [quote(block.title), ...block.lines.map((line) => `  - ${line}`), ...(link(block) ? [`  ${link(block)}`] : []), '']),
    ...(summary ? ['Good boy score', ...summary.rows.map((row) => `  ${row.name}: ${row.score} · ${row.label} (${signed(row.delta)})`), `  ${summary.headline}`, ''] : []),
    'You get these because email notifications are on in todoer Settings.',
  ].join('\n');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2328;max-width:560px">
<p>Hi ${escape(recipientName)},</p>
${blocks.map((block) => `<div style="margin:16px 0;padding:12px 16px;border:1px solid #e5e7eb;border-radius:12px">
<div style="font-weight:600;margin-bottom:6px">${link(block) ? `<a href="${escape(link(block))}" style="color:#1f2328">${escape(quote(block.title))}</a>` : escape(quote(block.title))}</div>
<ul style="margin:0;padding-left:20px;color:#4b5563">${block.lines.map((line) => `<li>${escape(line)}</li>`).join('')}</ul>
</div>`).join('\n')}
${summary ? `<div style="margin:16px 0;padding:12px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb">
<div style="font-weight:600;margin-bottom:6px">Good boy score</div>
${summary.rows.map((row) => `<div style="color:#4b5563">${escape(row.name)}: <strong style="color:#1f2328">${row.score}</strong> · ${escape(row.label)} (${signed(row.delta)})</div>`).join('\n')}
<div style="margin-top:6px;font-weight:600">${escape(summary.headline)}</div>
</div>` : ''}
<p style="color:#9ca3af;font-size:12px">You get these because email notifications are on in ${base ? `<a href="${escape(base)}/settings" style="color:#9ca3af">todoer Settings</a>` : 'todoer Settings'}.</p>
</div>`;
  return { subject, text, html };
}

export async function sendEmail({ to, subject, text, html, idempotencyKey }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text, html }),
  });
  if (!response.ok) throw new Error(`Resend responded ${response.status}: ${(await response.text()).slice(0, 500)}`);
}

// Send every recipient's digest whose events have been quiet for quietMs (or waited maxWaitMs).
// Events are deleted only after a successful send; the idempotency key prevents duplicates on retry.
export async function flushNotifications({ send = sendEmail, quiet = quietMs, maxWait = maxWaitMs } = {}) {
  await pool.query('DELETE FROM notification_events WHERE created_at < now() - $1::double precision * interval \'1 millisecond\'', [staleMs]);
  const { rows: due } = await pool.query(`SELECT recipient_id FROM notification_events GROUP BY recipient_id
    HAVING max(created_at) <= now() - $1::double precision * interval '1 millisecond'
        OR min(created_at) <= now() - $2::double precision * interval '1 millisecond'`, [quiet, maxWait]);
  let sent = 0;
  for (const { recipient_id: recipientId } of due) {
    const { rows: events } = await pool.query(`SELECT e.id, e.task_id AS "taskId", e.task_title AS "taskTitle", e.changes, e.scores, a.display_name AS "actorName"
      FROM notification_events e JOIN users a ON a.id = e.actor_id WHERE e.recipient_id = $1 ORDER BY e.id`, [recipientId]);
    const ids = events.map((event) => event.id);
    const { rows: [recipient] } = await pool.query('SELECT email, display_name, email_notifications FROM users WHERE id = $1', [recipientId]);
    if (recipient?.email && recipient.email_notifications && events.length) {
      const idempotencyKey = `todoer-${createHash('sha256').update(`${recipientId}:${ids.join(',')}`).digest('hex').slice(0, 32)}`;
      try {
        await send({ to: recipient.email, ...composeDigest(events, recipient.display_name, recipientId), idempotencyKey });
        sent++;
      } catch (error) {
        console.error(`Notification email to user ${recipientId} failed: ${error.message}`);
        continue;
      }
    }
    await pool.query('DELETE FROM notification_events WHERE id = ANY($1::bigint[])', [ids]);
  }
  return sent;
}

export function startNotificationWorker(intervalMs = 30 * 1000) {
  if (!notificationsConfigured()) {
    console.log('Email notifications disabled (RESEND_API_KEY or EMAIL_FROM not set)');
    return () => {};
  }
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await flushNotifications(); }
    catch (error) { console.error(`Notification worker: ${error.message}`); }
    finally { running = false; }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
