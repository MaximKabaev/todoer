-- Optional per-user email: a second login identifier and the address for change digests.
ALTER TABLE users ADD COLUMN email text;
ALTER TABLE users ADD COLUMN email_notifications boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

-- Pending notification events, batched into one digest email per recipient by the API process.
-- task_id has no foreign key: deleted tasks still need to be reported.
CREATE TABLE notification_events (
  id bigserial PRIMARY KEY,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL,
  task_title text NOT NULL,
  changes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_events_recipient ON notification_events (recipient_id, created_at);
