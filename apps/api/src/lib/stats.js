import { addDays, dateFromToday, labelFor, loadScoreRows, localParts, scoreFor, scoreTimezone, startOfDay } from './score.js';
import { seasonView } from './seasons.js';
import { achievementsView } from './achievements.js';

// GET /api/stats: everything the Stats page shows, from the viewer's point of view. Derived on the fly
// from tasks, AFK days and GitHub events (plus the frozen season results); not scoped by project.
// "Completed" means assigned Now tasks completed by that person, empty ones excluded: the tasks the score uses.
const HISTORY_DAYS = 365;
const ACTIVITY_DAYS = 182;

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  return (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2;
};

// End-of-day scores for both people, oldest first, from the first scored day (at most a year back) to today.
function scoreHistory(rows, ids, today, now) {
  const tasks = rows.filter((row) => row.kind !== 'afk' && ids.includes(row.userId));
  const first = tasks.length ? localParts(new Date(Math.min(...tasks.map((row) => row.createdAt.getTime())))).day : today;
  const floor = addDays(today, -(HISTORY_DAYS - 1));
  const history = [];
  for (let day = first < floor ? floor : first; day <= today; day = addDays(day, 1)) {
    const end = startOfDay(addDays(day, 1));
    const asOf = end < now ? end : now;
    history.push({ day, scores: ids.map((id) => scoreFor(rows, id, asOf)) });
  }
  return history;
}

async function personStats(db, { person, other, index, rows, history, season, today, now }) {
  const mine = rows.filter((row) => row.userId === person.id && row.kind !== 'afk');
  const done = mine.filter((row) => row.done && row.doneAt <= now && !row.empty).map((row) => ({ ...row, local: localParts(row.doneAt) }));
  const penalties = rows.filter((row) => row.userId === person.id && row.kind === 'afk' && row.at <= now);
  const { rows: github } = await db.query(`SELECT to_char((e.at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS day,
      coalesce(sum(e.commits) FILTER (WHERE e.kind = 'push'), 0)::int AS commits, (count(*) FILTER (WHERE e.kind = 'merge'))::int AS merges
    FROM github_events e JOIN users u ON lower(u.github_login) = lower(e.github_login) AND u.id = $1 GROUP BY 1`, [person.id, scoreTimezone()]);
  const { rows: [counts] } = await db.query(`SELECT
      (SELECT count(*)::int FROM tasks WHERE created_by = $1) AS created,
      (SELECT count(*)::int FROM tasks t WHERE t.created_by = $1 AND $2::uuid IS NOT NULL
        AND EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = $2)
        AND NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id <> $2)) AS "assignedToTeammate"`,
  [person.id, other?.id ?? null]);

  const perDay = new Map();
  const bump = (day, key, amount) => {
    const entry = perDay.get(day) ?? { completed: 0, commits: 0, merges: 0 };
    entry[key] += amount;
    perDay.set(day, entry);
  };
  for (const row of done) bump(row.local.day, 'completed', 1);
  for (const row of github) { bump(row.day, 'commits', row.commits); bump(row.day, 'merges', row.merges); }
  const active = (day) => { const entry = perDay.get(day); return Boolean(entry && (entry.completed || entry.commits || entry.merges)); };

  const seasonStart = season.startsAt;
  const seasonFirstDay = localParts(seasonStart).day;
  const totals = (from) => {
    const list = from ? done.filter((row) => row.doneAt >= from) : done;
    const onTime = list.filter((row) => row.doneAt <= row.deadline).length;
    const lost = from ? penalties.filter((row) => row.at > from) : penalties;
    const days = [...perDay.keys()].filter((day) => (!from || day >= seasonFirstDay) && active(day));
    const gh = github.filter((row) => !from || row.day >= seasonFirstDay);
    return {
      completed: list.length, onTime, onTimeRate: list.length ? onTime / list.length : null,
      afkDays: lost.length, afkPoints: lost.reduce((sum, row) => sum + row.points, 0),
      commits: gh.reduce((sum, row) => sum + row.commits, 0), merges: gh.reduce((sum, row) => sum + row.merges, 0),
      activeDays: days.length,
    };
  };

  // Streaks of consecutive active days. Today extends the current streak once it is active, but an
  // idle today doesn't break it yet.
  const activeDays = [...perDay.keys()].filter(active).sort();
  let best = 0;
  let run = 0;
  let previous = null;
  for (const day of activeDays) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  let current = 0;
  for (let day = active(today) ? today : addDays(today, -1); active(day); day = addDays(day, -1)) current++;

  const bestDay = [...perDay].filter(([, entry]) => entry.completed)
    .sort((a, b) => b[1].completed - a[1].completed || (a[0] < b[0] ? -1 : 1))[0];
  const series = history.map((entry) => ({ day: entry.day, score: entry.scores[index] }));
  const pick = (better) => series.reduce((acc, entry) => (!acc || better(entry.score, acc.score) ? entry : acc), null);
  const daysLed = other ? history.filter((entry) => entry.day >= seasonFirstDay && entry.day < today && entry.scores[index] > entry.scores[1 - index]).length : 0;
  const hours = median(done.map((row) => (row.doneAt - row.createdAt) / 3600000));
  const weekdays = Array(7).fill(0);
  const byHour = Array(24).fill(0);
  for (const row of done) { weekdays[row.local.weekday]++; byHour[row.local.hour]++; }
  const activity = [];
  for (let day = addDays(today, -(ACTIVITY_DAYS - 1)); day <= today; day = addDays(day, 1)) {
    activity.push({ day, ...(perDay.get(day) ?? { completed: 0, commits: 0, merges: 0 }) });
  }
  const score = scoreFor(rows, person.id, now);
  return {
    user: person, score, label: labelFor(score),
    open: mine.filter((row) => !row.done).length,
    overdue: mine.filter((row) => !row.done && row.deadline < now).length,
    best: pick((a, b) => a > b), worst: pick((a, b) => a < b),
    streak: { current, best },
    bestDay: bestDay ? { day: bestDay[0], completed: bestDay[1].completed } : null,
    season: { ...totals(seasonStart), daysLed },
    allTime: { ...totals(null), ...counts, medianHoursToDone: hours === null ? null : Math.round(hours * 10) / 10 },
    weekdays, hours: byHour, activity,
  };
}

export async function stats(db, user, teammate, now = new Date()) {
  const [rows, { rows: users }, seasons] = await Promise.all([
    loadScoreRows(db), db.query('SELECT id, username, display_name AS "displayName", color FROM users'), seasonView(db, user, teammate, now)]);
  const person = (id) => users.find((candidate) => candidate.id === id);
  const people = [person(user.id), teammate ? person(teammate.id) : null].filter(Boolean);
  const today = dateFromToday(0, now);
  const history = scoreHistory(rows, people.map((p) => p.id), today, now);
  const context = { rows, history, season: seasons.season, today, now };
  const [me, other] = await Promise.all(people.map((p, index) => personStats(db, { ...context, person: p, other: people[1 - index] ?? null, index })));
  const achievements = await achievementsView(db, user, teammate, now, rows);
  return {
    generatedAt: now, timezone: scoreTimezone(),
    season: seasons.season, seasons: seasons.seasons,
    history: history.map((entry) => ({ day: entry.day, me: entry.scores[0], teammate: entry.scores[1] ?? null })),
    me, teammate: other ?? null,
    achievements,
  };
}
