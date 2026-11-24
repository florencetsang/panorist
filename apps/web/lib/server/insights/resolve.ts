/**
 * Turn a reader's free selection into an insight target. Normalized text is
 * looked up in the alias table first (seeded by highlights and earlier
 * lookups), so each spelling costs at most one small classification call,
 * ever — and lands on the same explanation as everyone else's.
 */

import {
  cleanDisplayName,
  normalizeSelection,
  selectionProblem,
  slugifyKey,
} from '@panorist/core/insights';
import type { Annotation, InsightTarget } from '@panorist/core/types';
import type { LlmProvider } from '../llm/provider.ts';
import { parseJsonReply } from './annotate.ts';
import { CLASSIFY_SCHEMA, buildClassifyPrompt } from './prompts.ts';

export type ResolvedAlias = InsightTarget | { kind: 'reject' };

export interface AliasStore {
  get(surfaceNorm: string): Promise<ResolvedAlias | null>;
  /** Idempotent — the first writer wins. */
  save(surfaceNorm: string, alias: ResolvedAlias): Promise<void>;
}

export interface ResolveDeps {
  llm: LlmProvider;
  model: string;
  aliases: AliasStore;
  consumeQuota: () => Promise<boolean>;
  /** Highlights near the selection, so the model can reuse their keys. */
  known: () => Promise<Annotation[]>;
}

export type ResolveResult =
  | { status: 'resolved'; target: InsightTarget }
  | { status: 'invalid'; reason: string }
  | { status: 'rejected' }
  | { status: 'quota-exceeded' };

const MAX_CONTEXT_LENGTH = 400;

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The passage of the reader's own briefing that contains the selection,
 * trimmed to about MAX_CONTEXT_LENGTH around it; null when it isn't there.
 * Context comes from the server's copy of the report, never the client, so
 * nobody can steer the shared alias table with text of their own.
 */
export function findSelectionContext(
  selection: string,
  paragraphs: readonly string[],
): string | null {
  const needle = collapse(selection).toLowerCase();
  if (!needle) return null;
  for (const paragraph of paragraphs) {
    const text = collapse(paragraph);
    const at = text.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    if (text.length <= MAX_CONTEXT_LENGTH) return text;
    const pad = Math.max(0, Math.floor((MAX_CONTEXT_LENGTH - needle.length) / 2));
    const start = Math.max(0, Math.min(at - pad, text.length - MAX_CONTEXT_LENGTH));
    return text.slice(start, start + MAX_CONTEXT_LENGTH);
  }
  return null;
}

/** Validate a classification reply; anything unusable counts as a reject. */
export function parseClassification(reply: unknown): ResolvedAlias {
  if (reply === null || typeof reply !== 'object') return { kind: 'reject' };
  const { verdict, displayName, key } = reply as Record<string, unknown>;
  if (verdict !== 'event' && verdict !== 'term') return { kind: 'reject' };
  const name = cleanDisplayName(displayName);
  if (name === null) return { kind: 'reject' };
  const slug = slugifyKey(typeof key === 'string' && key ? key : name) || slugifyKey(name);
  return slug ? { kind: verdict, key: slug, displayName: name } : { kind: 'reject' };
}

/** `paragraphs` is the visible text of the reader's briefing the selection came from. */
export async function resolveSelection(
  text: string,
  paragraphs: readonly string[],
  deps: ResolveDeps,
): Promise<ResolveResult> {
  const problem = selectionProblem(text);
  if (problem) return { status: 'invalid', reason: `selection is ${problem}` };
  const context = findSelectionContext(text, paragraphs);
  if (context === null) return { status: 'invalid', reason: 'selection is not in this briefing' };
  const norm = normalizeSelection(text);

  const cached = await deps.aliases.get(norm);
  if (cached) {
    return cached.kind === 'reject'
      ? { status: 'rejected' }
      : { status: 'resolved', target: cached };
  }

  if (!(await deps.consumeQuota())) return { status: 'quota-exceeded' };
  const raw = await deps.llm.complete(
    buildClassifyPrompt(collapse(text), context, await deps.known()),
    { model: deps.model, search: false, jsonSchema: CLASSIFY_SCHEMA },
  );
  const alias = parseClassification(parseJsonReply(raw));
  await deps.aliases.save(norm, alias);
  return alias.kind === 'reject' ? { status: 'rejected' } : { status: 'resolved', target: alias };
}
