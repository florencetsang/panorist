/**
 * Domain and wire types. Pure module — safe to import from client
 * components, scripts and server code.
 */

import type { CategorySlug } from './categories.ts';
import type { FeatureKey, Plan } from './features.ts';

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
  Pick<Preferences, 'deliveryHour' | 'dailyCategories' | 'weeklyCategories' | 'pushSubscription'> &
    Pick<User, 'timezone'>
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
  /** AI-detected highlights, filtered to the kinds the user is entitled to. */
  annotations?: Annotation[];
}

// ---------------------------------------------------------------------------
// AI insights
// ---------------------------------------------------------------------------

/** event → "All I need to know"; term → "Tell me more". */
export type InsightKind = 'event' | 'term';

/**
 * An AI-detected highlight in a section's markdown. `surface` occurs verbatim
 * in the markdown; `key` is the canonical, cross-user cache identity.
 */
export interface Annotation {
  kind: InsightKind;
  surface: string;
  key: string;
  displayName: string;
}

/** What to explain: a highlight, or a reader's selection resolved by the server. */
export interface InsightTarget {
  kind: InsightKind;
  key: string;
  displayName: string;
}

/** POST /api/insights body. */
export interface InsightRequest extends InsightTarget {
  /** The briefing it was opened from, linked in the library. */
  reportId?: string;
  /** The exact text the reader clicked or selected. */
  sourceText?: string;
}

/**
 * An explanation as the reader sees it. `id` is the library entry, or null
 * when the library feature is off (nothing was saved).
 */
export interface Insight extends InsightTarget {
  id: string | null;
  markdown: string;
  /** When the shared explanation was generated. */
  generatedAt: Date;
  reportId: string | null;
  sourceText: string | null;
  starredAt: Date | null;
  savedAt: Date | null;
}

export type InsightWire = Omit<Insight, 'generatedAt' | 'starredAt' | 'savedAt'> & {
  generatedAt: string;
  starredAt: string | null;
  savedAt: string | null;
};

/** GET /api/features response. */
export interface FeaturesWire {
  plan: Plan;
  features: FeatureKey[];
  /** Uncached AI calls allowed and used today (Hong Kong day). */
  dailyAiCalls: { limit: number; used: number };
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
  /** When the user first opened it; null = unread. */
  readAt: Date | null;
}

/** PATCH /api/reports result: the report's read status after the update. */
export interface ReportReadStatus {
  id: string;
  readAt: Date | null;
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

/** GET /api/reports response item. */
export type ReportWire = Omit<
  Jsonified<Report, 'periodStart' | 'periodEnd' | 'createdAt'>,
  'readAt'
> & {
  readAt: string | null;
};

/** GET /api/reports/:id response (and GET /api/reports?hydrate=1 items). */
export type HydratedReportWire = Omit<
  Jsonified<HydratedReport, 'periodStart' | 'periodEnd' | 'createdAt'>,
  'readAt'
> & { readAt: string | null };

/** PATCH /api/reports response. */
export type ReportReadStatusWire = Omit<ReportReadStatus, 'readAt'> & { readAt: string | null };
