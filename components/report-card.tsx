'use client';

import { useEffect, useRef, useState } from 'react';
import { categoryLabel } from '../lib/shared/categories.ts';
import type { HydratedReportWire } from '../lib/shared/types.ts';
import { Chevron } from './chevron.tsx';
import { Markdown } from './markdown.tsx';

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** "12 May 2025" for daily, "6 May 2025 – 12 May 2025" for weekly. */
function periodLabel(report: HydratedReportWire): string {
  const end = dateFmt.format(new Date(report.periodEnd));
  return report.frequency === 'weekly'
    ? `${dateFmt.format(new Date(report.periodStart))} – ${end}`
    : end;
}

/** Tracks an element's rendered height while `active`. */
function useElementHeight<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el); // ResizeObserver fires once on observe, so no initial setState needed
    return () => observer.disconnect();
  }, [active]);
  return [ref, height] as const;
}

/**
 * One briefing, collapsible at two levels: the whole report, then each topic.
 * Dates render in the visitor's locale/timezone (prototype-simple).
 */
export function ReportCard({
  report,
  defaultOpen = false,
}: {
  report: HydratedReportWire;
  defaultOpen?: boolean;
}) {
  const period = periodLabel(report);
  const kindLabel = report.kind.charAt(0).toUpperCase() + report.kind.slice(1);
  // Empty markdown means the cache row is missing; skip rather than render a blank section.
  const topics = report.topics.filter((topic) => topic.markdown.trim().length > 0);

  const [reportOpen, setReportOpen] = useState(defaultOpen);
  const [openTopics, setOpenTopics] = useState<ReadonlySet<string>>(() => new Set());
  // The topic context line sticks just below the (sticky) report header.
  const [headerRef, headerHeight] = useElementHeight<HTMLButtonElement>(reportOpen);

  function toggleReport() {
    if (reportOpen) setOpenTopics(new Set()); // no hidden open state when collapsed
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
          {dateTimeFmt.format(new Date(report.createdAt))}
        </time>
        <span className="flex items-center gap-2 text-xs text-stone-500">
          <span>
            {kindLabel} · {period}
          </span>
          <Chevron open={reportOpen} />
        </span>
      </button>

      {reportOpen && (
        <div
          id={bodyId}
          role="region"
          aria-labelledby={headerId}
          className="px-5 pt-4 pb-5 sm:px-6"
        >
          {topics.length === 0 ? (
            <p className="text-sm text-stone-400">Report content unavailable.</p>
          ) : (
            <div className="divide-y divide-stone-100">
              {topics.map((topic) => {
                const label = categoryLabel(topic.category);
                const topicOpen = openTopics.has(topic.category);
                return (
                  <section key={topic.category} className="py-3 first:pt-0">
                    <button
                      type="button"
                      aria-expanded={topicOpen}
                      aria-controls={topicBodyId(topic.category)}
                      onClick={() => toggleTopic(topic.category)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold tracking-wider uppercase transition-colors ${
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
                        <div
                          className="sticky z-10 -mx-3 border-b border-stone-100 bg-white px-3 py-1.5 text-xs text-stone-500 sm:-mx-4 sm:px-4"
                          style={{ top: headerHeight }}
                        >
                          {kindLabel} · {period} · {label}
                        </div>
                        <div className="mt-3">
                          <Markdown source={topic.markdown} />
                        </div>
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
