/**
 * Shared types for the Panorist prototype.
 *
 * Pure module — no imports, no environment access — safe to import from client
 * components, scripts, and server code alike. Everything that touches the
 * database lives in `lib/db.ts`, which is guarded by `import 'server-only'`.
 */

/** The prototype's fixed category vocabulary (mirrored by a CHECK in db/schema.sql). */
export const CATEGORY_SLUGS = [
  'world',
  'asia_pacific',
  'hong_kong',
  'economics',
  'sport',
  'entertainment',
  'lifestyle',
  'technology',
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

/**
 * The cache identity of one LLM call. `to` is the ISO date (YYYY-MM-DD) the
 * window ends on ("today"), and `frequency` pins the window length — daily =
 * that one day, weekly = the 7 days ending on `to` — so `from` is implied
 * and kept out of the key. Callers must derive weekly ranges as to − 7 days,
 * or cache rows get shared across slightly different windows.
 */
export interface MarkdownCacheKey {
  category: string;
  frequency: Frequency;
  to: string;
}

/**
 * Pluggable storage for generated markdown, injected into generateReport so
 * lib/llm.ts itself stays DB-free (the original constraint). Implemented
 * over the markdown_cache table in lib/db.ts for the cron route; tests pass
 * an in-memory Map.
 */
export interface MarkdownCache {
  /** Cached markdown for this key, or null on a miss. */
  get(key: MarkdownCacheKey): Promise<string | null>;
  /** Store markdown under this key; idempotent — first writer wins. */
  set(key: MarkdownCacheKey, markdown: string): Promise<void>;
}

/**
 * One HYDRATED section of a stored report: a cache pointer resolved back
 * into { category, markdown } (see getReportMarkdown in lib/db.ts). Report
 * rows store only the pointers (MarkdownCacheKey[]), not the markdown.
 */
export interface TopicContent {
  category: string;
  markdown: string;
}

/**
 * A freshly generated report, ready to be stored: everything a `reports` row
 * needs except the DB-assigned id, user and created_at. `frequency` records
 * what the user asked for at generation time — it drove the prompt's window
 * ("today" vs "this week").
 */
export interface ReportDraft {
  /** App-defined kind; currently mirrors `frequency`, left free for future kinds. */
  kind: string;
  frequency: Frequency;
  periodStart: Date;
  periodEnd: Date;
  /** The surviving cache pointers, one per subscribed category — the markdown
   * itself lives in markdown_cache and is resolved by getReportMarkdown. */
  content: MarkdownCacheKey[];
}

export interface Report extends ReportDraft {
  id: string; // bigserial → string
  userId: string;
  createdAt: Date;
}

/** users ⋈ preferences, as returned by the joined-row helpers in lib/db.ts. */
export type UserWithPreferences = User & Preferences;

/** Fields of preferences that may be partially updated. */
export type PreferencesPatch = Partial<
  Pick<Preferences, 'frequency' | 'deliveryHour' | 'categories' | 'pushSubscription'>
>;
