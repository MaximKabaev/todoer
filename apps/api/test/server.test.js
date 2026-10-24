import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function withDeadline(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Server timed out')), 10000); }),
    ]);
  } finally { clearTimeout(timer); }
}

test('production server binds default loopback or API_HOST and shuts down cleanly on SIGTERM', async (t) => {
  for (const [name, host, origin] of [
    ['default 127.0.0.1', '', 'http://127.0.0.1:4200'],
    ['explicit IPv6 loopback', '::1', 'http://[::1]:4200'],
  ]) {
    await t.test(name, async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'todoer-server-'));
      const server = spawn(process.execPath, ['src/server.js'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: { ...process.env, NODE_ENV: 'production', API_PORT: '4200', API_HOST: host, API_UPLOAD_DIR: directory },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const closed = once(server, 'close');
      let output = '';
      server.stderr.on('data', (data) => { output += data; });
      const ready = new Promise((resolve) => {
        server.stdout.on('data', (data) => {
          output += data;
          if (output.includes(`todoer API listening on ${origin}`)) resolve();
        });
      });
      try {
        await withDeadline(Promise.race([ready, closed.then(() => { throw new Error(output || 'Server exited before listening'); })]));
        const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(3000) });
        assert.equal(health.status, 200);
        assert.deepEqual(await health.json(), { ok: true });
        server.kill('SIGTERM');
        const [code, signal] = await withDeadline(closed);
        assert.equal(code, 0, output);
        assert.equal(signal, null);
      } finally {
        if (server.exitCode === null && server.signalCode === null) {
          server.kill('SIGKILL');
          await withDeadline(closed);
        }
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});
