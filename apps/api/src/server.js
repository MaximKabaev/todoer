import { app } from './app.js';
import { pool } from './db.js';

if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required');
await pool.query('SELECT 1');
const port = Number(process.env.API_PORT || 4000);
const server = app.listen(port, () => console.log(`todoer API listening on http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    const timeout = setTimeout(() => process.exit(1), 10000).unref();
    server.close(async () => {
      await pool.end();
      clearTimeout(timeout);
      process.exit(0);
    });
  });
}
server.on('error', async (error) => {
  console.error(error.message);
  await pool.end();
  process.exitCode = 1;
});
