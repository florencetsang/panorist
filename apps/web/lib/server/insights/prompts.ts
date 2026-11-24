/**
 * Prompts for AI insights. Bump a version when its prompt changes in a way
 * that should invalidate cached output: the version is part of the cache key.
 */

import type { Annotation, InsightKind, InsightTarget } from '@panorist/core/types';
import type { Prompt } from '../llm/provider.ts';

export const ANNOTATION_PROMPT_VERSION = 1;
export const EXPLANATION_PROMPT_VERSION = 1;

export const MAX_EVENTS_PER_SECTION = 5;
export const MAX_TERMS_PER_SECTION = 8;

// ---------------------------------------------------------------------------
// Highlight detection
// ---------------------------------------------------------------------------

const ANNOTATION_SYSTEM = [
  'You annotate a news briefing for readers who are learning to follow the news.',
  'Find two kinds of highlights:',
  `(1) "event": up to ${MAX_EVENTS_PER_SECTION} specific news stories that have been developing over time and deserve a background summary,`,
  'such as summits, negotiations, conflicts, elections, trials, crises or policy rollouts',
  '(e.g. "APEC summit 2026", "Trump–Xi summit in Washington 2026"). Not a single person, country or organization on its own.',
  `(2) "term": up to ${MAX_TERMS_PER_SECTION} terms a learner may not know: institutions, acronyms and economic, financial, political,`,
  'legal or technical concepts (e.g. AIIB, CPI, IMF, World Bank, hawkish policy path, leading economic index).',
  'Not everyday words, not well-known countries or cities.',
  'For each highlight return:',
  '"surface": text copied character-for-character from the briefing prose (not from a URL), as it first appears, as short as possible while still naming it;',
  '"displayName": the clear full name, expanding acronyms (e.g. "Asian Infrastructure Investment Bank (AIIB)");',
  '"key": a lowercase hyphenated slug of the canonical name that any article would map to (e.g. "apec-summit-2026", "consumer-price-index").',
  'Return fewer highlights rather than weak ones. Return an empty list when nothing qualifies.',
].join(' ');

export const ANNOTATION_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    highlights: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: ['event', 'term'] },
          surface: { type: 'STRING' },
          displayName: { type: 'STRING' },
          key: { type: 'STRING' },
        },
        required: ['kind', 'surface', 'displayName', 'key'],
      },
    },
  },
  required: ['highlights'],
};

export function buildAnnotationPrompt(markdown: string): Prompt {
  return { system: ANNOTATION_SYSTEM, user: `Briefing:\n\n${markdown}` };
}

// ---------------------------------------------------------------------------
// Selection classification
// ---------------------------------------------------------------------------

const CLASSIFY_SYSTEM = [
  'A reader of a news briefing selected some text and wants it explained.',
  'Decide what it refers to:',
  '"event" — a specific news story developing over time (a summit, negotiation, conflict, election, trial, crisis, policy rollout);',
  '"term" — a concept, institution, organization, acronym, person, place or piece of jargon;',
  '"reject" — nothing explainable (common words, sentence fragments, opinions, numbers alone).',
  'For event or term also return "displayName", the clear full name (expand acronyms),',
  'and "key", a lowercase hyphenated slug of the canonical name that any article would map to.',
  'If the selection matches one of the known highlights listed, reuse its key and displayName exactly.',
].join(' ');

export const CLASSIFY_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING', enum: ['event', 'term', 'reject'] },
    displayName: { type: 'STRING' },
    key: { type: 'STRING' },
  },
  required: ['verdict'],
};

export function buildClassifyPrompt(
  selection: string,
  context: string | null,
  known: readonly Annotation[],
): Prompt {
  const lines = [`Selection: "${selection}"`];
  if (context) lines.push(`Sentence it appears in: "${context}"`);
  if (known.length > 0) {
    lines.push('Known highlights:');
    for (const a of known) lines.push(`- ${a.kind} | ${a.key} | ${a.displayName}`);
  }
  return { system: CLASSIFY_SYSTEM, user: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

const EVENT_SYSTEM = [
  'You are the news editor of a personalized briefing product, writing a catch-up explainer.',
  'You have web-search capability: you MUST search the web and ground every statement in what you find.',
  'Write in markdown, about 250–400 words: a short overview paragraph, then bold-labelled parts',
  '**Background**, **Latest developments** (newest first, with dates), **Why it matters** and **What to watch**.',
  'Cite sources as inline markdown links to specific articles, never homepages or category pages.',
  'Omit anything you cannot source.',
].join(' ');

const TERM_SYSTEM = [
  'You are a patient tutor helping someone learn to read the news.',
  'Explain the term in plain English for a smart non-specialist, in markdown, under 250 words:',
  'start with a one-sentence definition, then how it works, why it shows up in the news,',
  'a short concrete example, and a few **Related terms**.',
  'If the term is ambiguous, explain the meaning most common in news coverage.',
].join(' ');

/**
 * The user prompts are the product's wording. Nothing user-specific goes in,
 * so one explanation can be shared by every reader.
 */
export function buildExplanationPrompt(target: InsightTarget, today: string): Prompt {
  if (target.kind === 'event') {
    return {
      system: `${EVENT_SYSTEM} Today is ${today}.`,
      user: `Please summarize what I need to know about ${target.displayName}.`,
    };
  }
  return { system: TERM_SYSTEM, user: `Tell me about ${target.displayName}.` };
}

/** Events need fresh, cited facts; terms are stable knowledge. */
export function explanationUsesSearch(kind: InsightKind): boolean {
  return kind === 'event';
}
