/**
 * Feature entitlements on the server: a feature is on for a user when the
 * global kill switch is on AND their plan includes it (packages/core/features).
 * Enforced here, in the API layer — the apps only hide what is off.
 */

import 'server-only';

import { PLAN_LIMITS, resolveFeatures, type FeatureKey, type Plan } from '@panorist/core/features';
import type { InsightKind, TopicContent } from '@panorist/core/types';
import { isAnnotation } from '@panorist/core/insights';
import { getUserPlan } from './db/users.ts';
import { env } from './env.ts';
import { jsonError } from './http.ts';

export interface Entitlements {
  plan: Plan;
  features: FeatureKey[];
  dailyAiCalls: number;
}

export function entitlementsFor(plan: Plan): Entitlements {
  return {
    plan,
    features: resolveFeatures(plan, env.featureSwitches()),
    dailyAiCalls: PLAN_LIMITS[plan].dailyAiCalls,
  };
}

/** Null when the user doesn't exist. */
export async function getEntitlements(userId: string): Promise<Entitlements | null> {
  const plan = await getUserPlan(userId);
  return plan ? entitlementsFor(plan) : null;
}

export const FEATURE_FOR_KIND: Record<InsightKind, FeatureKey> = {
  event: 'event_insights',
  term: 'term_insights',
};

/** The highlight kinds a user may see. */
export function entitledKinds(features: readonly FeatureKey[]): InsightKind[] {
  return (Object.keys(FEATURE_FOR_KIND) as InsightKind[]).filter((kind) =>
    features.includes(FEATURE_FOR_KIND[kind]),
  );
}

/** Keep only valid highlights of the given kinds (none at all when the list is empty). */
export function filterTopicAnnotations<T extends { topics: TopicContent[] }>(
  report: T,
  kinds: readonly InsightKind[],
): T {
  return {
    ...report,
    topics: report.topics.map((topic) => ({
      ...topic,
      annotations: (topic.annotations ?? []).filter(
        (a) => isAnnotation(a) && kinds.includes(a.kind),
      ),
    })),
  };
}

/** Detect highlights at generation time only when some highlight kind is switched on. */
export function highlightDetectionEnabled(): boolean {
  const switches = env.featureSwitches();
  return switches.event_insights || switches.term_insights;
}

export function featureUnavailable(): Response {
  return jsonError(403, 'this feature is not available on your plan');
}

export function aiLimitReached(): Response {
  return jsonError(429, 'daily AI limit reached — try again tomorrow');
}
