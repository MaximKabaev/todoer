import { pool } from '../db.js';
import { addMonths, currentSeason, describeSeason, labelFor, loadScoreRows, scoreFor, seasonBoundaries } from './score.js';
import { notificationsConfigured, sendEmail } from './notifications.js';
import { wantsEmail } from './email-preferences.js';

// Seasons: at every boundary (midnight on the 1st, SCORE_TIMEZONE) the finished season's result is
// frozen in `seasons`: each person's final score, the score they carry into the next season after
// the soft reset, and the winner (null = tie). Decided once, by the AFK worker right after the last
// day's penalty, then both people are emailed.
const DAY = 24 * 60 * 60 * 1000;
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export async function finalizeSeasons(now = new Date(), db = pool) {
  const ended = seasonBoundaries(now);
  if (!ended.length) return [];
  const { rows: done } = await db.query('SELECT id FROM seasons');
  const decided = new Set(done.map((row) => row.id));
  const missing = ended.filter(({ day }) => !decided.has(addMonths(day, -1).slice(0, 7)));
  if (!missing.length) return [];
  const [rows, { rows: users }] = await Promise.all([loadScoreRows(db), db.query('SELECT id FROM users ORDER BY created_at, id')]);
  const created = [];
  for (const { day, at } of missing) {
    const season = describeSeason(addMonths(day, -1));
    const scores = Object.fromEntries(users.map((user) => [user.id, scoreFor(rows, user.id, at)]));
    const carried = Object.fromEntries(users.map((user) => [user.id, scoreFor(rows, user.id, new Date(at.getTime() + 1))]));
    const ranked = users.map((user) => user.id).sort((a, b) => scores[b] - scores[a]);
    const winner = ranked.length > 1 && scores[ranked[0]] > scores[ranked[1]] ? ranked[0] : null;
    const { rowCount } = await db.query(`INSERT INTO seasons (id, number, starts_at, ends_at, scores, carried, winner_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    [season.id, season.number, season.startsAt, season.endsAt, JSON.stringify(scores), JSON.stringify(carried), winner]);
    if (rowCount) created.push({ ...season, scores, carried, winnerId: winner });
  }
  return created;
}

const final = (row, userId) => (row.scores[userId] === undefined ? null
  : { score: row.scores[userId], label: labelFor(row.scores[userId]), carriedOver: row.carried[userId] });

// A frozen season from the viewer's point of view.
export function seasonResult(row, user, teammate) {
  return {
    id: row.id, number: row.number, name: describeSeason(`${row.id}-01`).name,
    startsAt: row.starts_at, endsAt: row.ends_at,
    winner: row.winner_id && row.winner_id === user.id ? 'me' : row.winner_id && row.winner_id === teammate?.id ? 'teammate' : null,
    me: final(row, user.id) ?? { score: null, label: null, carriedOver: null },
    teammate: teammate ? final(row, teammate.id) : null,
  };
}

// { season, seasons }: the season in progress (with the tally and the last result) and every finished one, newest first.
export async function seasonView(db, user, teammate, now = new Date()) {
  const { rows } = await db.query('SELECT * FROM seasons ORDER BY ends_at DESC');
  const seasons = rows.map((row) => seasonResult(row, user, teammate));
  const current = currentSeason(now);
  const count = (winner) => seasons.filter((season) => season.winner === winner).length;
  return {
    season: {
      ...current,
      daysLeft: Math.max(0, Math.ceil((current.endsAt - now) / DAY)),
      tally: { me: count('me'), teammate: count('teammate'), ties: count(null) },
      previous: seasons[0] ?? null,
    },
    seasons,
  };
}

export function composeSeasonEmail({ recipient, people, season, tally }) {
  const base = process.env.PUBLIC_WEB_URL?.replace(/\/+$/, '') || '';
  const winner = people.find((person) => person.id === season.winner_id);
  const you = winner?.id === recipient.id;
  const name = describeSeason(`${season.id}-01`).name;
  const subject = !winner ? `Season ${season.number} (${name}) ended in a tie`
    : you ? `You won Season ${season.number} (${name})!` : `${winner.display_name} won Season ${season.number} (${name})`;
  const headline = !winner ? `Season ${season.number} ended in a tie at ${season.scores[people[0].id]}.`
    : `${you ? 'You' : winner.display_name} won Season ${season.number} with ${season.scores[winner.id]} points.`;
  const self = (person) => `${person.display_name}${person.id === recipient.id ? ' (you)' : ''}`;
  const finals = people.map((person) => `${self(person)}: ${season.scores[person.id]} · ${labelFor(season.scores[person.id])}`);
  const overall = `Seasons won: ${people.map((person) => `${person.display_name} ${tally[person.id] ?? 0}`).join(', ')}${tally.ties ? `, ${tally.ties} tied` : ''}`;
  const fresh = `New season, fresh start: ${people.map((person) => `${person.display_name} ${season.carried[person.id]}`).join(', ')}.`;
  const text = [`Hi ${recipient.display_name},`, '', headline, '', 'Final scores', ...finals.map((row) => `  ${row}`), '', overall, fresh,
    ...(base ? ['', `${base}/stats`] : []), '', 'You get these because email notifications are on in todoer Settings.'].join('\n');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2328;max-width:560px">
<p>Hi ${escape(recipient.display_name)},</p>
<div style="margin:16px 0;padding:12px 16px;border:1px solid #fde68a;border-radius:12px;background:#fffbeb">
<div style="font-weight:700;color:#92400e;margin-bottom:6px">${winner ? '🏆 ' : ''}Season ${season.number} · ${escape(name)}</div>
<div>${escape(headline)}</div>
</div>
<div style="margin:16px 0;padding:12px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb">
<div style="font-weight:600;margin-bottom:6px">Final scores</div>
${people.map((person) => `<div style="color:#4b5563">${escape(self(person))}: <strong style="color:#1f2328">${season.scores[person.id]}</strong> · ${escape(labelFor(season.scores[person.id]))}</div>`).join('\n')}
<div style="margin-top:8px;color:#4b5563">${escape(overall)}</div>
<div style="margin-top:4px;color:#4b5563">${escape(fresh)}</div>
${base ? `<div style="margin-top:8px"><a href="${escape(base)}/stats" style="color:#1f2328">See the stats</a></div>` : ''}
</div>
<p style="color:#9ca3af;font-size:12px">You get these because email notifications are on in todoer Settings.</p>
</div>`;
  return { subject, text, html };
}

// Email both people about seasons decided in the last 3 days and not yet announced; retries on later ticks.
export async function sendSeasonEmails({ send = sendEmail, now = new Date(), db = pool } = {}) {
  if (!notificationsConfigured()) return 0;
  const { rows: pending } = await db.query('SELECT * FROM seasons WHERE NOT emailed AND ends_at >= $1 ORDER BY ends_at',
    [new Date(now.getTime() - 3 * DAY)]);
  if (!pending.length) return 0;
  const { rows: people } = await db.query('SELECT id, display_name, email, email_notifications, email_preferences FROM users ORDER BY created_at, id');
  let sent = 0;
  for (const season of pending) {
    const { rows: wins } = await db.query(`SELECT winner_id, count(*)::int AS n FROM seasons WHERE ends_at <= $1 GROUP BY winner_id`, [season.ends_at]);
    const tally = Object.fromEntries(wins.map((row) => [row.winner_id ?? 'ties', row.n]));
    let ok = true;
    for (const recipient of people) {
      if (!wantsEmail(recipient, 'seasons')) continue;
      try {
        await send({ to: recipient.email, idempotencyKey: `todoer-season-${season.id}-${recipient.id}`, ...composeSeasonEmail({ recipient, people, season, tally }) });
        sent++;
      } catch (error) {
        ok = false;
        console.error(`Season email to user ${recipient.id} failed: ${error.message}`);
      }
    }
    if (ok) await db.query('UPDATE seasons SET emailed = true WHERE id = $1', [season.id]);
  }
  return sent;
}
