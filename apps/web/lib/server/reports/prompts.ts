import type { CategorySlug } from '@panorist/core/categories';
import type { Frequency } from '@panorist/core/types';
import type { Prompt } from '../llm/provider.ts';
import { windowStart } from './period.ts';

/** Prose phrasing per category — reads better in a prompt than the UI labels. */
const CATEGORY_PROMPT_LABELS: Record<CategorySlug, string> = {
  world: 'news in the world',
  asia_pacific: 'Asia-Pacific news',
  hong_kong: 'Hong Kong news',
  economics: 'economics and business news',
  sport: 'sports news',
  entertainment: 'entertainment news',
  lifestyle: 'lifestyle news',
  technology: 'technology news',
};

const SYSTEM_PROMPT = [
  'You are the news editor of a personalized briefing product.',
  'You have web-search capability: you MUST search the web for the requested period and ground every statement in what you find.',
  'Cite any sources that the reader can read as further reading.',
  'Rule: All sources should be a particular article or report. Omit anything you cannot source. Do not use the generic news website homepage or category page as source. Every "url" must be an accessible real http(s) URL you actually found.',
].join(' ');

/**
 * The window is derived from (to, frequency) — the same inputs as the cache
 * key — so a cached markdown always matches the prompt that produced it.
 * A short question works best: search grounding does the heavy lifting.
 */
export function buildNewsPrompt(category: CategorySlug, to: string, frequency: Frequency): Prompt {
  const period =
    frequency === 'weekly'
      ? `this week - from ${windowStart(to, frequency)} to ${to}`
      : `today on ${to}`;
  return {
    system: SYSTEM_PROMPT,
    user: `What are some top ${CATEGORY_PROMPT_LABELS[category]} that I should be aware of ${period}?`,
  };
}
