import { describe, expect, it, vi } from 'vitest';

import type { LlmProvider, Prompt } from '../lib/server/llm/provider.ts';
import { generateReport } from '../lib/server/reports/generate-report.ts';
import {
  isLocalMonday,
  localDate,
  reportPeriod,
  windowStart,
} from '../lib/server/reports/period.ts';
import { buildNewsPrompt } from '../lib/server/reports/prompts.ts';
import type { MarkdownCache } from '../lib/shared/types.ts';

function memoryCache() {
  const store = new Map<string, string>();
  const cache: MarkdownCache = {
    get: async (key) => store.get(JSON.stringify(key)) ?? null,
    set: async (key, markdown) => void store.set(JSON.stringify(key), markdown),
  };
  return { cache, store };
}

function stubLlm(respond: (prompt: Prompt) => string): LlmProvider & { calls: Prompt[] } {
  const calls: Prompt[] = [];
  return {
    calls,
    complete: async (prompt) => {
      calls.push(prompt);
      return respond(prompt);
    },
  };
}

describe('period', () => {
  it('weekly window is 7 days inclusive', () => {
    expect(windowStart('2025-05-12', 'weekly')).toBe('2025-05-06');
    expect(windowStart('2025-05-12', 'daily')).toBe('2025-05-12');
    expect(windowStart('2025-03-01', 'weekly')).toBe('2025-02-23');
  });

  it('reportPeriod spans whole UTC days', () => {
    expect(reportPeriod('2025-05-12', 'weekly')).toEqual({
      periodStart: new Date('2025-05-06T00:00:00Z'),
      periodEnd: new Date('2025-05-12T23:59:59.999Z'),
    });
  });

  it('local date and Monday follow the user timezone', () => {
    const sundayUtcEvening = new Date('2025-05-11T20:00:00Z'); // Monday 04:00 in Hong Kong
    expect(localDate('Asia/Hong_Kong', sundayUtcEvening)).toBe('2025-05-12');
    expect(isLocalMonday('Asia/Hong_Kong', sundayUtcEvening)).toBe(true);
    expect(isLocalMonday('Europe/London', sundayUtcEvening)).toBe(false);
  });
});

describe('buildNewsPrompt', () => {
  it('daily asks about "today"', () => {
    const { system, user } = buildNewsPrompt('hong_kong', '2025-05-12', 'daily');
    expect(user).toContain('top Hong Kong news that I should be aware of today on 2025-05-12?');
    expect(system).toContain('you MUST search the web for the requested period');
  });

  it('weekly names the 7-day window', () => {
    const { user } = buildNewsPrompt('hong_kong', '2025-05-12', 'weekly');
    expect(user).toContain('this week - from 2025-05-06 to 2025-05-12?');
    expect(user).not.toContain('today on');
  });
});

describe('generateReport', () => {
  const TO = '2025-05-12';

  it('caches each category and points at it', async () => {
    const { cache, store } = memoryCache();
    const llm = stubLlm(() => '## Story');
    const draft = await generateReport(['hong_kong'], 'daily', TO, { llm, cache });

    const key = { category: 'hong_kong', frequency: 'daily', to: TO };
    expect(draft).toMatchObject({ kind: 'daily', frequency: 'daily', content: [key] });
    expect(store.get(JSON.stringify(key))).toBe('## Story');
  });

  it('skips failing categories and serves cache hits without the LLM', async () => {
    const { cache } = memoryCache();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = stubLlm((p) => {
      if (p.user.includes('sports')) throw new Error('boom');
      return 'md';
    });
    const first = await generateReport(['hong_kong', 'sport'], 'daily', TO, {
      llm: failing,
      cache,
    });
    expect(first.content.map((k) => k.category)).toEqual(['hong_kong']);

    const never = stubLlm(() => {
      throw new Error('must not be called');
    });
    const second = await generateReport(['hong_kong', 'hong_kong'], 'daily', TO, {
      llm: never,
      cache,
    });
    expect(second.content).toHaveLength(1); // duplicates collapse
    expect(never.calls).toHaveLength(0);
  });
});
