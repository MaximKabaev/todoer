import { pool } from '../db.js';

// "Good boy" score: a 0-100 rating of how well each person handles the tasks assigned to them.
// It is derived on the fly from the tasks table (no stored state), so reopening a task, editing a
// due date or tuning the constants below always yields a consistent result.
//
// Each scored task yields one graded event; events are folded chronologically into a running
// weighted average that starts at a neutral prior. The score only moves when its owner has task
// events, so someone with nothing assigned keeps exactly the score they had.
export const SCORE = {
  priorScore: 50,
  priorWeight: 5, // the neutral start counts as this many tasks, so one task can't swing a new score
  maxWeight: 15, // memory of the running average, in task-weights
  defaultDays: 7, // default due date offset, and the fallback deadline for tasks without a date
  quickMs: 10 * 60 * 1000, // tasks created and finished this fast barely count
  quickFactor: 0.25,
  trendDays: 7,
  afkPoints: 5, // taken at the end of each day with open tasks and no completion
  resetKeep: 0.5, // at a season boundary, keep this share of the distance from the prior score
};
const DAY = 24 * 60 * 60 * 1000;

// Label tiers, best first.
export const labels = [
  [100, 'Perfect boy'], [90, 'Best boy ever'], [75, 'Very good boy'], [60, 'Good boy'], [45, 'Doing okay'], [30, 'Naughty'], [0, 'Bad boy'],
];
export const labelFor = (score) => labels.find(([min]) => score >= min)[1];

export const scoreTimezone = () => process.env.SCORE_TIMEZONE || 'UTC';

// Calendar date (YYYY-MM-DD) `offset` days from today in the score timezone.
export function dateFromToday(offset = 0, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: scoreTimezone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const zoneFormats = new Map();
const zoneFormat = (tz) => {
  if (!zoneFormats.has(tz)) {
    zoneFormats.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }));
  }
  return zoneFormats.get(tz);
};
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Local calendar parts of an instant in the score timezone: { day: 'YYYY-MM-DD', hour, weekday (0 = Monday) }.
export function localParts(instant, tz = scoreTimezone()) {
  const parts = Object.fromEntries(zoneFormat(tz).formatToParts(instant).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: weekdays.indexOf(parts.weekday),
    offset: Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(instant.getTime() / 1000) * 1000 };
}

const midnights = new Map();
// The instant local midnight starts `day` (YYYY-MM-DD) in the score timezone.
export function startOfDay(day, tz = scoreTimezone()) {
  const key = `${tz}|${day}`;
  if (!midnights.has(key)) {
    const naive = Date.parse(`${day}T00:00:00Z`);
    let time = naive - localParts(new Date(naive), tz).offset;
    time = naive - localParts(new Date(time), tz).offset;
    midnights.set(key, new Date(time));
  }
  return midnights.get(key);
}
export const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const addMonths = (day, n) => { const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

// Seasons: calendar months in the score timezone. SEASONS_START is the first reset (the 1st of a
// month); the month before it is Season 1, which carries all earlier history.
export const seasonsStart = () => `${(process.env.SEASONS_START || '2026-12-01').slice(0, 7)}-01`;
// Season boundaries (the 1st of each month from SEASONS_START) that have started by `until`: [{ day, at }].
export function seasonBoundaries(until = new Date()) {
  const boundaries = [];
  for (let day = seasonsStart(); startOfDay(day) <= until; day = addMonths(day, 1)) boundaries.push({ day, at: startOfDay(day) });
  return boundaries;
}
// Describe the season that runs during the month starting `month` (YYYY-MM-01).
export function describeSeason(month) {
  const first = addMonths(seasonsStart(), -1);
  const [fy, fm] = first.split('-').map(Number);
  const [y, m] = month.split('-').map(Number);
  return {
    id: month.slice(0, 7),
    number: (y - fy) * 12 + (m - fm) + 1,
    name: new Date(`${month}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    startsAt: startOfDay(month),
    endsAt: startOfDay(addMonths(month, 1)),
  };
}
// The season in progress at `now` (never before Season 1).
export function currentSeason(now = new Date()) {
  const month = `${dateFromToday(0, now).slice(0, 7)}-01`;
  const first = addMonths(seasonsStart(), -1);
  return describeSeason(month < first ? first : month);
}

// Done late grades 90 minus 10 per late day (floor 30); still open and overdue grades 60 minus
// 10 per overdue day (floor 0), so finishing an overdue task is always an improvement.
export const gradeDone = (lateDays) => (lateDays <= 0 ? 100 : Math.max(30, 90 - 10 * lateDays));
export const gradeOpen = (lateDays) => Math.max(0, 60 - 10 * lateDays);
const lateDaysAt = (time, deadline) => (time <= deadline ? 0 : Math.ceil((time - deadline) / DAY));

// Fold events [{ time, grade, weight, key }] into a 0-100 integer score. AFK penalty events
// ({ time, penalty, key }) subtract points directly, floored at 0. Season resets ({ time, reset, key })
// pull the score part of the way back to the prior and restore the prior's memory; at the same
// instant they come after everything else (the last day's AFK penalty still counts for the old season).
export function foldScore(events) {
  let weightSum = SCORE.priorWeight;
  let score = SCORE.priorScore;
  const order = (a, b) => a.time - b.time || (a.reset ? 1 : 0) - (b.reset ? 1 : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  for (const event of [...events].sort(order)) {
    if (event.reset) {
      score = SCORE.priorScore + (score - SCORE.priorScore) * SCORE.resetKeep;
      weightSum = SCORE.priorWeight;
      continue;
    }
    if (event.penalty) { score = Math.max(0, score - event.penalty); continue; }
    if (event.weight <= 0) continue;
    weightSum = Math.min(weightSum + event.weight, SCORE.maxWeight);
    score += (event.weight / weightSum) * (event.grade - score);
  }
  return Math.round(score);
}

// Rows are one per (task, assignee) with the task's deadline already resolved.
// `asOf` replays history: later-created tasks are ignored and later completions count as open.
// A season reset applies strictly after its boundary, so the score as of a boundary is the
// season's final score.
export function scoreFor(rows, userId, asOf = new Date()) {
  const events = seasonBoundaries(asOf).filter(({ at }) => at < asOf).map(({ day, at }) => ({ key: `reset:${day}`, time: at, reset: true }));
  for (const row of rows) {
    if (row.userId !== userId) continue;
    if (row.kind === 'afk') {
      if (row.at <= asOf) events.push({ key: row.id, time: row.at, penalty: row.points });
      continue;
    }
    if (row.createdAt > asOf) continue;
    const done = row.done && row.doneAt <= asOf;
    let weight = (1 + 0.5 * row.priority) * (row.empty ? 0 : 1);
    if (done) {
      if (row.doneAt - row.createdAt < SCORE.quickMs) weight *= SCORE.quickFactor;
      events.push({ key: row.id, time: row.doneAt, weight, grade: gradeDone(lateDaysAt(row.doneAt, row.deadline)) });
    } else if (asOf > row.deadline) {
      events.push({ key: row.id, time: asOf, weight, grade: gradeOpen(lateDaysAt(asOf, row.deadline)) });
    }
  }
  return foldScore(events);
}

// Every task that is in Now and assigned, with its deadline: the start of the day after its due
// date (or after created + 7 days when it has none), in the score timezone. Unless filtered to one
// task, AFK penalties are appended as { kind: 'afk', userId, at, points } rows.
export async function loadScoreRows(db = pool, taskId = null) {
  const { rows } = await db.query(`SELECT t.id, a.user_id AS "userId", t.done, t.done_at AS "doneAt", t.created_at AS "createdAt",
    t.priority, (btrim(t.title) = '' AND btrim(t.notes) = '') AS empty,
    ((COALESCE(t.due_date, (t.created_at AT TIME ZONE $1)::date + ${SCORE.defaultDays}) + 1)::timestamp AT TIME ZONE $1) AS deadline
    FROM tasks t JOIN task_assignees a ON a.task_id = t.id WHERE t.list = 'now' AND ($2::uuid IS NULL OR t.id = $2)`, [scoreTimezone(), taskId]);
  if (taskId) return rows;
  const { rows: penalties } = await db.query(`SELECT 'afk' AS kind, 'afk:' || user_id || ':' || day AS id, user_id AS "userId",
    applied_at AS at, points FROM afk_days WHERE points > 0`);
  return [...rows, ...penalties];
}

// { [userId]: score } right now; used to report score changes in emails.
export async function scoreSnapshot(db = pool, now = new Date()) {
  const [rows, { rows: users }] = await Promise.all([loadScoreRows(db), db.query('SELECT id FROM users')]);
  return Object.fromEntries(users.map((user) => [user.id, scoreFor(rows, user.id, now)]));
}

// The scoreboard for GET /api/score, from the requesting user's point of view.
export async function scoreboard(db, user, teammate, now = new Date()) {
  const [rows, { rows: users }] = await Promise.all([
    loadScoreRows(db), db.query('SELECT id, username, display_name AS "displayName", color FROM users')]);
  const weekAgo = new Date(now.getTime() - SCORE.trendDays * DAY);
  // The trend never reaches back past the current season's reset.
  const lastReset = seasonBoundaries(now).filter(({ at }) => at < now).at(-1)?.at;
  const trendFrom = lastReset && lastReset > weekAgo ? new Date(lastReset.getTime() + 1) : weekAgo;
  const entry = (person) => {
    if (!person) return null;
    const score = scoreFor(rows, person.id, now);
    const mine = rows.filter((row) => row.userId === person.id && row.kind !== 'afk');
    const penalties = rows.filter((row) => row.userId === person.id && row.kind === 'afk' && row.at <= now);
    return {
      user: users.find((candidate) => candidate.id === person.id),
      score,
      label: labelFor(score),
      trend: score - scoreFor(rows, person.id, trendFrom),
      doneThisWeek: mine.filter((row) => row.done && row.doneAt > weekAgo && row.doneAt <= now).length,
      overdue: mine.filter((row) => !row.done && row.deadline < now).length,
      afkPenaltyThisWeek: penalties.filter((row) => row.at > weekAgo).reduce((sum, row) => sum + row.points, 0),
    };
  };
  const me = entry(user);
  const other = entry(teammate);
  const diff = other ? me.score - other.score : 0;
  return { me, teammate: other, leader: diff > 0 ? 'me' : diff < 0 ? 'teammate' : null, lead: Math.abs(diff) };
}

// Isolate this task's contribution from unrelated concurrent task edits.
export function taskScoreChange(previousTaskRows, currentRows, taskId, userId, asOf = new Date()) {
  const beforeRows = [...currentRows.filter((row) => row.id !== taskId), ...previousTaskRows];
  const before = scoreFor(beforeRows, userId, asOf);
  const after = scoreFor(currentRows, userId, asOf);
  return { before, after, delta: after - before };
}
