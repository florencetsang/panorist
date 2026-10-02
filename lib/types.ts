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

/** users ⋈ preferences, as returned by the joined-row helpers in lib/db.ts. */
export type UserWithPreferences = User & Preferences;

/** Fields of preferences that may be partially updated. */
export type PreferencesPatch = Partial<
  Pick<Preferences, 'frequency' | 'deliveryHour' | 'categories' | 'pushSubscription'>
>;
