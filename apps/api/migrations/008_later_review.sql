-- Preserve the time spent in Later independently of ordinary edits.
ALTER TABLE tasks ADD COLUMN later_since timestamptz;
UPDATE tasks SET later_since = created_at WHERE list = 'later';
CREATE INDEX tasks_later_review ON tasks (later_since) WHERE list = 'later' AND NOT done;

CREATE FUNCTION track_later_since() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
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
CREATE TRIGGER tasks_track_later_since BEFORE INSERT OR UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION track_later_since();
