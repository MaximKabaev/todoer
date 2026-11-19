// Per-type email preferences (users.email_preferences jsonb; a missing key means on). They apply on
// top of the email_notifications master switch, which turns every email off.
export const emailTypes = ['assigned', 'completed', 'updates', 'achievements', 'afk', 'seasons'];

// SQL expression returning the full preferences object with defaults filled in.
export const emailPreferencesSql = (column = 'email_preferences') =>
  `jsonb_build_object(${emailTypes.map((type) => `'${type}', COALESCE((${column}->>'${type}')::boolean, true)`).join(', ')})`;

// Whether a user row (email, email_notifications, email_preferences) wants emails of this type.
export const wantsEmail = (user, type) => Boolean(user?.email && user.email_notifications && user.email_preferences?.[type] !== false);

// Which preference a task change line belongs to. Creating a task for you or moving it to Now as part
// of assigning it to you counts as the assignment.
const assignment = new Set(['assigned it to you', 'assigned it to you for review', 'brought it back from Later after two weeks']);
const completion = new Set(['completed it', 'reopened it']);
export function changeType(change, changes) {
  if (assignment.has(change)) return 'assigned';
  if (completion.has(change)) return 'completed';
  if ((change === 'created it' || change === 'moved it to Now') && changes.some((other) => assignment.has(other))) return 'assigned';
  return 'updates';
}

// The task change lines this user still wants emailed.
export const wantedChanges = (user, changes) => changes.filter((change) => wantsEmail(user, changeType(change, changes)));
