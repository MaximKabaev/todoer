CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  display_name text NOT NULL,
  color text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_lower ON users (lower(username));

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expires_at ON sessions (expires_at);
CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Agent token',
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX api_tokens_user_id ON api_tokens (user_id);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'New Project',
  color text NOT NULL DEFAULT 'blue' CHECK (color IN ('blue','purple','pink','red','orange','yellow','green','teal','gray')),
  emoji text,
  position double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT 'gray' CHECK (color IN ('blue','purple','pink','red','orange','yellow','green','teal','gray'))
);
CREATE UNIQUE INDEX tags_name_lower ON tags (lower(name));

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  list text NOT NULL DEFAULT 'now' CHECK (list IN ('now','later')),
  due_date date,
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  position double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((done AND done_at IS NOT NULL) OR (NOT done AND done_at IS NULL))
);
CREATE INDEX tasks_open_view ON tasks (list, position DESC, created_at DESC) WHERE NOT done;
CREATE INDEX tasks_completed ON tasks (done_at DESC) WHERE done;
CREATE INDEX tasks_creator ON tasks (created_by);
CREATE INDEX tasks_project ON tasks (project_id);
CREATE TABLE task_assignees (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX task_assignees_user ON task_assignees (user_id, task_id);
CREATE TABLE task_tags (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX task_tags_tag ON task_tags (tag_id, task_id);
CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/gif','image/webp','image/heic','image/heif')),
  size integer NOT NULL CHECK (size <= 20971520 AND size > 0),
  width integer,
  height integer,
  storage_name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_task ON attachments (task_id);
