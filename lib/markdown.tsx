/**
 * Minimal markdown renderer for report bodies — no dependencies.
 *
 * lib/llm.ts deliberately imposes NO output schema: the model's own markdown
 * IS the report body. Rather than pull in a markdown library (and an HTML
 * sanitizer to go with it), this renders the small markdown subset a chat model
 * reliably emits — headings, paragraphs, nested bullet/numbered lists, fenced
 * code, and the inline marks (bold, italic, code, links) — straight to React
 * nodes.
 *
 * Safety: no dangerouslySetInnerHTML anywhere — React escapes every text node,
 * so model output can't inject HTML. Only http(s) hrefs are turned into
 * anchors; anything else renders as plain text.
 */

import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Inline marks
// ---------------------------------------------------------------------------

/** [text](href) — captured before the other marks so links with bold/italic
 * labels (e.g. [*The Guardian*: story](url)) parse in one pass. */
const INLINE_RE = new RegExp(
  [
    '\\[([^\\]]*)\\]\\(([^)\\s]+)\\)', // 1: link text, 2: href
    '\\*\\*([^*]+)\\*\\*', // 3: bold
    '`([^`]+)`', // 4: code
    '\\*([^*\\n]+)\\*', // 5: italic (bold matched first, so single asterisks only)
  ].join('|'),
  'g',
);

const A = 'text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900';
const CODE = 'rounded bg-stone-100 px-1 py-0.5 font-mono text-[13px] text-stone-800';

/** Render inline markdown inside one text run. Recursion is bounded: each
 * call consumes at least one character of its input. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    if (m[2] !== undefined) {
      // Link — only http(s) hrefs become anchors (no javascript:, data:, …).
      out.push(
        /^https?:\/\//i.test(m[2]) ? (
          <a key={`${key}-${i++}`} href={m[2]} target="_blank" rel="noreferrer" className={A}>
            {inline(m[1], `${key}-${i}`)}
          </a>
        ) : (
          m[0] // unsafe href: render the whole [text](href) as literal text
        ),
      );
    } else if (m[3] !== undefined) {
      out.push(<strong key={`${key}-${i++}`} className="font-semibold text-stone-900">{m[3]}</strong>);
    } else if (m[4] !== undefined) {
      out.push(<code key={`${key}-${i++}`} className={CODE}>{m[4]}</code>);
    } else {
      out.push(<em key={`${key}-${i++}`}>{m[5]}</em>);
    }
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ---------------------------------------------------------------------------
// Block structure
// ---------------------------------------------------------------------------

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM_RE = /^([-*+]|\d+[.)])\s+(.*)$/;
const HR_RE = /^(-{3,}|\*{3,})$/;

/** Heading size by level: # is the biggest; ### and deeper share one size —
 * they appear as per-topic headlines inside a section (see the prompt). */
const HEADING_CLASS: Record<number, string> = {
  1: 'mt-6 text-xl font-semibold tracking-tight text-stone-900',
  2: 'mt-6 text-lg font-semibold tracking-tight text-stone-900',
  3: 'mt-5 text-base font-semibold text-stone-900',
  4: 'mt-4 text-base font-semibold text-stone-900',
  5: 'mt-4 text-base font-semibold text-stone-900',
  6: 'mt-4 text-base font-semibold text-stone-900',
};

/** One parsed list item; deeper-indent runs become `children`. */
interface ListElem {
  text: string;
  children: ListElem[];
}

/**
 * Render a flat list of (indent, text) items as nested <ul>/<ol>.
 * Ordered-ness comes from each item's own marker, so mixed markers still work.
 */
function renderList(items: { indent: number; text: string }[], key: string): ReactNode {
  // Build the nesting tree with a stack keyed on indent depth.
  const roots: ListElem[] = [];
  const stack: { indent: number; elem: ListElem }[] = [];
  for (const item of items) {
    const elem: ListElem = { text: item.text, children: [] };
    while (stack.length && stack[stack.length - 1].indent >= item.indent) stack.pop();
    (stack.length ? stack[stack.length - 1].elem.children : roots).push(elem);
    stack.push({ indent: item.indent, elem });
  }

  const renderItems = (elems: ListElem[], k: string): ReactNode =>
    // The list type is per-item: most models keep one marker per level, but a
    // stray switch is rendered correctly rather than mis-listed. (Ordered
    // markers end up in a <ul> too — prototype-simple, still readable.)
    elems.map((e, n) => (
      <li key={`${k}.${n}`} className="pl-1 marker:text-stone-400">
        {inline(e.text, `${k}.${n}`)}
        {e.children.length > 0 && (
          <ul className="mt-1.5 list-disc space-y-1.5 pl-5 marker:text-stone-400">
            {renderItems(e.children, `${k}.${n}`)}
          </ul>
        )}
      </li>
    ));

  // key on the root <ul>: it is pushed into a sibling array in renderMarkdown,
  // so React wants a key (otherwise “unique key” warnings in the console).
  return (
    <ul key={key} className="my-3 list-disc space-y-1.5 pl-5 text-base leading-7 text-stone-700">
      {renderItems(roots, key)}
    </ul>
  );
}

/** True when a line starts a new block (used to end paragraphs). */
function isBlockStart(text: string): boolean {
  return HEADING_RE.test(text) || LIST_ITEM_RE.test(text) || HR_RE.test(text) || text.startsWith('```');
}

/** Render a markdown document to React nodes (the report body). */
export function renderMarkdown(md: string): ReactNode {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const text = line.trim();
    if (!text) {
      i++;
      continue;
    }
    const k = key++;

    // Fenced code block: ``` … ``` verbatim (no inline marks inside).
    if (text.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++]);
      i++; // closing fence (or EOF)
      out.push(
        <pre key={k} className="my-4 overflow-x-auto rounded-lg bg-stone-900 p-4 text-sm leading-6 text-stone-100">
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = HEADING_RE.exec(text);
    if (heading) {
      out.push(
        <p key={k} className={HEADING_CLASS[heading[1].length]}>
          {inline(heading[2], String(k))}
        </p>,
      );
      i++;
      continue;
    }

    if (HR_RE.test(text)) {
      out.push(<hr key={k} className="my-5 border-stone-200" />);
      i++;
      continue;
    }

    if (LIST_ITEM_RE.test(text)) {
      // Collect the whole consecutive run of list items (with indents), then
      // render it as a (possibly nested) list in one go.
      const items: { indent: number; text: string }[] = [];
      while (i < lines.length) {
        const raw = lines[i];
        const t = raw.trim();
        // Blank line ends the list (loose lists with blank lines between items
        // are rare from models; not worth the extra state).
        if (!t) break;
        const m = LIST_ITEM_RE.exec(t);
        if (m) {
          items.push({ indent: raw.length - raw.trimStart().length, text: m[2] });
          i++;
          continue;
        }
        // Lazy continuation: a plain line indented at/after the last item's
        // bullet belongs to that item (models hang item bodies under the
        // bullet), not to a new paragraph.
        if (items.length && raw.length - raw.trimStart().length >= items[items.length - 1].indent) {
          items[items.length - 1].text += ` ${t}`;
          i++;
          continue;
        }
        break;
      }
      out.push(renderList(items, String(k)));
      continue;
    }

    // Paragraph: consecutive plain lines joined with a space (soft wrap).
    const para: string[] = [text];
    i++;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t || isBlockStart(t)) break;
      para.push(t);
      i++;
    }
    out.push(
      <p key={k} className="mt-3 text-base leading-7 text-stone-700">
        {inline(para.join(' '), String(k))}
      </p>,
    );
  }

  return <>{out}</>;
}