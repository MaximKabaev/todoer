-- Achievements: derived from tasks, scores, GitHub activity and seasons, then stored the first time
-- they are earned so they are never lost (later task edits or a season reset can't take one away).
CREATE TABLE achievements (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id text NOT NULL,                                 -- catalog id, e.g. 'score-80'
  unlocked_at timestamptz NOT NULL,                 -- when it was first earned (derived, may be in the past)
  recorded_at timestamptz NOT NULL DEFAULT now(),
  emailed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, id)
);
