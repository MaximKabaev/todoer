import { Router } from 'express';
import { pool } from '../db.js';
import { scoreboard } from '../lib/score.js';

export const scoreRouter = Router();

// The "good boy" scoreboard from the caller's point of view: me, the teammate, who leads.
scoreRouter.get('/', async (req, res) => res.json(await scoreboard(pool, req.user, req.teammate)));
