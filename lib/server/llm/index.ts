import 'server-only';

import { env } from '../env.ts';
import { createGeminiProvider } from './gemini.ts';
import type { LlmProvider } from './provider.ts';

export type { LlmProvider, Prompt } from './provider.ts';

let provider: LlmProvider | null = null;

/** The configured provider (Gemini today), created on first use. */
export function getLlmProvider(): LlmProvider {
  provider ??= createGeminiProvider(env.llm());
  return provider;
}
