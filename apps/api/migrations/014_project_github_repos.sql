-- A project can have several GitHub repos (e.g. a backend and a separate frontend repo).
-- github_repo is superseded but kept, so the previous API build keeps working during a deploy.
ALTER TABLE projects ADD COLUMN github_repos text[] NOT NULL DEFAULT '{}';
UPDATE projects SET github_repos = ARRAY[github_repo] WHERE github_repo IS NOT NULL;
