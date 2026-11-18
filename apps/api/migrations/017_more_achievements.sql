-- More achievements.
-- An optional birthday (MM-DD, private to its owner, set in Settings).
ALTER TABLE users ADD COLUMN birthday text
  CHECK (birthday ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');

-- When a task last left Later for Now (manually or by the Later review), so finishing it can be
-- credited as "came back from Later". later_since is cleared on that move, so record it separately.
ALTER TABLE tasks ADD COLUMN left_later_at timestamptz;
UPDATE tasks SET left_later_at = resurfaced_at WHERE resurfaced_at IS NOT NULL;

CREATE OR REPLACE FUNCTION track_later_since() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.list = 'later' AND NEW.list <> 'later' THEN
    NEW.left_later_at := now();
  END IF;
  IF NEW.list <> 'later' THEN
    NEW.later_since := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.later_since := NEW.created_at;
  ELSIF OLD.list <> 'later' THEN
    NEW.later_since := now();
  END IF;
  RETURN NEW;
END;
$$;
