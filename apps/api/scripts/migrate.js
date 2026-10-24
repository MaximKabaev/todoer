import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { pool, transaction } from '../src/db.js';

export async function migrate() {
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':todoer:migrations'))");
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await db.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.name));
    const directory = new URL('../migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
      if (applied.has(name)) continue;
      await db.query(await readFile(new URL(name, directory), 'utf8'));
      await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      console.log(`Applied ${name}`);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await migrate(); } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await pool.end(); }
}
