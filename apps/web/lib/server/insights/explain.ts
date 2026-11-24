/**
 * Shared explanations: one LLM call per (kind, key, freshness bucket, prompt
 * version), reused by every reader. Concurrent requests for the same
 * explanation make one call — the first claims it, the rest see "pending".
 * Only the claimant spends quota, so cache hits are free for readers.
 */

import { DELIVERY_TIMEZONE } from '@panorist/core/delivery';
import type { InsightKind, InsightTarget } from '@panorist/core/types';
import type { LlmProvider } from '../llm/provider.ts';
import { localDate } from '../reports/period.ts';
import {
  EXPLANATION_PROMPT_VERSION,
  buildExplanationPrompt,
  explanationUsesSearch,
} from './prompts.ts';

export interface ExplanationIdentity {
  kind: InsightKind;
  key: string;
  bucket: string;
  promptVersion: number;
}

export interface StoredExplanation {
  /** bigserial, a string from the driver. */
  id: string;
  kind: InsightKind;
  key: string;
  displayName: string;
  status: 'pending' | 'ready' | 'failed';
  markdown: string | null;
  model: string | null;
  generatedAt: Date;
}

export type ReadyExplanation = StoredExplanation & { status: 'ready'; markdown: string };

export interface ExplanationStore {
  find(identity: ExplanationIdentity): Promise<StoredExplanation | null>;
  /** The row id when this caller now owns generation, else null. */
  claim(identity: ExplanationIdentity, displayName: string): Promise<string | null>;
  complete(id: string, markdown: string, model: string): Promise<StoredExplanation>;
  /** Release a claim so a later request can retry. */
  fail(id: string): Promise<void>;
}

export interface ExplainDeps {
  llm: LlmProvider;
  store: ExplanationStore;
  models: { grounded: string; lite: string };
  /** Count one uncached call against the caller's quota; false when exhausted. */
  consumeQuota: () => Promise<boolean>;
  now: Date;
}

export type ExplainResult =
  | { status: 'ready'; explanation: ReadyExplanation }
  /** Another request is generating it; ask again shortly. */
  | { status: 'pending' }
  | { status: 'quota-exceeded' };

/** Long-lived bucket for terms; bump with the prompt version to refresh. */
export const TERM_BUCKET = 'static';

/**
 * Events are refreshed once per Hong Kong day (the briefing's day), so
 * everyone reading that day's briefing shares one summary. Terms don't age.
 */
export function freshnessBucket(kind: InsightKind, now: Date): string {
  return kind === 'event' ? localDate(DELIVERY_TIMEZONE, now) : TERM_BUCKET;
}

export function explanationIdentity(target: InsightTarget, now: Date): ExplanationIdentity {
  return {
    kind: target.kind,
    key: target.key,
    bucket: freshnessBucket(target.kind, now),
    promptVersion: EXPLANATION_PROMPT_VERSION,
  };
}

const isReady = (row: StoredExplanation | null): row is ReadyExplanation =>
  row?.status === 'ready' && row.markdown !== null;

export async function getOrCreateExplanation(
  target: InsightTarget,
  deps: ExplainDeps,
): Promise<ExplainResult> {
  const identity = explanationIdentity(target, deps.now);
  const existing = await deps.store.find(identity);
  if (isReady(existing)) return { status: 'ready', explanation: existing };

  const claimId = await deps.store.claim(identity, target.displayName);
  if (claimId === null) {
    // Lost the race: it is either ready by now or still being generated.
    const current = await deps.store.find(identity);
    return isReady(current) ? { status: 'ready', explanation: current } : { status: 'pending' };
  }

  try {
    if (!(await deps.consumeQuota())) {
      await deps.store.fail(claimId);
      return { status: 'quota-exceeded' };
    }
    const search = explanationUsesSearch(target.kind);
    const model = search ? deps.models.grounded : deps.models.lite;
    const today = localDate(DELIVERY_TIMEZONE, deps.now);
    const markdown = await deps.llm.complete(buildExplanationPrompt(target, today), {
      model,
      search,
    });
    const saved = await deps.store.complete(claimId, markdown, model);
    if (!isReady(saved)) throw new Error(`explanation ${claimId} was not stored as ready`);
    return { status: 'ready', explanation: saved };
  } catch (err) {
    await deps.store.fail(claimId).catch(() => {});
    throw err;
  }
}
