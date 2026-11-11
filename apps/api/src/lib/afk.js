import { pool } from '../db.js';
import { dateFromToday, labelFor, SCORE, scoreSnapshot, scoreTimezone } from './score.js';
import { notificationsConfigured, sendEmail } from './notifications.js';

// AFK penalty: at the end of every day (in SCORE_TIMEZONE), anyone who had open tasks assigned in
// Now but completed none of their assigned tasks that day loses SCORE.afkPoints. Days with nothing
// assigned never count, so one person's empty plate can't cost them. Both people get an email.
// Penalties are stored (afk_days), so they never shift retroactively; each day is decided once.

const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pretty = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// Decide every finished day not yet checked. The first run only records yesterday as a baseline,
// so the feature starts counting from the day it ships rather than penalizing history.
export async function applyAfkPenalties(now = new Date(), db = pool) {
  const today = dateFromToday(0, now);
  const yesterday = addDays(today, -1);
  const tz = scoreTimezone();
  const applied = [];
  const { rows: users } = await db.query('SELECT id FROM users ORDER BY created_at, id');
  for (const { id: userId } of users) {
    const { rows: [{ last }] } = await db.query("SELECT to_char(max(day), 'YYYY-MM-DD') AS last FROM afk_days WHERE user_id = $1", [userId]);
    if (!last) {
      await db.query(`INSERT INTO afk_days (user_id, day, points, applied_at) VALUES ($1, $2::date, 0, ($2::date + 1)::timestamp AT TIME ZONE $3)
        ON CONFLICT DO NOTHING`, [userId, yesterday, tz]);
      continue;
    }
    for (let day = addDays(last, 1); day <= yesterday; day = addDays(day, 1)) {
      // Open at the end of the day: created before it ended and not completed by then.
      const { rows: [state] } = await db.query(`WITH bounds AS (
          SELECT ($2::date)::timestamp AT TIME ZONE $3 AS starts, ($2::date + 1)::timestamp AT TIME ZONE $3 AS ends),
        mine AS (SELECT t.* FROM tasks t JOIN task_assignees a ON a.task_id = t.id AND a.user_id = $1 WHERE t.list = 'now')
        SELECT (SELECT ends FROM bounds) AS ends,
          (SELECT count(*)::int FROM mine, bounds WHERE mine.created_at < bounds.ends AND (NOT mine.done OR mine.done_at >= bounds.ends)) AS open,
          (SELECT count(*)::int FROM mine, bounds WHERE mine.done AND mine.done_at >= bounds.starts AND mine.done_at < bounds.ends) AS completed`,
      [userId, day, tz]);
      const points = state.open > 0 && state.completed === 0 ? SCORE.afkPoints : 0;
      const { rowCount } = await db.query(`INSERT INTO afk_days (user_id, day, points, applied_at) VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING`, [userId, day, points, state.ends]);
      if (rowCount && points) applied.push({ userId, day, points, open: state.open });
    }
  }
  return applied;
}

// Consecutive penalized days ending with `day`.
async function streak(db, userId, day) {
  const { rows } = await db.query("SELECT to_char(day, 'YYYY-MM-DD') AS day, points FROM afk_days WHERE user_id = $1 AND day <= $2 ORDER BY day DESC LIMIT 60", [userId, day]);
  let count = 0;
  for (const [i, row] of rows.entries()) { if (row.day !== addDays(day, -i) || !row.points) break; count++; }
  return count;
}

export function composeAfkEmail({ penalized, recipient, day, points, open, streakDays, scores, people }) {
  const you = recipient.id === penalized.id;
  const base = process.env.PUBLIC_WEB_URL?.replace(/\/+$/, '') || '';
  const who = you ? 'You' : penalized.display_name;
  const subject = you ? `AFK penalty applied: −${points} good boy points` : `${penalized.display_name} got an AFK penalty (−${points})`;
  const reason = `${who} completed no tasks on ${pretty(day)} while ${you ? 'you' : 'they'} had ${open} open task${open === 1 ? '' : 's'}, so ${points} points were taken.`;
  const streakLine = streakDays > 1 ? `That's ${streakDays} AFK days in a row.` : '';
  const nudge = you ? 'Complete a task today to avoid another one.' : '';
  const rows = people.map((person) => `${person.display_name}${person.id === recipient.id ? ' (you)' : ''}: ${scores[person.id]} · ${labelFor(scores[person.id])}`);
  const text = [`Hi ${recipient.display_name},`, '', reason, ...[streakLine, nudge].filter(Boolean), '', 'Good boy score', ...rows.map((row) => `  ${row}`),
    ...(base ? ['', `${base}/my`] : []), '', 'You get these because email notifications are on in todoer Settings.'].join('\n');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2328;max-width:560px">
<p>Hi ${escape(recipient.display_name)},</p>
<div style="margin:16px 0;padding:12px 16px;border:1px solid #fecaca;border-radius:12px;background:#fef2f2">
<div style="font-weight:700;color:#b91c1c;margin-bottom:6px">AFK penalty: −${points}</div>
<div>${escape(reason)}</div>${streakLine ? `<div style="margin-top:4px">${escape(streakLine)}</div>` : ''}${nudge ? `<div style="margin-top:4px;font-weight:600">${escape(nudge)}</div>` : ''}
</div>
<div style="margin:16px 0;padding:12px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb">
<div style="font-weight:600;margin-bottom:6px">Good boy score</div>
${people.map((person) => `<div style="color:#4b5563">${escape(person.display_name)}${person.id === recipient.id ? ' (you)' : ''}: <strong style="color:#1f2328">${scores[person.id]}</strong> · ${escape(labelFor(scores[person.id]))}</div>`).join('\n')}
${base ? `<div style="margin-top:8px"><a href="${escape(base)}/my" style="color:#1f2328">Open todoer</a></div>` : ''}
</div>
<p style="color:#9ca3af;font-size:12px">You get these because email notifications are on in todoer Settings.</p>
</div>`;
  return { subject, text, html };
}

// Email both people about recent penalties not yet announced. Retries on later ticks if a send fails.
export async function sendAfkEmails({ send = sendEmail, now = new Date(), db = pool } = {}) {
  if (!notificationsConfigured()) return 0;
  const { rows: pending } = await db.query(`SELECT user_id AS "userId", to_char(day, 'YYYY-MM-DD') AS day, points FROM afk_days
    WHERE points > 0 AND NOT emailed AND day >= $1::date ORDER BY day, user_id`, [addDays(dateFromToday(0, now), -3)]);
  if (!pending.length) return 0;
  const { rows: people } = await db.query('SELECT id, display_name, email, email_notifications FROM users ORDER BY created_at, id');
  const scores = await scoreSnapshot(db, now);
  let sent = 0;
  for (const penalty of pending) {
    const penalized = people.find((person) => person.id === penalty.userId);
    const { rows: [{ open }] } = await db.query(`SELECT count(*)::int AS open FROM tasks t JOIN task_assignees a ON a.task_id = t.id AND a.user_id = $1
      WHERE t.list = 'now' AND t.created_at < ($2::date + 1)::timestamp AT TIME ZONE $3 AND (NOT t.done OR t.done_at >= ($2::date + 1)::timestamp AT TIME ZONE $3)`,
    [penalty.userId, penalty.day, scoreTimezone()]);
    const streakDays = await streak(db, penalty.userId, penalty.day);
    let ok = true;
    for (const recipient of people) {
      if (!recipient.email || !recipient.email_notifications) continue;
      try {
        await send({ to: recipient.email, idempotencyKey: `todoer-afk-${penalty.userId}-${penalty.day}-${recipient.id}`,
          ...composeAfkEmail({ penalized, recipient, day: penalty.day, points: penalty.points, open, streakDays, scores, people }) });
        sent++;
      } catch (error) {
        ok = false;
        console.error(`AFK email to user ${recipient.id} failed: ${error.message}`);
      }
    }
    if (ok) await db.query('UPDATE afk_days SET emailed = true WHERE user_id = $1 AND day = $2', [penalty.userId, penalty.day]);
  }
  return sent;
}

export function startAfkWorker(intervalMs = 60 * 1000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await applyAfkPenalties();
      await sendAfkEmails();
    } catch (error) { console.error(`AFK worker: ${error.message}`); }
    finally { running = false; }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
