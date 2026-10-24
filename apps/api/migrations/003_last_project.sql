ALTER TABLE users ADD COLUMN last_project_id uuid NULL REFERENCES projects(id) ON DELETE SET NULL;
