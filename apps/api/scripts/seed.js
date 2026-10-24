import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { pool, transaction } from '../src/db.js';
import { newToken, tokenHash } from '../src/auth.js';

const credentialsPath = new URL('../.seed-credentials.txt', import.meta.url);
const readablePassword = () => [0, 1, 2].map(() => randomBytes(4).toString('hex')).join('-');

try {
  const messages = [];
  const secrets = [];
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':todoer:seed'))");
    const users = [];
    for (const [number, username, displayName, color] of [[1, 'maxim', 'Maxim', 'blue'], [2, 'teammate', 'Teammate', 'orange']]) {
      const prefix = `SEED_USER${number}`;
      const login = process.env[`${prefix}_USERNAME`] || username;
      const name = process.env[`${prefix}_NAME`] || displayName;
      const { rows: [existing] } = await db.query('SELECT id, username FROM users WHERE lower(username) = lower($1)', [login]);
      let user = existing;
      if (existing) messages.push(`${login}: already exists (password unchanged)`);
      else {
        const { rows: [count] } = await db.query('SELECT count(*)::int AS total FROM users');
        if (count.total >= 2) throw new Error(`Two users already exist; refusing to create ${login}. Use the original seed usernames.`);
        const password = process.env[`${prefix}_PASSWORD`] || readablePassword();
        if (Buffer.byteLength(password) > 72) throw new Error(`${prefix}_PASSWORD must be at most 72 UTF-8 bytes`);
        const hash = await bcrypt.hash(password, 12);
        const { rows: [created] } = await db.query('INSERT INTO users (username, display_name, color, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, username', [login, name, color, hash]);
        user = created;
        secrets.push(`Username: ${login}\nDisplay name: ${name}\nPassword: ${password}`);
        messages.push(`Created ${login}`);
      }
      users.push(user);
      const { rows: [token] } = await db.query("SELECT id FROM api_tokens WHERE user_id = $1 AND name = 'Seed agent token'", [user.id]);
      if (token) messages.push(`${login}: seed API token already exists`);
      else {
        const secret = newToken();
        await db.query("INSERT INTO api_tokens (user_id, name, token_hash) VALUES ($1,'Seed agent token',$2)", [user.id, tokenHash(secret)]);
        secrets.push(`API token for ${login}: ${secret}`);
      }
    }
    // Serialize against concurrent task creation before checking the empty-table condition.
    await db.query('LOCK TABLE tasks IN SHARE ROW EXCLUSIVE MODE');
    const { rows: [count] } = await db.query('SELECT count(*)::int AS total FROM tasks');
    if (count.total === 0) {
      const { rows: [project] } = await db.query("INSERT INTO projects (name,color,emoji,position) VALUES ('Welcome','teal','👋',$1) RETURNING id", [Date.now()]);
      const tags = [];
      for (const [name, color] of [['getting-started', 'teal'], ['idea', 'purple']]) {
        const { rows: [tag] } = await db.query('INSERT INTO tags (name,color) VALUES ($1,$2) ON CONFLICT (lower(name)) DO UPDATE SET name = tags.name RETURNING id', [name, color]);
        tags.push(tag.id);
      }
      const examples = [
        ['Welcome to todoer 👋', 'This is your shared space. Open a task to edit its details.', 'now', 0, [0], 0],
        ['Try passing a task to your teammate', 'Use the Pass to button to hand this over.', 'now', 0, [0, 1], 0],
        ['Add your first shared project', 'Projects and tags are shared by both people.', 'now', 1, [1], 0],
        ['Drop a screenshot to capture an idea', 'Drag or paste an image anywhere in the app.', 'now', 1, [], 1],
        ['An idea for later ✨', 'Keep future changes here until you are ready.', 'later', 0, [], 1],
      ];
      for (const [index, [title, notes, list, creator, assigned, tag]] of examples.entries()) {
        const { rows: [task] } = await db.query('INSERT INTO tasks (title, notes, list, created_by, project_id, position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [title, notes, list, users[creator].id, project.id, Date.now() - index]);
        for (const assignee of assigned) await db.query('INSERT INTO task_assignees (task_id,user_id) VALUES ($1,$2)', [task.id, users[assignee].id]);
        await db.query('INSERT INTO task_tags (task_id,tag_id) VALUES ($1,$2)', [task.id, tags[tag]]);
      }
      messages.push('Created 5 friendly example tasks, a Welcome project, and two tags');
    } else messages.push('Tasks already exist; examples skipped');

    let previous = '';
    try { previous = await readFile(credentialsPath, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const content = `${previous || '# todoer seed credentials — keep private\n'}${secrets.length ? `\n${secrets.join('\n\n')}\n` : ''}`;
    await writeFile(credentialsPath, content, { mode: 0o600 });
    await chmod(credentialsPath, 0o600);
  });
  console.log([...messages, ...secrets, `Credentials file: ${credentialsPath.pathname}`].join('\n\n'));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
