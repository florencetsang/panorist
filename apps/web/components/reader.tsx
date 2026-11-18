'use client';

/**
 * One briefing as a long-form article: a section per topic with a sticky
 * topic index. Opening an unread briefing marks it read.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { categoryLabel } from '@panorist/core/categories';
import { deliveredLabel, frequencyLabel, periodLabel, readingMinutes } from '@panorist/core/format';
import type { HydratedReportWire } from '@panorist/core/types';
import { ApiError, api } from '../lib/client/api.ts';
import { Markdown } from './markdown.tsx';
import { Button, ButtonLink, Notice, Skeleton } from './ui.tsx';

type State =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; report: HydratedReportWire };

export function Reader({ reportId }: { reportId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getReport(reportId).then(
      async (report) => {
        if (cancelled) return;
        setState({ status: 'ready', report });
        if (report.readAt === null) {
          try {
            const { readAt } = await api.setReportRead(report.id, true);
            if (!cancelled) setState({ status: 'ready', report: { ...report, readAt } });
          } catch (err) {
            console.error('[reader] mark read failed', err);
          }
        }
      },
      (err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setState({ status: 'missing' });
        else {
          console.error('[reader] load failed', err);
          setState({ status: 'error' });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  if (state.status === 'loading') return <ReaderSkeleton />;
  if (state.status === 'missing') {
    return (
      <div className="py-20 text-center">
        <p className="font-serif text-3xl font-medium">Briefing not found</p>
        <p className="mt-2 text-ink-muted">It may have been removed, or the link is wrong.</p>
        <ButtonLink href="/" className="mt-6">
          Back to briefings
        </ButtonLink>
      </div>
    );
  }
  if (state.status === 'error') {
    return <Notice>We couldn’t load this briefing. Refresh the page to try again.</Notice>;
  }

  const { report } = state;
  const topics = report.topics.filter((t) => t.markdown.trim().length > 0);
  const minutes = readingMinutes(topics.map((t) => t.markdown).join('\n'));
  const anchor = (category: string) => `topic-${category}`;

  async function toggleRead() {
    setSaving(true);
    try {
      const { readAt } = await api.setReportRead(report.id, report.readAt === null);
      setState({ status: 'ready', report: { ...report, readAt } });
    } catch (err) {
      console.error('[reader] toggle read failed', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article>
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← All briefings
      </Link>

      <header className="mt-8 border-b border-ink pb-8">
        <p className="eyebrow text-accent">{frequencyLabel(report.frequency)}</p>
        <h1 className="mt-3 font-serif text-4xl leading-[1.1] font-medium tracking-tight text-balance sm:text-5xl">
          {periodLabel(report)}
        </h1>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted">
          <p>
            {topics.length} {topics.length === 1 ? 'topic' : 'topics'} · {minutes} min read ·{' '}
            {deliveredLabel(report.createdAt)}
          </p>
          <Button
            variant="ghost"
            onClick={toggleRead}
            busy={saving}
            className="!px-3 !py-1.5 text-sm"
          >
            Mark as {report.readAt === null ? 'read' : 'unread'}
          </Button>
        </div>
      </header>

      {topics.length > 1 && (
        <nav
          aria-label="Topics in this briefing"
          className="sticky top-[57px] z-20 -mx-5 mt-0 overflow-x-auto border-b border-rule bg-paper/90 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8"
        >
          <ul className="flex gap-2 whitespace-nowrap">
            {topics.map((t, i) => (
              <li key={t.category}>
                <a
                  href={`#${anchor(t.category)}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-rule px-3 py-1 text-sm text-ink-muted transition hover:border-ink hover:text-ink"
                >
                  <span className="text-ink-faint tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {categoryLabel(t.category)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {topics.length === 0 ? (
        <p className="mt-10 text-ink-muted">This briefing’s content is no longer available.</p>
      ) : (
        topics.map((t, i) => (
          <section key={t.category} id={anchor(t.category)} className="scroll-mt-32 pt-12">
            <div className="flex items-baseline gap-3">
              <span className="font-serif text-lg text-accent tabular-nums">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h2 className="font-serif text-3xl font-medium tracking-tight">
                {categoryLabel(t.category)}
              </h2>
            </div>
            <div className="mt-6">
              <Markdown source={t.markdown} />
            </div>
          </section>
        ))
      )}

      <footer className="mt-16 border-t border-rule pt-8 text-center">
        <p className="font-serif text-xl text-ink-muted italic">That’s the briefing.</p>
        <ButtonLink href="/" variant="secondary" className="mt-5">
          Back to all briefings
        </ButtonLink>
      </footer>
    </article>
  );
}

function ReaderSkeleton() {
  return (
    <div aria-label="Loading briefing">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-10 h-3 w-32" />
      <Skeleton className="mt-4 h-12 w-3/4" />
      <Skeleton className="mt-5 h-4 w-1/2" />
      <div className="mt-14 space-y-3">
        {['w-full', 'w-11/12', 'w-full', 'w-4/5', 'w-11/12', 'w-3/5'].map((w, i) => (
          <Skeleton key={i} className={`h-4 ${w}`} />
        ))}
      </div>
    </div>
  );
}
