-- GitHub activity: pushes (any branch) and merged PRs from connected repos count as activity for the
-- AFK check. Events are matched to people by their linked GitHub login (users.github_login).
ALTER TABLE users ADD COLUMN github_login text;
CREATE UNIQUE INDEX users_github_login_lower ON users (lower(github_login));

CREATE TABLE github_events (
  delivery_id text PRIMARY KEY,                 -- X-GitHub-Delivery, so redeliveries are idempotent
  kind text NOT NULL CHECK (kind IN ('push', 'merge')),
  github_login text NOT NULL,                   -- the authenticated sender (pusher or merger)
  repo text NOT NULL,                           -- owner/name
  ref text,                                     -- branch for pushes, base branch for merges
  commits integer NOT NULL DEFAULT 0,
  url text,
  at timestamptz NOT NULL DEFAULT now()         -- when GitHub delivered it (commit dates can be rewritten)
);
CREATE INDEX github_events_login_at ON github_events (lower(github_login), at);

-- Link the two known accounts (editable later in Settings).
UPDATE users SET github_login = 'MaximKabaev' WHERE username = 'maxim' AND github_login IS NULL;
UPDATE users SET github_login = 'SkechX' WHERE username = 'german' AND github_login IS NULL;
