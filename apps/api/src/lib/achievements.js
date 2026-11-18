import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pool } from '../db.js';
import { addDays, dateFromToday, loadScoreRows, localParts, scoreFor, startOfDay } from './score.js';
import { notificationsConfigured, sendEmail } from './notifications.js';

// Achievements: derived from the same data as the score and Stats (assigned Now tasks, AFK days,
// GitHub events, frozen seasons), then stored the first time they are earned (with the derived
// moment they were earned), so later task edits or a season reset never take one away.
// "Completed" means what Stats means: assigned Now tasks the person completed, empty ones excluded.
// "Activity" means what the AFK check means: a completion, a push with commits, or a merged PR.
//
// Hidden achievements (hidden: true) keep their title, description and art secret from anyone who
// hasn't earned them: the API sends a placeholder instead, and unlock emails only say "a secret
// achievement" to someone who doesn't have it. Their rules are deliberately not listed in SPEC.md.
export const ACHIEVEMENTS = [
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
].map((entry) => ({ hidden: false, ...entry }));
const byId = new Map(ACHIEVEMENTS.map((entry) => [entry.id, entry]));
// Stable placeholder ids for hidden achievements, so the real id never reaches someone who lacks it.
const secretIds = new Map(ACHIEVEMENTS.filter((entry) => entry.hidden).map((entry, index) => [entry.id, `secret-${index + 1}`]));
const DAY = 24 * 60 * 60 * 1000;
const EMAIL_WINDOW = 3 * DAY; // unlocks older than this when first recorded (backfill) are never emailed

// Progress toward a counted goal: { current (capped at target), target }.
const progress = (current, target) => ({ current: Math.min(current, target), target });
const nth = (list, n) => list[n - 1] ?? null;
const earliest = (...dates) => dates.filter(Boolean).sort((a, b) => a - b)[0] ?? null;
const latest = (...dates) => dates.filter(Boolean).sort((a, b) => b - a)[0] ?? null;
const addYears = (date, n) => { const d = new Date(date); d.setUTCFullYear(d.getUTCFullYear() + n); return d; };

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

// One person's completions and GitHub activity as of `now`.
function activityOf(rows, userId, github, now) {
  const done = rows.filter((row) => row.userId === userId && row.kind !== 'afk' && row.createdAt <= now && row.done && row.doneAt <= now && !row.empty)
    .map((row) => ({ ...row, local: localParts(row.doneAt) }))
    .sort((a, b) => a.doneAt - b.doneAt);
  const events = github.filter((event) => event.at <= now).map((event) => ({ ...event, local: localParts(event.at) }));
  const pushes = events.filter((event) => event.kind === 'push' && event.commits > 0);
  const merges = events.filter((event) => event.kind === 'merge');
  // The first moment of activity on each local day.
  const firstActivity = new Map();
  for (const at of [...done.map((row) => row.doneAt), ...pushes.map((event) => event.at), ...merges.map((event) => event.at)]) {
    const { day } = localParts(at);
    if (!firstActivity.has(day) || at < firstActivity.get(day)) firstActivity.set(day, at);
  }
  return { done, pushes, merges, firstActivity };
}

// Runs of consecutive days (sorted YYYY-MM-DD list): calls visit(day, runLength) for each day.
function runs(days, visit) {
  let run = 0;
  let previous = null;
  for (const day of days) {
    run = previous && addDays(previous, 1) === day ? run + 1 : 1;
    visit(day, run);
    previous = day;
  }
}

// Everything one person has earned, as of `now`: { [id]: { unlockedAt: Date | null, progress } }.
// `other` is the teammate (or null) with `otherGithub` their events; `leftLater` maps task id → when it
// last left Later; `person.birthday` (MM-DD) and `person.createdAt` drive two of the hidden ones.
export function deriveFor({ person, other = null, rows, github, otherGithub = [], delegated = [], seasons = [], leftLater = new Map(), now }) {
  const result = {};
  const set = (id, unlockedAt, current = null) => {
    const { target } = byId.get(id);
    result[id] = {
      unlockedAt: unlockedAt && unlockedAt <= now ? unlockedAt : null,
      progress: target === null || current === null ? null : progress(unlockedAt && unlockedAt <= now ? target : current, target),
    };
  };
  const today = dateFromToday(0, now);
  const own = rows.filter((row) => row.userId === person.id);
  const tasks = own.filter((row) => row.kind !== 'afk' && row.createdAt <= now);
  const { done, pushes, merges, firstActivity } = activityOf(rows, person.id, github, now);
  const activeDays = [...firstActivity.keys()].sort();

  // Score milestones and the redemption arc: the score after every completion, every AFK penalty and
  // at the end of every day (when open overdue tasks drag it down), plus right now.
  const instants = new Set([now.getTime(), ...done.map((row) => row.doneAt.getTime()),
    ...own.filter((row) => row.kind === 'afk' && row.at <= now).map((row) => row.at.getTime())]);
  const firstTaskDay = tasks.length ? localParts(new Date(Math.min(...tasks.map((row) => row.createdAt.getTime())))).day : today;
  for (let day = firstTaskDay; day < today; day = addDays(day, 1)) instants.add(startOfDay(addDays(day, 1)).getTime());
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

  // Active-day streaks, earned at the first activity of the streak's last day.
  let longest = 0;
  const streakAt = {};
  runs(activeDays, (day, run) => {
    longest = Math.max(longest, run);
    for (const target of [7, 30, 100]) if (run === target && !streakAt[target]) streakAt[target] = firstActivity.get(day);
  });
  for (const target of [7, 30, 100]) set(`streak-${target}`, streakAt[target] ?? null, longest);

  // Volume.
  set('first-bone', earliest(done[0]?.doneAt, pushes[0]?.at), done.length || pushes.length ? 1 : 0);
  set('century', nth(done, 100)?.doneAt ?? null, done.length);
  set('half-grand', nth(done, 500)?.doneAt ?? null, done.length);
  set('thousand-club', nth(done, 1000)?.doneAt ?? null, done.length);
  // Busy days: N tasks, or M commits pushed, in one local day (earned at the completion/push that gets there).
  const tasksPerDay = new Map();
  const commitsPerDay = new Map();
  const busy = { 10: null, 20: null };
  for (const row of done) {
    const count = (tasksPerDay.get(row.local.day) ?? 0) + 1;
    tasksPerDay.set(row.local.day, count);
    for (const target of [10, 20]) if (count === target) busy[target] = earliest(busy[target], row.doneAt);
  }
  for (const event of pushes) {
    const count = (commitsPerDay.get(event.local.day) ?? 0) + event.commits;
    const before = commitsPerDay.get(event.local.day) ?? 0;
    commitsPerDay.set(event.local.day, count);
    for (const [target, commits] of [[10, 25], [20, 50]]) if (before < commits && count >= commits) busy[target] = earliest(busy[target], event.at);
  }
  const busiest = (target, commits) => Math.max(0, ...tasksPerDay.values(), ...[...commitsPerDay.values()].map((n) => Math.floor((n * target) / commits)));
  set('zoomies', busy[10], busiest(10, 25));
  set('overdrive', busy[20], busiest(20, 50));
  const quick = done.filter((row) => row.doneAt - row.createdAt >= 10 * 60 * 1000 && row.doneAt - row.createdAt <= 60 * 60 * 1000);
  set('speedrun', nth(quick, 25)?.doneAt ?? null, quick.length);

  // Punctuality: runs of on-time completions, and runs of days with no overdue task.
  let onTimeRun = 0;
  let bestOnTime = 0;
  const onTimeAt = {};
  for (const row of done) {
    onTimeRun = row.doneAt <= row.deadline ? onTimeRun + 1 : 0;
    bestOnTime = Math.max(bestOnTime, onTimeRun);
    for (const target of [20, 100]) if (onTimeRun === target && !onTimeAt[target]) onTimeAt[target] = row.doneAt;
  }
  set('clockwork', onTimeAt[20] ?? null, bestOnTime);
  set('swiss-watch', onTimeAt[100] ?? null, bestOnTime);
  // A clean day: something assigned (open at some point that day) and nothing overdue: no task still
  // open past its deadline at the end of the day and none completed late during it. Finished days only.
  // The same pass records the open count at the end of each day (for the inbox-zero achievement).
  const scored = tasks.filter((row) => !row.empty);
  let cleanRun = 0;
  let bestClean = 0;
  const cleanAt = {};
  const openAtEnd = [];
  if (scored.length) {
    for (let day = firstTaskDay; day < today; day = addDays(day, 1)) {
      const start = startOfDay(day);
      const end = startOfDay(addDays(day, 1));
      const doneBy = (row, at) => row.done && row.doneAt < at;
      const live = scored.filter((row) => row.createdAt < end && !doneBy(row, start));
      const overdue = live.some((row) => (!doneBy(row, end) && row.deadline < end) || (doneBy(row, end) && row.doneAt > row.deadline));
      cleanRun = live.length && !overdue ? cleanRun + 1 : 0;
      bestClean = Math.max(bestClean, cleanRun);
      for (const target of [7, 30]) if (cleanRun === target && !cleanAt[target]) cleanAt[target] = end;
      openAtEnd.push({ end, open: live.filter((row) => !doneBy(row, end)).length });
    }
  }
  set('clean-slate', cleanAt[7] ?? null, bestClean);
  set('spotless-month', cleanAt[30] ?? null, bestClean);

  // Seasons (frozen results, oldest first).
  const finished = seasons.filter((season) => season.endsAt <= now).sort((a, b) => a.endsAt - b.endsAt);
  const won = finished.filter((season) => season.winnerId === person.id);
  set('season-champion', won[0]?.endsAt ?? null, won.length);
  set('seasons-6', nth(won, 6)?.endsAt ?? null, won.length);
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
  let commitChampion = null;
  if (other) {
    for (const season of won) {
      const days = seasonDays(season).map(({ end }) => [scoreFor(rows, person.id, end), scoreFor(rows, other.id, end)]);
      if (!comeback && days.some(([mine, theirs]) => theirs - mine >= 15)) comeback = season.endsAt;
      if (!topDog && days.length && days.every(([mine, theirs]) => mine > theirs)) topDog = season.endsAt;
    }
    const commitsIn = (events, season) => events.filter((event) => event.kind === 'push' && event.at >= season.startsAt && event.at < season.endsAt)
      .reduce((sum, event) => sum + event.commits, 0);
    commitChampion = finished.find((season) => { const mine = commitsIn(github, season); return mine > 0 && mine > commitsIn(otherGithub, season); })?.endsAt ?? null;
  }
  set('comeback-kid', comeback);
  set('top-dog', topDog);
  set('commit-champion', commitChampion);

  // Teamwork. The shared ones are derived from both people's data, so both earn them at the same moment.
  const handed = delegated.filter((at) => at <= now);
  set('delegator', nth(handed, 25) ?? null, handed.length);
  let duo = null;
  let wavelength = null;
  let bestWavelength = 0;
  let tagTeam = null;
  if (other) {
    const theirs = activityOf(rows, other.id, otherGithub, now);
    const theirTaskIds = new Set(rows.filter((row) => row.userId === other.id && row.kind !== 'afk').map((row) => row.id));
    duo = done.find((row) => theirTaskIds.has(row.id))?.doneAt ?? null;
    runs(activeDays.filter((day) => theirs.firstActivity.has(day)), (day, run) => {
      bestWavelength = Math.max(bestWavelength, run);
      if (run === 30 && !wavelength) wavelength = latest(firstActivity.get(day), theirs.firstActivity.get(day));
    });
    const firstPush = (list) => {
      const map = new Map();
      for (const event of list) { const key = `${event.local.day}|${event.repo}`; if (!map.has(key) || event.at < map.get(key)) map.set(key, event.at); }
      return map;
    };
    const theirPushes = firstPush(theirs.pushes);
    for (const [key, at] of firstPush(pushes)) if (theirPushes.has(key)) tagTeam = earliest(tagTeam, latest(at, theirPushes.get(key)));
  }
  set('dynamic-duo', duo);
  set('same-wavelength', wavelength, bestWavelength);
  set('tag-team', tagTeam);

  // Code. Commit counts are summed over pushes in delivery order.
  let total = 0;
  const commitsAt = {};
  for (const event of pushes) {
    const before = total;
    total += event.commits;
    for (const target of [100, 500, 1000, 2500, 5000]) if (before < target && total >= target) commitsAt[target] = event.at;
  }
  for (const target of [100, 500, 1000, 2500, 5000]) set(`commits-${target}`, commitsAt[target] ?? null, total);
  // Rolling 7-day windows: commits pushed, and distinct repos pushed to.
  let machine = null;
  let bestWeek = 0;
  let polyglot = null;
  let bestRepos = 0;
  for (let i = 0, start = 0, sum = 0; i < pushes.length; i++) {
    sum += pushes[i].commits;
    while (pushes[i].at - pushes[start].at >= 7 * DAY) sum -= pushes[start++].commits;
    bestWeek = Math.max(bestWeek, sum);
    if (sum >= 100 && !machine) machine = pushes[i].at;
    const repos = new Set(pushes.slice(start, i + 1).map((event) => event.repo)).size;
    bestRepos = Math.max(bestRepos, repos);
    if (repos >= 4 && !polyglot) polyglot = pushes[i].at;
  }
  set('commit-machine', machine, bestWeek);
  set('polyglot', polyglot, bestRepos);
  const branches = new Set();
  let explorer = null;
  for (const event of pushes) {
    branches.add(`${event.repo}|${event.ref}`);
    if (branches.size === 5 && !explorer) explorer = event.at;
  }
  set('branch-explorer', explorer, branches.size);
  set('shipper', nth(merges, 10)?.at ?? null, merges.length);
  set('release-train', nth(merges, 50)?.at ?? null, merges.length);

  // Time of day and weekends (SCORE_TIMEZONE); completions and pushes both count.
  const moments = [...done.map((row) => ({ at: row.doneAt, local: row.local })), ...pushes.map((event) => ({ at: event.at, local: event.local }))]
    .sort((a, b) => a.at - b.at);
  set('night-owl', moments.find((moment) => moment.local.hour < 5)?.at ?? null);
  set('early-bird', moments.find((moment) => moment.local.hour >= 5 && moment.local.hour < 7)?.at ?? null);
  const saturdayOf = (local) => (local.weekday === 6 ? addDays(local.day, -1) : local.day);
  const weekends = new Map();
  let warrior = null;
  for (const row of done) {
    if (row.local.weekday < 5) continue;
    const count = (weekends.get(saturdayOf(row.local)) ?? 0) + 1;
    weekends.set(saturdayOf(row.local), count);
    if (count === 5) warrior = earliest(warrior, row.doneAt);
  }
  const weekendPushes = new Map(); // saturday → { 5: first Saturday push, 6: first Sunday push }
  for (const event of pushes) {
    if (event.local.weekday < 5) continue;
    const entry = weekendPushes.get(saturdayOf(event.local)) ?? {};
    entry[event.local.weekday] ??= event.at;
    weekendPushes.set(saturdayOf(event.local), entry);
  }
  for (const entry of weekendPushes.values()) if (entry[5] && entry[6]) warrior = earliest(warrior, latest(entry[5], entry[6]));
  set('weekend-warrior', warrior, Math.max(0, ...weekends.values()));
  const returned = done.filter((row) => leftLater.get(row.id) && leftLater.get(row.id) <= row.doneAt);
  set('back-from-later', nth(returned, 10)?.doneAt ?? null, returned.length);

  // Hidden ones.
  const onDate = (monthDay) => earliest(...activeDays.filter((day) => day.slice(5) === monthDay).map((day) => firstActivity.get(day)));
  set('new-year', onDate('01-01'));
  set('birthday-boy', person.birthday ? onDate(person.birthday) : null);
  set('anniversary', person.createdAt ? addYears(person.createdAt, 1) : null);
  set('archaeologist', done.find((row) => row.doneAt - row.createdAt >= 60 * DAY)?.doneAt ?? null);
  let inboxZero = null;
  openAtEnd.forEach(({ end, open }, index) => {
    if (inboxZero || open !== 0) return;
    if (openAtEnd.slice(Math.max(0, index - 6), index).some((day) => day.open >= 10)) inboxZero = end;
  });
  set('inbox-zero', inboxZero);
  set('big-push', pushes.find((event) => event.commits >= 10)?.at ?? null);
  return result;
}

// Derive every person's achievements: { [userId]: { [id]: { unlockedAt, progress } } }.
export async function deriveAchievements(db, now = new Date(), rows = null) {
  const [scoreRows, { rows: users }, { rows: events }, { rows: seasonRows }, { rows: returned }] = await Promise.all([
    rows ?? loadScoreRows(db),
    db.query('SELECT id, birthday, created_at AS "createdAt" FROM users ORDER BY created_at, id'),
    db.query(`SELECT u.id AS "userId", e.kind, e.commits, e.repo, e.ref, e.at FROM github_events e
      JOIN users u ON lower(u.github_login) = lower(e.github_login) ORDER BY e.at`),
    db.query('SELECT id, number, starts_at AS "startsAt", ends_at AS "endsAt", winner_id AS "winnerId" FROM seasons ORDER BY ends_at'),
    db.query('SELECT id, left_later_at AS at FROM tasks WHERE left_later_at IS NOT NULL'),
  ]);
  const leftLater = new Map(returned.map((row) => [row.id, row.at]));
  const derived = {};
  for (const person of users) {
    const other = users.find((candidate) => candidate.id !== person.id) ?? null;
    // Tasks this person created that are assigned only to the other person, in creation order.
    const { rows: delegated } = other ? await db.query(`SELECT t.created_at AS at FROM tasks t WHERE t.created_by = $1
        AND EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = $2)
        AND NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id <> $2) ORDER BY t.created_at`, [person.id, other.id])
      : { rows: [] };
    derived[person.id] = deriveFor({
      person, other, rows: scoreRows, now, seasons: seasonRows, leftLater,
      github: events.filter((event) => event.userId === person.id),
      otherGithub: other ? events.filter((event) => event.userId === other.id) : [],
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
// [{ id, category, hidden, title, description, target, me: State, teammate: State | null }],
// State = { unlocked, unlockedAt, progress: { current, target } | null }.
// A hidden achievement the viewer hasn't earned is a placeholder: id "secret-N", title, description,
// target and progress null, and only whether (and when) the teammate earned it.
export async function achievementsView(db, user, teammate, now = new Date(), rows = null) {
  const { derived, stored } = await syncAchievements(db, now, rows);
  const state = (person, id, revealed) => {
    if (!person) return null;
    const unlockedAt = stored[person.id]?.[id] ?? null;
    const live = derived[person.id]?.[id];
    const target = byId.get(id).target;
    return {
      unlocked: Boolean(unlockedAt), unlockedAt,
      progress: !revealed || target === null ? null : unlockedAt ? progress(target, target) : live?.progress ?? progress(0, target),
    };
  };
  return ACHIEVEMENTS.map((entry) => {
    const revealed = !entry.hidden || Boolean(stored[user.id]?.[entry.id]);
    if (revealed) return { ...entry, me: state(user, entry.id, true), teammate: state(teammate, entry.id, true) };
    return { id: secretIds.get(entry.id), category: entry.category, hidden: true, title: null, description: null, target: null,
      me: state(user, entry.id, false), teammate: state(teammate, entry.id, false) };
  });
}

// Badge art served by the web app (apps/web/public/achievements/<id>.png), attached to unlock emails
// as inline images. A missing file just leaves the badge out of the email. "secret" is the mystery badge.
const artDir = new URL('../../../web/public/achievements/', import.meta.url);
export function achievementArt(id) {
  try {
    return { filename: `${id}.png`, content: readFileSync(new URL(`${id}.png`, artDir)).toString('base64'), content_id: `achievement-${id}` };
  } catch {
    return null;
  }
}

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// One email per recipient covering every new unlock (theirs and their teammate's). `owned` = the ids
// the recipient has earned: a hidden achievement they don't have is only "a secret achievement".
// `art` = the art names that have an inline image attached (see achievementArt).
export function composeAchievementEmail({ recipient, people, unlocks, owned = new Set(), art = new Set() }) {
  const base = process.env.PUBLIC_WEB_URL?.replace(/\/+$/, '') || '';
  const name = (userId) => (userId === recipient.id ? 'You' : people.find((person) => person.id === userId)?.display_name ?? 'Someone');
  const lines = unlocks.map((unlock) => {
    const entry = byId.get(unlock.id);
    const revealed = !entry.hidden || unlock.userId === recipient.id || owned.has(unlock.id);
    return revealed ? { who: name(unlock.userId), art: entry.id, title: entry.title, description: entry.description, quoted: `“${entry.title}”` }
      : { who: name(unlock.userId), art: 'secret', title: 'A secret achievement', description: 'Earn it yourself to find out what it is.', quoted: 'a secret achievement' };
  });
  const mine = lines.filter((line) => line.who === 'You');
  const subject = unlocks.length === 1
    ? `${lines[0].who} unlocked ${lines[0].quoted}${lines[0].who === 'You' ? '!' : ''}`
    : mine.length === unlocks.length ? `You unlocked ${unlocks.length} achievements!` : `${unlocks.length} new achievements unlocked`;
  const text = [`Hi ${recipient.display_name},`, '', 'Achievement unlocked:', ...lines.map((line) => `  ${line.who}: ${line.title} (${line.description})`),
    ...(base ? ['', `${base}/stats`] : []), '', 'You get these because email notifications are on in todoer Settings.'].join('\n');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2328;max-width:560px">
<p>Hi ${escape(recipient.display_name)},</p>
<div style="margin:16px 0;padding:12px 16px;border:1px solid #c7d2fe;border-radius:12px;background:#eef2ff">
<div style="font-weight:700;color:#3730a3;margin-bottom:6px">🏅 Achievement${unlocks.length === 1 ? '' : 's'} unlocked</div>
${lines.map((line) => `<table role="presentation" style="margin-top:8px;border-collapse:collapse"><tr>
${art.has(line.art) ? `<td style="padding:0 12px 0 0;vertical-align:middle"><img src="cid:achievement-${escape(line.art)}" width="64" height="64" alt="${escape(line.title)} badge" style="display:block;image-rendering:pixelated"></td>` : ''}
<td style="vertical-align:middle"><strong>${escape(line.title)}</strong> · ${escape(line.who)}<div style="color:#4b5563">${escape(line.description)}</div></td>
</tr></table>`).join('\n')}
${base ? `<div style="margin-top:8px"><a href="${escape(base)}/stats" style="color:#1f2328">See all achievements</a></div>` : ''}
</div>
<p style="color:#9ca3af;font-size:12px">You get these because email notifications are on in todoer Settings.</p>
</div>`;
  return { subject, text, html, art: [...new Set(lines.map((line) => line.art))] };
}

// Email both people about unlocks not yet announced; retries on later ticks if a send fails.
export async function sendAchievementEmails({ send = sendEmail, now = new Date(), db = pool } = {}) {
  if (!notificationsConfigured()) return 0;
  const { rows: pending } = await db.query(`SELECT user_id AS "userId", id, unlocked_at AS "unlockedAt" FROM achievements
    WHERE NOT emailed ORDER BY unlocked_at, user_id, id`);
  if (!pending.length) return 0;
  const [{ rows: people }, { rows: all }] = await Promise.all([
    db.query('SELECT id, display_name, email, email_notifications FROM users ORDER BY created_at, id'),
    db.query('SELECT user_id AS "userId", id FROM achievements'),
  ]);
  const key = createHash('sha256').update(pending.map((row) => `${row.userId}:${row.id}`).join(',')).digest('hex').slice(0, 24);
  let sent = 0;
  let ok = true;
  for (const recipient of people) {
    if (!recipient.email || !recipient.email_notifications) continue;
    const owned = new Set(all.filter((row) => row.userId === recipient.id).map((row) => row.id));
    const names = composeAchievementEmail({ recipient, people, unlocks: pending, owned }).art;
    const attachments = names.map(achievementArt).filter(Boolean);
    const { subject, text, html } = composeAchievementEmail({ recipient, people, unlocks: pending, owned,
      art: new Set(attachments.map((file) => file.filename.replace(/\.png$/, ''))) });
    try {
      await send({ to: recipient.email, idempotencyKey: `todoer-achievement-${key}-${recipient.id}`, subject, text, html, attachments });
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
