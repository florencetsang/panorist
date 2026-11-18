// One live, search-grounded LLM round-trip per category — a manual check that
// the configured provider works. Prints the markdown; stores nothing.
// Offline behaviour (prompts, parsing, retries) is covered by `npm test`.
//
// Run: node --env-file=.env.local --conditions react-server scripts/llm-live.ts [category...]

import { getLlmProvider } from '../lib/server/llm/index.ts';
import { generateReport } from '../lib/server/reports/generate-report.ts';
import { isCategorySlug, type CategorySlug } from '@panorist/core/categories';
import type { MarkdownCache } from '@panorist/core/types';

async function main() {
  const args = process.argv.slice(2);
  const invalid = args.filter((a) => !isCategorySlug(a));
  if (invalid.length) throw new Error(`unknown category: ${invalid.join(', ')}`);
  const categories = (args.length ? args : ['hong_kong']) as CategorySlug[];

  const store = new Map<string, string>();
  const cache: MarkdownCache = {
    get: async (key) => store.get(JSON.stringify(key)) ?? null,
    set: async (key, markdown) => void store.set(JSON.stringify(key), markdown),
  };

  const to = new Date().toISOString().slice(0, 10);
  const report = await generateReport(categories, 'daily', to, { llm: getLlmProvider(), cache });
  for (const key of report.content) {
    const markdown = store.get(JSON.stringify(key)) ?? '';
    console.log(`\n===== ${key.category} (${markdown.length} chars) =====\n${markdown}\n`);
  }
  if (report.content.length < categories.length) {
    throw new Error(
      `${categories.length - report.content.length} category(ies) failed — see above`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
