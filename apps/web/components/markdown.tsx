/**
 * Renders model-written markdown (see @panorist/core/markdown) as React nodes.
 * No dangerouslySetInnerHTML: React escapes all text, so model output can't
 * inject HTML.
 */

import type { ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline, type List } from '@panorist/core/markdown';

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

export function Markdown({ source }: { source: string }) {
  return (
    <>
      {parseMarkdown(source).map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </>
  );
}
