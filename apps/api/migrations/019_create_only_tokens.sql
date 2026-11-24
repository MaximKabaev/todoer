-- Create-only tokens: can only add tasks to one project (e.g. error reports from another server).
-- Deleting the project revokes its create-only tokens; they must never fall back to full access.
-- Their secrets start with tdc_, which API builds older than this migration reject outright.
ALTER TABLE api_tokens ADD COLUMN scope text NOT NULL DEFAULT 'full' CHECK (scope IN ('full', 'create'));
ALTER TABLE api_tokens ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_scope_project CHECK ((scope = 'create') = (project_id IS NOT NULL));

-- Who reported a task that came in through a create-only token. Null for every task made by a person.
ALTER TABLE tasks ADD COLUMN reported_by text;

-- Report ids already received per project, so a retried report never becomes a second task.
-- task_id has no foreign key on purpose: the id stays known after its task is moved or deleted.
CREATE TABLE task_external_ids (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  task_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, external_id)
);
