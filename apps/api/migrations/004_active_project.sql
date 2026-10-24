-- The per-user "last used project" becomes the site-wide active project selected in the menu.
-- NULL means "All projects".
ALTER TABLE users RENAME COLUMN last_project_id TO active_project_id;
