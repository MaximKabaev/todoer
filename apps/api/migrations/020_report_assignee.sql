-- A create-only token can name who its reports are assigned to when the report itself doesn't say.
ALTER TABLE api_tokens ADD COLUMN assignee_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_assignee_scope CHECK (scope = 'create' OR assignee_id IS NULL);

-- Reports go to Maxim: the create-only tokens that already exist, and open reports nobody has yet.
UPDATE api_tokens SET assignee_id = (SELECT id FROM users WHERE username = 'maxim') WHERE scope = 'create';
INSERT INTO task_assignees (task_id, user_id)
  SELECT t.id, u.id FROM tasks t JOIN users u ON u.username = 'maxim'
  WHERE t.reported_by IS NOT NULL AND NOT t.done AND t.list = 'now'
    AND NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id);
