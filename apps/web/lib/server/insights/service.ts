/**
 * Wiring for AI insights: the services with their production dependencies
 * (Gemini, Postgres, quotas). Routes call these; tests use the services
 * directly with stubs.
 */

import 'server-only';

import { DELIVERY_TIMEZONE } from '@panorist/core/delivery';
import { markdownParagraphs } from '@panorist/core/markdown';
import type { Insight, InsightRequest } from '@panorist/core/types';
import {
  consumeAiCall,
  dbAliasStore,
  dbAnnotationStore,
  canonicalDisplayName,
  dbExplanationStore,
  getReportAnnotations,
  saveUserInsight,
} from '../db/insights.ts';
import { getHydratedReportForUser } from '../db/reports.ts';
import { env } from '../env.ts';
import { highlightDetectionEnabled, type Entitlements } from '../features.ts';
import { getLlmProvider } from '../llm/index.ts';
import { localDate } from '../reports/period.ts';
import { mapLimit } from '../util/async.ts';
import { createSectionAnnotator, type SectionAnnotator } from './annotate.ts';
import { getOrCreateExplanation, type ReadyExplanation } from './explain.ts';
import { resolveSelection, type ResolveResult } from './resolve.ts';

/** The Hong Kong day quotas are counted in. */
export const aiDay = (now: Date): string => localDate(DELIVERY_TIMEZONE, now);

function quota(userId: string, entitlements: Entitlements, now: Date): () => Promise<boolean> {
  return () =>
    consumeAiCall(userId, aiDay(now), entitlements.dailyAiCalls, env.aiGlobalDailyLimit());
}

/** Term explanations pre-generated per newly annotated section, when AI_TERM_PREFETCH is on. */
const PREFETCH_CONCURRENCY = 2;

/**
 * The annotator report generation runs after caching each section, or
 * undefined when highlights are switched off globally.
 */
export function defaultSectionAnnotator(): SectionAnnotator | undefined {
  if (!highlightDetectionEnabled()) return undefined;
  const llm = getLlmProvider();
  const models = env.insightModels();
  const prefetch = env.termPrefetch() && env.featureSwitches().term_insights;
  return createSectionAnnotator({
    llm,
    model: models.lite,
    store: dbAnnotationStore,
    onAnnotated: prefetch
      ? async (annotations) => {
          const terms = annotations.filter((a) => a.kind === 'term');
          await mapLimit(terms, PREFETCH_CONCURRENCY, async (term) => {
            try {
              await getOrCreateExplanation(term, {
                llm,
                store: dbExplanationStore,
                models,
                consumeQuota: async () => true,
                now: new Date(),
              });
            } catch (err) {
              console.error(`[insights] prefetch "${term.key}" failed`, err);
            }
          });
        }
      : undefined,
  });
}

export type ExplainForUserResult =
  | { status: 'ready'; insight: Insight }
  | { status: 'pending' }
  | { status: 'quota-exceeded' }
  /** Not a highlight or resolved selection the server produced. */
  | { status: 'unknown-target' };

function asUnsavedInsight(explanation: ReadyExplanation, request: InsightRequest): Insight {
  return {
    id: null,
    kind: explanation.kind,
    key: explanation.key,
    displayName: explanation.displayName,
    markdown: explanation.markdown,
    generatedAt: explanation.generatedAt,
    reportId: request.reportId ?? null,
    sourceText: request.sourceText ?? null,
    starredAt: null,
    savedAt: null,
  };
}

/** Get or generate the explanation, and save it to the library when that feature is on. */
export async function explainForUser(
  userId: string,
  entitlements: Entitlements,
  request: InsightRequest,
  now: Date,
): Promise<ExplainForUserResult> {
  const displayName = await canonicalDisplayName(request.kind, request.key);
  if (displayName === null) return { status: 'unknown-target' };
  const target = { kind: request.kind, key: request.key, displayName };
  const result = await getOrCreateExplanation(target, {
    llm: getLlmProvider(),
    store: dbExplanationStore,
    models: env.insightModels(),
    consumeQuota: quota(userId, entitlements, now),
    now,
  });
  if (result.status !== 'ready') return result;
  if (!entitlements.features.includes('insight_library')) {
    return { status: 'ready', insight: asUnsavedInsight(result.explanation, request) };
  }
  const insight = await saveUserInsight(
    userId,
    result.explanation.id,
    request.reportId ?? null,
    request.sourceText ?? null,
  );
  return { status: 'ready', insight };
}

/** Null when the user has no such report. */
export async function resolveForUser(
  userId: string,
  entitlements: Entitlements,
  input: { text: string; reportId: string },
  now: Date,
): Promise<ResolveResult | null> {
  const report = await getHydratedReportForUser(userId, input.reportId);
  if (!report) return null;
  const paragraphs = report.topics.flatMap((topic) => markdownParagraphs(topic.markdown));
  return resolveSelection(input.text, paragraphs, {
    llm: getLlmProvider(),
    model: env.insightModels().lite,
    aliases: dbAliasStore,
    consumeQuota: quota(userId, entitlements, now),
    known: () => getReportAnnotations(userId, input.reportId),
  });
}
