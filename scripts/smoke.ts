// Exercises every lib/db.ts helper against the live database (uses the seed user).
// Run: node --env-file=.env.local --conditions react-server scripts/smoke.ts
// (Node >= 23 runs .ts files natively via type stripping. --conditions react-server
// resolves the `server-only` marker in lib/db.ts to its empty module instead of
// the throwing one — the same condition Next.js sets for server bundles.)

import assert from 'node:assert';
import {
  sql,
  getUsersDueForReport,
  getUserWithPreferences,
  saveReport,
  getReportsForUser,
  getCachedMarkdown,
  saveCachedMarkdown,
  getReportMarkdown,
  updatePreferences,
  savePushSubscription,
} from '../lib/db.ts';
import { type CategorySlug, type MarkdownCacheKey, type ReportDraft } from '../lib/types.ts';

const SEED_DAILY: CategorySlug[] = ['world', 'economics'];
const SEED_WEEKLY: CategorySlug[] = ['hong_kong'];

async function main() {
  const utcHour = new Date().getUTCHours();
  const hkLocalHour = (utcHour + 8) % 24; // Hong Kong is UTC+8, no DST

  const seedRows = await sql`SELECT id FROM users WHERE email = 'test@example.com'`;
  const seed = seedRows[0] as { id: string } | undefined;
  assert(seed, 'seed user missing — run `npm run db:setup` first');
  const userId = seed.id;

  // 1. getUsersDueForReport: the seed user has a non-empty daily list, so
  //    they are due exactly when the HK local hour is 8 (any weekday).
  const due = await getUsersDueForReport(utcHour);
  assert.equal(
    due.some((r) => r.email === 'test@example.com'),
    hkLocalHour === 8,
    'user with daily categories should be due iff local hour is 8',
  );

  // 2. getUserWithPreferences: joined row with all aliased fields.
  const joined = await getUserWithPreferences(userId);
  assert(joined, 'joined row missing');
  assert.equal(joined.email, 'test@example.com');
  assert.equal(joined.deliveryHour, 8);
  assert.deepEqual(joined.dailyCategories, SEED_DAILY);
  assert.deepEqual(joined.weeklyCategories, SEED_WEEKLY);
  assert.equal(joined.pushSubscription, null);
  assert.ok(joined.createdAt instanceof Date);
  assert.ok(joined.updatedAt instanceof Date);

  // 3. saveReport: accepts a ReportDraft with Date or ISO-string periods;
  //    content is now an array of markdown-cache POINTERS, not inline markdown.
  //    The cache key's `to` is a fixed past date (not today): real runs cache
  //    today's rows, and saveCachedMarkdown is first-writer-wins, so a live
  //    row for "today" would make the round-trip below flap.
  const periodStart = new Date(Date.now() - 86_400_000);
  const periodEnd = new Date();
  const cacheKeys: MarkdownCacheKey[] = [
    {
      category: 'hong_kong',
      frequency: 'daily',
      to: '2000-01-01',
    },
  ];
  const draft: ReportDraft = {
    kind: 'daily',
    frequency: 'daily',
    periodStart,
    periodEnd,
    content: cacheKeys,
  };
  const id1 = await saveReport(userId, draft);
  const id2 = await saveReport(userId, {
    ...draft,
    periodStart: draft.periodStart.toISOString(),
    periodEnd: draft.periodEnd.toISOString(),
  });

  // 3b. markdown_cache round-trip: set → get, first-writer-wins on conflict,
  //     miss → null, and pointer hydration via getReportMarkdown.
  const MARKDOWN = '## Test headline\n\nA comprehensively summarized test topic.';
  const key = cacheKeys[0];
  await saveCachedMarkdown(key, MARKDOWN);
  assert.equal(await getCachedMarkdown(key), MARKDOWN);
  await saveCachedMarkdown(key, 'loser write');
  assert.equal(await getCachedMarkdown(key), MARKDOWN, 'first writer must win (DO NOTHING)');
  assert.equal(await getCachedMarkdown({ ...key, category: 'world' }), null, 'miss → null');
  assert.deepEqual(await getReportMarkdown(cacheKeys), [{ category: 'hong_kong', markdown: MARKDOWN }]);
  assert.match(id1, /^\d+$/, 'report id should be a numeric string');
  assert.match(id2, /^\d+$/);

  // 4. getReportsForUser: newest first, jsonb parsed, dates as Date.
  const reports = await getReportsForUser(userId, 10);
  assert.ok(reports.length >= 2);
  const [newest, second] = reports;
  assert.ok(newest.createdAt >= second.createdAt, 'reports should be newest first');
  assert.ok(newest.createdAt instanceof Date && newest.periodStart instanceof Date);
  assert.equal(newest.kind, 'daily');
  assert.equal(newest.frequency, 'daily');
  assert.deepEqual(newest.content, cacheKeys);

  // 5. updatePreferences: partial updates only touch given fields.
  await updatePreferences(userId, { deliveryHour: 9 });
  let p = await getUserWithPreferences(userId);
  assert(p);
  assert.equal(p.deliveryHour, 9);
  assert.deepEqual(p.dailyCategories, SEED_DAILY, 'dailyCategories must be untouched');
  assert.deepEqual(p.weeklyCategories, SEED_WEEKLY, 'weeklyCategories must be untouched');

  const newDaily: CategorySlug[] = ['world', 'sport'];
  await updatePreferences(userId, { dailyCategories: newDaily });
  p = await getUserWithPreferences(userId);
  assert(p);
  assert.deepEqual(p.dailyCategories, newDaily);
  assert.deepEqual(p.weeklyCategories, SEED_WEEKLY, 'weeklyCategories must be untouched');

  // 6. weekly-only schedule: a user with an EMPTY daily list and a non-empty
  //    weekly list is due only on Mondays (local time in their timezone).
  await updatePreferences(userId, { dailyCategories: [], weeklyCategories: ['hong_kong'], deliveryHour: hkLocalHour });
  const dueNow = await getUsersDueForReport(utcHour);
  const isMondayInHk = new Date(Date.now() + 8 * 3_600_000).getUTCDay() === 1;
  assert.equal(
    dueNow.some((r) => r.email === 'test@example.com'),
    isMondayInHk,
    'weekly-only user should be due iff local weekday is Monday',
  );

  // 6b. paused state: both lists empty → never due, no error.
  await updatePreferences(userId, { dailyCategories: [], weeklyCategories: [] });
  const duePaused = await getUsersDueForReport(utcHour);
  assert.equal(
    duePaused.some((r) => r.email === 'test@example.com'),
    false,
    'paused user (both lists empty) must never be due',
  );

  // 7. savePushSubscription round-trip, and clearing to SQL NULL.
  const subscription = {
    endpoint: 'https://push.example.com/send/test',
    expirationTime: null,
    keys: { p256dh: 'public-key', auth: 'auth-secret' },
  };
  await savePushSubscription(userId, subscription);
  p = await getUserWithPreferences(userId);
  assert(p);
  assert.deepEqual(p.pushSubscription, subscription);
  await updatePreferences(userId, { pushSubscription: null });
  p = await getUserWithPreferences(userId);
  assert(p);
  assert.equal(p.pushSubscription, null, 'null patch should store SQL NULL, not JSON null');

  // Clean up: restore the seed state and remove the test rows (reports + cache).
  await updatePreferences(userId, { deliveryHour: 8, dailyCategories: SEED_DAILY, weeklyCategories: SEED_WEEKLY });
  await sql`DELETE FROM reports WHERE user_id = ${userId}`;
  await sql`DELETE FROM markdown_cache`;

  console.log('smoke: all lib/db.ts helpers OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
