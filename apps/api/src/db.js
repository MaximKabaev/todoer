import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

export const apiRoot = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });

const schema = process.env.API_DB_SCHEMA;
if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid API_DB_SCHEMA');
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ...(schema ? { options: `-c search_path=${schema}` } : {}),
});

export async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
