/**
 * Parser for the small markdown subset chat models reliably emit: headings,
 * paragraphs, nested bullet/numbered lists, fenced code, rules, and inline
 * bold / italic / code / links. Produces a plain AST so rendering
 * (components/markdown.tsx) stays dumb and parsing is unit-testable.
 *
 * Only http(s) links become link nodes; anything else stays literal text.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] };

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
