import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserWithPreferences } from '../lib/shared/types.ts';

vi.mock('../lib/server/db/reports.ts', () => ({ saveReport: vi.fn() }));
vi.mock('../lib/server/db/users.ts', () => ({ savePushSubscription: vi.fn() }));
vi.mock('../lib/server/push.ts', () => ({ sendPush: vi.fn() }));

const { saveReport } = await import('../lib/server/db/reports.ts');
const { savePushSubscription } = await import('../lib/server/db/users.ts');
const { sendPush } = await import('../lib/server/push.ts');
const { dueFrequencies, generateDueReports } = await import('../lib/server/reports/due-reports.ts');

const HK_MONDAY_9AM = new Date('2025-05-12T01:00:00Z');
const HK_TUESDAY_9AM = new Date('2025-05-13T01:00:00Z');

const user = (overrides: Partial<UserWithPreferences> = {}): UserWithPreferences => ({
  id: 'u1',
  userId: 'u1',
  email: 'a@example.com',
  timezone: 'Asia/Hong_Kong',
  createdAt: new Date(),
  deliveryHour: 9,
  dailyCategories: ['world'],
  weeklyCategories: ['sport'],
  pushSubscription: { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } },
  updatedAt: new Date(),
  ...overrides,
});

const deps = (fail = false) => ({
  llm: {
    complete: async () => {
      if (fail) throw new Error('llm down');
      return 'md';
    },
  },
  cache: { get: async () => null, set: async () => {} },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('dueFrequencies', () => {
  it('weekly only on the local Monday', () => {
    expect(dueFrequencies(user(), HK_MONDAY_9AM).map((d) => d.frequency)).toEqual([
      'daily',
      'weekly',
    ]);
    expect(dueFrequencies(user(), HK_TUESDAY_9AM).map((d) => d.frequency)).toEqual(['daily']);
    expect(
      dueFrequencies(user({ dailyCategories: [], weeklyCategories: [] }), HK_MONDAY_9AM),
    ).toEqual([]);
  });
});

describe('generateDueReports', () => {
  it('stores both reports on a Monday and notifies once per new report', async () => {
    vi.mocked(saveReport)
      .mockResolvedValueOnce({ id: '1', created: true })
      .mockResolvedValueOnce({ id: '2', created: false });
    vi.mocked(sendPush).mockResolvedValue('sent');

    const result = await generateDueReports(user(), HK_MONDAY_9AM, deps());
    expect(result).toEqual({ status: 'generated', dailyReportId: '1', weeklyReportId: '2' });
    expect(sendPush).toHaveBeenCalledTimes(1); // the weekly report already existed
    expect(vi.mocked(sendPush).mock.calls[0][1].url).toBe('/?userId=u1');
  });

  it('reports no-content when every category fails', async () => {
    expect(await generateDueReports(user(), HK_TUESDAY_9AM, deps(true))).toEqual({
      status: 'no-content',
    });
    expect(saveReport).not.toHaveBeenCalled();
  });

  it('clears an expired push subscription', async () => {
    vi.mocked(saveReport).mockResolvedValue({ id: '1', created: true });
    vi.mocked(sendPush).mockResolvedValue('expired');
    await generateDueReports(user(), HK_TUESDAY_9AM, deps());
    expect(savePushSubscription).toHaveBeenCalledWith('u1', null);
  });
});
