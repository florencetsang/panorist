/**
 * The LLM abstraction: discovers and summarizes news via a web-search-enabled
 * chat model.
 *
 * Provider-agnostic by design. The ONLY code that knows the wire format is
 * `postChatCompletion` — swapping providers means editing that one function
 * plus the three LLM_* env vars (see .env.example). Everything above it talks
 * in prompts and TopicContent[], everything below it is plain HTTPS plumbing.
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
  type TopicSource,
  type User,
} from './types.ts';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Categories requested in parallel per report; kept low to avoid 429s. */
const MAX_CONCURRENCY = 3;
/** Per-attempt timeout — web search plus long summaries can take tens of seconds. */
const REQUEST_TIMEOUT_MS = 60_000;
/** Retries AFTER the first attempt (up to 3 attempts total per call). */
const MAX_RETRIES = 2;
/** Backoff base: 1s after the 1st attempt, 4s after the 2nd. */
const BACKOFF_BASE_MS = 1_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ask the model for the most important news in one category for a date range,
 * as 2-4 distinct topics, each with a headline, a comprehensive multi-paragraph
 * body and real sources. Throws on malformed model output — callers treat a
 * category as best-effort (see generateReport).
 */
export async function generateCategoryTopics(
  category: string,
  dateRange: DateRange,
): Promise<TopicContent[]> {
  // The DB CHECK already guarantees valid slugs; this guards programmatic misuse.
  if (!(CATEGORY_SLUGS as readonly string[]).includes(category)) {
    throw new Error(`Unknown category "${category}" — expected one of: ${CATEGORY_SLUGS.join(', ')}`);
  }
  const raw = await postChatCompletion(buildMessages(category as CategorySlug, dateRange));
  return validateTopics(parseModelJson(raw), category);
}

/**
 * Build a whole report: one generateCategoryTopics call per subscribed category
 * (at most MAX_CONCURRENCY in flight), flattened in the user's preference
 * order. A category whose call fails is logged and skipped — one flaky request
 * must not kill the report. If every category fails, [] is returned and the
 * cron route decides whether an empty report is worth storing.
 */
export async function generateReport(
  user: User,
  preferences: Preferences,
  dateRange: DateRange,
): Promise<TopicContent[]> {
  const categories = [...new Set(preferences.categories)]; // defensive dedupe
  const perCategory = await mapLimit(categories, MAX_CONCURRENCY, (category) =>
    generateCategoryTopics(category, dateRange).catch((err) => {
      console.error(`[llm] category "${category}" failed for user ${user.email} — skipping`, err);
      return [] as TopicContent[];
    }),
  );
  return perCategory.flat();
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
};

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

function buildMessages(category: CategorySlug, { start, end }: DateRange): ChatMessage[] {
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const from = start.toISOString().slice(0, 10);
  const to = end.toISOString().slice(0, 10);

  const system = [
    'You are the news editor of a personalized briefing product.',
    'You have web-search capability: you MUST search the web for the requested period and ground every statement in what you find.',
    'You always answer with strict JSON only — no markdown fences, no commentary before or after.',
  ].join(' ');

  const user = [
    `Identify the most important ${CATEGORY_LABELS[category]} (category slug "${category}") a reader should know about between ${from} and ${to} — a ${days}-day window where ${to} is "today".`,
    '',
    'Select the 2 to 4 most important, clearly DISTINCT topics of that window. Distinct means different events or storylines — never two angles of the same story.',
    '',
    'For each topic provide:',
    '- "headline": one clear declarative sentence, at most 15 words, no outlet name.',
    '- "body": a comprehensive summary in 2-3 paragraphs separated by a blank line (\\n\\n): what happened, the key facts and figures, and why it matters. Write for a busy reader.',
    '- "sources": 2 to 4 real articles you found via web search; "title" is the article headline, "url" its canonical URL.',
    '',
    'Rules: use only information you verified via web search for this window; omit anything you cannot source; every "url" must be a real http(s) URL you actually found.',
    '',
    'Respond with ONLY a JSON array matching exactly this schema:',
    '[',
    '  {',
    '    "category": "<the slug given above>",',
    '    "headline": "string",',
    '    "body": "string (multi-paragraph, \\n\\n between paragraphs)",',
    '    "sources": [{ "title": "string", "url": "string" }]',
    '  }',
    ']',
  ].join('\n');

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
 * Transport: a standard OpenAI-compatible request to
 * `{LLM_BASE_URL}/chat/completions`. Web search is a property of the MODEL
 * here, because the chat-completions spec has no standard search switch —
 * every provider gates it differently, and unknown extra fields risk 400s
 * from strict endpoints:
 *   • Perplexity sonar / OpenAI *-search-preview / Gemini grounded models:
 *     search is built in — pick the model via LLM_MODEL, add nothing (default).
 *   • OpenRouter: use an ":online" model id, or add `plugins: [{type:'web_search'}]`.
 *   • xAI: add `search_parameters: { mode: 'on' }`.
 *   • OpenAI Responses API: switch the URL to /responses and pass `tools`.
 * The prompt (buildMessages) reinforces this by instructing the model to use
 * its search capability; strict-JSON output is likewise enforced by the
 * prompt + defensive parsing rather than `response_format`, which several
 * search models reject.
 */
async function postChatCompletion(messages: ChatMessage[]): Promise<string> {
  const { baseUrl, apiKey, model } = llmEnv();
  const raw = await fetchWithRetry(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages }), // deliberately only standard fields
  });
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

/** Unwraps the assistant's text from an OpenAI-compatible response body. */
function extractAssistantText(rawBody: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error(`LLM endpoint returned non-JSON: ${snippet(rawBody)}`);
  }
  const content = (parsed as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]
    ?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error(`LLM response has no message content: ${snippet(rawBody)}`);
  }
  return content;
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
 * more than 60s once will very likely time out again and just eat the cron
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
// Output parsing & validation (defensive: models misformat JSON constantly)
// ---------------------------------------------------------------------------

/** Model text → parsed JSON: strips ``` fences, salvages an array from prose. */
function parseModelJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = (fenced ? fenced[1] : raw).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // Some models wrap the JSON in a sentence ("Here is your briefing:") or
    // append usage notes; the report itself is the outermost [...] — salvage it.
    const start = candidate.indexOf('[');
    const end = candidate.lastIndexOf(']');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* fall through to the error below */
      }
    }
    throw new Error(`LLM output is not parseable JSON: ${snippet(raw)}`);
  }
}

/**
 * Shape-validates the parsed output against TopicContent[] and throws with a
 * precise reason on the first malformed element — during a prototype, loud
 * failures beat silently storing broken reports. One soft spot: "category" is
 * overwritten with the requested slug, because we know which call produced the
 * row, so a mismatch is cosmetic rather than structural.
 */
function validateTopics(parsed: unknown, category: string): TopicContent[] {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`Expected a non-empty JSON array of topics, got: ${snippet(JSON.stringify(parsed))}`);
  }
  return parsed.map((raw, i): TopicContent => {
    const where = `topic ${i}`;
    if (typeof raw !== 'object' || raw === null) throw new Error(`${where}: not an object`);
    const { headline, body, sources } = raw as Record<string, unknown>;
    if (typeof headline !== 'string' || !headline.trim()) throw new Error(`${where}: missing "headline"`);
    if (typeof body !== 'string' || !body.trim()) throw new Error(`${where}: missing "body"`);
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new Error(`${where}: "sources" must be a non-empty array`);
    }
    const cleanSources: TopicSource[] = sources.map((source, j): TopicSource => {
      const at = `${where} source ${j}`;
      if (typeof source !== 'object' || source === null) throw new Error(`${at}: not an object`);
      const { title, url } = source as Record<string, unknown>;
      if (typeof title !== 'string' || !title.trim()) throw new Error(`${at}: missing "title"`);
      if (typeof url !== 'string' || !/^https?:\/\//.test(url.trim())) {
        throw new Error(`${at}: "url" is not a valid http(s) URL: ${String(url)}`);
      }
      return { title: title.trim(), url: url.trim() };
    });
    return { category, headline: headline.trim(), body: body.trim(), sources: cleanSources };
  });
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
