/**
 * Provider-agnostic LLM seam. Callers work in prompts and text; each provider
 * owns its wire format. Swapping providers means adding an implementation
 * and selecting it in ./index.ts.
 */

export interface Prompt {
  system: string;
  user: string;
}

export interface LlmProvider {
  /** Return the model's text response. Throws on transport failure or empty output. */
  complete(prompt: Prompt): Promise<string>;
}
