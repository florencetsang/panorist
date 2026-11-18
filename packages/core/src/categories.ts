/**
 * The fixed category vocabulary. Mirrored by CHECK constraints in
 * db/migrations — a unit test keeps the two in sync.
 */
export const CATEGORY_SLUGS = [
  'world',
  'asia_pacific',
  'hong_kong',
  'economics',
  'sport',
  'entertainment',
  'lifestyle',
  'technology',
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

/** Compact UI labels. Prompt phrasing lives in lib/server/reports/prompts.ts. */
export const CATEGORY_LABELS: Record<CategorySlug, string> = {
  world: 'World',
  asia_pacific: 'Asia-Pacific',
  hong_kong: 'Hong Kong',
  economics: 'Economics & Business',
  sport: 'Sport',
  entertainment: 'Entertainment',
  lifestyle: 'Lifestyle',
  technology: 'Technology',
};

export function isCategorySlug(value: unknown): value is CategorySlug {
  return typeof value === 'string' && (CATEGORY_SLUGS as readonly string[]).includes(value);
}

/** UI label for a slug, falling back to the raw value for unknown slugs. */
export function categoryLabel(slug: string): string {
  return isCategorySlug(slug) ? CATEGORY_LABELS[slug] : slug;
}
