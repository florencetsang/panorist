import { describe, expect, it } from 'vitest';

import { parseInline, parseMarkdown } from '../src/markdown.ts';

describe('parseInline', () => {
  it('parses marks and safe links', () => {
    expect(parseInline('a **b** *c* `d` [*e*](https://x.example)')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', text: 'b' },
      { type: 'text', text: ' ' },
      { type: 'em', text: 'c' },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://x.example', children: [{ type: 'em', text: 'e' }] },
    ]);
  });

  it('leaves non-http links as literal text', () => {
    expect(parseInline('[x](javascript:alert(1))')).toEqual([
      { type: 'text', text: '[x](javascript:alert(1))' },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('parses headings, paragraphs, rules and code', () => {
    const blocks = parseMarkdown('## Title\nline one\nline two\n\n---\n```\nx; y\n```');
    expect(blocks).toEqual([
      { type: 'heading', level: 2, content: [{ type: 'text', text: 'Title' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'line one line two' }] },
      { type: 'rule' },
      { type: 'code', text: 'x; y' },
    ]);
  });

  it('distinguishes ordered and bullet lists, with nesting and continuations', () => {
    const [list] = parseMarkdown('1. first\n   continued\n   - child\n2. second');
    expect(list).toEqual({
      type: 'list',
      ordered: true,
      items: [
        {
          content: [{ type: 'text', text: 'first continued' }],
          sublist: {
            type: 'list',
            ordered: false,
            items: [{ content: [{ type: 'text', text: 'child' }], sublist: null }],
          },
        },
        { content: [{ type: 'text', text: 'second' }], sublist: null },
      ],
    });
  });
});
