import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkCronSecret, secretsMatch } from '../lib/server/cron-secret.ts';
import { dispatchReportJobs } from '../lib/server/cron/dispatch.ts';
import { createTickLogger } from '../lib/server/cron/tick-logger.ts';
import { mapLimit } from '../lib/server/util/async.ts';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('cron secret', () => {
  it('secretsMatch compares exactly', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true);
    expect(secretsMatch('abc', 'abd')).toBe(false);
    expect(secretsMatch('ab', 'abc')).toBe(false);
  });

  it('checkCronSecret fails closed when unset', () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(checkCronSecret('anything')).toBe('misconfigured');
    vi.stubEnv('CRON_SECRET', 's3cret');
    expect(checkCronSecret('s3cret')).toBe('ok');
    expect(checkCronSecret('nope')).toBe('unauthorized');
    expect(checkCronSecret(null)).toBe('unauthorized');
  });
});

describe('createTickLogger', () => {
  const at = () => new Date('2025-05-12T01:02:03.456Z');

  it('captures timestamped lines only when enabled', () => {
    const on = createTickLogger(true, at);
    on.log('hello');
    on.error('failed', new Error('boom'));
    expect(on.text()).toBe('01:02:03.456 hello\n01:02:03.456 failed: boom');

    const off = createTickLogger(false, at);
    off.log('hello');
    expect(off.text()).toBeNull();
  });
});

describe('mapLimit', () => {
  it('keeps order and caps concurrency', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5 - n));
      active--;
      return n * 10;
    });
    expect(result).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
});

describe('dispatchReportJobs', () => {
  const base = { origin: 'https://app.example', secret: 's', concurrency: 2 };

  it('counts successes and failures and sends the secret', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const { userId } = JSON.parse(String(init?.body)) as { userId: string };
      if (userId === 'bad') return new Response('nope', { status: 502 });
      if (userId === 'throws') throw new Error('network');
      return new Response('{}', { status: 201 });
    }) as unknown as typeof fetch;

    const summary = await dispatchReportJobs(['a', 'bad', 'throws', 'b'], {
      ...base,
      deadline: Date.now() + 60_000,
      logger: createTickLogger(false),
      fetchImpl,
    });
    expect(summary).toEqual({ processed: 4, succeeded: 2, failed: 2, skipped: 0 });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe('https://app.example/api/generate');
    expect((init?.headers as Record<string, string>)['x-cron-secret']).toBe('s');
  });

  it('skips users once the deadline has passed', async () => {
    let clock = 0;
    const fetchImpl = vi.fn(async () => {
      clock += 100; // each call "takes" 100ms
      return new Response('{}');
    }) as unknown as typeof fetch;

    const summary = await dispatchReportJobs(['a', 'b', 'c', 'd'], {
      ...base,
      concurrency: 1,
      deadline: 150,
      logger: createTickLogger(false),
      fetchImpl,
      now: () => clock,
    });
    expect(summary).toEqual({ processed: 4, succeeded: 2, failed: 0, skipped: 2 });
  });
});
