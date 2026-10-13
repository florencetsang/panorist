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
 * check. Each category's markdown is stored verbatim, tagged with its slug.
 *
 * Scope: content only. This module never touches the database and never sends
 * notifications — the cron route orchestrates both around it.
 */

import 'server-only';

import {
  CATEGORY_SLUGS,
  type CategorySlug,
  type DateRange,
  type Preferences,
  type TopicContent,
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
 * Ask the model for today's news in one category and return its markdown
 * verbatim. There is no output schema to enforce — the only validation is
 * the non-emptiness check inside extractAssistantText — so callers get the
 * model's words as-is. Throws on transport failures; callers treat a category
 * as best-effort (see generateReport).
 */
export async function generateCategoryMarkdown(
  category: string,
  dateRange: DateRange,
): Promise<string> {
  // The DB CHECK already guarantees valid slugs; this guards programmatic misuse.
  if (!(CATEGORY_SLUGS as readonly string[]).includes(category)) {
    throw new Error(`Unknown category "${category}" — expected one of: ${CATEGORY_SLUGS.join(', ')}`);
  }
  return postChatCompletion(buildMessages(category as CategorySlug, dateRange));
}

/**
 * Build a whole report: one generateCategoryMarkdown call per subscribed
 * category (at most MAX_CONCURRENCY in flight), each yielding one
 * { category, markdown } element in the user's preference order. A category
 * whose call fails is logged and skipped — one flaky request must not kill
 * the report. If every category fails, [] is returned and the cron route
 * decides whether an empty report is worth storing.
 */
export async function generateReport(
  user: User,
  preferences: Preferences,
  dateRange: DateRange,
): Promise<TopicContent[]> {
  const categories = [...new Set(preferences.categories)]; // defensive dedupe
  const sections = await mapLimit(categories, MAX_CONCURRENCY, async (category) => {
    try {
      // Explicit TopicContent: the literal infers category: CategorySlug,
      // which then fights the filter's type predicate below.
      const topic: TopicContent = { category, markdown: await generateCategoryMarkdown(category, dateRange) };
      return topic;
    } catch (err) {
      console.error(`[llm] category "${category}" failed for user ${user.email} — skipping`, err);
      return null;
    }
  });
  return sections.filter((section): section is TopicContent => section !== null);
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/** Prose label per category slug (slugs alone read poorly in a prompt). */
const CATEGORY_LABELS: Record<CategorySlug, string> = {
  world: 'world news',
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

function buildMessages(category: CategorySlug, { end }: DateRange): ChatMessage[] {
  // "Today" is the end of the window (the cron run's reference date). The
  // window start is implicit — the system prompt's "requested period" covers
  // weekly ranges without spelling out dates twice.
  const to = end.toISOString().slice(0, 10);

  const system = [
    'You are the news editor of a personalized briefing product.',
    'You have web-search capability: you MUST search the web for the requested period and ground every statement in what you find.',
    'Cite any sources that the reader can read as further reading.',
  ].join(' ');

  // Deliberately one short question: with search grounding doing the work, the
  // long prescriptive prompt mostly produced brittle JSON, not better news.
  const user = `What are some top ${CATEGORY_LABELS[category]} that I should be aware of today on ${to}?`;

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
