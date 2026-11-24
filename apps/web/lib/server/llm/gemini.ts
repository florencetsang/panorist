/**
 * Google Gemini via the native generateContent API with the `google_search`
 * tool, so web-search grounding is real. The OpenAI-compatible endpoint
 * can't enable search grounding — see ARCHITECTURE.md.
 */

import type { CompletionOptions, LlmProvider, Prompt } from './provider.ts';
import { DEFAULT_RETRY, fetchTextWithRetry, snippet, type RetryOptions } from './transport.ts';

export interface GeminiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  retry?: RetryOptions;
}

export function createGeminiProvider(config: GeminiConfig): LlmProvider {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  return {
    async complete(prompt: Prompt, options: CompletionOptions = {}): Promise<string> {
      const model = options.model ?? config.model;
      const raw = await fetchTextWithRetry(
        `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'x-goog-api-key': config.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildRequestBody(prompt, options)),
        },
        config.retry ?? DEFAULT_RETRY,
      );
      return extractText(raw);
    },
  };
}

export function buildRequestBody(
  prompt: Prompt,
  options: CompletionOptions = {},
): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: prompt.system }] },
    contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
    ...(options.search !== false && { tools: [{ google_search: {} }] }),
    ...(options.jsonSchema && {
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: options.jsonSchema,
      },
    }),
  };
}

interface GenerateContentResponse {
  candidates?: Array<{
    finishReason?: unknown;
    content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
  }>;
}

/**
 * The first candidate's non-thought text parts, joined. Grounding citations
 * arrive in a separate groundingMetadata field, which is ignored — the prompt
 * asks for inline sources instead.
 */
export function extractText(rawBody: string): string {
  let body: GenerateContentResponse;
  try {
    body = JSON.parse(rawBody) as GenerateContentResponse;
  } catch {
    throw new Error(`LLM endpoint returned non-JSON: ${snippet(rawBody)}`);
  }
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
