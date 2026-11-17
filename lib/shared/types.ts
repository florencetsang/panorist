/**
 * Domain and wire types. Pure module — safe to import from client
 * components, scripts and server code.
 */

import type { CategorySlug } from './categories.ts';

export type Frequency = 'daily' | 'weekly';

/** The browser `PushSubscription.toJSON()` payload; web-push consumes this shape. */
export interface PushSubscriptionJSON {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

export interface User {
  id: string;
  email: string;
  /** IANA timezone name. */
  timezone: string;
  createdAt: Date;
}

export interface Preferences {
  userId: string;
  /** Local wall-clock hour (0–23) in the user's timezone, shared by both frequencies. */
  deliveryHour: number;
  /** Categories in the daily report. Both lists empty = paused. */
  dailyCategories: CategorySlug[];
  /** Categories in the weekly report (generated on the user's local Monday). */
  weeklyCategories: CategorySlug[];
  pushSubscription: PushSubscriptionJSON | null;
  updatedAt: Date;
}

export type UserWithPreferences = User & Preferences;

export type PreferencesPatch = Partial<
  Pick<Preferences, 'deliveryHour' | 'dailyCategories' | 'weeklyCategories' | 'pushSubscription'>
>;

/**
 * Identity of one generated markdown section. `frequency` fixes the window
 * length (daily = the `to` day, weekly = the 7 days ending on `to`), so the
 * window start is implied and not part of the key.
 */
export interface MarkdownCacheKey {
  category: CategorySlug;
  frequency: Frequency;
  /** ISO date (YYYY-MM-DD) the window ends on. */
  to: string;
}

/** Storage for generated markdown, injected so report generation stays DB-agnostic. */
export interface MarkdownCache {
  get(key: MarkdownCacheKey): Promise<string | null>;
  /** Idempotent — the first writer wins. */
  set(key: MarkdownCacheKey, markdown: string): Promise<void>;
}

/** One rendered report section: a cache key resolved to its markdown. */
export interface TopicContent {
  category: string;
  markdown: string;
}

/** A generated report, ready to store. */
export interface ReportDraft {
  /** App-defined kind; currently mirrors `frequency`. */
  kind: string;
  frequency: Frequency;
  periodStart: Date;
  periodEnd: Date;
  /** Pointers into markdown_cache, one per successfully generated category. */
  content: MarkdownCacheKey[];
}

export interface Report extends ReportDraft {
  /** bigserial, returned as a string by the driver. */
  id: string;
  userId: string;
  createdAt: Date;
}

export interface HydratedReport extends Report {
  topics: TopicContent[];
}

// ---------------------------------------------------------------------------
// Wire (HTTP JSON) shapes — Dates become ISO strings
// ---------------------------------------------------------------------------

type Jsonified<T, K extends keyof T> = Omit<T, K> & { [P in K]: string };

/** GET/PATCH /api/preferences response. */
export type UserWithPreferencesWire = Jsonified<UserWithPreferences, 'createdAt' | 'updatedAt'>;

/** GET /api/reports?hydrate=1 response item. */
export type HydratedReportWire = Jsonified<
  HydratedReport,
  'periodStart' | 'periodEnd' | 'createdAt'
>;
