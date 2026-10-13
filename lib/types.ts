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

/** The window a report covers (e.g. last 24h for daily, last 7 days for weekly). */
export interface DateRange {
  start: Date;
  end: Date;
}

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
 * One element of a report's `content` jsonb array: the LLM's markdown for one
 * subscribed category, stored verbatim; the slug labels the section for
 * rendering (the model's markdown is never rewritten).
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
  content: TopicContent[];
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
