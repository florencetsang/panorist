/**
 * Build one report (one frequency) from cached or freshly generated
 * per-category markdown. DB- and provider-agnostic: storage and the LLM are
 * injected.
 */

import { isCategorySlug, type CategorySlug } from '../../shared/categories.ts';
import type {
  Frequency,
  MarkdownCache,
  MarkdownCacheKey,
  ReportDraft,
} from '../../shared/types.ts';
import type { LlmProvider } from '../llm/provider.ts';
import { mapLimit } from '../util/async.ts';
import { reportPeriod } from './period.ts';
import { buildNewsPrompt } from './prompts.ts';

/** Categories generated in parallel per report; kept low to avoid 429s. */
const MAX_CONCURRENCY = 3;

export interface ReportGenerationDeps {
  llm: LlmProvider;
  cache: MarkdownCache;
}

export async function generateCategoryMarkdown(
  llm: LlmProvider,
  category: CategorySlug,
  to: string,
  frequency: Frequency,
): Promise<string> {
  if (!isCategorySlug(category)) throw new Error(`Unknown category "${String(category)}"`);
  return llm.complete(buildNewsPrompt(category, to, frequency));
}

/**
 * Each category is a cache hit or one LLM call whose result is cached before
 * it is referenced, so a stored report never points at a missing row.
 * Categories are best-effort: failures are logged and skipped. If all fail,
 * `content` is empty and the caller decides what to do.
 */
export async function generateReport(
  categories: readonly CategorySlug[],
  frequency: Frequency,
  to: string,
  { llm, cache }: ReportGenerationDeps,
): Promise<ReportDraft> {
  const unique = [...new Set(categories)];
  const keys = await mapLimit(unique, MAX_CONCURRENCY, async (category) => {
    const key: MarkdownCacheKey = { category, frequency, to };
    try {
      if ((await cache.get(key)) === null) {
        await cache.set(key, await generateCategoryMarkdown(llm, category, to, frequency));
      }
      return key;
    } catch (err) {
      console.error(`[reports] ${frequency} "${category}" for ${to} failed — skipping`, err);
      return null;
    }
  });
  return {
    kind: frequency,
    frequency,
    ...reportPeriod(to, frequency),
    content: keys.filter((key): key is MarkdownCacheKey => key !== null),
  };
}
