import { Router } from 'express';
import { eventFromPayload, githubConfigured, recordGithubEvent, validSignature } from '../lib/github.js';

export const githubRouter = Router();

// Public (no session): authenticated by the webhook's HMAC signature instead.
githubRouter.post('/webhook', async (req, res) => {
  if (!githubConfigured()) return res.status(503).json({ error: 'GitHub integration is not configured' });
  if (!validSignature(process.env.GITHUB_WEBHOOK_SECRET, req.rawBody, req.get('x-hub-signature-256'))) return res.status(401).json({ error: 'Invalid signature' });
  const event = req.get('x-github-event');
  const delivery = req.get('x-github-delivery');
  if (event === 'ping') return res.json({ ok: true, pong: true });
  const record = eventFromPayload(event, req.body);
  if (!record || !delivery) return res.json({ ok: true, recorded: false });
  res.json({ ok: true, recorded: await recordGithubEvent(delivery, record) });
});
