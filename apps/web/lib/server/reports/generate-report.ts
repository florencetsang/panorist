/**
 * Build one report (one frequency) from cached or freshly generated
 * per-category markdown. DB- and provider-agnostic: storage and the LLM are
 * injected.
 */

import { isCategorySlug, type CategorySlug } from '@panorist/core/categories';
import type { Frequency, MarkdownCache, MarkdownCacheKey, ReportDraft } from '@panorist/core/types';
import type { SectionAnnotator } from '../insights/annotate.ts';
import type { LlmProvider } from '../llm/provider.ts';
import { mapLimit } from '../util/async.ts';
import { reportPeriod } from './period.ts';
import { buildNewsPrompt } from './prompts.ts';

/** Categories generated in parallel per report; kept low to avoid 429s. */
const MAX_CONCURRENCY = 3;

export interface ReportGenerationDeps {
  llm: LlmProvider;
  cache: MarkdownCache;
  /** Detects AI highlights for each section; omitted when highlights are off. */
  annotate?: SectionAnnotator;
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
 * `content` is empty and the caller decides what to do. Highlight detection
 * runs after a section is cached and never fails the section.
 */
export async function generateReport(
  categories: readonly CategorySlug[],
  frequency: Frequency,
  to: string,
  { llm, cache, annotate }: ReportGenerationDeps,
): Promise<ReportDraft> {
  const unique = [...new Set(categories)];
  const keys = await mapLimit(unique, MAX_CONCURRENCY, async (category) => {
    const key: MarkdownCacheKey = { category, frequency, to };
    let markdown: string;
    try {
      const cached = await cache.get(key);
      if (cached === null) {
        markdown = await generateCategoryMarkdown(llm, category, to, frequency);
        await cache.set(key, markdown);
      } else {
        markdown = cached;
      }
    } catch (err) {
      console.error(`[reports] ${frequency} "${category}" for ${to} failed — skipping`, err);
      return null;
    }
    if (annotate) {
      try {
        await annotate(key, markdown);
      } catch (err) {
        console.error(`[insights] highlights for ${frequency} "${category}" ${to} failed`, err);
      }
    }
    return key;
  });
  return {
    kind: frequency,
    frequency,
    ...reportPeriod(to, frequency),
    content: keys.filter((key): key is MarkdownCacheKey => key !== null),
  };
}
