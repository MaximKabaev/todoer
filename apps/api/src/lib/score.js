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
};
const DAY = 24 * 60 * 60 * 1000;

// Label tiers, best first.
export const labels = [
  [90, 'Best boy ever'], [75, 'Very good boy'], [60, 'Good boy'], [45, 'Doing okay'], [30, 'Naughty'], [0, 'Bad boy'],
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

// Done late grades 90 minus 10 per late day (floor 30); still open and overdue grades 60 minus
// 10 per overdue day (floor 0), so finishing an overdue task is always an improvement.
export const gradeDone = (lateDays) => (lateDays <= 0 ? 100 : Math.max(30, 90 - 10 * lateDays));
export const gradeOpen = (lateDays) => Math.max(0, 60 - 10 * lateDays);
const lateDaysAt = (time, deadline) => (time <= deadline ? 0 : Math.ceil((time - deadline) / DAY));

// Fold events [{ time, grade, weight, key }] into a 0-100 integer score.
export function foldScore(events) {
  let weightSum = SCORE.priorWeight;
  let score = SCORE.priorScore;
  for (const event of [...events].sort((a, b) => a.time - b.time || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    if (event.weight <= 0) continue;
    weightSum = Math.min(weightSum + event.weight, SCORE.maxWeight);
    score += (event.weight / weightSum) * (event.grade - score);
  }
  return Math.round(score);
}

// Rows are one per (task, assignee) with the task's deadline already resolved.
// `asOf` replays history: later-created tasks are ignored and later completions count as open.
export function scoreFor(rows, userId, asOf = new Date()) {
  const events = [];
  for (const row of rows) {
    if (row.userId !== userId || row.createdAt > asOf) continue;
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
// date (or after created + 7 days when it has none), in the score timezone.
export async function loadScoreRows(db = pool) {
  const { rows } = await db.query(`SELECT t.id, a.user_id AS "userId", t.done, t.done_at AS "doneAt", t.created_at AS "createdAt",
    t.priority, (btrim(t.title) = '' AND btrim(t.notes) = '') AS empty,
    ((COALESCE(t.due_date, (t.created_at AT TIME ZONE $1)::date + ${SCORE.defaultDays}) + 1)::timestamp AT TIME ZONE $1) AS deadline
    FROM tasks t JOIN task_assignees a ON a.task_id = t.id WHERE t.list = 'now'`, [scoreTimezone()]);
  return rows;
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
  const entry = (person) => {
    if (!person) return null;
    const score = scoreFor(rows, person.id, now);
    const mine = rows.filter((row) => row.userId === person.id);
    return {
      user: users.find((candidate) => candidate.id === person.id),
      score,
      label: labelFor(score),
      trend: score - scoreFor(rows, person.id, weekAgo),
      doneThisWeek: mine.filter((row) => row.done && row.doneAt > weekAgo && row.doneAt <= now).length,
      overdue: mine.filter((row) => !row.done && row.deadline < now).length,
    };
  };
  const me = entry(user);
  const other = entry(teammate);
  const diff = other ? me.score - other.score : 0;
  return { me, teammate: other, leader: diff > 0 ? 'me' : diff < 0 ? 'teammate' : null, lead: Math.abs(diff) };
}
