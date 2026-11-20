import { describe, expect, it } from 'vitest';

import { groupByMonth, initials, periodLabel, reportHeadline } from '../src/format.ts';

describe('format helpers', () => {
  it('labels daily and weekly periods in UTC', () => {
    const base = { createdAt: '2026-11-18T08:00:00Z' };
    expect(
      periodLabel(
        { ...base, frequency: 'daily', periodStart: '2026-11-17', periodEnd: '2026-11-17' },
        'en-GB',
      ),
    ).toBe('Tuesday 17 November');
    expect(
      periodLabel(
        { ...base, frequency: 'weekly', periodStart: '2026-11-10', periodEnd: '2026-11-16' },
        'en-GB',
      ),
    ).toBe('10 Nov – 16 Nov');
  });

  it('builds headlines and initials', () => {
    expect(reportHeadline([])).toBe('Your briefing');
    expect(reportHeadline(['world'])).toBe('World');
    expect(reportHeadline(['world', 'sport', 'technology'])).toBe('World, Sport and Technology');
    expect(initials('Florence Tsang')).toBe('FT');
    expect(initials('reader@example.com')).toBe('R');
    expect(initials('')).toBe('?');
  });

  it('groups consecutive items by month', () => {
    const groups = groupByMonth(
      [
        { createdAt: '2026-11-18T12:00:00Z' },
        { createdAt: '2026-11-02T12:00:00Z' },
        { createdAt: '2026-10-30T12:00:00Z' },
      ],
      'en-GB',
    );
    expect(groups.map((g) => [g.month, g.items.length])).toEqual([
      ['November 2026', 2],
      ['October 2026', 1],
    ]);
  });
});
