/**
 * Renders model-written markdown (see lib/shared/markdown.ts) as React nodes.
 * No dangerouslySetInnerHTML: React escapes all text, so model output can't
 * inject HTML.
 */

import type { ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline, type List } from '../lib/shared/markdown.ts';

const LINK =
  'text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-900';
const CODE = 'rounded bg-stone-100 px-1 py-0.5 font-mono text-[13px] text-stone-800';

/**
 * Report bodies sit under the page <h1> and a per-topic heading, so markdown
 * `#` maps to <h3> and deeper levels follow, capped at <h6>.
 */
const HEADING_TAGS = ['h3', 'h4', 'h5', 'h6', 'h6', 'h6'] as const;
const HEADING_CLASS = [
  'mt-6 text-xl font-semibold tracking-tight text-stone-900',
  'mt-6 text-lg font-semibold tracking-tight text-stone-900',
  'mt-5 text-base font-semibold text-stone-900',
  'mt-4 text-base font-semibold text-stone-900',
  'mt-4 text-base font-semibold text-stone-900',
  'mt-4 text-base font-semibold text-stone-900',
];

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'strong':
        return (
          <strong key={i} className="font-semibold text-stone-900">
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
    'space-y-1.5 pl-5 marker:text-stone-400',
    nested ? 'mt-1.5' : 'my-3 text-base leading-7 text-stone-700',
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
      return (
        <p className="mt-3 text-base leading-7 text-stone-700">{renderInline(block.content)}</p>
      );
    case 'code':
      return (
        <pre className="my-4 overflow-x-auto rounded-lg bg-stone-900 p-4 text-sm leading-6 text-stone-100">
          <code>{block.text}</code>
        </pre>
      );
    case 'rule':
      return <hr className="my-5 border-stone-200" />;
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
