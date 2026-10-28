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

/** Short human label per slug, for the frontend (checkboxes, chips).
 * Prompt phrasing lives separately in lib/llm.ts — it wants sentences
 * ("Asia-Pacific news"), the UI wants compact nouns. */
export const CATEGORY_LABELS: Record<CategorySlug, string> = {
  world: 'World',
  asia_pacific: 'Asia-Pacific',
  hong_kong: 'Hong Kong',
  economics: 'Economics & Business',
  sport: 'Sport',
  entertainment: 'Entertainment',
  lifestyle: 'Lifestyle',
  technology: 'Technology',
};

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
  /** Local wall-clock hour (0–23) in the user's timezone — ONE global
   * delivery time per user, for both frequencies. */
  deliveryHour: number;
  /** Categories in the DAILY report (generated every day at deliveryHour,
   * local time). A category may appear here, in weeklyCategories, in both,
   * or in neither. */
  dailyCategories: CategorySlug[];
  /** Categories in the WEEKLY report (generated on the user's local Monday
   * at deliveryHour). */
  weeklyCategories: CategorySlug[];
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
 * which of the user's per-frequency category lists the report was generated
 * for ('daily' or 'weekly') — it drives the prompt's time window ("today"
 * vs "this week"). A local-Monday tick can produce TWO of these for one user.
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

/** Fields of preferences that may be partially updated. `frequency` and
 * `categories` are gone with the single-frequency preference: the two lists
 * above replace them, and a report's frequency is chosen per generation. */
export type PreferencesPatch = Partial<
  Pick<Preferences, 'deliveryHour' | 'dailyCategories' | 'weeklyCategories' | 'pushSubscription'>
>;

// ---------------------------------------------------------------------------
// Wire (HTTP JSON) shapes — same rows, dates as ISO strings
// ---------------------------------------------------------------------------

/** User ⋈ preferences as GET /api/preferences returns it (JSON-stringified). */
export type UserWithPreferencesWire = Omit<UserWithPreferences, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

/** GET /api/reports?hydrate=1 — a report row plus its `content` pointers
 * resolved into renderable { category, markdown } topics. Without `hydrate=1`
 * the route returns bare rows (content stays pointers). */
export type HydratedReport = Omit<Report, 'periodStart' | 'periodEnd' | 'createdAt'> & {
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  topics: TopicContent[];
};
