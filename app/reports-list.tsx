'use client';

/** Past briefings, newest first (the API orders them). */

import { useEffect, useState } from 'react';
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
  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">Your briefings</h1>
      <p className="mt-1 text-sm text-stone-500">
        Daily and weekly briefings arrive as separate reports — on Mondays you get one of each, one
        section per category you picked for it.
      </p>
      <div className="mt-6">
        {userId ? (
          // key: a new user remounts with fresh 'loading' state.
          <Reports key={userId} userId={userId} />
        ) : (
          <ErrorAlert message={MISSING_USER_MESSAGE} />
        )}
      </div>
    </section>
  );
}

function Reports({ userId }: { userId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

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
      {state.reports.map((report, index) => (
        // Newest starts expanded so the page isn't a wall of collapsed cards.
        <ReportCard key={report.id} report={report} defaultOpen={index === 0} />
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
