/**
 * Provider-agnostic LLM seam. Callers work in prompts and text; each provider
 * owns its wire format. Swapping providers means adding an implementation
 * and selecting it in ./index.ts.
 */

export interface Prompt {
  system: string;
  user: string;
}

export interface CompletionOptions {
  /** Override the provider's default model, e.g. a cheaper one for small tasks. */
  model?: string;
  /** Ground the answer in a web search. Defaults to true. */
  search?: boolean;
  /**
   * Ask for JSON matching this (OpenAPI-subset) schema. The text returned is
   * still a string; the caller parses and validates it. Not combinable with
   * search on every model, so callers should pass `search: false`.
   */
  jsonSchema?: Record<string, unknown>;
}

export interface LlmProvider {
  /** Return the model's text response. Throws on transport failure or empty output. */
  complete(prompt: Prompt, options?: CompletionOptions): Promise<string>;
}
