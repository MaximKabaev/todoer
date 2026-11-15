import { Router } from 'express';
import { pool } from '../db.js';
import { todayActivity } from '../lib/afk.js';
import { scoreboard } from '../lib/score.js';
import { seasonView } from '../lib/seasons.js';

export const scoreRouter = Router();

// The "good boy" scoreboard from the caller's point of view: me, the teammate, who leads,
// plus each person's activity today for the AFK check and the season in progress.
scoreRouter.get('/', async (req, res) => {
  const now = new Date();
  const [board, { season }] = await Promise.all([scoreboard(pool, req.user, req.teammate, now), seasonView(pool, req.user, req.teammate, now)]);
  board.season = season;
  await Promise.all([board.me, board.teammate].filter(Boolean).map(async (entry) => {
    entry.activity = await todayActivity(pool, entry.user.id, now);
  }));
  res.json(board);
});
