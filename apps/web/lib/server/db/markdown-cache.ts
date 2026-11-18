/**
 * Markdown cache: one generated markdown per (category, frequency, to_date),
 * shared by every user with the same category and window. Stored reports
 * point at these rows, so they must not be truncated casually.
 */

import 'server-only';

import type { MarkdownCache, MarkdownCacheKey } from '@panorist/core/types';
import { db } from './client.ts';

export async function getCachedMarkdown(key: MarkdownCacheKey): Promise<string | null> {
  const rows = await db()`
    SELECT markdown FROM markdown_cache
    WHERE category = ${key.category} AND frequency = ${key.frequency} AND to_date = ${key.to}
  `;
  return (rows[0] as { markdown: string } | undefined)?.markdown ?? null;
}

/** First writer wins, so concurrent generations of the same key are harmless. */
export async function saveCachedMarkdown(key: MarkdownCacheKey, markdown: string): Promise<void> {
  await db()`
    INSERT INTO markdown_cache (category, frequency, to_date, markdown)
    VALUES (${key.category}, ${key.frequency}, ${key.to}, ${markdown})
    ON CONFLICT (category, frequency, to_date) DO NOTHING
  `;
}

export const dbMarkdownCache: MarkdownCache = {
  get: getCachedMarkdown,
  set: saveCachedMarkdown,
};
