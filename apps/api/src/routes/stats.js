import { Router } from 'express';
import { pool } from '../db.js';
import { stats } from '../lib/stats.js';

export const statsRouter = Router();

// Everything the Stats page shows: season standings and history, score history, records, activity.
statsRouter.get('/', async (req, res) => {
  res.json(await stats(pool, req.user, req.teammate, new Date()));
});
