// Mock implementation of seasons (GET /api/score `season`) and GET /api/stats. Dates use UTC.
// The mock has no AFK worker, GitHub events or soft resets: those numbers are always 0, and the two
// finished seasons before the current month are fixed sample results so the UI has a history to show.
import { createHash } from "node:crypto";
import { deadline, scoreAt } from "./mock-score.mjs";

// Catalog mirrors apps/api/src/lib/achievements.js.
const ACHIEVEMENTS = [
  { id: 'score-80', category: 'score', title: 'Good Boy', description: 'Reach a score of 80', target: 80 },
  { id: 'score-90', category: 'score', title: 'Very Good Boy', description: 'Reach a score of 90', target: 90 },
  { id: 'score-95', category: 'score', title: 'Elite Boy', description: 'Reach a score of 95', target: 95 },
  { id: 'score-100', category: 'score', title: 'Perfect Boy', description: 'Reach a perfect score of 100', target: 100 },

  { id: 'streak-7', category: 'streak', title: 'On a Roll', description: 'Be active 7 days in a row (a task done, commits pushed or a PR merged)', target: 7 },
  { id: 'streak-30', category: 'streak', title: 'Unstoppable', description: 'Be active 30 days in a row', target: 30 },
  { id: 'streak-100', category: 'streak', title: 'Iron Will', description: 'Be active 100 days in a row', target: 100 },

  { id: 'first-bone', category: 'volume', title: 'First Bone', description: 'Complete your first task or push your first commit', target: 1 },
  { id: 'century', category: 'volume', title: 'Century', description: 'Complete 100 tasks', target: 100 },
  { id: 'half-grand', category: 'volume', title: 'Half a Grand', description: 'Complete 500 tasks', target: 500 },
  { id: 'thousand-club', category: 'volume', title: 'Thousand Club', description: 'Complete 1,000 tasks', target: 1000 },
  { id: 'zoomies', category: 'volume', title: 'Zoomies', description: 'Complete 10 tasks or push 25 commits in one day', target: 10 },
  { id: 'overdrive', category: 'volume', title: 'Overdrive', description: 'Complete 20 tasks or push 50 commits in one day', target: 20 },
  { id: 'speedrun', category: 'volume', title: 'Speedrun', description: 'Complete 25 tasks between 10 minutes and an hour after creating them', target: 25 },

  { id: 'clockwork', category: 'punctuality', title: 'Clockwork', description: 'Complete 20 tasks in a row on time', target: 20 },
  { id: 'swiss-watch', category: 'punctuality', title: 'Swiss Watch', description: 'Complete 100 tasks in a row on time', target: 100 },
  { id: 'clean-slate', category: 'punctuality', title: 'Clean Slate', description: '7 days in a row with tasks assigned and none overdue', target: 7 },
  { id: 'spotless-month', category: 'punctuality', title: 'Spotless Month', description: '30 days in a row with tasks assigned and none overdue', target: 30 },

  { id: 'season-champion', category: 'competition', title: 'Season Champion', description: 'Win a season', target: 1 },
  { id: 'dynasty', category: 'competition', title: 'Dynasty', description: 'Win 3 seasons in a row', target: 3 },
  { id: 'seasons-6', category: 'competition', title: 'Hat Trick of Hat Tricks', description: 'Win 6 seasons', target: 6 },
  { id: 'comeback-kid', category: 'competition', title: 'Comeback Kid', description: 'Win a season after trailing by 15+ points at the end of a day in it', target: null },
  { id: 'top-dog', category: 'competition', title: 'Top Dog', description: 'Win a season leading at the end of every one of its days', target: null },
  { id: 'commit-champion', category: 'competition', title: 'Commit Champion', description: 'Push more commits than your teammate in a season', target: null },

  { id: 'delegator', category: 'team', title: 'Delegator', description: 'Assign 25 tasks you created to your teammate', target: 25 },
  { id: 'dynamic-duo', category: 'team', title: 'Dynamic Duo', description: 'Complete a task assigned to both of you (you both earn it)', target: null },
  { id: 'same-wavelength', category: 'team', title: 'Same Wavelength', description: 'Both be active on the same day, 30 days in a row (you both earn it)', target: 30 },
  { id: 'tag-team', category: 'team', title: 'Tag Team', description: 'Both push to the same repo on the same day (you both earn it)', target: null },

  { id: 'commits-100', category: 'code', title: 'Centurion Coder', description: 'Push 100 commits', target: 100 },
  { id: 'commits-500', category: 'code', title: 'Keyboard Warrior', description: 'Push 500 commits', target: 500 },
  { id: 'commits-1000', category: 'code', title: 'Commit Legend', description: 'Push 1,000 commits', target: 1000 },
  { id: 'commits-2500', category: 'code', title: 'Code Titan', description: 'Push 2,500 commits', target: 2500 },
  { id: 'commits-5000', category: 'code', title: 'Git Immortal', description: 'Push 5,000 commits', target: 5000 },
  { id: 'commit-machine', category: 'code', title: 'Commit Machine', description: 'Push 100 commits within 7 days', target: 100 },
  { id: 'polyglot', category: 'code', title: 'Polyglot', description: 'Push to 4 different repos within 7 days', target: 4 },
  { id: 'branch-explorer', category: 'code', title: 'Branch Explorer', description: 'Push to 5 different branches', target: 5 },
  { id: 'shipper', category: 'code', title: 'Shipper', description: 'Merge 10 pull requests', target: 10 },
  { id: 'release-train', category: 'code', title: 'Release Train', description: 'Merge 50 pull requests', target: 50 },

  { id: 'redemption-arc', category: 'fun', title: 'Redemption Arc', description: 'Climb from under 45 back up to 80', target: null },
  { id: 'night-owl', category: 'fun', title: 'Night Owl', description: 'Complete a task or push a commit between midnight and 5am', target: null },
  { id: 'early-bird', category: 'fun', title: 'Early Bird', description: 'Complete a task or push a commit between 5am and 7am', target: null },
  { id: 'weekend-warrior', category: 'fun', title: 'Weekend Warrior', description: 'Complete 5 tasks in one weekend, or push commits on both its Saturday and Sunday', target: 5 },
  { id: 'back-from-later', category: 'fun', title: 'Back from Later', description: 'Complete 10 tasks that came back from Later', target: 10 },

  { id: 'new-year', category: 'secret', hidden: true, title: 'New Year, New Me', description: 'Complete a task or push a commit on January 1', target: null },
  { id: 'birthday-boy', category: 'secret', hidden: true, title: 'Birthday Boy', description: 'Complete a task or push a commit on your birthday (set it in Settings)', target: null },
  { id: 'anniversary', category: 'secret', hidden: true, title: 'Anniversary', description: 'One year of todoer', target: null },
  { id: 'archaeologist', category: 'secret', hidden: true, title: 'Archaeologist', description: 'Complete a task that was open for 60+ days', target: null },
  { id: 'inbox-zero', category: 'secret', hidden: true, title: 'Inbox Zero', description: 'End a day with no open tasks after having 10+ open at the end of a day earlier that week', target: null },
  { id: 'big-push', category: 'secret', hidden: true, title: 'Big Push', description: 'Push 10+ commits at once', target: null },
  { id: 'halloween', category: 'secret', hidden: true, title: 'Spooky Season', description: 'Complete a task or push a commit on October 31', target: null },
  { id: 'christmas', category: 'secret', hidden: true, title: 'Ho Ho Ho', description: 'Complete a task or push a commit on December 25', target: null },
  { id: 'friday-13', category: 'secret', hidden: true, title: 'Unlucky for Some', description: 'Complete a task or push a commit on a Friday the 13th', target: null },
  { id: 'leet', category: 'secret', hidden: true, title: '1337', description: 'Complete a task or push a commit at exactly 13:37', target: null },
  { id: 'season-tie', category: 'secret', hidden: true, title: 'Perfectly Balanced', description: 'Finish a season in an exact tie (you both earn it)', target: null },
].map((entry) => ({ hidden: false, ...entry }))
  // Same art paths as the API: hidden badges use hash-named files.
  .map((entry) => ({ ...entry, art: `/achievements/${entry.hidden ? `s/${createHash("sha256").update(`todoer-secret:${entry.id}`).digest("hex").slice(0, 16)}` : entry.id}.png` }));

const DAY = 86400000;
const labelFor = (score) =>
  score >= 100 ? "Perfect boy" : score >= 90 ? "Best boy ever" : score >= 75 ? "Very good boy" : score >= 60 ? "Good boy" : score >= 45 ? "Doing okay" : score >= 30 ? "Naughty" : "Bad boy";
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
  const assigned = tasks.filter((t) => t.list === "now" && t.assignees.some((u) => u.id === user.id));
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
    // Open and overdue count every assigned Now task, empty ones included (like the score card).
    open: assigned.filter((t) => !t.done).length,
    overdue: assigned.filter((t) => !t.done && now > deadline(t)).length,
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

// Task-derived UTC sample progress; production additionally persists unlocks and scans
// scoring instants. No GitHub activity is simulated; season wins use SAMPLE above.
function achievementStates(tasks, user, summary, finished, key, now) {
  const done = scoredFor(tasks, user).filter((t) => t.done && t.doneAt && Date.parse(t.doneAt) <= now)
    .sort((a, b) => Date.parse(a.doneAt) - Date.parse(b.doneAt));
  const values = {};
  const dates = {};
  const last = done.at(-1)?.doneAt ?? null;
  const peak = Math.max(summary.score, summary.best?.score ?? 0);
  for (const target of [80, 90, 95, 100]) {
    values[`score-${target}`] = peak;
    dates[`score-${target}`] = new Date(summary.best?.day ?? now).toISOString();
  }
  for (const target of [7, 30]) values[`streak-${target}`] = summary.streak.best;
  for (const [id, target] of [["first-bone", 1], ["century", 100], ["thousand-club", 1000]]) {
    values[id] = done.length;
    dates[id] = done[target - 1]?.doneAt;
  }
  const perDay = new Map();
  const weekends = new Map();
  let onTime = 0;
  values.clockwork = 0;
  for (const task of done) {
    const day = task.doneAt.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    onTime = Date.parse(task.doneAt) <= deadline(task) ? onTime + 1 : 0;
    values.clockwork = Math.max(values.clockwork, onTime);
    const d = new Date(task.doneAt);
    if (d.getUTCHours() < 5) dates["night-owl"] ??= task.doneAt;
    if (d.getUTCHours() >= 5 && d.getUTCHours() < 7) dates["early-bird"] ??= task.doneAt;
    if ([0, 6].includes(d.getUTCDay())) {
      const saturday = dayOf(Date.parse(day) - (d.getUTCDay() === 0 ? DAY : 0));
      weekends.set(saturday, (weekends.get(saturday) ?? 0) + 1);
    }
  }
  values.zoomies = Math.max(0, ...perDay.values());
  values["weekend-warrior"] = Math.max(0, ...weekends.values());
  const wins = finished.filter((season) => season.winner === key);
  values["season-champion"] = wins.length;
  dates["season-champion"] = wins.at(-1)?.endsAt;
  values.dynasty = wins.length ? 1 : 0; // alternating sample winners
  values.delegator = summary.allTime.assignedToTeammate;
  dates.delegator = new Date(now).toISOString();
  // Fixed examples cover revealed and teammate-only secrets in the mock.
  dates["new-year"] = "2026-01-01T12:00:00.000Z";
  if (user.username === "teammate") dates["birthday-boy"] = "2026-06-15T12:00:00.000Z";
  return Object.fromEntries(ACHIEVEMENTS.map(({ id, target }) => {
    const unlocked = target === null ? !!dates[id] : (values[id] ?? 0) >= target;
    return [id, { unlocked, unlockedAt: unlocked ? dates[id] ?? last : null,
      progress: target === null ? null : { current: Math.min(values[id] ?? 0, target), target } }];
  }));
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
  const mine = person(tasks, me, other, history, "me", now);
  const theirs = other ? person(tasks, other, me, history, "teammate", now) : null;
  const finished = results(users, me, now);
  const myBadges = achievementStates(tasks, me, mine, finished, "me", now);
  const theirBadges = other ? achievementStates(tasks, other, theirs, finished, "teammate", now) : null;
  return {
    achievements: ACHIEVEMENTS.map((entry) => {
      const mine = myBadges[entry.id];
      const theirs = theirBadges?.[entry.id] ?? null;
      if (entry.hidden && !mine.unlocked) return {
        id: `secret-${ACHIEVEMENTS.filter((badge) => badge.hidden).indexOf(entry) + 1}`,
        category: entry.category, hidden: true, art: entry.art, title: null, description: null, target: null,
        me: { ...mine, progress: null }, teammate: theirs ? { ...theirs, progress: null } : null,
      };
      return { ...entry, me: mine, teammate: theirs };
    }),
    generatedAt: new Date(now).toISOString(),
    timezone: "UTC",
    season: seasonFor(users, me, now),
    seasons: results(users, me, now),
    history,
    me: mine,
    teammate: theirs,
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
