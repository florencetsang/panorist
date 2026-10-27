'use client';

/**
 * The reports list: past briefings, newest first (the API orders them).
 * Client-side fetch of GET /api/reports?userId=…&hydrate=1 — `hydrate`
 * resolves each report's markdown-cache pointers into renderable topics.
 */

import { useEffect, useState } from 'react';
import type { CategorySlug } from '../lib/types.ts';
import { CATEGORY_LABELS, type HydratedReport } from '../lib/types.ts';
import { renderMarkdown } from '../lib/markdown.tsx';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; reports: HydratedReport[] };

export default function ReportsList({ userId }: { userId: string | null }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!userId) {
      setState({ status: 'error', message: 'No user id — add ?userId=<uuid> or set NEXT_PUBLIC_TEST_USER_ID.' });
      return;
    }
    let cancelled = false; // ignore a stale response after unmount/re-run
    (async () => {
      try {
        const res = await fetch(`/api/reports?userId=${encodeURIComponent(userId)}&hydrate=1`);
        if (!res.ok) throw new Error(`GET /api/reports answered ${res.status}`);
        const reports = (await res.json()) as HydratedReport[];
        if (!cancelled) setState({ status: 'ready', reports });
      } catch (err) {
        console.error('[reports-list] fetch failed', err);
        if (!cancelled) setState({ status: 'error', message: 'Could not load reports — is the database up?' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">Your briefings</h1>
      <p className="mt-1 text-sm text-stone-500">
        One report per delivery, one section per category you follow.
      </p>

      <div className="mt-6">
        {state.status === 'loading' && <LoadingSkeleton />}

        {state.status === 'error' && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {state.message}
          </p>
        )}

        {state.status === 'ready' && state.reports.length === 0 && <EmptyState />}

        {state.status === 'ready' && state.reports.length > 0 && (
          <div className="space-y-6">
            {state.reports.map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Placeholder blocks while the fetch is in flight (keeps layout stable). */
function LoadingSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {[0, 1].map((n) => (
        <div key={n} className="animate-pulse rounded-xl border border-stone-200 bg-white p-5">
          <div className="h-4 w-32 rounded bg-stone-100" />
          <div className="mt-4 space-y-2">
            <div className="h-3 w-full rounded bg-stone-100" />
            <div className="h-3 w-5/6 rounded bg-stone-100" />
            <div className="h-3 w-2/3 rounded bg-stone-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center">
      <p className="font-medium text-stone-900">No briefings yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
        Reports appear here after your first scheduled delivery. You can also
        trigger one now from a terminal via <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">POST /api/generate</code>.
      </p>
    </div>
  );
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function ReportCard({ report }: { report: HydratedReport }) {
  // Shown in the *visitor's* locale/timezone — prototype-simple; a real
  // product would use the user's stored timezone (reports.created_at is UTC).
  const created = new Date(report.createdAt);
  const period =
    report.frequency === 'weekly'
      ? `${dateFmt.format(new Date(report.periodStart))} – ${dateFmt.format(new Date(report.periodEnd))}`
      : dateFmt.format(new Date(report.periodEnd));

  // A topic with empty markdown means its cache row vanished (shouldn't
  // happen — generateReport stores before pointing); skip rather than render
  // a blank section.
  const topics = report.topics.filter((topic) => topic.markdown.trim().length > 0);

  return (
    <article className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <time dateTime={report.createdAt} className="text-sm font-medium text-stone-900">
          {dateTimeFmt.format(created)}
        </time>
        {/* kind mirrors frequency today (lib/llm.ts) */}
        <span className="text-xs text-stone-400">
          {report.kind} · {period}
        </span>
      </header>

      {topics.length === 0 ? (
        <p className="mt-4 text-sm text-stone-400">Report content unavailable.</p>
      ) : (
        <div className="mt-4 divide-y divide-stone-100">
          {topics.map((topic) => (
            <section key={topic.category} className="pt-4 first:pt-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
                {/* cache keys are free-form strings; fall back to the raw slug */}
                {CATEGORY_LABELS[topic.category as CategorySlug] ?? topic.category}
              </p>
              {/* The model's own markdown IS the body (no JSON schema) */}
              <div className="mt-1">{renderMarkdown(topic.markdown)}</div>
            </section>
          ))}
        </div>
      )}
    </article>
  );
}