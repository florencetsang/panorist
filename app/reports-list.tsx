'use client';

/** Past briefings, newest first (the API orders them). */

import { useEffect, useRef, useState } from 'react';
import { ErrorAlert } from '../components/alert.tsx';
import { ReportCard } from '../components/report-card.tsx';
import { api } from '../lib/client/api.ts';
import type { HydratedReportWire } from '../lib/shared/types.ts';
import { MISSING_USER_MESSAGE } from '../lib/shared/user-id.ts';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; reports: HydratedReportWire[] };

export default function ReportsList({ userId }: { userId: string | null }) {
  // Owned by <Reports>; null until loaded (and while loading another user).
  const [unread, setUnread] = useState<number | null>(null);
  return (
    <section>
      <h1 className="flex items-baseline gap-3 text-xl font-semibold tracking-tight">
        Your briefings
        {unread !== null && unread > 0 && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
            {unread} unread
          </span>
        )}
      </h1>
      <p className="mt-1 text-sm text-stone-500">
        Daily and weekly briefings arrive as separate reports — on Mondays you get one of each, one
        section per category you picked for it.
      </p>
      <div className="mt-6">
        {userId ? (
          // key: a new user remounts with fresh 'loading' state.
          <Reports key={userId} userId={userId} onUnreadChange={setUnread} />
        ) : (
          <ErrorAlert message={MISSING_USER_MESSAGE} />
        )}
      </div>
    </section>
  );
}

function Reports({
  userId,
  onUnreadChange,
}: {
  userId: string;
  onUnreadChange: (count: number | null) => void;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  // Latest request per report, so a stale response can't undo a newer toggle.
  const readSeq = useRef(new Map<string, number>());

  const unread =
    state.status === 'ready' ? state.reports.filter((r) => r.readAt === null).length : null;
  useEffect(() => {
    onUnreadChange(unread);
  }, [unread, onUnreadChange]);
  useEffect(() => () => onUnreadChange(null), [onUnreadChange]);

  function setReadAt(reportId: string, readAt: string | null) {
    setState((prev) =>
      prev.status === 'ready'
        ? {
            ...prev,
            reports: prev.reports.map((r) => (r.id === reportId ? { ...r, readAt } : r)),
          }
        : prev,
    );
  }

  /** Optimistic: update locally, then persist; roll back if the request fails. */
  function changeRead(report: HydratedReportWire, read: boolean) {
    if ((report.readAt !== null) === read) return;
    const previous = report.readAt;
    const seq = (readSeq.current.get(report.id) ?? 0) + 1;
    readSeq.current.set(report.id, seq);
    setReadAt(report.id, read ? new Date().toISOString() : null);
    api.setReportRead(userId, report.id, read).then(
      (status) => readSeq.current.get(report.id) === seq && setReadAt(report.id, status.readAt),
      (err) => {
        console.error('[reports-list] read update failed', err);
        if (readSeq.current.get(report.id) === seq) setReadAt(report.id, previous);
      },
    );
  }

  useEffect(() => {
    let cancelled = false;
    api.getReports(userId).then(
      (reports) => !cancelled && setState({ status: 'ready', reports }),
      (err) => {
        console.error('[reports-list] fetch failed', err);
        if (!cancelled) {
          setState({ status: 'error', message: 'Could not load reports — is the database up?' });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (state.status === 'loading') return <LoadingSkeleton />;
  if (state.status === 'error') return <ErrorAlert message={state.message} />;
  if (state.reports.length === 0) return <EmptyState />;
  return (
    <div className="space-y-6">
      {state.reports.map((report) => (
        // All start collapsed: opening a report is what marks it read.
        <ReportCard
          key={report.id}
          report={report}
          onReadChange={(read) => changeRead(report, read)}
        />
      ))}
    </div>
  );
}

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
        Reports appear here after your first scheduled delivery. You can also trigger one now from a
        terminal via{' '}
        <code className="rounded bg-stone-100 px-1 py-0.5 text-xs">POST /api/generate</code>.
      </p>
    </div>
  );
}
