-- Per-type email preferences on top of the email_notifications master switch.
-- Keys: assigned, completed, updates, achievements, afk, seasons. A missing key means on.
ALTER TABLE users ADD COLUMN email_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
