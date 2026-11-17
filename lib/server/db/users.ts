/** Users and their preferences (one row each, joined). */

import 'server-only';

import type {
  PreferencesPatch,
  PushSubscriptionJSON,
  UserWithPreferences,
} from '../../shared/types.ts';
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
const PATCH_COLUMNS: Record<keyof PreferencesPatch, string> = {
  deliveryHour: 'delivery_hour',
  dailyCategories: 'daily_categories',
  weeklyCategories: 'weekly_categories',
  pushSubscription: 'push_subscription',
};

/**
 * Partially update preferences and return the stored row, or null when the
 * user doesn't exist. An empty patch is a plain read.
 */
export async function updatePreferences(
  userId: string,
  patch: PreferencesPatch,
): Promise<UserWithPreferences | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of Object.keys(PATCH_COLUMNS) as (keyof PreferencesPatch)[]) {
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
  if (sets.length === 0) return getUserWithPreferences(userId);

  values.push(userId);
  const rows = await db().query(
    `UPDATE preferences p
     SET ${sets.join(', ')}, updated_at = now()
     FROM users u
     WHERE u.id = p.user_id AND p.user_id = $${values.length}
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
