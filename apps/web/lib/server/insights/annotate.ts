/**
 * Highlight detection for one shared markdown section: one cheap,
 * search-free LLM call returning events and terms, validated so every
 * highlight can actually be found in the rendered text.
 */

import { isInsightKind, normalizeSelection, slugifyKey } from '@panorist/core/insights';
import { parseMarkdown, type Block, type Inline } from '@panorist/core/markdown';
import type { Annotation, InsightKind, MarkdownCacheKey } from '@panorist/core/types';
import type { LlmProvider } from '../llm/provider.ts';
import {
  ANNOTATION_PROMPT_VERSION,
  ANNOTATION_SCHEMA,
  MAX_EVENTS_PER_SECTION,
  MAX_TERMS_PER_SECTION,
  buildAnnotationPrompt,
} from './prompts.ts';

/** An alias row seeded from a highlight: its normalized surface → canonical key. */
export interface AnnotationAlias {
  norm: string;
  kind: InsightKind;
  key: string;
  displayName: string;
}

export interface AnnotationStore {
  has(key: MarkdownCacheKey): Promise<boolean>;
  /** Idempotent — the first writer wins. */
  save(
    key: MarkdownCacheKey,
    annotations: Annotation[],
    model: string,
    promptVersion: number,
    aliases: AnnotationAlias[],
  ): Promise<void>;
}

/** Called for a section after its markdown is cached; best-effort for the caller. */
export type SectionAnnotator = (key: MarkdownCacheKey, markdown: string) => Promise<void>;

const MAX_SURFACE_LENGTH = 80;
const MAX_DISPLAY_NAME_LENGTH = 120;

/** Parse a JSON reply that may still arrive wrapped in a ```json fence. */
export function parseJsonReply(raw: string): unknown {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    return null;
  }
}

/** The text runs annotateBlocks can highlight (text/bold/italic outside links and code). */
function highlightableRuns(blocks: Block[]): string[] {
  const runs: string[] = [];
  const inlines = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.type === 'text' || node.type === 'strong' || node.type === 'em')
        runs.push(node.text);
    }
  };
  const visit = (block: Block) => {
    if (block.type === 'heading' || block.type === 'paragraph') inlines(block.content);
    if (block.type === 'list') {
      for (const item of block.items) {
        inlines(item.content);
        if (item.sublist) visit(item.sublist);
      }
    }
  };
  blocks.forEach(visit);
  return runs;
}

/**
 * Keep highlights that are well-formed and whose surface appears inside one
 * highlightable run; re-slug keys; drop duplicate keys and surfaces; cap per kind.
 */
export function validateAnnotations(reply: unknown, markdown: string): Annotation[] {
  const items =
    reply !== null &&
    typeof reply === 'object' &&
    Array.isArray((reply as { highlights?: unknown }).highlights)
      ? (reply as { highlights: unknown[] }).highlights
      : [];
  const runs = highlightableRuns(parseMarkdown(markdown));
  const caps: Record<InsightKind, number> = {
    event: MAX_EVENTS_PER_SECTION,
    term: MAX_TERMS_PER_SECTION,
  };
  const counts: Record<InsightKind, number> = { event: 0, term: 0 };
  const seenKeys = new Set<string>();
  const seenSurfaces = new Set<string>();
  const out: Annotation[] = [];

  for (const item of items) {
    if (item === null || typeof item !== 'object') continue;
    const { kind, surface, displayName, key } = item as Record<string, unknown>;
    if (!isInsightKind(kind) || typeof surface !== 'string' || typeof displayName !== 'string') {
      continue;
    }
    const trimmedSurface = surface.trim();
    const name = displayName.replace(/\s+/g, ' ').trim();
    if (trimmedSurface.length < 2 || trimmedSurface.length > MAX_SURFACE_LENGTH) continue;
    if (name.length === 0 || name.length > MAX_DISPLAY_NAME_LENGTH) continue;
    if (!runs.some((run) => run.includes(trimmedSurface))) continue;

    const slug = slugifyKey(typeof key === 'string' && key ? key : name) || slugifyKey(name);
    if (!slug || seenKeys.has(slug) || seenSurfaces.has(trimmedSurface)) continue;
    if (counts[kind] >= caps[kind]) continue;

    counts[kind]++;
    seenKeys.add(slug);
    seenSurfaces.add(trimmedSurface);
    out.push({ kind, surface: trimmedSurface, key: slug, displayName: name });
  }
  return out;
}

export async function detectHighlights(
  llm: LlmProvider,
  model: string,
  markdown: string,
): Promise<Annotation[]> {
  const raw = await llm.complete(buildAnnotationPrompt(markdown), {
    model,
    search: false,
    jsonSchema: ANNOTATION_SCHEMA,
  });
  return validateAnnotations(parseJsonReply(raw), markdown);
}

export interface AnnotatorDeps {
  llm: LlmProvider;
  model: string;
  store: AnnotationStore;
  /** Runs after new highlights are stored, e.g. to pre-generate term explanations. */
  onAnnotated?: (annotations: Annotation[]) => Promise<void>;
}

/** Annotates each section once; later calls for an annotated section are one lookup. */
export function createSectionAnnotator(deps: AnnotatorDeps): SectionAnnotator {
  return async (key, markdown) => {
    if (await deps.store.has(key)) return;
    const annotations = await detectHighlights(deps.llm, deps.model, markdown);
    const aliases = annotations
      .map((a) => ({
        norm: normalizeSelection(a.surface),
        kind: a.kind,
        key: a.key,
        displayName: a.displayName,
      }))
      .filter((a) => a.norm.length > 0);
    await deps.store.save(key, annotations, deps.model, ANNOTATION_PROMPT_VERSION, aliases);
    if (annotations.length > 0) await deps.onAnnotated?.(annotations);
  };
}
