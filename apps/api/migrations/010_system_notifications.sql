-- Automated Later reviews have no human actor.
ALTER TABLE notification_events ALTER COLUMN actor_id DROP NOT NULL;
