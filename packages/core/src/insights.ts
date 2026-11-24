/**
 * Pure helpers for AI insights: canonical keys, selection normalization and
 * request validation. Shared by the server (validation, cache keys) and the
 * apps (selection limits).
 */

import type { Annotation, InsightKind, InsightRequest } from './types.ts';
import { isPlainObject, isReportId } from './validation.ts';

export const INSIGHT_KINDS: readonly InsightKind[] = ['event', 'term'];

/** A selection the reader may ask about: a name or phrase, not a paragraph. */
export const SELECTION_LIMITS = { minChars: 2, maxChars: 80, maxWords: 8 } as const;

const MAX_KEY_LENGTH = 80;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_SOURCE_TEXT_LENGTH = 200;
const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isInsightKind(value: unknown): value is InsightKind {
  return value === 'event' || value === 'term';
}

/** A canonical key: lowercase ASCII slug, e.g. `apec-summit-2026`. */
export function isInsightKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_KEY_LENGTH && KEY_RE.test(value);
}

/** Lowercase ASCII slug; diacritics are folded, everything else becomes a hyphen. */
export function slugifyKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_KEY_LENGTH)
    .replace(/-+$/, '');
}

/**
 * Alias-table key for a selection: case, width, whitespace and surrounding
 * punctuation don't matter ("AIIB", " aiib. " and "ＡＩＩＢ" are one entry).
 */
export function normalizeSelection(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
}

/** Null when the selection is explainable-sized; otherwise why not. */
export function selectionProblem(text: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (normalizeSelection(trimmed).length < SELECTION_LIMITS.minChars) return 'too short';
  if (trimmed.length > SELECTION_LIMITS.maxChars) return 'too long';
  if (trimmed.split(' ').length > SELECTION_LIMITS.maxWords) return 'too many words';
  return null;
}

/** Collapse whitespace and cap length; null for empty or non-strings. */
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 0 && text.length <= max ? text : null;
}

export function cleanDisplayName(value: unknown): string | null {
  return cleanText(value, MAX_DISPLAY_NAME_LENGTH);
}

/** Validate a POST /api/insights body. Returns an error message for bad input. */
export function parseInsightRequest(body: Record<string, unknown>): InsightRequest | string {
  const { kind, key, displayName, reportId, sourceText } = body;
  if (!isInsightKind(kind)) return 'kind must be "event" or "term"';
  if (!isInsightKey(key)) return 'key must be a lowercase slug (a-z, 0-9, hyphens)';
  const name = cleanDisplayName(displayName);
  if (name === null) return `displayName must be 1–${MAX_DISPLAY_NAME_LENGTH} characters`;
  if (reportId !== undefined && !isReportId(reportId)) return 'reportId must be a report id';
  let source: string | undefined;
  if (sourceText !== undefined) {
    const cleaned = cleanText(sourceText, MAX_SOURCE_TEXT_LENGTH);
    if (cleaned === null) return `sourceText must be 1–${MAX_SOURCE_TEXT_LENGTH} characters`;
    source = cleaned;
  }
  return {
    kind,
    key,
    displayName: name,
    ...(reportId !== undefined && { reportId }),
    ...(source !== undefined && { sourceText: source }),
  };
}

/** Shape check for annotations read back from jsonb. */
export function isAnnotation(value: unknown): value is Annotation {
  return (
    isPlainObject(value) &&
    isInsightKind(value.kind) &&
    typeof value.surface === 'string' &&
    value.surface.length > 0 &&
    isInsightKey(value.key) &&
    typeof value.displayName === 'string'
  );
}

/** Library page size: a shorter page means there are no more. */
export const INSIGHT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// UI copy shared by web and mobile
// ---------------------------------------------------------------------------

export const INSIGHT_ACTION_LABEL: Record<InsightKind, string> = {
  event: 'All I need to know',
  term: 'Tell me more',
};

export const INSIGHT_KIND_LABEL: Record<InsightKind, string> = {
  event: 'Key event',
  term: 'Term to know',
};

/** A reader-facing message for a failed insight request (by HTTP status). */
export function insightErrorMessage(status: number | null): string {
  switch (status) {
    case 400:
      return 'Select a name or short phrase (up to 8 words) to explain.';
    case 403:
      return 'This feature isn’t available on your plan.';
    case 404:
      return 'We couldn’t find anything to explain here.';
    case 422:
      return 'There’s nothing to explain in that selection — try a name, event or term.';
    case 429:
      return 'You’ve reached today’s limit for new explanations. Saved ones are still available.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
