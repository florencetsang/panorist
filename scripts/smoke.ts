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
  updatePreferences,
  savePushSubscription,
} from '../lib/db.ts';
import { type CategorySlug, type TopicContent } from '../lib/types.ts';

const SEED_CATEGORIES: CategorySlug[] = ['hong_kong', 'world', 'economics'];

async function main() {
  const utcHour = new Date().getUTCHours();
  const hkLocalHour = (utcHour + 8) % 24; // Hong Kong is UTC+8, no DST

  const seedRows = await sql`SELECT id FROM users WHERE email = 'test@example.com'`;
  const seed = seedRows[0] as { id: string } | undefined;
  assert(seed, 'seed user missing — run `npm run db:setup` first');
  const userId = seed.id;

  // 1. getUsersDueForReport: daily-@-8 user is due exactly when HK local hour is 8.
  const due = await getUsersDueForReport(utcHour);
  assert.equal(
    due.some((r) => r.email === 'test@example.com'),
    hkLocalHour === 8,
    'daily user should be due iff local hour is 8',
  );

  // 2. getUserWithPreferences: joined row with all aliased fields.
  const joined = await getUserWithPreferences(userId);
  assert(joined, 'joined row missing');
  assert.equal(joined.email, 'test@example.com');
  assert.equal(joined.frequency, 'daily');
  assert.equal(joined.deliveryHour, 8);
  assert.deepEqual(joined.categories, SEED_CATEGORIES);
  assert.equal(joined.pushSubscription, null);
  assert.ok(joined.createdAt instanceof Date);
  assert.ok(joined.updatedAt instanceof Date);

  // 3. saveReport: accepts Date and ISO-string periods.
  const topic: TopicContent = {
    category: 'hong_kong',
    headline: 'Test headline',
    body: 'A comprehensively summarized test topic.',
    sources: [{ title: 'Example News', url: 'https://example.com/article' }],
  };
  const periodStart = new Date(Date.now() - 86_400_000);
  const periodEnd = new Date();
  const id1 = await saveReport(userId, 'daily', periodStart, periodEnd, [topic]);
  const id2 = await saveReport(userId, 'daily', periodStart.toISOString(), periodEnd.toISOString(), [topic]);
  assert.match(id1, /^\d+$/, 'report id should be a numeric string');
  assert.match(id2, /^\d+$/);

  // 4. getReportsForUser: newest first, jsonb parsed, dates as Date.
  const reports = await getReportsForUser(userId, 10);
  assert.ok(reports.length >= 2);
  const [newest, second] = reports;
  assert.ok(newest.createdAt >= second.createdAt, 'reports should be newest first');
  assert.ok(newest.createdAt instanceof Date && newest.periodStart instanceof Date);
  assert.deepEqual(newest.content[0], topic);

  // 5. updatePreferences: partial updates only touch given fields.
  await updatePreferences(userId, { frequency: 'weekly', deliveryHour: 9 });
  let p = await getUserWithPreferences(userId);
  assert(p);
  assert.equal(p.frequency, 'weekly');
  assert.equal(p.deliveryHour, 9);
  assert.deepEqual(p.categories, SEED_CATEGORIES, 'categories must be untouched');

  const newCategories: CategorySlug[] = ['world', 'sport'];
  await updatePreferences(userId, { categories: newCategories });
  p = await getUserWithPreferences(userId);
  assert(p);
  assert.deepEqual(p.categories, newCategories);

  // 6. weekly schedule: due only on Mondays (local time in the user's timezone).
  await updatePreferences(userId, { frequency: 'weekly', deliveryHour: hkLocalHour });
  const dueNow = await getUsersDueForReport(utcHour);
  const isMondayInHk = new Date(Date.now() + 8 * 3_600_000).getUTCDay() === 1;
  assert.equal(
    dueNow.some((r) => r.email === 'test@example.com'),
    isMondayInHk,
    'weekly user should be due iff local weekday is Monday',
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

  // Clean up: restore the seed state and remove the test reports.
  await updatePreferences(userId, { frequency: 'daily', deliveryHour: 8, categories: SEED_CATEGORIES });
  await sql`DELETE FROM reports WHERE user_id = ${userId}`;

  console.log('smoke: all lib/db.ts helpers OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
