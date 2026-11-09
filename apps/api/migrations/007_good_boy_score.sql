-- Good boy score. Tasks in Now now default to a one-week due date; give the open ones that have
-- none a fresh week from today, so nothing is overdue the moment this ships. Completed tasks keep
-- their (null) date and are graded as if due created + 7 days. Later tasks stay undated.
UPDATE tasks SET due_date = CURRENT_DATE + 7 WHERE NOT done AND list = 'now' AND due_date IS NULL;

-- Score changes (per user, before/after) captured when a completion is queued for an email.
ALTER TABLE notification_events ADD COLUMN scores jsonb;
