// Mock implementation of seasons (GET /api/score `season`) and GET /api/stats. Dates use UTC.
// The mock has no AFK worker, GitHub events or soft resets: those numbers are always 0, and the two
// finished seasons before the current month are fixed sample results so the UI has a history to show.
import { deadline, scoreAt } from "./mock-score.mjs";

const DAY = 86400000;
const labelFor = (score) =>
  score >= 90 ? "Best boy ever" : score >= 75 ? "Very good boy" : score >= 60 ? "Good boy" : score >= 45 ? "Doing okay" : score >= 30 ? "Naughty" : "Bad boy";
const dayOf = (time) => new Date(time).toISOString().slice(0, 10);
const monthStart = (now, offset = 0) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1);
};
const monthName = (start) => new Date(start).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const carried = (score) => Math.round(50 + (score - 50) / 2);

// Sample finished seasons: [maxim, teammate] final scores, oldest first.
const SAMPLE = [[71, 64], [58, 77]];

function results(users, me, now) {
  return SAMPLE.map(([first, second], index) => {
    const startsAt = monthStart(now, index - SAMPLE.length);
    const endsAt = monthStart(now, index - SAMPLE.length + 1);
    const scores = new Map([[users[0].id, first], [users[1].id, second]]);
    const mine = scores.get(me.id);
    const theirs = [...scores].find(([id]) => id !== me.id)[1];
    const final = (score) => ({ score, label: labelFor(score), carriedOver: carried(score) });
    return {
      id: dayOf(startsAt).slice(0, 7), number: index + 1, name: monthName(startsAt),
      startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
      winner: mine > theirs ? "me" : mine < theirs ? "teammate" : null,
      me: final(mine), teammate: final(theirs),
    };
  }).reverse();
}

export function seasonFor(users, me, now = Date.now()) {
  const finished = results(users, me, now);
  const startsAt = monthStart(now);
  const endsAt = monthStart(now, 1);
  const count = (winner) => finished.filter((season) => season.winner === winner).length;
  return {
    id: dayOf(startsAt).slice(0, 7), number: SAMPLE.length + 1, name: monthName(startsAt),
    startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
    daysLeft: Math.ceil((endsAt - now) / DAY),
    tally: { me: count("me"), teammate: count("teammate"), ties: count(null) },
    previous: finished[0] ?? null,
  };
}

const scoredFor = (tasks, user) =>
  tasks.filter((t) => t.list === "now" && t.assignees.some((u) => u.id === user.id) && (t.title.trim() || t.notes.trim()));

function totals(done, from = -Infinity) {
  const list = done.filter((t) => Date.parse(t.doneAt) >= from);
  const onTime = list.filter((t) => Date.parse(t.doneAt) <= deadline(t)).length;
  const activeDays = new Set(list.map((t) => t.doneAt.slice(0, 10))).size;
  return { completed: list.length, onTime, onTimeRate: list.length ? onTime / list.length : null, afkDays: 0, afkPoints: 0, commits: 0, merges: 0, activeDays };
}

function person(tasks, user, other, history, key, now) {
  const scored = scoredFor(tasks, user);
  const done = scored.filter((t) => t.done && t.doneAt && Date.parse(t.doneAt) <= now);
  const score = scoreAt(scored, now);
  const perDay = new Map();
  for (const t of done) perDay.set(t.doneAt.slice(0, 10), (perDay.get(t.doneAt.slice(0, 10)) ?? 0) + 1);
  // Streaks of consecutive active days; today only extends the current streak once it is active.
  let best = 0, run = 0, current = 0;
  const today = dayOf(now);
  const first = done.length ? Math.min(...done.map((t) => Date.parse(t.doneAt.slice(0, 10)))) : Date.parse(today);
  for (let d = first; d <= Date.parse(today); d += DAY) {
    run = perDay.has(dayOf(d)) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  for (let d = Date.parse(today) - (perDay.has(today) ? 0 : DAY); perDay.has(dayOf(d)); d -= DAY) current++;
  const bestDay = [...perDay].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const scores = history.map((h) => ({ score: h[key], day: h.day })).filter((h) => h.score !== null);
  const pick = (better) => scores.reduce((acc, h) => (!acc || better(h.score, acc.score) ? h : acc), null);
  const seasonStart = monthStart(now);
  const otherKey = key === "me" ? "teammate" : "me";
  const daysLed = history.filter((h) => Date.parse(h.day) >= seasonStart && h.day < today && h[otherKey] !== null && h[key] > h[otherKey]).length;
  const hoursToDone = done.map((t) => (Date.parse(t.doneAt) - Date.parse(t.createdAt)) / 3600000).sort((a, b) => a - b);
  const median = hoursToDone.length
    ? (hoursToDone[Math.floor((hoursToDone.length - 1) / 2)] + hoursToDone[Math.ceil((hoursToDone.length - 1) / 2)]) / 2
    : null;
  const weekdays = Array(7).fill(0);
  const hours = Array(24).fill(0);
  for (const t of done) {
    const d = new Date(t.doneAt);
    weekdays[(d.getUTCDay() + 6) % 7]++;
    hours[d.getUTCHours()]++;
  }
  const activity = [];
  for (let d = Date.parse(today) - 181 * DAY; d <= Date.parse(today); d += DAY) {
    activity.push({ day: dayOf(d), completed: perDay.get(dayOf(d)) ?? 0, commits: 0, merges: 0 });
  }
  return {
    user, score, label: labelFor(score),
    open: scored.filter((t) => !t.done).length,
    overdue: scored.filter((t) => !t.done && now > deadline(t)).length,
    best: pick((a, b) => a > b), worst: pick((a, b) => a < b),
    streak: { current, best },
    bestDay: bestDay ? { day: bestDay[0], completed: bestDay[1] } : null,
    season: { ...totals(done, seasonStart), daysLed },
    allTime: {
      ...totals(done),
      created: tasks.filter((t) => t.createdBy.id === user.id).length,
      assignedToTeammate: other ? tasks.filter((t) => t.createdBy.id === user.id && t.assignees.length === 1 && t.assignees[0].id === other.id).length : 0,
      medianHoursToDone: median === null ? null : Math.round(median * 10) / 10,
    },
    weekdays, hours, activity,
  };
}

export function statsFor(tasks, users, me, now = Date.now()) {
  const other = users.find((u) => u.id !== me.id) ?? null;
  const today = Date.parse(dayOf(now));
  const relevant = [me, other].filter(Boolean).flatMap((user) => scoredFor(tasks, user));
  const firstDay = relevant.length ? Date.parse(dayOf(Math.min(...relevant.map((t) => Date.parse(t.createdAt))))) : today;
  const history = [];
  for (let d = Math.max(firstDay, today - 364 * DAY); d <= today; d += DAY) {
    const asOf = Math.min(d + DAY, now);
    history.push({
      day: dayOf(d),
      me: scoreAt(scoredFor(tasks, me), asOf),
      teammate: other ? scoreAt(scoredFor(tasks, other), asOf) : null,
    });
  }
  return {
    generatedAt: new Date(now).toISOString(),
    timezone: "UTC",
    season: seasonFor(users, me, now),
    seasons: results(users, me, now),
    history,
    me: person(tasks, me, other, history, "me", now),
    teammate: other ? person(tasks, other, me, history, "teammate", now) : null,
  };
}

// MOCK_STATS_DEMO=1: backdated completed and overdue tasks over the last ~10 weeks, so the Stats page
// has a realistic history to design against. Off by default (the e2e suite expects the plain fixtures).
export function demoTasks(users, now = Date.now()) {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = [];
  for (let back = 70; back >= 1; back--) {
    for (const [index, user] of users.entries()) {
      const count = Math.floor(random() * (index ? 4 : 3));
      for (let n = 0; n < count; n++) {
        const created = now - back * DAY - Math.floor(random() * 5) * DAY - 3600000 * (2 + Math.floor(random() * 6));
        const late = random() < 0.25 ? 1 + Math.floor(random() * 3) : 0;
        const due = dayOf(created + (late ? 1 : 3) * DAY);
        const doneAt = Math.min(now - DAY, Date.parse(due) + DAY - 3600000 * (4 + Math.floor(random() * 10)) + late * DAY);
        out.push({
          title: `Demo task ${out.length + 1}`, createdBy: users[Math.floor(random() * users.length)], assignees: [user],
          dueDate: due, priority: Math.floor(random() * 4), done: true,
          doneAt: new Date(Math.max(doneAt, created + 3600000)).toISOString(), createdAt: new Date(created).toISOString(),
        });
      }
    }
  }
  return out;
}
