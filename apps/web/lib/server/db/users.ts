/** Users and their preferences (one row each, joined). */

import 'server-only';

import type {
  PreferencesPatch,
  PushSubscriptionJSON,
  UserWithPreferences,
} from '@panorist/core/types';
import { isTimeZone } from '@panorist/core/validation';

import { db } from './client.ts';

const USER_PREFS_COLUMNS = `
  u.id, u.email, u.timezone, u.created_at AS "createdAt",
  p.user_id AS "userId", p.delivery_hour AS "deliveryHour",
  p.daily_categories AS "dailyCategories", p.weekly_categories AS "weeklyCategories",
  p.push_subscription AS "pushSubscription", p.updated_at AS "updatedAt"
`;

export async function getUserWithPreferences(userId: string): Promise<UserWithPreferences | null> {
  const rows = await db()`
    SELECT ${db().unsafe(USER_PREFS_COLUMNS)}
    FROM preferences p
    JOIN users u ON u.id = p.user_id
    WHERE u.id = ${userId}
  `;
  return (rows[0] as UserWithPreferences | undefined) ?? null;
}

/**
 * Users due for at least one report at `instant` (truncated to the hour).
 *
 * `delivery_hour` is a local wall-clock hour, so Postgres converts the
 * instant into each user's timezone (`AT TIME ZONE` handles DST and
 * half-hour offsets). Daily lists are due every day; weekly lists only on
 * the user's local Monday (isodow = 1). Paused users (both lists empty)
 * never match.
 */
export async function getUsersDueForReport(instant: Date): Promise<UserWithPreferences[]> {
  const hour = new Date(instant);
  hour.setUTCMinutes(0, 0, 0);
  const rows = await db()`
    SELECT ${db().unsafe(USER_PREFS_COLUMNS)}
    FROM preferences p
    JOIN users u ON u.id = p.user_id
    CROSS JOIN LATERAL (
      SELECT (${hour.toISOString()}::timestamptz AT TIME ZONE u.timezone) AS local_time
    ) lt
    WHERE p.delivery_hour = extract(hour FROM lt.local_time)::smallint
      AND (
        cardinality(p.daily_categories) > 0
        OR (extract(isodow FROM lt.local_time) = 1 AND cardinality(p.weekly_categories) > 0)
      )
  `;
  return rows as UserWithPreferences[];
}

/** Column whitelist: names are interpolated into SQL, values are always bound. */
const PATCH_COLUMNS: Record<Exclude<keyof PreferencesPatch, 'timezone'>, string> = {
  deliveryHour: 'delivery_hour',
  dailyCategories: 'daily_categories',
  weeklyCategories: 'weekly_categories',
  pushSubscription: 'push_subscription',
};

/**
 * Partially update preferences (and the user's timezone, which lives on
 * `users`) and return the stored row, or null when the user doesn't exist.
 * An empty patch is a plain read.
 */
export async function updatePreferences(
  userId: string,
  patch: PreferencesPatch,
): Promise<UserWithPreferences | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of Object.keys(PATCH_COLUMNS) as (keyof typeof PATCH_COLUMNS)[]) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (key === 'pushSubscription') {
      // null must stay SQL NULL, not the JSON value 'null'.
      values.push(value === null ? null : JSON.stringify(value));
      sets.push(`${PATCH_COLUMNS[key]} = $${values.length}::jsonb`);
    } else {
      values.push(value);
      sets.push(`${PATCH_COLUMNS[key]} = $${values.length}`);
    }
  }
  const hasTimezone = patch.timezone !== undefined;
  if (sets.length === 0 && !hasTimezone) return getUserWithPreferences(userId);

  values.push(userId);
  const userParam = `$${values.length}`;
  let timezoneSql = 'timezone';
  if (hasTimezone) {
    values.push(patch.timezone);
    timezoneSql = `$${values.length}`;
  }
  // Both tables in one statement: the CTE updates users, the outer UPDATE
  // preferences, and RETURNING reports the new timezone from the CTE.
  const rows = await db().query(
    `WITH u AS (
       UPDATE users SET timezone = ${timezoneSql}
       WHERE id = ${userParam}
       RETURNING id, email, timezone, created_at
     )
     UPDATE preferences p
     SET ${[...sets, 'updated_at = now()'].join(', ')}
     FROM u
     WHERE u.id = p.user_id
     RETURNING ${USER_PREFS_COLUMNS}`,
    values,
  );
  return (rows[0] as UserWithPreferences | undefined) ?? null;
}

/** Store (or replace) a web-push subscription. Returns false when the user doesn't exist. */
export async function savePushSubscription(
  userId: string,
  subscription: PushSubscriptionJSON | null,
): Promise<boolean> {
  return (await updatePreferences(userId, { pushSubscription: subscription })) !== null;
}

export type LinkResult =
  | { status: 'linked'; userId: string }
  /** An account already has this email, and the sign-in hasn't proven ownership. */
  | { status: 'email-unverified' }
  /** The auth user no longer exists (deleted account; its JWT hasn't expired yet). */
  | { status: 'gone' };

/**
 * Map an auth identity to our `users` row, creating it (with paused default
 * preferences) on first sight. An existing row with the same email — the dev
 * seed, or one left by a deleted auth user — is adopted, but only for a
 * verified email, so an unverified sign-up can't take over someone else's
 * reports.
 *
 * The common case (already linked) is one indexed lookup.
 */
export async function linkAppUser(
  identity: { authUserId: string; email: string; emailVerified: boolean },
  timezoneHint: string | null,
): Promise<LinkResult> {
  const linked = await db()`SELECT id FROM users WHERE auth_user_id = ${identity.authUserId}`;
  if (linked.length > 0) return { status: 'linked', userId: (linked[0] as { id: string }).id };

  const email = identity.email.toLowerCase();
  const existing = await db()`
    SELECT id, auth_user_id AS "authUserId" FROM users WHERE lower(email) = ${email}
  `;
  if (existing.length > 0) {
    const row = existing[0] as { id: string; authUserId: string | null };
    if (!identity.emailVerified) return { status: 'email-unverified' };
    // A row linked to another auth user is taken over too: Neon Auth emails
    // are unique and can't be changed, so that auth user was deleted (e.g.
    // the account was recreated) and the reports belong to this address.
    const adopted = await db()`
      UPDATE users SET auth_user_id = ${identity.authUserId}
      WHERE id = ${row.id} AND auth_user_id IS NOT DISTINCT FROM ${row.authUserId}
      RETURNING id
    `;
    if (adopted.length > 0) return { status: 'linked', userId: row.id };
    return linkAppUser(identity, timezoneHint); // lost a race with a concurrent request
  }

  const timezone = isTimeZone(timezoneHint) ? timezoneHint : 'UTC';
  // One statement, so a user row never exists without its preferences. The
  // auth user must still exist: a deleted account's mobile JWT stays valid
  // for up to 15 minutes and must not recreate the account.
  const created = await db()`
    WITH auth AS (
      SELECT EXISTS (SELECT 1 FROM neon_auth."user" WHERE id::text = ${identity.authUserId}) AS ok
    ), u AS (
      INSERT INTO users (email, auth_user_id, timezone)
      SELECT ${email}, ${identity.authUserId}, ${timezone} FROM auth WHERE auth.ok
      ON CONFLICT DO NOTHING
      RETURNING id
    ), p AS (
      INSERT INTO preferences (user_id) SELECT id FROM u
    )
    SELECT (SELECT ok FROM auth) AS "authExists", (SELECT id FROM u) AS id
  `;
  const row = created[0] as { authExists: boolean; id: string | null } | undefined;
  if (row && !row.authExists) return { status: 'gone' };
  if (row?.id) return { status: 'linked', userId: row.id };
  return linkAppUser(identity, timezoneHint); // lost a race with a concurrent request
}

/**
 * Delete an account: our `users` row (preferences and reports cascade) and
 * the Neon Auth user (its sessions and linked accounts cascade), atomically.
 * Shared `markdown_cache` rows are kept. Returns false when nothing matched.
 */
export async function deleteAccount(userId: string, authUserId: string): Promise<boolean> {
  const [app, auth] = await db().transaction((sql) => [
    sql`DELETE FROM users WHERE id = ${userId} AND auth_user_id = ${authUserId} RETURNING id`,
    sql`DELETE FROM neon_auth."user" WHERE id::text = ${authUserId} RETURNING id`,
  ]);
  return (app?.length ?? 0) > 0 || (auth?.length ?? 0) > 0;
}
