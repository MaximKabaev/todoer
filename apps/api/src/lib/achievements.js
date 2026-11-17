import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pool } from '../db.js';
import { addDays, dateFromToday, loadScoreRows, localParts, scoreFor, startOfDay } from './score.js';
import { notificationsConfigured, sendEmail } from './notifications.js';

// Achievements: derived from the same data as the score and Stats (assigned Now tasks, AFK days,
// GitHub events, frozen seasons), then stored the first time they are earned (with the derived
// moment they were earned), so later task edits or a season reset never take one away.
// "Completed" means what Stats means: assigned Now tasks the person completed, empty ones excluded.
export const ACHIEVEMENTS = [
  { id: 'score-80', category: 'score', title: 'Good Boy', description: 'Reach a score of 80', target: 80 },
  { id: 'score-90', category: 'score', title: 'Very Good Boy', description: 'Reach a score of 90', target: 90 },
  { id: 'score-95', category: 'score', title: 'Elite Boy', description: 'Reach a score of 95', target: 95 },
  { id: 'score-100', category: 'score', title: 'Perfect Boy', description: 'Reach a perfect score of 100', target: 100 },
  { id: 'streak-7', category: 'streak', title: 'On a Roll', description: 'Be active 7 days in a row', target: 7 },
  { id: 'streak-30', category: 'streak', title: 'Unstoppable', description: 'Be active 30 days in a row', target: 30 },
  { id: 'first-bone', category: 'volume', title: 'First Bone', description: 'Complete your first task', target: 1 },
  { id: 'century', category: 'volume', title: 'Century', description: 'Complete 100 tasks', target: 100 },
  { id: 'thousand-club', category: 'volume', title: 'Thousand Club', description: 'Complete 1,000 tasks', target: 1000 },
  { id: 'zoomies', category: 'volume', title: 'Zoomies', description: 'Complete 10 tasks in one day', target: 10 },
  { id: 'clockwork', category: 'punctuality', title: 'Clockwork', description: 'Complete 20 tasks in a row on time', target: 20 },
  { id: 'clean-slate', category: 'punctuality', title: 'Clean Slate', description: '7 days in a row with tasks assigned and none overdue', target: 7 },
  { id: 'season-champion', category: 'competition', title: 'Season Champion', description: 'Win a season', target: 1 },
  { id: 'dynasty', category: 'competition', title: 'Dynasty', description: 'Win 3 seasons in a row', target: 3 },
  { id: 'comeback-kid', category: 'competition', title: 'Comeback Kid', description: 'Win a season after trailing by 15+ points at the end of a day in it', target: null },
  { id: 'top-dog', category: 'competition', title: 'Top Dog', description: 'Win a season leading at the end of every one of its days', target: null },
  { id: 'redemption-arc', category: 'fun', title: 'Redemption Arc', description: 'Climb from under 45 back up to 80', target: null },
  { id: 'night-owl', category: 'fun', title: 'Night Owl', description: 'Complete a task between midnight and 5am', target: null },
  { id: 'early-bird', category: 'fun', title: 'Early Bird', description: 'Complete a task between 5am and 7am', target: null },
  { id: 'weekend-warrior', category: 'fun', title: 'Weekend Warrior', description: 'Complete 5 tasks in one weekend', target: 5 },
  { id: 'delegator', category: 'fun', title: 'Delegator', description: 'Assign 25 tasks you created to your teammate', target: 25 },
  { id: 'shipper', category: 'fun', title: 'Shipper', description: 'Merge 10 pull requests', target: 10 },
];
const byId = new Map(ACHIEVEMENTS.map((entry) => [entry.id, entry]));
const DAY = 24 * 60 * 60 * 1000;
const EMAIL_WINDOW = 3 * DAY; // unlocks older than this when first recorded (backfill) are never emailed

// Progress toward a counted goal: { current (capped at target), target }.
const progress = (current, target) => ({ current: Math.min(current, target), target });
const nth = (list, n) => list[n - 1] ?? null;

// End-of-day instants for each day of a finished season: [{ day, end }]; the last one is the boundary.
function seasonDays(season) {
  const days = [];
  for (let day = localParts(season.startsAt).day; ; day = addDays(day, 1)) {
    const end = startOfDay(addDays(day, 1));
    if (end > season.endsAt) break;
    days.push({ day, end });
  }
  return days;
}

// Everything one person has earned, as of `now`: { [id]: { unlockedAt: Date | null, progress } }.
export function deriveFor({ person, other, rows, github, delegated, seasons, now }) {
  const result = {};
  const set = (id, unlockedAt, current = null) => {
    const { target } = byId.get(id);
    result[id] = {
      unlockedAt: unlockedAt && unlockedAt <= now ? unlockedAt : null,
      progress: target === null || current === null ? null : progress(unlockedAt ? target : current, target),
    };
  };
  const own = rows.filter((row) => row.userId === person.id);
  const tasks = own.filter((row) => row.kind !== 'afk' && row.createdAt <= now);
  const done = tasks.filter((row) => row.done && row.doneAt <= now && !row.empty)
    .map((row) => ({ ...row, local: localParts(row.doneAt) }))
    .sort((a, b) => a.doneAt - b.doneAt);

  // Score milestones and the redemption arc: the score after every completion, every AFK penalty and
  // at the end of every day (when open overdue tasks drag it down), plus right now.
  const instants = new Set([now.getTime(), ...done.map((row) => row.doneAt.getTime()),
    ...own.filter((row) => row.kind === 'afk' && row.at <= now).map((row) => row.at.getTime())]);
  if (tasks.length) {
    const today = dateFromToday(0, now);
    for (let day = localParts(new Date(Math.min(...tasks.map((row) => row.createdAt.getTime())))).day; day < today; day = addDays(day, 1)) {
      instants.add(startOfDay(addDays(day, 1)).getTime());
    }
  }
  const reached = new Map();
  let peak = 0;
  let low = false;
  let redemption = null;
  for (const time of [...instants].sort((a, b) => a - b)) {
    const at = new Date(time);
    const score = scoreFor(own, person.id, at);
    peak = Math.max(peak, score);
    for (const target of [80, 90, 95, 100]) if (score >= target && !reached.has(target)) reached.set(target, at);
    if (score < 45) low = true;
    else if (low && score >= 80 && !redemption) redemption = at;
  }
  for (const target of [80, 90, 95, 100]) set(`score-${target}`, reached.get(target) ?? null, peak);
  set('redemption-arc', redemption);

  // Active-day streaks (the AFK definition: a completion, pushed commits or a merged PR). The streak
  // is earned at the first activity of its last day.
  const firstActivity = new Map();
  const touch = (at) => { const { day } = localParts(at); if (!firstActivity.has(day) || at < firstActivity.get(day)) firstActivity.set(day, at); };
  for (const row of done) touch(row.doneAt);
  for (const event of github) if (event.at <= now && (event.kind === 'merge' || event.commits > 0)) touch(event.at);
  let run = 0;
  let longest = 0;
  let previous = null;
  const streakAt = {};
  for (const day of [...firstActivity.keys()].sort()) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
    for (const target of [7, 30]) if (run === target && !streakAt[target]) streakAt[target] = firstActivity.get(day);
  }
  set('streak-7', streakAt[7] ?? null, longest);
  set('streak-30', streakAt[30] ?? null, longest);

  // Completion counts.
  set('first-bone', nth(done, 1)?.doneAt ?? null, done.length);
  set('century', nth(done, 100)?.doneAt ?? null, done.length);
  set('thousand-club', nth(done, 1000)?.doneAt ?? null, done.length);
  const perDay = new Map();
  let zoomies = null;
  for (const row of done) {
    const count = (perDay.get(row.local.day) ?? 0) + 1;
    perDay.set(row.local.day, count);
    if (count === 10 && !zoomies) zoomies = row.doneAt;
  }
  set('zoomies', zoomies, Math.max(0, ...perDay.values()));

  // Punctuality: a run of on-time completions, and a week of days with no overdue task.
  let onTimeRun = 0;
  let bestOnTime = 0;
  let clockwork = null;
  for (const row of done) {
    onTimeRun = row.doneAt <= row.deadline ? onTimeRun + 1 : 0;
    bestOnTime = Math.max(bestOnTime, onTimeRun);
    if (onTimeRun === 20 && !clockwork) clockwork = row.doneAt;
  }
  set('clockwork', clockwork, bestOnTime);
  // A clean day: something assigned (open at some point that day) and nothing overdue: no task still
  // open past its deadline at the end of the day and none completed late during it. Finished days only.
  const scored = tasks.filter((row) => !row.empty);
  let cleanRun = 0;
  let bestClean = 0;
  let cleanSlate = null;
  if (scored.length) {
    const today = dateFromToday(0, now);
    for (let day = localParts(new Date(Math.min(...scored.map((row) => row.createdAt.getTime())))).day; day < today; day = addDays(day, 1)) {
      const start = startOfDay(day);
      const end = startOfDay(addDays(day, 1));
      const doneBy = (row, at) => row.done && row.doneAt < at;
      const live = scored.filter((row) => row.createdAt < end && !doneBy(row, start));
      const overdue = live.some((row) => (!doneBy(row, end) && row.deadline < end) || (doneBy(row, end) && row.doneAt > row.deadline));
      cleanRun = live.length && !overdue ? cleanRun + 1 : 0;
      bestClean = Math.max(bestClean, cleanRun);
      if (cleanRun === 7 && !cleanSlate) cleanSlate = end;
    }
  }
  set('clean-slate', cleanSlate, bestClean);

  // Seasons (frozen results, oldest first).
  const finished = seasons.filter((season) => season.endsAt <= now).sort((a, b) => a.endsAt - b.endsAt);
  const won = finished.filter((season) => season.winnerId === person.id);
  set('season-champion', won[0]?.endsAt ?? null, won.length);
  let winRun = 0;
  let bestWinRun = 0;
  let dynasty = null;
  let lastNumber = null;
  for (const season of finished) {
    winRun = season.winnerId === person.id ? (lastNumber !== null && season.number === lastNumber + 1 ? winRun + 1 : 1) : 0;
    lastNumber = season.number;
    bestWinRun = Math.max(bestWinRun, winRun);
    if (winRun === 3 && !dynasty) dynasty = season.endsAt;
  }
  set('dynasty', dynasty, bestWinRun);
  let comeback = null;
  let topDog = null;
  if (other) {
    for (const season of won) {
      const days = seasonDays(season).map(({ end }) => [scoreFor(rows, person.id, end), scoreFor(rows, other.id, end)]);
      if (!comeback && days.some(([mine, theirs]) => theirs - mine >= 15)) comeback = season.endsAt;
      if (!topDog && days.length && days.every(([mine, theirs]) => mine > theirs)) topDog = season.endsAt;
    }
  }
  set('comeback-kid', comeback);
  set('top-dog', topDog);

  // Time of day and weekends (SCORE_TIMEZONE).
  set('night-owl', done.find((row) => row.local.hour < 5)?.doneAt ?? null);
  set('early-bird', done.find((row) => row.local.hour >= 5 && row.local.hour < 7)?.doneAt ?? null);
  const weekends = new Map();
  let warrior = null;
  for (const row of done) {
    if (row.local.weekday < 5) continue;
    const saturday = row.local.weekday === 6 ? addDays(row.local.day, -1) : row.local.day;
    const count = (weekends.get(saturday) ?? 0) + 1;
    weekends.set(saturday, count);
    if (count === 5 && !warrior) warrior = row.doneAt;
  }
  set('weekend-warrior', warrior, Math.max(0, ...weekends.values()));

  const handed = delegated.filter((at) => at <= now);
  set('delegator', nth(handed, 25) ?? null, handed.length);
  const merges = github.filter((event) => event.kind === 'merge' && event.at <= now).map((event) => event.at);
  set('shipper', nth(merges, 10) ?? null, merges.length);
  return result;
}

// Derive every person's achievements: { [userId]: { [id]: { unlockedAt, progress } } }.
export async function deriveAchievements(db, now = new Date(), rows = null) {
  const [scoreRows, { rows: users }, { rows: events }, { rows: seasonRows }] = await Promise.all([
    rows ?? loadScoreRows(db),
    db.query('SELECT id FROM users ORDER BY created_at, id'),
    db.query(`SELECT u.id AS "userId", e.kind, e.commits, e.at FROM github_events e
      JOIN users u ON lower(u.github_login) = lower(e.github_login) ORDER BY e.at`),
    db.query('SELECT id, number, starts_at AS "startsAt", ends_at AS "endsAt", winner_id AS "winnerId" FROM seasons ORDER BY ends_at'),
  ]);
  const derived = {};
  for (const person of users) {
    const other = users.find((candidate) => candidate.id !== person.id) ?? null;
    // Tasks this person created that are assigned only to the other person, in creation order.
    const { rows: delegated } = other ? await db.query(`SELECT t.created_at AS at FROM tasks t WHERE t.created_by = $1
        AND EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = $2)
        AND NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id <> $2) ORDER BY t.created_at`, [person.id, other.id])
      : { rows: [] };
    derived[person.id] = deriveFor({
      person, other, rows: scoreRows, now, seasons: seasonRows,
      github: events.filter((event) => event.userId === person.id),
      delegated: delegated.map((row) => row.at),
    });
  }
  return derived;
}

// Record newly earned achievements (idempotent). Ones earned more than EMAIL_WINDOW before they are
// first recorded (the initial backfill, or after long downtime) are stored as already announced.
// Returns { derived, stored: { [userId]: { [id]: Date } }, created: [{ userId, id, unlockedAt }] }.
export async function syncAchievements(db = pool, now = new Date(), rows = null) {
  const derived = await deriveAchievements(db, now, rows);
  const { rows: existing } = await db.query('SELECT user_id AS "userId", id, unlocked_at AS "unlockedAt" FROM achievements');
  const stored = {};
  for (const row of existing) (stored[row.userId] ??= {})[row.id] = row.unlockedAt;
  const created = [];
  for (const [userId, entries] of Object.entries(derived)) {
    for (const [id, { unlockedAt }] of Object.entries(entries)) {
      if (!unlockedAt || stored[userId]?.[id]) continue;
      const { rowCount } = await db.query(`INSERT INTO achievements (user_id, id, unlocked_at, emailed) VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING`, [userId, id, unlockedAt, unlockedAt < new Date(now.getTime() - EMAIL_WINDOW)]);
      if (rowCount) {
        (stored[userId] ??= {})[id] = unlockedAt;
        created.push({ userId, id, unlockedAt });
      }
    }
  }
  return { derived, stored, created };
}

// The catalog with both people's state, from the viewer's point of view, for GET /api/stats:
// [{ id, category, title, description, target, me: State, teammate: State | null }],
// State = { unlocked, unlockedAt, progress: { current, target } | null }.
export async function achievementsView(db, user, teammate, now = new Date(), rows = null) {
  const { derived, stored } = await syncAchievements(db, now, rows);
  const state = (person, id) => {
    if (!person) return null;
    const unlockedAt = stored[person.id]?.[id] ?? null;
    const live = derived[person.id]?.[id];
    const target = byId.get(id).target;
    return {
      unlocked: Boolean(unlockedAt), unlockedAt,
      progress: target === null ? null : unlockedAt ? progress(target, target) : live?.progress ?? progress(0, target),
    };
  };
  return ACHIEVEMENTS.map((entry) => ({ ...entry, me: state(user, entry.id), teammate: state(teammate, entry.id) }));
}

// Badge art served by the web app (apps/web/public/achievements/<id>.png), attached to unlock emails
// as inline images. A missing file just leaves the badge out of the email.
const artDir = new URL('../../../web/public/achievements/', import.meta.url);
export function achievementArt(id) {
  try {
    return { filename: `${id}.png`, content: readFileSync(new URL(`${id}.png`, artDir)).toString('base64'), content_id: `achievement-${id}` };
  } catch {
    return null;
  }
}

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// One email per recipient covering every new unlock (theirs and their teammate's).
// `art` = the ids that have an inline image attached (see achievementArt).
export function composeAchievementEmail({ recipient, people, unlocks, art = new Set() }) {
  const base = process.env.PUBLIC_WEB_URL?.replace(/\/+$/, '') || '';
  const name = (userId) => (userId === recipient.id ? 'You' : people.find((person) => person.id === userId)?.display_name ?? 'Someone');
  const lines = unlocks.map((unlock) => ({ who: name(unlock.userId), ...byId.get(unlock.id) }));
  const mine = lines.filter((line) => line.who === 'You');
  const subject = unlocks.length === 1
    ? `${lines[0].who === 'You' ? 'You' : lines[0].who} unlocked “${lines[0].title}”${lines[0].who === 'You' ? '!' : ''}`
    : mine.length === unlocks.length ? `You unlocked ${unlocks.length} achievements!` : `${unlocks.length} new achievements unlocked`;
  const text = [`Hi ${recipient.display_name},`, '', 'Achievement unlocked:', ...lines.map((line) => `  ${line.who}: ${line.title} (${line.description})`),
    ...(base ? ['', `${base}/stats`] : []), '', 'You get these because email notifications are on in todoer Settings.'].join('\n');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2328;max-width:560px">
<p>Hi ${escape(recipient.display_name)},</p>
<div style="margin:16px 0;padding:12px 16px;border:1px solid #c7d2fe;border-radius:12px;background:#eef2ff">
<div style="font-weight:700;color:#3730a3;margin-bottom:6px">🏅 Achievement${unlocks.length === 1 ? '' : 's'} unlocked</div>
${lines.map((line) => `<table role="presentation" style="margin-top:8px;border-collapse:collapse"><tr>
${art.has(line.id) ? `<td style="padding:0 12px 0 0;vertical-align:middle"><img src="cid:achievement-${escape(line.id)}" width="64" height="64" alt="${escape(line.title)} badge" style="display:block;image-rendering:pixelated"></td>` : ''}
<td style="vertical-align:middle"><strong>${escape(line.title)}</strong> · ${escape(line.who)}<div style="color:#4b5563">${escape(line.description)}</div></td>
</tr></table>`).join('\n')}
${base ? `<div style="margin-top:8px"><a href="${escape(base)}/stats" style="color:#1f2328">See all achievements</a></div>` : ''}
</div>
<p style="color:#9ca3af;font-size:12px">You get these because email notifications are on in todoer Settings.</p>
</div>`;
  return { subject, text, html };
}

// Email both people about unlocks not yet announced; retries on later ticks if a send fails.
export async function sendAchievementEmails({ send = sendEmail, now = new Date(), db = pool } = {}) {
  if (!notificationsConfigured()) return 0;
  const { rows: pending } = await db.query(`SELECT user_id AS "userId", id, unlocked_at AS "unlockedAt" FROM achievements
    WHERE NOT emailed ORDER BY unlocked_at, user_id, id`);
  if (!pending.length) return 0;
  const { rows: people } = await db.query('SELECT id, display_name, email, email_notifications FROM users ORDER BY created_at, id');
  const attachments = [...new Set(pending.map((row) => row.id))].map(achievementArt).filter(Boolean);
  const art = new Set(attachments.map((file) => file.filename.replace(/\.png$/, '')));
  const key = createHash('sha256').update(pending.map((row) => `${row.userId}:${row.id}`).join(',')).digest('hex').slice(0, 24);
  let sent = 0;
  let ok = true;
  for (const recipient of people) {
    if (!recipient.email || !recipient.email_notifications) continue;
    try {
      await send({ to: recipient.email, idempotencyKey: `todoer-achievement-${key}-${recipient.id}`, ...composeAchievementEmail({ recipient, people, unlocks: pending, art }), attachments });
      sent++;
    } catch (error) {
      ok = false;
      console.error(`Achievement email to user ${recipient.id} failed: ${error.message}`);
    }
  }
  if (ok) {
    await db.query('UPDATE achievements SET emailed = true WHERE (user_id, id) IN (SELECT * FROM unnest($1::uuid[], $2::text[]))',
      [pending.map((row) => row.userId), pending.map((row) => row.id)]);
  }
  return sent;
}

