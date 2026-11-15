-- Seasons: the good boy competition runs in calendar months (SCORE_TIMEZONE). When a season ends,
-- its result is frozen here so later edits to old tasks never change who won. The soft reset itself
-- is derived (replayed at every boundary), like the rest of the score.
CREATE TABLE seasons (
  id text PRIMARY KEY,                              -- 'YYYY-MM', the month the season ran
  number integer NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,                     -- the reset boundary
  scores jsonb NOT NULL,                            -- { userId: final score }
  carried jsonb NOT NULL,                           -- { userId: score right after the soft reset }
  winner_id uuid REFERENCES users(id) ON DELETE SET NULL, -- null = tie
  decided_at timestamptz NOT NULL DEFAULT now(),
  emailed boolean NOT NULL DEFAULT false
);
