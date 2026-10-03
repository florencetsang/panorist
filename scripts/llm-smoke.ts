// Exercises lib/llm.ts: offline with a stubbed fetch (prompt → request → parse
// → validate, retry, per-category resilience), then — only when the LLM_* env
// vars are set — one live round-trip per category.
// Run: node --env-file=.env.local --conditions react-server scripts/llm-smoke.ts
// (--conditions react-server resolves lib/llm.ts's `server-only` marker
// outside Next.js, the same way scripts/smoke.ts handles lib/db.ts.)

import assert from 'node:assert';

import { generateCategoryTopics, generateReport } from '../lib/llm.ts';
import type { Preferences, TopicContent, User } from '../lib/types.ts';

// A real live round-trip needs real values; the offline tests below stub
// fetch entirely, so placeholders are enough to satisfy llmEnv()'s fail-fast
// check.
const liveConfigured = Boolean(
    process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL,
);
if (!liveConfigured) {
  process.env.LLM_BASE_URL ??= 'https://offline-test.example/v1';
  process.env.LLM_API_KEY ??= 'offline-test-key';
  process.env.LLM_MODEL ??= 'offline-test-model';
}

const DAY_MS = 86_400_000;
const RANGE = { start: new Date(Date.now() - DAY_MS), end: new Date() };
const realFetch = globalThis.fetch;

/** A Gemini-native success response carrying the given assistant text. */
function assistantResponse(content: string): Response {
  return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: content }] }, finishReason: 'STOP' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Install a fetch stub; the handler inspects the request body (the prompt). */
function stubFetch(handler: (body: string) => Response): void {
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) =>
      handler(String(init?.body ?? ''))) as typeof fetch;
}

// Canned model output: deliberately fenced, wrapped in chatty prose, with a
// wrong "category" field and untrimmed strings — proving the defensive parser
// and validator earn their keep.
const RAW_TOPICS = [
  {
    category: 'news', // wrong on purpose — must be normalized to the requested slug
    headline: '  Budget lands with deficit  ',
    body: 'Para one.\n\nPara two.',
    sources: [{ title: 'Example Post ', url: ' https://example.com/budget ' }],
  },
  {
    category: 'hong_kong',
    headline: 'Rail line extended',
    body: 'Para one.\n\nPara two.',
    sources: [{ title: 'Example Post', url: 'https://example.com/rail' }],
  },
];

const EXPECTED_TOPICS: TopicContent[] = [
  {
    category: 'hong_kong',
    headline: 'Budget lands with deficit',
    body: 'Para one.\n\nPara two.',
    sources: [{ title: 'Example Post', url: 'https://example.com/budget' }],
  },
  {
    category: 'hong_kong',
    headline: 'Rail line extended',
    body: 'Para one.\n\nPara two.',
    sources: [{ title: 'Example Post', url: 'https://example.com/rail' }],
  },
];

async function main() {
  // 1. Unknown slug → immediate, clear error.
  await assert.rejects(generateCategoryTopics('not_a_slug', RANGE), /Unknown category/);

  // 2. Happy path through the full pipeline (request built, sent, parsed, validated).
  stubFetch(() =>
      assistantResponse('Sure! Here you go:\n```json\n' + JSON.stringify(RAW_TOPICS) + '\n```\nAnything else?'),
  );
  assert.deepEqual(await generateCategoryTopics('hong_kong', RANGE), EXPECTED_TOPICS);

  // 3. Malformed output (no JSON anywhere) → throws.
  stubFetch(() => assistantResponse('I could not search the web, sorry.'));
  await assert.rejects(generateCategoryTopics('world', RANGE), /not parseable JSON/);

  // 4. Shape violations → precise errors: empty sources, then a non-http url.
  stubFetch(() => assistantResponse(JSON.stringify([{ headline: 'h', body: 'b', sources: [] }])));
  await assert.rejects(generateCategoryTopics('world', RANGE), /sources/);
  stubFetch(() =>
      assistantResponse(JSON.stringify([{ headline: 'h', body: 'b', sources: [{ title: 't', url: 'example.com' }] }])),
  );
  await assert.rejects(generateCategoryTopics('world', RANGE), /url/);

  // 5. Transient failure: first attempt 503s, second succeeds (1 backoff sleep).
  let calls = 0;
  stubFetch(() =>
      ++calls === 1 ? new Response('upstream overloaded', { status: 503 }) : assistantResponse(JSON.stringify(RAW_TOPICS)),
  );
  await generateCategoryTopics('sport', RANGE);
  assert.equal(calls, 2);

  // 6. Non-retryable HTTP 400 fails after exactly one attempt.
  calls = 0;
  stubFetch(() => {
    calls++;
    return new Response('bad request', { status: 400 });
  });
  await assert.rejects(generateCategoryTopics('sport', RANGE), /HTTP 400/);
  assert.equal(calls, 1);

  // 7. generateReport: one category 400s — it is logged (see stderr) and
  //    skipped while the other category still produces its topics.
  stubFetch((body) =>
      body.includes('sports news') // sport's prompt label — request-body routing
          ? new Response('bad request', { status: 400 })
          : assistantResponse(JSON.stringify(RAW_TOPICS)),
  );
  const user: User = {
    id: '00000000-0000-0000-0000-000000000000',
    email: 'test@example.com',
    timezone: 'Asia/Hong_Kong',
    createdAt: new Date(),
  };
  const preferences: Preferences = {
    userId: user.id,
    frequency: 'daily',
    deliveryHour: 8,
    categories: ['hong_kong', 'sport'],
    pushSubscription: null,
    updatedAt: new Date(),
  };
  const report = await generateReport(user, preferences, RANGE);
  assert.equal(report.length, 2);
  assert.ok(report.every((topic) => topic.category === 'hong_kong'));

  globalThis.fetch = realFetch;

  // 8. Live round-trip (only when the provider is configured).
  if (liveConfigured) {
    const topics = await generateCategoryTopics('hong_kong', RANGE);
    console.log(`live: hong_kong → ${topics.length} topic(s):`);
    for (const topic of topics) console.log(`  - ${topic.headline} (${topic.sources.length} sources)`);
  } else {
    console.log('live: LLM_* env not set — skipped');
  }

  console.log('llm-smoke: all checks OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});