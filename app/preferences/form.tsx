'use client';

/**
 * Preferences editor: independent daily and weekly (local Monday) category
 * lists plus one delivery hour. Saving always sends all three fields and
 * re-applies the stored row, so the UI mirrors the server exactly.
 */

import { useEffect, useState } from 'react';
import { ErrorAlert } from '../../components/alert.tsx';
import { CategoryGrid } from '../../components/category-grid.tsx';
import { ApiError, api } from '../../lib/client/api.ts';
import type { CategorySlug } from '../../lib/shared/categories.ts';
import type { UserWithPreferencesWire } from '../../lib/shared/types.ts';
import { MISSING_USER_MESSAGE } from '../../lib/shared/user-id.ts';
import { isDeliveryHour } from '../../lib/shared/validation.ts';

interface Draft {
  dailyCategories: ReadonlySet<CategorySlug>;
  weeklyCategories: ReadonlySet<CategorySlug>;
  deliveryHour: number;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; timezone: string };

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'error'; message: string };

const toDraft = (prefs: UserWithPreferencesWire): Draft => ({
  dailyCategories: new Set(prefs.dailyCategories),
  weeklyCategories: new Set(prefs.weeklyCategories),
  deliveryHour: prefs.deliveryHour,
});

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export default function PreferencesForm({ userId }: { userId: string | null }) {
  // key: a new user remounts with fresh 'loading' state.
  return userId ? (
    <Editor key={userId} userId={userId} />
  ) : (
    <ErrorAlert message={MISSING_USER_MESSAGE} />
  );
}

function Editor({ userId }: { userId: string }) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [draft, setDraft] = useState<Draft>({
    dailyCategories: new Set(),
    weeklyCategories: new Set(),
    deliveryHour: 8,
  });

  useEffect(() => {
    let cancelled = false;
    api.getPreferences(userId).then(
      (prefs) => {
        if (cancelled) return;
        setDraft(toDraft(prefs));
        setLoad({ status: 'ready', timezone: prefs.timezone });
      },
      (err) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError && err.status === 404
            ? 'Unknown user id — run `npm run db:setup` (or check ?userId=).'
            : 'Could not load preferences — is the database up?';
        setLoad({ status: 'error', message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  function edit(patch: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
    setSave({ status: 'idle' }); // any edit clears "Saved ✓"
  }

  // Both lists empty is the valid "paused" state.
  const hourValid = isDeliveryHour(draft.deliveryHour);
  const paused = draft.dailyCategories.size === 0 && draft.weeklyCategories.size === 0;
  const canSave = load.status === 'ready' && hourValid && save.status !== 'saving';

  async function onSave() {
    if (!canSave) return;
    setSave({ status: 'saving' });
    try {
      const prefs = await api.updatePreferences(userId, {
        deliveryHour: draft.deliveryHour,
        dailyCategories: [...draft.dailyCategories],
        weeklyCategories: [...draft.weeklyCategories],
      });
      setDraft(toDraft(prefs));
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
  if (load.status === 'error') return <ErrorAlert message={load.message} />;

  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">Preferences</h1>
      <p className="mt-1 text-sm text-stone-500">
        Pick which categories go into your daily and weekly (Mondays) reports.
      </p>

      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-stone-900">Daily report — categories</legend>
        <CategoryGrid
          selected={draft.dailyCategories}
          onToggle={(slug) => edit({ dailyCategories: toggled(draft.dailyCategories, slug) })}
        />
        {draft.dailyCategories.size === 0 && (
          <p className="mt-2 text-xs text-stone-500">
            No daily report — leave this empty if you only want a weekly one.
          </p>
        )}
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-stone-900">
          Weekly report (Mondays) — categories
        </legend>
        <CategoryGrid
          selected={draft.weeklyCategories}
          onToggle={(slug) => edit({ weeklyCategories: toggled(draft.weeklyCategories, slug) })}
        />
        {draft.weeklyCategories.size === 0 && (
          <p className="mt-2 text-xs text-stone-500">
            No weekly report — leave this empty if you only want a daily one.
          </p>
        )}
      </fieldset>

      {paused && (
        <p className="mt-4 text-xs text-stone-500">
          Both lists are empty — you are paused: no reports will be generated until you pick at
          least one category.
        </p>
      )}

      {/* One local wall-clock hour per user; on Mondays both reports arrive then. */}
      <fieldset className="mt-6">
        <legend className="text-sm font-medium text-stone-900">Delivery hour</legend>
        <div className="mt-3 flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={23}
            value={draft.deliveryHour}
            onChange={(e) => edit({ deliveryHour: Number(e.target.value) })}
            className="w-20 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm invalid:border-red-300"
          />
          <span className="text-xs text-stone-500">
            Local hour (0–23){load.timezone && ` in ${load.timezone}`}
          </span>
        </div>
        {!hourValid && <p className="mt-2 text-xs text-red-600">Hour must be an integer 0–23.</p>}
      </fieldset>

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
