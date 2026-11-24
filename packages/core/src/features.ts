/**
 * AI feature entitlements. A feature is available to a user when it is
 * switched on globally (server env kill switch) AND their plan includes it.
 * The server enforces this; apps only hide what the server says is off.
 */

export const FEATURE_KEYS = [
  /** "All I need to know" on highlighted events. */
  'event_insights',
  /** "Tell me more" on highlighted terms. */
  'term_insights',
  /** Explain any text the reader selects (classified into an event or a term). */
  'free_select',
  /** Saved and starred insights. */
  'insight_library',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const PLANS = ['free', 'premium'] as const;

export type Plan = (typeof PLANS)[number];

/** Everything is free for now; move keys to premium-only to gate them. */
export const PLAN_FEATURES: Record<Plan, readonly FeatureKey[]> = {
  free: FEATURE_KEYS,
  premium: FEATURE_KEYS,
};

export interface PlanLimits {
  /** Uncached AI calls (new explanations and selection lookups) per Hong Kong day. Cache hits are free. */
  dailyAiCalls: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { dailyAiCalls: 30 },
  premium: { dailyAiCalls: 300 },
};

export function isPlan(value: unknown): value is Plan {
  return typeof value === 'string' && (PLANS as readonly string[]).includes(value);
}

/** The features a plan gets, minus those switched off globally. */
export function resolveFeatures(
  plan: Plan,
  globallyEnabled: Readonly<Record<FeatureKey, boolean>>,
): FeatureKey[] {
  return PLAN_FEATURES[plan].filter((key) => globallyEnabled[key]);
}
