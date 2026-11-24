/**
 * Parser for the small markdown subset chat models reliably emit: headings,
 * paragraphs, nested bullet/numbered lists, fenced code, rules, and inline
 * bold / italic / code / links. Produces a plain AST so rendering
 * (components/markdown.tsx) stays dumb and parsing is unit-testable.
 *
 * Only http(s) links become link nodes; anything else stays literal text.
 */

import type { Annotation } from './types.ts';

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'annotation'; annotation: Annotation; children: StyledText[] };

/** Leaf inline nodes that carry plain text and may be highlighted. */
export type StyledText = Extract<Inline, { type: 'text' | 'strong' | 'em' }>;

export interface ListItem {
  content: Inline[];
  sublist: List | null;
}

export interface List {
  type: 'list';
  ordered: boolean;
  items: ListItem[];
}

export type Block =
  | { type: 'heading'; level: number; content: Inline[] }
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'rule' }
  | List;

// Links first so a link label may contain bold/italic.
const INLINE_RE = new RegExp(
  [
    '\\[([^\\]]*)\\]\\(([^)\\s]+)\\)', // 1: link text, 2: href
    '\\*\\*([^*]+)\\*\\*', // 3: bold
    '`([^`]+)`', // 4: code
    '\\*([^*\\n]+)\\*', // 5: italic
  ].join('|'),
  'g',
);

const SAFE_HREF_RE = /^https?:\/\//i;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const pushText = (s: string) => {
    if (!s) return;
    const prev = out[out.length - 1];
    if (prev?.type === 'text') prev.text += s;
    else out.push({ type: 'text', text: s });
  };

  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    pushText(text.slice(last, idx));
    if (m[2] !== undefined) {
      if (SAFE_HREF_RE.test(m[2]))
        out.push({ type: 'link', href: m[2], children: parseInline(m[1]) });
      else pushText(m[0]);
    } else if (m[3] !== undefined) out.push({ type: 'strong', text: m[3] });
    else if (m[4] !== undefined) out.push({ type: 'code', text: m[4] });
    else out.push({ type: 'em', text: m[5] });
    last = idx + m[0].length;
  }
  pushText(text.slice(last));
  return out;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM_RE = /^([-*+]|\d+[.)])\s+(.*)$/;
const ORDERED_MARKER_RE = /^\d/;
const RULE_RE = /^(-{3,}|\*{3,})$/;

const indentOf = (line: string) => line.length - line.trimStart().length;

function isBlockStart(text: string): boolean {
  return (
    HEADING_RE.test(text) || LIST_ITEM_RE.test(text) || RULE_RE.test(text) || text.startsWith('```')
  );
}

interface FlatItem {
  indent: number;
  ordered: boolean;
  text: string;
}

/** Nest a run of (indent, text) items; each list's type comes from its first marker. */
function buildList(items: FlatItem[]): List {
  const root: List = { type: 'list', ordered: items[0].ordered, items: [] };
  const stack: { indent: number; list: List; item: ListItem | null }[] = [
    { indent: -1, list: root, item: null },
  ];
  for (const flat of items) {
    while (stack.length > 1 && stack[stack.length - 1].indent >= flat.indent) stack.pop();
    const parent = stack[stack.length - 1];
    let list = parent.list;
    if (parent.item) {
      parent.item.sublist ??= { type: 'list', ordered: flat.ordered, items: [] };
      list = parent.item.sublist;
    }
    const item: ListItem = { content: parseInline(flat.text), sublist: null };
    list.items.push(item);
    stack.push({ indent: flat.indent, list, item });
  }
  return root;
}

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const text = lines[i].trim();
    if (!text) {
      i++;
      continue;
    }

    if (text.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++]);
      i++; // closing fence (or EOF)
      blocks.push({ type: 'code', text: buf.join('\n') });
      continue;
    }

    const heading = HEADING_RE.exec(text);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, content: parseInline(heading[2]) });
      i++;
      continue;
    }

    if (RULE_RE.test(text)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    if (LIST_ITEM_RE.test(text)) {
      const items: FlatItem[] = [];
      while (i < lines.length) {
        const raw = lines[i];
        const t = raw.trim();
        if (!t) break; // blank line ends the list
        const m = LIST_ITEM_RE.exec(t);
        if (m) {
          items.push({ indent: indentOf(raw), ordered: ORDERED_MARKER_RE.test(m[1]), text: m[2] });
          i++;
          continue;
        }
        // Lazy continuation: an indented plain line belongs to the previous item.
        if (items.length && indentOf(raw) >= items[items.length - 1].indent) {
          items[items.length - 1].text += ` ${t}`;
          i++;
          continue;
        }
        break;
      }
      blocks.push(buildList(items));
      continue;
    }

    const para: string[] = [text];
    i++;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t || isBlockStart(t)) break;
      para.push(t);
      i++;
    }
    blocks.push({ type: 'paragraph', content: parseInline(para.join(' ')) });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// AI highlights
// ---------------------------------------------------------------------------

/**
 * Wrap the first occurrence of each annotation's surface in an annotation
 * node. Matching is exact and stays within one text/bold/italic run; links,
 * code and code blocks are never highlighted. At a tie the longer surface
 * wins, so "Federal Reserve" beats "Federal".
 */
export function annotateBlocks(blocks: Block[], annotations: readonly Annotation[]): Block[] {
  if (annotations.length === 0) return blocks;
  const pending = new Set(annotations.filter((a) => a.surface.length > 0));

  const inlines = (nodes: Inline[]): Inline[] =>
    nodes.flatMap((node) =>
      node.type === 'text' || node.type === 'strong' || node.type === 'em'
        ? highlightRun(node, pending)
        : [node],
    );
  const list = (l: List): List => ({
    ...l,
    items: l.items.map((item) => ({
      content: inlines(item.content),
      sublist: item.sublist && list(item.sublist),
    })),
  });

  return blocks.map((block) => {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        return { ...block, content: inlines(block.content) };
      case 'list':
        return list(block);
      default:
        return block;
    }
  });
}

function highlightRun(node: StyledText, pending: Set<Annotation>): Inline[] {
  let best: { annotation: Annotation; index: number } | null = null;
  for (const annotation of pending) {
    const index = node.text.indexOf(annotation.surface);
    if (index < 0) continue;
    if (
      !best ||
      index < best.index ||
      (index === best.index && annotation.surface.length > best.annotation.surface.length)
    ) {
      best = { annotation, index };
    }
  }
  if (!best) return [node];

  const { annotation, index } = best;
  pending.delete(annotation);
  const end = index + annotation.surface.length;
  const piece = (text: string): StyledText => ({ type: node.type, text });
  const out: Inline[] = [];
  if (index > 0) out.push(piece(node.text.slice(0, index)));
  out.push({ type: 'annotation', annotation, children: [piece(annotation.surface)] });
  if (end < node.text.length) out.push(...highlightRun(piece(node.text.slice(end)), pending));
  return out;
}

/** The visible text of each heading, paragraph and list item, in order. */
export function markdownParagraphs(md: string): string[] {
  const out: string[] = [];
  const visitList = (list: List) => {
    for (const item of list.items) {
      out.push(inlineText(item.content));
      if (item.sublist) visitList(item.sublist);
    }
  };
  for (const block of parseMarkdown(md)) {
    if (block.type === 'heading' || block.type === 'paragraph') out.push(inlineText(block.content));
    else if (block.type === 'list') visitList(block);
  }
  return out.filter((text) => text.trim() !== '');
}

/** The visible text of inline nodes, e.g. for picking words from a paragraph. */
export function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((node) =>
      node.type === 'link' || node.type === 'annotation' ? inlineText(node.children) : node.text,
    )
    .join('');
}
