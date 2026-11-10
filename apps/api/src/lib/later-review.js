import { randomInt } from 'node:crypto';
import { transaction } from '../db.js';
import { dateFromToday, SCORE } from './score.js';

// Row locks serialize this worker with task edits; SKIP LOCKED also permits multiple API processes.
export async function resurfaceLaterTasks() {
  return transaction(async (db) => {
    const { rows: users } = await db.query('SELECT id FROM users ORDER BY id');
    if (users.length !== 2) return 0;
    const { rows } = await db.query(`SELECT id FROM tasks
      WHERE list = 'later' AND NOT done AND later_since <= now() - interval '336 hours'
      ORDER BY later_since LIMIT 100 FOR UPDATE SKIP LOCKED`);
    for (const task of rows) {
      const assignee = users[randomInt(2)].id;
      await db.query(`UPDATE tasks SET list = 'now', updated_at = now(), position = $2,
        due_date = CASE WHEN due_date IS NULL OR due_date < $3::date THEN $4::date ELSE due_date END
        WHERE id = $1`, [task.id, Date.now(), dateFromToday(), dateFromToday(SCORE.defaultDays)]);
      await db.query('DELETE FROM task_assignees WHERE task_id = $1', [task.id]);
      await db.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2)', [task.id, assignee]);
    }
    return rows.length;
  });
}

export function startLaterReviewWorker(intervalMs = 60 * 1000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await resurfaceLaterTasks(); }
    catch (error) { console.error(`Later review worker: ${error.message}`); }
    finally { running = false; }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
