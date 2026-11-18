import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildRequestBody, createGeminiProvider, extractText } from '../lib/server/llm/gemini.ts';
import { fetchTextWithRetry } from '../lib/server/llm/transport.ts';

const NO_WAIT = { timeoutMs: 1_000, maxRetries: 2, backoffBaseMs: 0 };
const geminiBody = (parts: object[]) =>
  JSON.stringify({ candidates: [{ content: { parts }, finishReason: 'STOP' }] });

function stubFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gemini', () => {
  it('builds a search-grounded request', () => {
    expect(buildRequestBody({ system: 'S', user: 'U' })).toEqual({
      systemInstruction: { parts: [{ text: 'S' }] },
      contents: [{ role: 'user', parts: [{ text: 'U' }] }],
      tools: [{ google_search: {} }],
    });
  });

  it('joins text parts and drops thoughts', () => {
    expect(
      extractText(geminiBody([{ text: 'a' }, { text: 'x', thought: true }, { text: 'b' }])),
    ).toBe('ab');
  });

  it('rejects blank and non-JSON bodies', () => {
    expect(() => extractText(geminiBody([{ text: '  ' }]))).toThrow(/no text content/);
    expect(() => extractText('<html>')).toThrow(/non-JSON/);
  });

  it('posts to the model endpoint with the API key', async () => {
    const fetch = stubFetch(new Response(geminiBody([{ text: 'hi' }])));
    const llm = createGeminiProvider({
      baseUrl: 'https://g.example/v1/',
      apiKey: 'k',
      model: 'm',
      retry: NO_WAIT,
    });
    expect(await llm.complete({ system: 's', user: 'u' })).toBe('hi');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://g.example/v1/models/m:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
  });
});

describe('fetchTextWithRetry', () => {
  it('retries 5xx, 429 and network errors', async () => {
    const fetch = stubFetch(
      new Response('', { status: 503 }),
      new TypeError('net'),
      new Response('ok'),
    );
    await expect(fetchTextWithRetry('https://x', {}, NO_WAIT)).resolves.toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('fails fast on other HTTP errors', async () => {
    const fetch = stubFetch(new Response('bad', { status: 400 }));
    await expect(fetchTextWithRetry('https://x', {}, NO_WAIT)).rejects.toThrow(/HTTP 400/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries', async () => {
    stubFetch(...[1, 2, 3].map(() => new Response('', { status: 429 })));
    await expect(fetchTextWithRetry('https://x', {}, NO_WAIT)).rejects.toThrow(/HTTP 429/);
  });

  it('does not retry timeouts', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    const fetch = stubFetch(timeout);
    await expect(fetchTextWithRetry('https://x', {}, NO_WAIT)).rejects.toThrow(/timed out/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
