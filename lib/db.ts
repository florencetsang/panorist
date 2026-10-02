/**
 * Typed data-access layer for the Panorist prototype.
 *
 * Plain SQL over the Neon serverless driver (no ORM by design). The driver speaks
 * HTTPS — one request per query, no connection state — which is exactly what a
 * serverless/edge runtime wants. Value decoding notes relied on below:
 *   - timestamptz columns come back as JS `Date`
 *   - jsonb columns come back pre-parsed (object / array / null)
 *   - bigint columns (reports.id) come back as `string` (int64 > JS safe integers)
 */

import { neon } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Fail fast with a clear message instead of an obscure HTTP error later.
  throw new Error('DATABASE_URL is not set — copy .env.example to .env.local and fill it in.');
}

/** Query function: `sql\`SELECT ...\`` (params are safely interpolated). */
export const sql = neon(connectionString);

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** The prototype's fixed category vocabulary (mirrored by a CHECK in db/schema.sql). */
export const CATEGORY_SLUGS = [
  'world',
  'asia_pacific',
  'hong_kong',
  'economics',
  'sport',
  'entertainment',
  'lifestyle',
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export type Frequency = 'daily' | 'weekly';

/** The browser PushSubscription.toJSON() payload; the web-push library consumes this shape. */
export interface PushSubscriptionJSON {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

export interface User {
  id: string;
  email: string;
  timezone: string;
  createdAt: Date;
}

export interface Preferences {
  userId: string;
  frequency: Frequency;
  /** Local wall-clock hour (0–23) in the user's timezone. */
  deliveryHour: number;
  categories: CategorySlug[];
  pushSubscription: PushSubscriptionJSON | null;
  updatedAt: Date;
}

export interface TopicSource {
  title: string;
  url: string;
}

/** One element of a report's `content` jsonb array. */
export interface TopicContent {
  category: string;
  headline: string;
  body: string;
  sources: TopicSource[];
}

export interface Report {
  id: string; // bigserial → string
  userId: string;
  /** Currently the user's frequency ('daily' | 'weekly'); left free for future kinds. */
  kind: string;
  periodStart: Date;
  periodEnd: Date;
  content: TopicContent[];
  createdAt: Date;
}

/** users ⋈ preferences, as returned by the two joined-row helpers below. */
export type UserWithPreferences = User & Preferences;

// ---------------------------------------------------------------------------
// Shared SELECT fragments
// ---------------------------------------------------------------------------

const USER_PREFS_COLUMNS = `
  u.id, u.email, u.timezone, u.created_at AS "createdAt",
  p.user_id AS "userId", p.frequency, p.delivery_hour AS "deliveryHour",
  p.categories, p.push_subscription AS "pushSubscription", p.updated_at AS "updatedAt"
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Users whose report is due this hour.
 *
 * Timezone math: `delivery_hour` is a LOCAL wall-clock hour in the user's IANA
 * timezone, but Vercel Cron ticks in UTC and hands us `currentUtcHour` (0–23).
 * We anchor a reference timestamp at "today at 00:00 UTC + currentUtcHour" and
 * let Postgres convert it per user with `AT TIME ZONE users.timezone` — the
 * server's tz database handles UTC offsets, DST and half-hour zones, so no
 * offset math lives in application code. A user is due when the local hour of
 * that instant equals `delivery_hour`.
 *
 * Frequency schedule: 'daily' users are due every day when the hour matches;
 * 'weekly' users are due only when the *local* weekday is Monday (isodow = 1) —
 * one fixed digest day keeps the prototype simple.
 *
 * Scale note: this scans the (tiny) preferences table once per hourly tick,
 * which is fine at prototype size. The `preferences(frequency, delivery_hour)`
 * index serves the constant-parameter form of this lookup if it's ever needed.
 */
export async function getUsersDueForReport(currentUtcHour: number): Promise<UserWithPreferences[]> {
  const now = new Date();
  const refInstant = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), currentUtcHour),
  );

  const rows = await sql`
    SELECT ${sql.unsafe(USER_PREFS_COLUMNS)}
    FROM preferences p
    JOIN users u ON u.id = p.user_id
    CROSS JOIN LATERAL (
      SELECT (${refInstant.toISOString()}::timestamptz AT TIME ZONE u.timezone) AS local_time
    ) lt
    WHERE p.delivery_hour = extract(hour FROM lt.local_time)::smallint
      AND (p.frequency = 'daily' OR extract(isodow FROM lt.local_time) = 1)
  `;

  return rows as unknown as UserWithPreferences[];
}

/** Fetch a single user together with their preferences (or null). */
export async function getUserWithPreferences(userId: string): Promise<UserWithPreferences | null> {
  const rows = await sql`
    SELECT ${sql.unsafe(USER_PREFS_COLUMNS)}
    FROM preferences p
    JOIN users u ON u.id = p.user_id
    WHERE u.id = ${userId}
    LIMIT 1
  `;
  return (rows[0] as unknown as UserWithPreferences) ?? null;
}

/** Insert a report; returns the new report id. */
export async function saveReport(
  userId: string,
  kind: string,
  periodStart: Date | string,
  periodEnd: Date | string,
  content: TopicContent[],
): Promise<string> {
  // The HTTP transport JSON-encodes parameters, so pass timestamps as ISO text
  // (Postgres infers timestamptz from the column) and jsonb as a JSON string.
  const toIso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);

  const rows = await sql`
    INSERT INTO reports (user_id, kind, period_start, period_end, content)
    VALUES (${userId}, ${kind}, ${toIso(periodStart)}, ${toIso(periodEnd)},
            ${JSON.stringify(content)}::jsonb)
    RETURNING id
  `;
  return (rows[0] as { id: string }).id;
}

/** A user's recent reports, newest first. */
export async function getReportsForUser(userId: string, limit = 20): Promise<Report[]> {
  const rows = await sql`
    SELECT id, user_id AS "userId", kind,
           period_start AS "periodStart", period_end AS "periodEnd",
           content, created_at AS "createdAt"
    FROM reports
    WHERE user_id = ${userId}
    ORDER BY created_at DESC, id DESC  -- id as a stable tie-breaker within one second
    LIMIT ${limit}
  `;
  return rows as unknown as Report[];
}

/** Fields of preferences that may be partially updated. */
export type PreferencesPatch = Partial<
  Pick<Preferences, 'frequency' | 'deliveryHour' | 'categories' | 'pushSubscription'>
>;

/** Partially update a user's preferences (only the provided fields are written). */
export async function updatePreferences(userId: string, patch: PreferencesPatch): Promise<void> {
  // Column names come from the fixed whitelist below (never from user input), so
  // interpolating them into the statement text is safe; all VALUES are bound as
  // $n parameters.
  const columns: Partial<Record<keyof PreferencesPatch, string>> = {
    frequency: 'frequency',
    deliveryHour: 'delivery_hour',
    categories: 'categories',
    pushSubscription: 'push_subscription',
  };

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of Object.keys(patch) as (keyof PreferencesPatch)[]) {
    const column = columns[key];
    if (!column) continue;
    const value = patch[key];
    if (key === 'pushSubscription') {
      // null must stay SQL NULL, not the JSON value 'null'.
      values.push(value === null ? null : JSON.stringify(value));
      sets.push(`${column} = $${values.length}::jsonb`);
    } else {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (sets.length === 0) return;

  values.push(userId);
  await sql.query(
    `UPDATE preferences SET ${sets.join(', ')}, updated_at = now() WHERE user_id = $${values.length}`,
    values,
  );
}

/** Store (or replace) a user's web-push subscription. */
export async function savePushSubscription(
  userId: string,
  subscription: PushSubscriptionJSON,
): Promise<void> {
  await sql`
    UPDATE preferences
    SET push_subscription = ${JSON.stringify(subscription)}::jsonb, updated_at = now()
    WHERE user_id = ${userId}
  `;
}
