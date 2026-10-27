'use client';

/**
 * Preferences editor: category checkboxes, daily/weekly frequency, delivery
 * hour. Loads GET /api/preferences, saves via PATCH (same route) — the form
 * always sends all three fields, so the server row and the UI can't drift.
 */

import { useEffect, useState } from 'react';
import {
  CATEGORY_LABELS,
  CATEGORY_SLUGS,
  type CategorySlug,
  type Frequency,
  type UserWithPreferencesWire,
} from '../../lib/types.ts';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready' };

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'error'; message: string };

export default function PreferencesForm({ userId }: { userId: string | null }) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [save, setSave] = useState<SaveState>({ status: 'idle' });

  const [categories, setCategories] = useState<Set<CategorySlug>>(new Set());
  const [frequency, setFrequency] = useState<Frequency>('daily');
  const [deliveryHour, setDeliveryHour] = useState(8);
  const [timezone, setTimezone] = useState(''); // shown next to the hour field

  // Load current preferences. 404 → the id isn't in the db (seed it first).
  useEffect(() => {
    if (!userId) {
      setLoad({ status: 'error', message: 'No user id — add ?userId=<uuid> or set NEXT_PUBLIC_TEST_USER_ID.' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/preferences?userId=${encodeURIComponent(userId)}`);
        if (res.status === 404) throw new Error('unknown user');
        if (!res.ok) throw new Error(`GET /api/preferences answered ${res.status}`);
        const prefs = (await res.json()) as UserWithPreferencesWire;
        if (cancelled) return;
        setCategories(new Set(prefs.categories));
        setFrequency(prefs.frequency);
        setDeliveryHour(prefs.deliveryHour);
        setTimezone(prefs.timezone);
        setLoad({ status: 'ready' });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error && err.message === 'unknown user'
            ? 'Unknown user id — run `npm run db:setup` (or check ?userId=).'
            : 'Could not load preferences — is the database up?';
        setLoad({ status: 'error', message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Any edit clears the "Saved" confirmation until the next save.
  const edited = () => setSave({ status: 'idle' });

  function toggleCategory(slug: CategorySlug) {
    const next = new Set(categories);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setCategories(next);
    edited();
  }

  const hourValid = Number.isInteger(deliveryHour) && deliveryHour >= 0 && deliveryHour <= 23;
  const canSave = load.status === 'ready' && categories.size > 0 && hourValid && save.status !== 'saving';

  async function onSave() {
    if (!userId || !canSave) return;
    setSave({ status: 'saving' });
    try {
      const res = await fetch('/api/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId,
          patch: { frequency, deliveryHour, categories: [...categories] },
        }),
      });
      if (!res.ok) throw new Error(`PATCH /api/preferences answered ${res.status}`);
      // The response is the stored row — re-apply it so the UI mirrors the
      // server exactly (fresh updated_at too).
      const prefs = (await res.json()) as UserWithPreferencesWire;
      setCategories(new Set(prefs.categories));
      setFrequency(prefs.frequency);
      setDeliveryHour(prefs.deliveryHour);
      setSave({ status: 'saved' });
    } catch (err) {
      console.error('[preferences] save failed', err);
      setSave({ status: 'error', message: 'Save failed — check the console, then retry.' });
    }
  }

  if (load.status === 'loading') {
    return (
      <div className="animate-pulse space-y-4" aria-hidden>
        <div className="h-6 w-32 rounded bg-stone-100" />
        <div className="h-24 rounded-lg border border-stone-200 bg-white" />
        <div className="h-16 rounded-lg border border-stone-200 bg-white" />
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{load.message}</p>
    );
  }

  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">Preferences</h1>
      <p className="mt-1 text-sm text-stone-500">What to cover, and when to deliver it.</p>

      {/* Categories — the fixed prototype vocabulary (mirrors the DB CHECK) */}
      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-stone-900">Categories</legend>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CATEGORY_SLUGS.map((slug) => (
            <label
              key={slug}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm transition-colors has-[:checked]:border-indigo-300 has-[:checked]:bg-indigo-50/60"
            >
              <input
                type="checkbox"
                checked={categories.has(slug)}
                onChange={() => toggleCategory(slug)}
                className="h-4 w-4 accent-indigo-600"
              />
              {CATEGORY_LABELS[slug]}
            </label>
          ))}
        </div>
        {categories.size === 0 && (
          <p className="mt-2 text-xs text-stone-500">Pick at least one category to save.</p>
        )}
      </fieldset>

      {/* Frequency */}
      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-stone-900">Frequency</legend>
        <div className="mt-3 flex gap-2">
          {(['daily', 'weekly'] as const).map((value) => (
            <label
              key={value}
              className="flex flex-1 cursor-pointer items-center gap-2.5 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm transition-colors has-[:checked]:border-indigo-300 has-[:checked]:bg-indigo-50/60 sm:flex-none sm:px-4"
            >
              <input
                type="radio"
                name="frequency"
                value={value}
                checked={frequency === value}
                onChange={() => {
                  setFrequency(value);
                  edited();
                }}
                className="h-4 w-4 accent-indigo-600"
              />
              {value === 'daily' ? 'Daily' : 'Weekly (Mondays)'}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Delivery hour — local wall-clock hour in the user's timezone (the
          cron route lets Postgres do the tz math; see lib/db.ts). */}
      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-stone-900">Delivery hour</legend>
        <div className="mt-3 flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={23}
            value={deliveryHour}
            onChange={(e) => {
              setDeliveryHour(Number(e.target.value));
              edited();
            }}
            className="w-20 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm invalid:border-red-300"
          />
          <span className="text-xs text-stone-500">
            Local hour (0–23){timezone && ` in ${timezone}`}
          </span>
        </div>
        {!hourValid && <p className="mt-2 text-xs text-red-600">Hour must be an integer 0–23.</p>}
      </fieldset>

      {/* Save + confirmation */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {save.status === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {save.status === 'saved' && (
          <span className="text-sm font-medium text-emerald-700" role="status">
            Saved ✓
          </span>
        )}
        {save.status === 'error' && (
          <span className="text-sm text-red-600" role="alert">
            {save.message}
          </span>
        )}
      </div>
    </section>
  );
}