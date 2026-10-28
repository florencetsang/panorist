/**
 * Typed data-access layer for the Panorist prototype. Server-only.
 *
 * Plain SQL over the Neon serverless driver (no ORM by design). The driver speaks
 * HTTPS — one request per query, no connection state — which is exactly what a
 * serverless/edge runtime wants. Value decoding notes relied on below:
 *   - timestamptz columns come back as JS `Date`
 *   - jsonb columns come back pre-parsed (object / array / null)
 *   - bigint columns (reports.id) come back as `string` (int64 > JS safe integers)
 *
 * Types are imported from `./types.ts`, a pure module that is safe to import from
 * client code; everything in here must stay on the server.
 */

import 'server-only'; // any client-side import of this module fails the build

import { neon } from '@neondatabase/serverless';
import type {
  MarkdownCache,
  MarkdownCacheKey,
  PreferencesPatch,
  PushSubscriptionJSON,
  Report,
  ReportDraft,
  TopicContent,
  UserWithPreferences,
} from './types.ts';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Fail fast with a clear message instead of an obscure HTTP error later.
  throw new Error('DATABASE_URL is not set — copy .env.example to .env.local and fill it in.');
}

/** Query function: `sql\`SELECT ...\`` (params are safely interpolated). */
export const sql = neon(connectionString);

// ---------------------------------------------------------------------------
// Shared SELECT fragments
// ---------------------------------------------------------------------------

const USER_PREFS_COLUMNS = `
  u.id, u.email, u.timezone, u.created_at AS "createdAt",
  p.user_id AS "userId", p.delivery_hour AS "deliveryHour",
  p.daily_categories AS "dailyCategories", p.weekly_categories AS "weeklyCategories",
  p.push_subscription AS "pushSubscription", p.updated_at AS "updatedAt"
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Users due for AT LEAST ONE report this hour (the /api/generate worker then
 * decides per frequency — on a local Monday a user can be due for two).
 *
 * Timezone math: `delivery_hour` is a LOCAL wall-clock hour in the user's IANA
 * timezone, but Vercel Cron ticks in UTC and hands us `currentUtcHour` (0–23).
 * We anchor a reference timestamp at "today at 00:00 UTC + currentUtcHour" and
 * let Postgres convert it per user with `AT TIME ZONE users.timezone` — the
 * server's tz database handles UTC offsets, DST and half-hour zones, so no
 * offset math lives in application code.
 *
 * Schedule: a user is due when the local hour matches AND at least one of
 * their per-frequency lists wants a report now — `daily_categories` is due
 * every day; `weekly_categories` is due only when the *local* weekday is
 * Monday (isodow = 1) — one fixed digest day keeps the prototype simple.
 * Both lists empty ("paused") matches nothing, so such a user is never due
 * and the worker will simply no-op for them.
 *
 * Scale note: this scans the (tiny) preferences table once per hourly tick,
 * which is fine at prototype size. The `preferences(delivery_hour)` index
 * serves the constant-parameter form of this lookup if it's ever needed.
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
      AND (
        cardinality(p.daily_categories) > 0
        OR (extract(isodow FROM lt.local_time) = 1 AND cardinality(p.weekly_categories) > 0)
      )
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

/**
 * ReportDraft with the period fields relaxed to ISO strings: the HTTP
 * transport JSON-encodes parameters, and Postgres infers timestamptz from the
 * column — the driver must not be trusted to serialize Date. (types.ts stays
 * client-safe with plain `Date`, which is what rows come back as.)
 */
type ReportDraftInput = Omit<ReportDraft, 'periodStart' | 'periodEnd'> & {
  periodStart: Date | string;
  periodEnd: Date | string;
};

/** Insert a generated report; returns the new report id. */
export async function saveReport(userId: string, draft: ReportDraftInput): Promise<string> {
  const toIso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);

  const rows = await sql`
    INSERT INTO reports (user_id, kind, frequency, period_start, period_end, content)
    VALUES (${userId}, ${draft.kind}, ${draft.frequency},
            ${toIso(draft.periodStart)}, ${toIso(draft.periodEnd)},
            ${JSON.stringify(draft.content)}::jsonb)
    RETURNING id
  `;
  return (rows[0] as { id: string }).id;
}

// ---------------------------------------------------------------------------
// Markdown cache — the Postgres-backed MarkdownCache passed to generateReport
// ---------------------------------------------------------------------------

/** Look up one cached markdown by its exact prompt inputs; null on miss. */
export async function getCachedMarkdown(key: MarkdownCacheKey): Promise<string | null> {
  const rows = await sql`
    SELECT markdown FROM markdown_cache
    WHERE category = ${key.category} AND frequency = ${key.frequency}
      AND to_date = ${key.to}
    LIMIT 1
  `;
  return (rows[0] as { markdown: string } | undefined)?.markdown ?? null;
}

/**
 * Store one markdown under its key. ON CONFLICT DO NOTHING: when racing cron
 * invocations generate the same category+window concurrently, the first
 * writer wins and the loser's write is discarded harmlessly (both callers
 * still return the same valid key).
 */
export async function saveCachedMarkdown(key: MarkdownCacheKey, markdown: string): Promise<void> {
  await sql`
    INSERT INTO markdown_cache (category, frequency, to_date, markdown)
    VALUES (${key.category}, ${key.frequency}, ${key.to}, ${markdown})
    ON CONFLICT (category, frequency, to_date) DO NOTHING
  `;
}

/** The MarkdownCache implementation the cron route injects into generateReport. */
export const dbMarkdownCache: MarkdownCache = {
  get: getCachedMarkdown,
  set: saveCachedMarkdown,
};

/**
 * Resolve a stored report's content pointers into hydrated { category,
 * markdown } sections — this is what the frontend renders. A missing cache
 * row should be impossible (generateReport only points at rows it stored),
 * so it degrades to empty markdown rather than throwing.
 */
export async function getReportMarkdown(content: MarkdownCacheKey[]): Promise<TopicContent[]> {
  return Promise.all(
      content.map(async (key) => ({
        category: key.category,
        markdown: (await getCachedMarkdown(key)) ?? '',
      })),
  );
}

/** A user's recent reports, newest first. */
export async function getReportsForUser(userId: string, limit = 20): Promise<Report[]> {
  const rows = await sql`
    SELECT id, user_id AS "userId", kind, frequency,
           period_start AS "periodStart", period_end AS "periodEnd",
           content, created_at AS "createdAt"
    FROM reports
    WHERE user_id = ${userId}
    ORDER BY created_at DESC, id DESC  -- id as a stable tie-breaker within one second
    LIMIT ${limit}
  `;
  return rows as unknown as Report[];
}

/** Partially update a user's preferences (only the provided fields are written). */
export async function updatePreferences(userId: string, patch: PreferencesPatch): Promise<void> {
  // Column names come from the fixed whitelist below (never from user input), so
  // interpolating them into the statement text is safe; all VALUES are bound as
  // $n parameters. The per-frequency lists bind as plain array parameters, the
  // same way the old global `categories` list did.
  const columns: Partial<Record<keyof PreferencesPatch, string>> = {
    deliveryHour: 'delivery_hour',
    dailyCategories: 'daily_categories',
    weeklyCategories: 'weekly_categories',
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
