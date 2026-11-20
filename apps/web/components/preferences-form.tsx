'use client';

/** What to follow, and when to deliver it. */

import { useEffect, useMemo, useState } from 'react';

import { CATEGORY_LABELS, CATEGORY_SLUGS, type CategorySlug } from '@panorist/core/categories';
import { hourLabel } from '@panorist/core/format';
import { deviceTimeZone, timeZoneLabel, timeZoneOptions } from '@panorist/core/timezones';
import type { PreferencesPatch, UserWithPreferencesWire } from '@panorist/core/types';
import { api } from '../lib/client/api.ts';
import { useClientValue } from '../lib/client/use-client-value.ts';
import { Button, Notice, Skeleton } from './ui.tsx';

interface Draft {
  dailyCategories: CategorySlug[];
  weeklyCategories: CategorySlug[];
  deliveryHour: number;
  timezone: string;
}

const toDraft = (p: UserWithPreferencesWire): Draft => ({
  dailyCategories: p.dailyCategories,
  weeklyCategories: p.weeklyCategories,
  deliveryHour: p.deliveryHour,
  timezone: p.timezone,
});

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

function diff(saved: Draft, draft: Draft): PreferencesPatch {
  const patch: PreferencesPatch = {};
  if (!sameSet(saved.dailyCategories, draft.dailyCategories))
    patch.dailyCategories = draft.dailyCategories;
  if (!sameSet(saved.weeklyCategories, draft.weeklyCategories))
    patch.weeklyCategories = draft.weeklyCategories;
  if (saved.deliveryHour !== draft.deliveryHour) patch.deliveryHour = draft.deliveryHour;
  if (saved.timezone !== draft.timezone) patch.timezone = draft.timezone;
  return patch;
}

type Status = 'idle' | 'saving' | 'saved' | 'error';

export function PreferencesForm() {
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const device = useClientValue<string | null>(deviceTimeZone, null);

  useEffect(() => {
    api.getPreferences().then(
      (p) => {
        setSaved(toDraft(p));
        setDraft(toDraft(p));
      },
      (err) => {
        console.error('[preferences] load failed', err);
        setLoadError(true);
      },
    );
  }, []);

  const timezone = draft?.timezone;
  const zones = useMemo(() => timeZoneOptions(timezone), [timezone]);

  if (loadError) return <Notice>We couldn’t load your preferences. Refresh to try again.</Notice>;
  if (!draft || !saved) return <PreferencesSkeleton />;

  const patch = diff(saved, draft);
  const dirty = Object.keys(patch).length > 0;
  const paused = draft.dailyCategories.length === 0 && draft.weeklyCategories.length === 0;

  function update(next: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...next } : d));
    setStatus('idle');
  }

  function toggle(list: 'dailyCategories' | 'weeklyCategories', slug: CategorySlug) {
    const current = draft![list];
    const next = current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
    // Keep the canonical order so diffs and reports are stable.
    update({ [list]: CATEGORY_SLUGS.filter((s) => next.includes(s)) });
  }

  async function save() {
    setStatus('saving');
    try {
      const updated = toDraft(await api.updatePreferences(patch));
      setSaved(updated);
      setDraft(updated);
      setStatus('saved');
    } catch (err) {
      console.error('[preferences] save failed', err);
      setStatus('error');
    }
  }

  return (
    <div>
      <header>
        <p className="eyebrow text-accent">Preferences</p>
        <h1 className="mt-3 font-serif text-4xl leading-tight font-medium tracking-tight sm:text-5xl">
          Your beats
        </h1>
        <p className="mt-3 max-w-xl text-lg text-ink-muted">
          Choose the topics for each edition. A topic can appear in both: the daily covers the last
          day, the weekly the last seven.
        </p>
      </header>

      <Section
        title="The Daily"
        description="Every morning, the last day’s news."
        count={draft.dailyCategories.length}
      >
        <CategoryPicker
          name="daily"
          selected={draft.dailyCategories}
          onToggle={(s) => toggle('dailyCategories', s)}
        />
      </Section>

      <Section
        title="The Weekly"
        description="Mondays, the stories that shaped the week."
        count={draft.weeklyCategories.length}
      >
        <CategoryPicker
          name="weekly"
          selected={draft.weeklyCategories}
          onToggle={(s) => toggle('weeklyCategories', s)}
        />
      </Section>

      <Section title="Delivery" description="Both editions arrive at the same local hour.">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">Time</span>
            <select
              value={draft.deliveryHour}
              onChange={(e) => update({ deliveryHour: Number(e.target.value) })}
              className="mt-1.5 w-full rounded-xl border border-rule bg-surface px-3 py-2.5 focus:border-ink focus:outline-none"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Time zone</span>
            <select
              value={draft.timezone}
              onChange={(e) => update({ timezone: e.target.value })}
              className="mt-1.5 w-full rounded-xl border border-rule bg-surface px-3 py-2.5 focus:border-ink focus:outline-none"
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {timeZoneLabel(z)}
                </option>
              ))}
            </select>
            {device && device !== draft.timezone && (
              <button
                type="button"
                onClick={() => update({ timezone: device })}
                className="mt-2 text-sm text-accent underline-offset-2 hover:underline"
              >
                Use this device’s time zone ({timeZoneLabel(device)})
              </button>
            )}
          </label>
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-5 mt-10 border-t border-rule bg-paper/90 px-5 py-4 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm text-ink-muted">
            {status === 'saved'
              ? 'Saved. Changes apply from the next delivery.'
              : status === 'error'
                ? 'Couldn’t save. Try again.'
                : paused
                  ? 'No topics selected — deliveries are paused.'
                  : dirty
                    ? 'You have unsaved changes.'
                    : `Next editions at ${hourLabel(draft.deliveryHour)}.`}
          </p>
          <div className="flex gap-2">
            {dirty && (
              <Button variant="ghost" onClick={() => update(saved)}>
                Discard
              </Button>
            )}
            <Button onClick={save} disabled={!dirty} busy={status === 'saving'}>
              Save changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12 border-t border-ink pt-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-serif text-2xl font-medium">{title}</h2>
        {count !== undefined && (
          <span className="text-sm text-ink-faint">
            {count === 0 ? 'Off' : `${count} ${count === 1 ? 'topic' : 'topics'}`}
          </span>
        )}
      </div>
      <p className="mt-1 text-ink-muted">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function CategoryPicker({
  name,
  selected,
  onToggle,
}: {
  name: string;
  selected: readonly CategorySlug[];
  onToggle: (slug: CategorySlug) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">{name} topics</legend>
      <div className="flex flex-wrap gap-2">
        {CATEGORY_SLUGS.map((slug) => {
          const on = selected.includes(slug);
          return (
            <label
              key={slug}
              className={`cursor-pointer rounded-full border px-4 py-2 text-[15px] transition select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
                on
                  ? 'border-ink bg-ink text-paper'
                  : 'border-rule bg-surface text-ink-muted hover:border-ink/40 hover:text-ink'
              }`}
            >
              <input
                type="checkbox"
                name={`${name}-${slug}`}
                checked={on}
                onChange={() => onToggle(slug)}
                className="sr-only"
              />
              {on && <span aria-hidden>✓ </span>}
              {CATEGORY_LABELS[slug]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function PreferencesSkeleton() {
  return (
    <div aria-label="Loading preferences">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-12 w-64" />
      <Skeleton className="mt-4 h-5 w-full max-w-xl" />
      {[0, 1].map((n) => (
        <div key={n} className="mt-12 border-t border-rule pt-6">
          <Skeleton className="h-7 w-40" />
          <div className="mt-5 flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-28 rounded-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
