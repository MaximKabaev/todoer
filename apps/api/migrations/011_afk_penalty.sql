-- AFK penalty: the daily check records one row per user per finished day (in SCORE_TIMEZONE).
-- points > 0 means the penalty was applied at applied_at (the end of that day); emailed tracks the notice.
CREATE TABLE afk_days (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,
  points integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  applied_at timestamptz NOT NULL,
  emailed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, day)
);
