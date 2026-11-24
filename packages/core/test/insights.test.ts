import { describe, expect, it } from 'vitest';

import { resolveFeatures } from '../src/features.ts';
import {
  normalizeSelection,
  parseInsightRequest,
  selectionProblem,
  slugifyKey,
} from '../src/insights.ts';
import { annotateBlocks, inlineText, parseMarkdown } from '../src/markdown.ts';
import type { Annotation } from '../src/types.ts';

const event = (surface: string, key = slugifyKey(surface)): Annotation => ({
  kind: 'event',
  surface,
  key,
  displayName: surface,
});
const term = (surface: string): Annotation => ({ ...event(surface), kind: 'term' });

describe('annotateBlocks', () => {
  it('wraps only the first occurrence of each surface, keeping the rest of the run', () => {
    const [block] = annotateBlocks(parseMarkdown('The **IMF** said the IMF and CPI moved.'), [
      term('IMF'),
      term('CPI'),
    ]);
    expect(block).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The ' },
        {
          type: 'annotation',
          annotation: term('IMF'),
          children: [{ type: 'strong', text: 'IMF' }],
        },
        { type: 'text', text: ' said the IMF and ' },
        { type: 'annotation', annotation: term('CPI'), children: [{ type: 'text', text: 'CPI' }] },
        { type: 'text', text: ' moved.' },
      ],
    });
  });

  it('prefers the longer surface at the same position and skips links and code', () => {
    const blocks = annotateBlocks(
      parseMarkdown('- Federal Reserve held. [Federal](https://x.test) `Fed`\n- Fed again'),
      [term('Federal'), term('Federal Reserve'), term('Fed')],
    );
    const list = blocks[0];
    if (list.type !== 'list') throw new Error('expected a list');
    const [first, second] = list.items.map((item) => item.content);
    expect(first[0]).toMatchObject({
      type: 'annotation',
      annotation: { surface: 'Federal Reserve' },
    });
    expect(first.filter((n) => n.type === 'annotation')).toHaveLength(1);
    expect(second[0]).toMatchObject({ type: 'annotation', annotation: { surface: 'Fed' } });
    expect(inlineText(first)).toBe('Federal Reserve held. Federal Fed');
  });
});

describe('selection helpers', () => {
  it('normalizes case, width, whitespace and edge punctuation', () => {
    expect(normalizeSelection('  “ＡＩＩＢ.”  ')).toBe('aiib');
    expect(normalizeSelection('Hawkish\n policy   path,')).toBe('hawkish policy path');
  });

  it('slugifies to stable keys', () => {
    expect(slugifyKey('Trump–Xi summit, Washington 2026')).toBe('trump-xi-summit-washington-2026');
    expect(slugifyKey('S&P 500 Índex')).toBe('s-and-p-500-index');
  });

  it('bounds selections', () => {
    expect(selectionProblem('CPI')).toBeNull();
    expect(selectionProblem('.')).toBe('too short');
    expect(selectionProblem('one two three four five six seven eight nine')).toBe('too many words');
  });
});

describe('parseInsightRequest', () => {
  it('accepts a valid target and trims text', () => {
    expect(
      parseInsightRequest({ kind: 'term', key: 'cpi', displayName: '  Consumer Price Index ' }),
    ).toEqual({ kind: 'term', key: 'cpi', displayName: 'Consumer Price Index' });
  });

  it('rejects bad kinds, keys and report ids', () => {
    expect(parseInsightRequest({ kind: 'x', key: 'cpi', displayName: 'CPI' })).toMatch(/kind/);
    expect(parseInsightRequest({ kind: 'term', key: 'Not A Slug', displayName: 'CPI' })).toMatch(
      /key/,
    );
    expect(
      parseInsightRequest({ kind: 'term', key: 'cpi', displayName: 'CPI', reportId: 'abc' }),
    ).toMatch(/reportId/);
  });
});

describe('resolveFeatures', () => {
  it('drops globally disabled features from the plan', () => {
    expect(
      resolveFeatures('free', {
        event_insights: true,
        term_insights: false,
        free_select: true,
        insight_library: true,
      }),
    ).toEqual(['event_insights', 'free_select', 'insight_library']);
  });
});
