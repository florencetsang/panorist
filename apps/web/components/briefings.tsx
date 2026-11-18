'use client';

/** Home: greeting, the latest briefing as the lead, then the archive by month. */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { CATEGORY_LABELS } from '@panorist/core/categories';
import {
  deliveredLabel,
  frequencyLabel,
  greeting,
  groupByMonth,
  hourLabel,
  periodLabel,
  reportHeadline,
} from '@panorist/core/format';
import type { ReportWire, UserWithPreferencesWire } from '@panorist/core/types';
import { authClient } from '../lib/client/auth.ts';
import { api } from '../lib/client/api.ts';
import { useClientValue } from '../lib/client/use-client-value.ts';
import { ButtonLink, Eyebrow, Notice, Skeleton } from './ui.tsx';

type Filter = 'all' | 'unread' | 'daily' | 'weekly';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
];

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; reports: ReportWire[]; prefs: UserWithPreferencesWire };

const categoriesOf = (r: ReportWire) => r.content.map((c) => c.category);

export function Briefings() {
  const { data: session } = authClient.useSession();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [filter, setFilter] = useState<Filter>('all');
  const hello = useClientValue(greeting, 'Welcome');

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getReports(), api.getPreferences()]).then(
      ([reports, prefs]) => !cancelled && setState({ status: 'ready', reports, prefs }),
      (err) => {
        console.error('[briefings] load failed', err);
        if (!cancelled) setState({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const firstName = session?.user?.name?.split(' ')[0];
  const reports = state.status === 'ready' ? state.reports : [];
  const unread = reports.filter((r) => r.readAt === null).length;
  const [lead, ...rest] = reports;
  const archive = useMemo(
    () =>
      rest.filter((r) =>
        filter === 'all' ? true : filter === 'unread' ? r.readAt === null : r.frequency === filter,
      ),
    [rest, filter],
  );

  return (
    <div>
      <section>
        <h1 className="font-serif text-4xl leading-tight font-medium tracking-tight sm:text-5xl">
          {hello}
          {firstName ? `, ${firstName}` : ''}.
        </h1>
        <p className="mt-2 text-lg text-ink-muted">
          {state.status !== 'ready'
            ? '\u00a0'
            : unread > 0
              ? `${unread} unread ${unread === 1 ? 'briefing' : 'briefings'} waiting for you.`
              : reports.length > 0
                ? 'You’re all caught up.'
                : 'Your first briefing is on its way.'}
        </p>
      </section>

      <div className="mt-10">
        {state.status === 'loading' && <LoadingState />}
        {state.status === 'error' && (
          <Notice>We couldn’t load your briefings. Refresh the page to try again.</Notice>
        )}
        {state.status === 'ready' && (
          <>
            <ScheduleNote prefs={state.prefs} />
            {lead ? <LeadStory report={lead} /> : <EmptyState prefs={state.prefs} />}
            {rest.length > 0 && (
              <section className="mt-14">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink pb-3">
                  <h2 className="font-serif text-2xl font-medium">Archive</h2>
                  <div role="tablist" className="flex gap-1 text-sm">
                    {FILTERS.map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={filter === id}
                        onClick={() => setFilter(id)}
                        className={`rounded-full px-3 py-1 transition ${
                          filter === id ? 'bg-ink text-paper' : 'text-ink-muted hover:text-ink'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {archive.length === 0 ? (
                  <p className="py-10 text-center text-ink-faint">Nothing here.</p>
                ) : (
                  groupByMonth(archive).map((group) => (
                    <div key={group.month} className="mt-8">
                      <Eyebrow>{group.month}</Eyebrow>
                      <ul className="mt-2 divide-y divide-rule">
                        {group.items.map((r) => (
                          <ArchiveRow key={r.id} report={r} />
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ScheduleNote({ prefs }: { prefs: UserWithPreferencesWire }) {
  const paused = prefs.dailyCategories.length === 0 && prefs.weeklyCategories.length === 0;
  if (!paused) return null;
  return (
    <div className="mb-10 rounded-2xl border border-accent/30 bg-accent-soft p-6">
      <Eyebrow className="!text-accent">Set up</Eyebrow>
      <p className="mt-2 font-serif text-2xl font-medium">Choose what you want to follow.</p>
      <p className="mt-2 text-ink-muted">
        Pick your beats and a delivery time, and your first briefing will arrive at that hour.
      </p>
      <ButtonLink href="/preferences" className="mt-5">
        Choose beats
      </ButtonLink>
    </div>
  );
}

function LeadStory({ report }: { report: ReportWire }) {
  const categories = categoriesOf(report);
  const unread = report.readAt === null;
  return (
    <Link
      href={`/reports/${report.id}`}
      className="group block rounded-3xl border border-rule bg-surface p-7 transition hover:border-ink/30 hover:shadow-lg hover:shadow-black/5 sm:p-10"
    >
      <div className="flex items-center gap-3">
        <Eyebrow className="!text-accent">Latest · {frequencyLabel(report.frequency)}</Eyebrow>
        {unread && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold tracking-wider text-on-accent uppercase">
            New
          </span>
        )}
      </div>
      <h2 className="mt-4 font-serif text-3xl leading-tight font-medium tracking-tight text-balance sm:text-4xl">
        {reportHeadline(categories)}
      </h2>
      <p className="mt-3 text-ink-muted">
        {periodLabel(report)} · {deliveredLabel(report.createdAt)}
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {categories.map((c) => (
          <span key={c} className="rounded-full bg-sunken px-3 py-1 text-sm text-ink-muted">
            {CATEGORY_LABELS[c]}
          </span>
        ))}
      </div>
      <p className="mt-8 inline-flex items-center gap-2 font-medium">
        {unread ? 'Read briefing' : 'Read again'}
        <span aria-hidden className="transition group-hover:translate-x-1">
          →
        </span>
      </p>
    </Link>
  );
}

function ArchiveRow({ report }: { report: ReportWire }) {
  const unread = report.readAt === null;
  const created = new Date(report.createdAt);
  return (
    <li>
      <Link
        href={`/reports/${report.id}`}
        className="group -mx-3 flex items-center gap-5 rounded-xl px-3 py-4 transition hover:bg-surface"
      >
        <div className="w-12 shrink-0 text-center">
          <p className="font-serif text-3xl leading-none">{created.getDate()}</p>
          <p className="mt-1 text-[11px] tracking-wider text-ink-faint uppercase">
            {created.toLocaleDateString(undefined, { weekday: 'short' })}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-ink-faint">{frequencyLabel(report.frequency)}</p>
          <p
            className={`mt-1 truncate font-serif text-xl ${unread ? 'font-semibold' : 'text-ink-muted'}`}
          >
            {reportHeadline(categoriesOf(report))}
          </p>
          <p className="mt-0.5 text-sm text-ink-faint">{periodLabel(report)}</p>
        </div>
        {unread && (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-label="Unread" />
        )}
      </Link>
    </li>
  );
}

function EmptyState({ prefs }: { prefs: UserWithPreferencesWire }) {
  const paused = prefs.dailyCategories.length === 0 && prefs.weeklyCategories.length === 0;
  if (paused) return null;
  return (
    <div className="rounded-3xl border border-dashed border-rule p-10 text-center">
      <p className="font-serif text-2xl font-medium">Nothing to read yet</p>
      <p className="mx-auto mt-2 max-w-sm text-ink-muted">
        Your first briefing arrives at {hourLabel(prefs.deliveryHour)} ({prefs.timezone}). We’ll
        notify you if notifications are on.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div aria-label="Loading briefings">
      <div className="rounded-3xl border border-rule bg-surface p-7 sm:p-10">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-5 h-9 w-4/5" />
        <Skeleton className="mt-3 h-4 w-1/2" />
        <div className="mt-6 flex gap-2">
          <Skeleton className="h-7 w-20 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
      </div>
      <div className="mt-14 space-y-6">
        {[0, 1, 2].map((n) => (
          <div key={n} className="flex gap-5">
            <Skeleton className="h-12 w-12" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
