/**
 * The LLM abstraction: fetches the day's news for a category via a
 * web-search-enabled chat model.
 *
 * Provider-agnostic by design. The ONLY code that knows the wire format is
 * `postChatCompletion` — swapping providers means editing that one function
 * plus the three LLM_* env vars (see .env.example). Everything above it talks
 * in prompts and markdown strings, everything below it is plain HTTPS plumbing.
 *
 * Output policy: the model's own markdown IS the report body — no JSON schema
 * is enforced on the model and there is no parsing beyond an empty-response
 * check. Each category's markdown is keyed by (category, frequency, to)
 * (MarkdownCacheKey) so identical requests share one cached LLM call.
 *
 * Scope: content only. This module never touches the database and never sends
 * notifications — cache storage is INJECTED as a MarkdownCache (implemented
 * over the markdown_cache table in lib/db.ts); the cron route wires it up.
 */

import 'server-only';

import {
  CATEGORY_SLUGS,
  type CategorySlug,
  type Frequency,
  type MarkdownCache,
  type MarkdownCacheKey,
  type ReportDraft,
  type User,
} from './types.ts';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Categories requested in parallel per report; kept low to avoid 429s. */
const MAX_CONCURRENCY = 3;
/** Per-attempt timeout — search-grounded multi-topic summaries can take a minute. */
const REQUEST_TIMEOUT_MS = 90_000;
/** Retries AFTER the first attempt (up to 3 attempts total per call). */
const MAX_RETRIES = 2;
/** Backoff base: 1s after the 1st attempt, 4s after the 2nd. */
const BACKOFF_BASE_MS = 1_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ask the model for the news in one category — "today on `to`" for daily,
 * the derived 7-day window for weekly — and return its markdown verbatim.
 * There is no output schema to enforce — the only validation is the
 * non-emptiness check inside extractAssistantText — so callers get the
 * model's words as-is. Throws on transport failures; callers treat a
 * category as best-effort (see generateReport).
 */
export async function generateCategoryMarkdown(
  category: string,
  to: string,
  frequency: Frequency,
): Promise<string> {
  // The DB CHECK already guarantees valid slugs; this guards programmatic misuse.
  if (!(CATEGORY_SLUGS as readonly string[]).includes(category)) {
    throw new Error(`Unknown category "${category}" — expected one of: ${CATEGORY_SLUGS.join(', ')}`);
  }
  return postChatCompletion(buildMessages(category as CategorySlug, to, frequency));
}

/**
 * Build ONE whole report for an explicit (categories, frequency) pair,
 * reusing cached markdown wherever possible. `categories` and `frequency`
 * are CALLER-supplied, not read from preferences: a user now has two
 * per-frequency category lists, and the caller (the /api/generate worker)
 * decides which lists to run and may call this twice per user per tick — a
 * local-Monday tick generates the daily report and the weekly report as two
 * separate ReportDrafts. Every draft covers exactly one frequency.
 *
 * Per category (at most MAX_CONCURRENCY in flight), (category, frequency,
 * to) form a MarkdownCacheKey: a cache hit skips the LLM entirely — users
 * sharing a category, window and frequency read one stored markdown. On a
 * miss the model is called and the result is cached. The returned content is
 * the list of surviving keys (pointers the frontend resolves via
 * lib/db.ts's getReportMarkdown), NOT the markdown itself.
 *
 * `to` is the ISO date (YYYY-MM-DD) the window ends on ("today"). The covered
 * period is DERIVED from (to, frequency) inside reportPeriod, matching the
 * weekly `from` derived in buildMessages — so prompt, cache key and stored
 * period always agree.
 *
 * A category fails and is skipped (logged) when the cache or the LLM call
 * fails — cache.set must succeed BEFORE we point at the row, so a stored
 * report never contains a dangling key. Returns the complete ReportDraft so
 * the worker can store it with a single saveReport call; if every category
 * fails, content is [] and the caller decides whether an empty report is
 * worth storing (it reports the upstream failure instead).
 */
export async function generateReport(
  user: User,
  categories: CategorySlug[],
  frequency: Frequency,
  to: string,
  cache: MarkdownCache,
): Promise<ReportDraft> {
  const unique = [...new Set(categories)]; // defensive dedupe
  const sections = await mapLimit(unique, MAX_CONCURRENCY, async (category) => {
    // Explicit key type: the literal infers category: CategorySlug, which
    // then fights the filter's type predicate below. `to` is exactly the
    // cache key's date — no slicing, no second source of truth.
    const key: MarkdownCacheKey = { category, frequency, to };
    try {
      if ((await cache.get(key)) !== null) return key;
      await cache.set(key, await generateCategoryMarkdown(category, to, frequency));
      return key;
    } catch (err) {
      console.error(`[llm] category "${category}" failed for user ${user.email} — skipping`, err);
      return null;
    }
  });
  const content = sections.filter((section): section is MarkdownCacheKey => section !== null);
  return {
    kind: frequency, // mirrors frequency; left free for future kinds
    frequency,
    ...reportPeriod(to, frequency),
    content,
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/** Prose label per category slug (slugs alone read poorly in a prompt). */
const CATEGORY_LABELS: Record<CategorySlug, string> = {
  world: 'news in the world',
  asia_pacific: 'Asia-Pacific news',
  hong_kong: 'Hong Kong news',
  economics: 'economics and business news',
  sport: 'sports news',
  entertainment: 'entertainment news',
  lifestyle: 'lifestyle news',
  technology: 'technology news',
};

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** ISO calendar date minus n days. UTC-only math — these are plain dates
 * (YYYY-MM-DD), never wall-clock instants, so no timezone database is needed. */
const minusDays = (isoDate: string, days: number): string =>
  new Date(new Date(`${isoDate}T00:00:00Z`).getTime() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * The period a report covers, derived from (to, frequency): the `to` day for
 * daily, the 7 days ending on `to` for weekly. Same derivation buildMessages
 * uses for the weekly `from`, so the stored dates always agree with the
 * prompt that produced the content.
 */
function reportPeriod(to: string, frequency: Frequency): { periodStart: Date; periodEnd: Date } {
  const startIso = frequency === 'weekly' ? minusDays(to, 7) : to;
  return {
    periodStart: new Date(`${startIso}T00:00:00Z`),
    periodEnd: new Date(`${to}T23:59:59.999Z`), // end of the `to` day
  };
}

function buildMessages(category: CategorySlug, to: string, frequency: Frequency): ChatMessage[] {
  // The weekly window is DERIVED here (to − 7 days) rather than passed in,
  // so the prompt can never drift from the cache key (category, frequency,
  // to) that identifies its markdown. Daily asks about "today" alone.
  const period = frequency === 'weekly'
      ? `this week - from ${minusDays(to, 7)} to ${to}`
      : `today on ${to}`;

  const system = [
    'You are the news editor of a personalized briefing product.',
    'You have web-search capability: you MUST search the web for the requested period and ground every statement in what you find.',
    'Cite any sources that the reader can read as further reading.',
    'Rule: All sources should be a particular article or report. Omit anything you cannot source. Do not use the generic news website homepage or category page as source. Every "url" must be an accessible real http(s) URL you actually found.',
  ].join(' ');

  // Deliberately one short question: with search grounding doing the work, the
  // long prescriptive prompt mostly produced brittle JSON, not better news.
  const user = `What are some top ${CATEGORY_LABELS[category]} that I should be aware of ${period}?`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ---------------------------------------------------------------------------
// Provider seam — edit HERE (and the LLM_* env vars) when swapping providers
// ---------------------------------------------------------------------------

/**
 * POST one chat completion and return the assistant's text.
 *
 * Transport: Google's NATIVE generateContent API — POST
 * `{LLM_BASE_URL}/models/{LLM_MODEL}:generateContent` — with the
 * `google_search` tool, so the grounding the prompt demands is real.
 *
 * Why native and not the OpenAI-compatible `/chat/completions` served on the
 * same host: the compat layer has NO way to enable search grounding (every
 * spelling — `tools:[{type:'google_search'}]`, `web_search_options`, … — is
 * rejected with a 400), and a model told to "search the web" without a
 * search tool fights back: Gemini 3 emits a pseudo-search function call that
 * the endpoint either drops (empty response, finish_reason
 * "MALFORMED_FUNCTION_CALL") or rejects (HTTP 400). Declaring the tool makes
 * the search genuine and cited.
 *
 * Swapping providers means rewriting THIS function plus the LLM_* env vars
 * (see .env.example): Perplexity sonar / OpenAI *-search-preview are plain
 * OpenAI-compatible POSTs with search built into the model; OpenRouter offers
 * ":online" model ids; xAI takes `search_parameters: { mode: 'on' }` — all can
 * consume the same ChatMessage[] the prompt layer produces. Free-form markdown
 * output means `response_format` is never needed (several search models reject
 * it anyway).
 */
async function postChatCompletion(messages: ChatMessage[]): Promise<string> {
  const { baseUrl, apiKey, model } = llmEnv();
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join(' ');
  const contents = messages
    .filter((message) => message.role === 'user')
    .map((message) => ({ role: 'user', parts: [{ text: message.content }] }));
  const body: Record<string, unknown> = {
    contents,
    tools: [{ google_search: {} }], // snake_case: the REST field name
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const raw = await fetchWithRetry(
    `${baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return extractAssistantText(raw);
}

/**
 * Env is read lazily (unlike lib/db.ts's module-load check) so scripts can
 * import this module and exercise the parsing logic without credentials.
 */
function llmEnv(): { baseUrl: string; apiKey: string; model: string } {
  const missing = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing LLM environment variable(s): ${missing.join(', ')} — see .env.example`);
  }
  return {
    baseUrl: process.env.LLM_BASE_URL as string,
    apiKey: process.env.LLM_API_KEY as string,
    model: process.env.LLM_MODEL as string,
  };
}

/**
 * Unwraps the assistant's text from a generateContent response: the first
 * candidate's text parts, joined. Search grounding returns ordinary text parts
 * (citations ride along in a separate groundingMetadata field we ignore — the
 * model is asked to cite further reading inline). Thought parts are skipped
 * defensively, though they are only produced when explicitly requested.
 */
function extractAssistantText(rawBody: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error(`LLM endpoint returned non-JSON: ${snippet(rawBody)}`);
  }
  const body = parsed as {
    candidates?: Array<{
      finishReason?: unknown;
      content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
    }>;
  };
  const candidate = body.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => part.thought !== true)
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('');
  if (text.trim() === '') {
    throw new Error(
      `LLM response has no text content (finishReason=${String(candidate?.finishReason ?? '?')}): ` +
        snippet(rawBody),
    );
  }
  return text;
}

// ---------------------------------------------------------------------------
// Transport plumbing (timeout + retry) — nothing provider-specific below
// ---------------------------------------------------------------------------

/** Failure another attempt might fix (429, 5xx). */
class TransientError extends Error {}
/** Failure every retry would reproduce identically (400/401/404/…). */
class FatalError extends Error {}

/**
 * fetch with up to MAX_RETRIES retries and a REQUEST_TIMEOUT_MS timeout per
 * attempt. Backoff is plain exponential with no jitter — at prototype call
 * volumes jitter buys nothing. Timeouts are NOT retried: a call that needs
 * more than the timeout once will very likely time out again and just eat the cron
 * invocation's remaining time budget.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<string> {
  let lastError: Error = new Error(`LLM request failed after ${MAX_RETRIES + 1} attempts: ${url}`);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(BACKOFF_BASE_MS * 4 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok) return await response.text();
      const text = await response.text();
      if (response.status === 429 || response.status >= 500) {
        throw new TransientError(`LLM endpoint returned HTTP ${response.status}: ${snippet(text)}`);
      }
      throw new FatalError(`LLM endpoint returned HTTP ${response.status}: ${snippet(text)}`);
    } catch (err) {
      if (err instanceof FatalError) throw err;
      // AbortError is a DOMException (not an Error subclass in some runtimes),
      // so match on name rather than instanceof.
      const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : undefined;
      if (name === 'AbortError') {
        throw new Error(`LLM request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${url}`);
      }
      if (err instanceof TransientError) {
        lastError = err;
      } else {
        lastError = err instanceof Error ? err : new Error(String(err)); // network-level failure
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Runs fn over items with at most `limit` in flight, preserving input order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++; // JS is single-threaded: no race between awaits
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Truncates for error messages / logs. */
const snippet = (s: string): string => (s.length > 300 ? `${s.slice(0, 300)}…` : s);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
