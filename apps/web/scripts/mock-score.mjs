// Pure mock implementation of the shared score contract. Dates use UTC.
const DAY = 86400000;
export function defaultDate(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 7)).toISOString().slice(0, 10);
}
export function deadline(task) {
  const date = task.dueDate || defaultDate(new Date(task.createdAt));
  return Date.parse(`${date}T00:00:00Z`) + DAY;
}
export function scoreAt(tasks, asOf) {
  const events = [];
  for (const task of tasks) {
    if (Date.parse(task.createdAt) > asOf) continue;
    const doneAt = task.done && task.doneAt ? Date.parse(task.doneAt) : null;
    const done = doneAt !== null && doneAt <= asOf;
    const end = deadline(task);
    if (!done && asOf <= end) continue;
    const time = done ? doneAt : asOf;
    const lateDays = Math.max(0, Math.ceil((time - end) / DAY));
    const grade = done ? (lateDays === 0 ? 100 : Math.max(30, 90 - 10 * lateDays)) : Math.max(0, 60 - 10 * lateDays);
    let weight = 1 + 0.5 * task.priority;
    if (done && doneAt - Date.parse(task.createdAt) < 600000) weight *= 0.25;
    if (!task.title.trim() && !task.notes.trim()) continue;
    events.push({ id: task.id, time, grade, weight });
  }
  events.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  let W = 5, s = 50;
  for (const { weight, grade } of events) {
    W = Math.min(W + weight, 15);
    s += (weight / W) * (grade - s);
  }
  return Math.round(s);
}
export function scoreEntry(tasks, user, now = Date.now()) {
  const scored = tasks.filter((t) => t.list === "now" && t.assignees.some((u) => u.id === user.id));
  const score = scoreAt(scored, now);
  const label = score >= 90 ? "Best boy ever" : score >= 75 ? "Very good boy" : score >= 60 ? "Good boy" : score >= 45 ? "Doing okay" : score >= 30 ? "Naughty" : "Bad boy";
  return {
    user, score, label,
    trend: score - scoreAt(scored, now - 7 * DAY),
    doneThisWeek: scored.filter((t) => t.done && t.doneAt && Date.parse(t.doneAt) >= now - 7 * DAY && Date.parse(t.doneAt) <= now).length,
    overdue: scored.filter((t) => !t.done && now > deadline(t)).length,
  };
}
