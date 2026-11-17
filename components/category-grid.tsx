import { CATEGORY_LABELS, CATEGORY_SLUGS, type CategorySlug } from '../lib/shared/categories.ts';

export function CategoryGrid({
  selected,
  onToggle,
}: {
  selected: ReadonlySet<CategorySlug>;
  onToggle: (slug: CategorySlug) => void;
}) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {CATEGORY_SLUGS.map((slug) => (
        <label
          key={slug}
          className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm transition-colors has-[:checked]:border-indigo-300 has-[:checked]:bg-indigo-50/60"
        >
          <input
            type="checkbox"
            checked={selected.has(slug)}
            onChange={() => onToggle(slug)}
            className="h-4 w-4 accent-indigo-600"
          />
          {CATEGORY_LABELS[slug]}
        </label>
      ))}
    </div>
  );
}
