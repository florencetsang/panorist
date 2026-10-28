'use client';

/**
 * The reports list: past briefings, newest first (the API orders them).
 * Client-side fetch of GET /api/reports?userId=…&hydrate=1 — `hydrate`
 * resolves each report's markdown-cache pointers into renderable topics.
 */

import { useEffect, useRef, useState } from 'react';
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
        Daily and weekly briefings arrive as separate reports — on Mondays you
        get one of each, one section per category you picked for it.
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
            {state.reports.map((report, index) => (
              // The newest report starts expanded so the page isn't a wall of
              // collapsed cards on load (state is local — reload resets it).
              <ReportCard key={report.id} report={report} defaultOpen={index === 0} />
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

/** Chevron that flips between collapsed and expanded. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function ReportCard({ report, defaultOpen = false }: { report: HydratedReport; defaultOpen?: boolean }) {
  // Shown in the *visitor's* locale/timezone — prototype-simple; a real
  // product would use the user's stored timezone (reports.created_at is UTC).
  const created = new Date(report.createdAt);
  const period =
    report.frequency === 'weekly'
      ? `${dateFmt.format(new Date(report.periodStart))} – ${dateFmt.format(new Date(report.periodEnd))}`
      : dateFmt.format(new Date(report.periodEnd));
  // kind mirrors frequency today (lib/llm.ts); capitalized for display only.
  const kindLabel = report.kind.charAt(0).toUpperCase() + report.kind.slice(1);

  // A topic with empty markdown means its cache row vanished (shouldn't
  // happen — generateReport stores before pointing); skip rather than render
  // a blank section.
  const topics = report.topics.filter((topic) => topic.markdown.trim().length > 0);

  // Level 1: the whole report collapses behind its header. Level 2: each
  // topic toggles independently (a Set of open categories). Both are local
  // state — nothing persists across reloads.
  const [reportOpen, setReportOpen] = useState(defaultOpen);
  const [openTopics, setOpenTopics] = useState<Set<string>>(() => new Set());

  // Measured height of the sticky report header, so each topic's sticky
  // context line can sit *below* it instead of behind it.
  const headerRef = useRef<HTMLButtonElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || !reportOpen) return;
    const update = () => setHeaderHeight(el.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [reportOpen]);

  function toggleReport() {
    // Collapsing a report also collapses its topics — no hidden open state.
    if (reportOpen) setOpenTopics(new Set());
    setReportOpen(!reportOpen);
  }

  function toggleTopic(category: string) {
    setOpenTopics((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  const headerId = `report-${report.id}-header`;
  const bodyId = `report-${report.id}-body`;
  const topicBodyId = (category: string) => `report-${report.id}-topic-${category}`;

  return (
    <article className="rounded-xl border border-stone-200 bg-white shadow-sm">
      {/* Level-1 toggle: the full-width header. While the report is open it
          sticks to the top of the viewport, so the date + report type stay
          visible even when scrolled deep into a long topic. */}
      <button
        ref={headerRef}
        type="button"
        id={headerId}
        aria-expanded={reportOpen}
        aria-controls={bodyId}
        onClick={toggleReport}
        className={`flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 py-4 text-left sm:px-6 ${
          reportOpen
            ? 'sticky top-0 z-20 rounded-t-xl border-b border-stone-100 bg-white'
            : 'rounded-xl'
        }`}
      >
        <time dateTime={report.createdAt} className="text-sm font-medium text-stone-900">
          {dateTimeFmt.format(created)}
        </time>
        <span className="flex items-center gap-2 text-xs text-stone-500">
          <span>
            {kindLabel} · {period}
          </span>
          <Chevron open={reportOpen} />
        </span>
      </button>

      {reportOpen && (
        <div id={bodyId} role="region" aria-labelledby={headerId} className="px-5 pt-4 pb-5 sm:px-6">
          {topics.length === 0 ? (
            <p className="text-sm text-stone-400">Report content unavailable.</p>
          ) : (
            <div className="divide-y divide-stone-100">
              {topics.map((topic) => {
                // cache keys are free-form strings; fall back to the raw slug
                const label = CATEGORY_LABELS[topic.category as CategorySlug] ?? topic.category;
                const topicOpen = openTopics.has(topic.category);
                return (
                  <section key={topic.category} className="py-3 first:pt-0">
                    {/* Level-2 toggle: one topic per collapsible section. */}
                    <button
                      type="button"
                      aria-expanded={topicOpen}
                      aria-controls={topicBodyId(topic.category)}
                      onClick={() => toggleTopic(topic.category)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider transition-colors ${
                        topicOpen
                          ? 'bg-indigo-50 text-indigo-900'
                          : 'text-indigo-700 hover:bg-stone-50'
                      }`}
                    >
                      <span>{label}</span>
                      <Chevron open={topicOpen} />
                    </button>
                    {topicOpen && (
                      <div id={topicBodyId(topic.category)} className="mt-2 px-3 sm:px-4">
                        {/* Reading context: date + report type + topic name,
                            sticky just below the report header so it stays in
                            view while the (long) markdown scrolls. */}
                        <div
                          className="sticky z-10 -mx-3 border-b border-stone-100 bg-white px-3 py-1.5 text-xs text-stone-500 sm:-mx-4 sm:px-4"
                          style={{ top: headerHeight }}
                        >
                          {kindLabel} · {period} · {label}
                        </div>
                        {/* The model's own markdown IS the body (no JSON schema) */}
                        <div className="mt-3">{renderMarkdown(topic.markdown)}</div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
    </article>
  );
}