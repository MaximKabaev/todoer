-- Each project can name its GitHub repo ("owner/name"), shown as a link on the project.
ALTER TABLE projects ADD COLUMN github_repo text;
