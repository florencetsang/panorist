// Exercises the lib/server/db helpers against a real database, using the seed
// user. Non-destructive: preferences are restored and only rows this script
// created are deleted.
//
// Run: node --env-file=.env.local --conditions react-server scripts/smoke.ts
// (`--conditions react-server` resolves the `server-only` marker to its empty
// module, as Next.js does for server bundles.)

import assert from 'node:assert';

import { db } from '../lib/server/db/client.ts';
import { getCachedMarkdown, saveCachedMarkdown } from '../lib/server/db/markdown-cache.ts';
import {
  getHydratedReportsForUser,
  getReportsForUser,
  saveReport,
  setReportRead,
} from '../lib/server/db/reports.ts';
import {
  getUsersDueForReport,
  getUserWithPreferences,
  savePushSubscription,
  updatePreferences,
} from '../lib/server/db/users.ts';
import type { CategorySlug } from '@panorist/core/categories';
import type { MarkdownCacheKey, ReportDraft } from '@panorist/core/types';

const SEED_EMAIL = 'test@example.com';
// A fixed past date: real runs only cache "today", so this key is ours alone.
const TEST_CACHE_KEY: MarkdownCacheKey = {
  category: 'hong_kong',
  frequency: 'daily',
  to: '2000-01-01',
};
const MARKDOWN = '## Test headline\n\nA summarized test topic.';

const isDue = async (instant: Date) =>
  (await getUsersDueForReport(instant)).some((u) => u.email === SEED_EMAIL);

/** An instant whose wall-clock time in Asia/Hong_Kong (UTC+8, no DST) is the given day/hour. */
function hkInstant(isoDate: string, hour: number): Date {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + (hour - 8) * 3_600_000);
}
const HK_MONDAY = '2025-05-12';
const HK_TUESDAY = '2025-05-13';

async function main() {
  const [seed] = (await db()`SELECT id FROM users WHERE email = ${SEED_EMAIL}`) as { id: string }[];
  assert(seed, 'seed user missing — run `npm run db:setup` first');
  const userId = seed.id;

  const original = await getUserWithPreferences(userId);
  assert(original, 'seed user has no preferences row');
  assert.equal(original.timezone, 'Asia/Hong_Kong', 'smoke assumes the seed user is in Hong Kong');

  const createdReportIds: string[] = [];
  try {
    // getUserWithPreferences: joined, camelCased, dates decoded.
    assert.equal(original.email, SEED_EMAIL);
    assert.ok(original.createdAt instanceof Date && original.updatedAt instanceof Date);

    // updatePreferences: partial patch, returns the stored row.
    const daily: CategorySlug[] = ['world', 'sport'];
    const updated = await updatePreferences(userId, {
      deliveryHour: 9,
      dailyCategories: daily,
      weeklyCategories: [],
    });
    assert(updated);
    assert.equal(updated.deliveryHour, 9);
    assert.deepEqual(updated.dailyCategories, daily);
    assert.deepEqual(updated.weeklyCategories, []);
    assert.equal(
      await updatePreferences('00000000-0000-0000-0000-000000000000', { deliveryHour: 1 }),
      null,
    );
    assert.deepEqual(
      (await updatePreferences(userId, {}))?.dailyCategories,
      daily,
      'empty patch reads',
    );

    // getUsersDueForReport: local-hour match; daily any day; weekly only local Mondays.
    assert.equal(await isDue(hkInstant(HK_TUESDAY, 9)), true, 'daily user due at their hour');
    assert.equal(await isDue(hkInstant(HK_TUESDAY, 10)), false, 'not due at another hour');
    await updatePreferences(userId, { dailyCategories: [], weeklyCategories: ['hong_kong'] });
    assert.equal(await isDue(hkInstant(HK_MONDAY, 9)), true, 'weekly-only due on local Monday');
    assert.equal(await isDue(hkInstant(HK_TUESDAY, 9)), false, 'weekly-only not due on Tuesday');
    await updatePreferences(userId, { weeklyCategories: [] });
    assert.equal(await isDue(hkInstant(HK_MONDAY, 9)), false, 'paused user never due');

    // savePushSubscription: round-trip, clear to SQL NULL, unknown user → false.
    const subscription = {
      endpoint: 'https://push.example.com/send/test',
      expirationTime: null,
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    };
    assert.equal(await savePushSubscription(userId, subscription), true);
    assert.deepEqual((await getUserWithPreferences(userId))?.pushSubscription, subscription);
    assert.equal(await savePushSubscription(userId, null), true);
    assert.equal((await getUserWithPreferences(userId))?.pushSubscription, null);
    assert.equal(await savePushSubscription('00000000-0000-0000-0000-000000000000', null), false);

    // markdown_cache: set → get, first writer wins, miss → null.
    await saveCachedMarkdown(TEST_CACHE_KEY, MARKDOWN);
    assert.equal(await getCachedMarkdown(TEST_CACHE_KEY), MARKDOWN);
    await saveCachedMarkdown(TEST_CACHE_KEY, 'loser write');
    assert.equal(await getCachedMarkdown(TEST_CACHE_KEY), MARKDOWN, 'first writer must win');
    assert.equal(await getCachedMarkdown({ ...TEST_CACHE_KEY, category: 'world' }), null);

    // saveReport: idempotent per (user, frequency, period).
    const draft: ReportDraft = {
      kind: 'daily',
      frequency: 'daily',
      periodStart: new Date('2000-01-01T00:00:00Z'),
      periodEnd: new Date('2000-01-01T23:59:59.999Z'),
      content: [TEST_CACHE_KEY],
    };
    const first = await saveReport(userId, draft);
    createdReportIds.push(first.id);
    assert.equal(first.created, true);
    assert.match(first.id, /^\d+$/);
    const second = await saveReport(userId, draft);
    assert.deepEqual(second, { id: first.id, created: false }, 'duplicate period must not insert');

    // getReportsForUser / getHydratedReportsForUser.
    const reports = await getReportsForUser(userId, 50);
    const mine = reports.find((r) => r.id === first.id);
    assert(mine, 'saved report not listed');
    assert.ok(mine.createdAt instanceof Date && mine.periodStart instanceof Date);
    assert.deepEqual(mine.content, [TEST_CACHE_KEY]);
    for (let i = 1; i < reports.length; i++) {
      assert.ok(reports[i - 1].createdAt >= reports[i].createdAt, 'newest first');
    }
    const hydrated = (await getHydratedReportsForUser(userId, 50)).find((r) => r.id === first.id);
    assert.deepEqual(hydrated?.topics, [{ category: 'hong_kong', markdown: MARKDOWN }]);

    // setReportRead: new reports are unread; read keeps the first read_at; unread clears it.
    assert.equal(mine.readAt, null, 'new report must start unread');
    const read = await setReportRead(userId, first.id, true);
    assert.ok(read?.readAt instanceof Date);
    const reread = await setReportRead(userId, first.id, true);
    assert.equal(reread?.readAt?.getTime(), read.readAt.getTime(), 're-read must keep read_at');
    assert.deepEqual(await setReportRead(userId, first.id, false), { id: first.id, readAt: null });
    assert.equal(
      await setReportRead('00000000-0000-0000-0000-000000000000', first.id, true),
      null,
      "another user's report must not be found",
    );

    console.log('smoke: all db helpers OK');
  } finally {
    await updatePreferences(userId, {
      deliveryHour: original.deliveryHour,
      dailyCategories: original.dailyCategories,
      weeklyCategories: original.weeklyCategories,
      pushSubscription: original.pushSubscription,
    });
    if (createdReportIds.length) {
      await db()`DELETE FROM reports WHERE id = ANY(${createdReportIds}::bigint[])`;
    }
    await db()`
      DELETE FROM markdown_cache
      WHERE category = ${TEST_CACHE_KEY.category}
        AND frequency = ${TEST_CACHE_KEY.frequency}
        AND to_date = ${TEST_CACHE_KEY.to}::date
    `;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
