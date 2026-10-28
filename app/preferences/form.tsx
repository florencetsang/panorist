'use client';

/**
 * Preferences editor: TWO per-frequency category lists — which categories go
 * into the DAILY report and which into the WEEKLY (local Monday) one — plus
 * the single global delivery hour. A category may be checked in both, one,
 * or neither group. Loads GET /api/preferences, saves via PATCH (same route)
 * — the form always sends all three fields, so the server row and the UI
 * can't drift.
 */

import { useEffect, useState } from 'react';
import {
  CATEGORY_LABELS,
  CATEGORY_SLUGS,
  type CategorySlug,
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

/** One category-checkbox grid, shared by the daily and weekly groups. */
function CategoryGrid({
  selected,
  onToggle,
}: {
  selected: Set<CategorySlug>;
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

export default function PreferencesForm({ userId }: { userId: string | null }) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [save, setSave] = useState<SaveState>({ status: 'idle' });

  const [dailyCategories, setDailyCategories] = useState<Set<CategorySlug>>(new Set());
  const [weeklyCategories, setWeeklyCategories] = useState<Set<CategorySlug>>(new Set());
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
        setDailyCategories(new Set(prefs.dailyCategories));
        setWeeklyCategories(new Set(prefs.weeklyCategories));
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

  function toggleIn(set: Set<CategorySlug>, slug: CategorySlug): Set<CategorySlug> {
    const next = new Set(set);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    return next;
  }

  // Both lists empty is the valid "paused" state (no reports generated), so
  // the only hard requirement is a sane delivery hour.
  const hourValid = Number.isInteger(deliveryHour) && deliveryHour >= 0 && deliveryHour <= 23;
  const paused = dailyCategories.size === 0 && weeklyCategories.size === 0;
  const canSave = load.status === 'ready' && hourValid && save.status !== 'saving';

  async function onSave() {
    if (!userId || !canSave) return;
    setSave({ status: 'saving' });
    try {
      const res = await fetch('/api/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId,
          patch: {
            deliveryHour,
            dailyCategories: [...dailyCategories],
            weeklyCategories: [...weeklyCategories],
          },
        }),
      });
      if (!res.ok) throw new Error(`PATCH /api/preferences answered ${res.status}`);
      // The response is the stored row — re-apply it so the UI mirrors the
      // server exactly (fresh updated_at too).
      const prefs = (await res.json()) as UserWithPreferencesWire;
      setDailyCategories(new Set(prefs.dailyCategories));
      setWeeklyCategories(new Set(prefs.weeklyCategories));
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
      <p className="mt-1 text-sm text-stone-500">
        Pick which categories go into your daily and weekly (Mondays) reports.
      </p>

      {/* Daily report — the fixed prototype vocabulary (mirrors the DB CHECK) */}
      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-stone-900">Daily report — categories</legend>
        <CategoryGrid
          selected={dailyCategories}
          onToggle={(slug) => {
            setDailyCategories((set) => toggleIn(set, slug));
            edited();
          }}
        />
        {dailyCategories.size === 0 && (
          <p className="mt-2 text-xs text-stone-500">
            No daily report — leave this empty if you only want a weekly one.
          </p>
        )}
      </fieldset>

      {/* Weekly report — same grid, independent selection */}
      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-stone-900">Weekly report (Mondays) — categories</legend>
        <CategoryGrid
          selected={weeklyCategories}
          onToggle={(slug) => {
            setWeeklyCategories((set) => toggleIn(set, slug));
            edited();
          }}
        />
        {weeklyCategories.size === 0 && (
          <p className="mt-2 text-xs text-stone-500">
            No weekly report — leave this empty if you only want a daily one.
          </p>
        )}
      </fieldset>

      {paused && (
        <p className="mt-4 text-xs text-stone-500">
          Both lists are empty — you are paused: no reports will be generated
          until you pick at least one category.
        </p>
      )}

      {/* Delivery hour — local wall-clock hour in the user's timezone (the
          cron route lets Postgres do the tz math; see lib/db.ts). One global
          time per user: on a Monday both reports arrive at this hour. */}
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