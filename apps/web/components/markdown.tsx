/**
 * Renders model-written markdown (see @panorist/core/markdown) as React nodes.
 * No dangerouslySetInnerHTML: React escapes all text, so model output can't
 * inject HTML.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  annotateBlocks,
  parseMarkdown,
  type Block,
  type Inline,
  type List,
} from '@panorist/core/markdown';
import { INSIGHT_KIND_LABEL } from '@panorist/core/insights';
import type { Annotation } from '@panorist/core/types';

const LINK =
  'text-ink underline decoration-accent/60 decoration-[1.5px] underline-offset-[3px] transition hover:decoration-accent';
const CODE = 'rounded bg-sunken px-1 py-0.5 font-mono text-[0.85em] text-ink';

/**
 * Report bodies sit under the page <h1> and a per-topic heading, so markdown
 * `#` maps to <h3> and deeper levels follow, capped at <h6>.
 */
const HEADING_TAGS = ['h3', 'h4', 'h5', 'h6', 'h6', 'h6'] as const;
const HEADING_CLASS = [
  'mt-10 font-serif text-2xl font-semibold tracking-tight text-ink',
  'mt-8 font-serif text-xl font-semibold tracking-tight text-ink',
  'mt-6 font-sans text-base font-semibold text-ink',
  'mt-6 font-sans text-base font-semibold text-ink',
  'mt-6 font-sans text-base font-semibold text-ink',
  'mt-6 font-sans text-base font-semibold text-ink',
];

const BODY = 'font-serif text-[19px] leading-[1.7] text-ink/90';

/** Events read as a marker highlight; terms as a dotted "definition" underline. */
const HIGHLIGHT = {
  event:
    'cursor-pointer rounded-sm bg-accent-soft px-0.5 text-inherit transition hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent',
  term: 'cursor-pointer text-inherit underline decoration-ink-faint decoration-dotted decoration-[1.5px] underline-offset-[4px] transition hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent',
} as const;

const AnnotationHandler = createContext<((annotation: Annotation) => void) | null>(null);

function Highlight({ node }: { node: Extract<Inline, { type: 'annotation' }> }) {
  const onSelect = useContext(AnnotationHandler);
  const { annotation } = node;
  if (!onSelect) return <>{renderInline(node.children)}</>;
  return (
    <button
      type="button"
      onClick={() => onSelect(annotation)}
      aria-haspopup="dialog"
      title={`${INSIGHT_KIND_LABEL[annotation.kind]}: ${annotation.displayName}`}
      className={`inline font-[inherit] text-[length:inherit] leading-[inherit] ${HIGHLIGHT[annotation.kind]}`}
    >
      {renderInline(node.children)}
    </button>
  );
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'strong':
        return (
          <strong key={i} className="font-semibold text-ink">
            {node.text}
          </strong>
        );
      case 'em':
        return <em key={i}>{node.text}</em>;
      case 'code':
        return (
          <code key={i} className={CODE}>
            {node.text}
          </code>
        );
      case 'link':
        return (
          <a key={i} href={node.href} target="_blank" rel="noreferrer" className={LINK}>
            {renderInline(node.children)}
          </a>
        );
      case 'annotation':
        return <Highlight key={i} node={node} />;
    }
  });
}

function ListView({ list, nested = false }: { list: List; nested?: boolean }) {
  const Tag = list.ordered ? 'ol' : 'ul';
  const className = [
    list.ordered ? 'list-decimal' : 'list-disc',
    'space-y-2 pl-6 marker:text-accent',
    nested ? 'mt-2' : `my-5 ${BODY}`,
  ].join(' ');
  return (
    <Tag className={className}>
      {list.items.map((item, i) => (
        <li key={i} className="pl-1">
          {renderInline(item.content)}
          {item.sublist && <ListView list={item.sublist} nested />}
        </li>
      ))}
    </Tag>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = HEADING_TAGS[block.level - 1];
      return <Tag className={HEADING_CLASS[block.level - 1]}>{renderInline(block.content)}</Tag>;
    }
    case 'paragraph':
      return <p className={`mt-5 first:mt-0 ${BODY}`}>{renderInline(block.content)}</p>;
    case 'code':
      return (
        <pre className="my-6 overflow-x-auto rounded-xl bg-sunken p-4 text-sm leading-6 text-ink">
          <code>{block.text}</code>
        </pre>
      );
    case 'rule':
      return <hr className="mx-auto my-10 w-16 border-rule" />;
    case 'list':
      return <ListView list={block} />;
  }
}

/** With `annotations` and `onAnnotation`, AI highlights become buttons. */
export function Markdown({
  source,
  annotations,
  onAnnotation,
}: {
  source: string;
  annotations?: readonly Annotation[];
  onAnnotation?: (annotation: Annotation) => void;
}) {
  const blocks = useMemo(() => {
    const parsed = parseMarkdown(source);
    return annotations && onAnnotation ? annotateBlocks(parsed, annotations) : parsed;
  }, [source, annotations, onAnnotation]);
  return (
    <AnnotationHandler.Provider value={onAnnotation ?? null}>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </AnnotationHandler.Provider>
  );
}
