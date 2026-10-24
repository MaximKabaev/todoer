-- Browser sessions no longer expire; only logout (or setting expires_at) ends them.
UPDATE sessions SET expires_at = 'infinity';
