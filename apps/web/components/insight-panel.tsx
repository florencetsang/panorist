'use client';

/**
 * The panel for one highlight or resolved selection: shows what it is, the
 * kind's action ("All I need to know" / "Tell me more"), then the shared AI
 * explanation with a star. A right-hand drawer on wide screens, a bottom
 * sheet on narrow ones.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import {
  INSIGHT_ACTION_LABEL,
  INSIGHT_KIND_LABEL,
  insightErrorMessage,
} from '@panorist/core/insights';
import type { InsightTarget, InsightWire } from '@panorist/core/types';
import { ApiError, api } from '../lib/client/api.ts';
import { Markdown } from './markdown.tsx';
import { Button, Notice, Skeleton } from './ui.tsx';

export interface PanelTarget extends InsightTarget {
  sourceText?: string;
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; insight: InsightWire }
  | { status: 'error'; message: string };

export function InsightPanel({
  target,
  reportId,
  onClose,
}: {
  target: PanelTarget;
  reportId?: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function explain() {
    setState({ status: 'loading' });
    try {
      const insight = await api.explain({
        kind: target.kind,
        key: target.key,
        displayName: target.displayName,
        ...(reportId && { reportId }),
        ...(target.sourceText && { sourceText: target.sourceText.slice(0, 200) }),
      });
      setState({ status: 'ready', insight });
    } catch (err) {
      console.error('[insight] explain failed', err);
      setState({
        status: 'error',
        message: insightErrorMessage(err instanceof ApiError ? err.status : null),
      });
    }
  }

  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-ink/20 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="insight-title"
        className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl border border-rule bg-paper shadow-xl sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[440px] sm:rounded-none sm:border-y-0 sm:border-r-0"
      >
        <header className="flex items-start justify-between gap-4 border-b border-rule px-6 py-5">
          <div className="min-w-0">
            <p className="eyebrow text-accent">{INSIGHT_KIND_LABEL[target.kind]}</p>
            <h2
              id="insight-title"
              className="mt-2 font-serif text-2xl leading-tight font-medium tracking-tight"
            >
              {target.displayName}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 rounded-full p-2 text-ink-muted transition hover:bg-sunken hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {state.status === 'idle' && (
            <Button onClick={explain} className="w-full">
              {INSIGHT_ACTION_LABEL[target.kind]}
            </Button>
          )}
          {state.status === 'loading' && <InsightSkeleton kind={target.kind} />}
          {state.status === 'error' && (
            <div className="space-y-4">
              <Notice>{state.message}</Notice>
              <Button variant="secondary" onClick={explain}>
                Try again
              </Button>
            </div>
          )}
          {state.status === 'ready' && (
            <InsightBody
              insight={state.insight}
              onChange={(insight) => setState({ status: 'ready', insight })}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function InsightSkeleton({ kind }: { kind: InsightTarget['kind'] }) {
  return (
    <div aria-live="polite">
      <p className="text-sm text-ink-muted">
        {kind === 'event' ? 'Catching you up on the latest…' : 'Writing a short explainer…'}
      </p>
      <div className="mt-5 space-y-3">
        {['w-full', 'w-11/12', 'w-full', 'w-4/5', 'w-3/5'].map((w, i) => (
          <Skeleton key={i} className={`h-4 ${w}`} />
        ))}
      </div>
    </div>
  );
}

/** Explanation text with its star toggle; shared by the panel and the library. */
export function InsightBody({
  insight,
  onChange,
}: {
  insight: InsightWire;
  onChange: (insight: InsightWire) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted">
        <span>
          Generated{' '}
          {new Date(insight.generatedAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </span>
        {insight.id !== null && <StarButton insight={insight} onChange={onChange} />}
      </div>
      <div className="mt-5 [&_p]:text-[17px]">
        <Markdown source={insight.markdown} />
      </div>
      {insight.id !== null && (
        <p className="mt-8 border-t border-rule pt-4 text-sm text-ink-faint">
          Saved to your{' '}
          <Link href="/library" className="text-ink-muted underline underline-offset-2">
            library
          </Link>
          .
        </p>
      )}
    </div>
  );
}

export function StarButton({
  insight,
  onChange,
}: {
  insight: InsightWire;
  onChange: (insight: InsightWire) => void;
}) {
  const [busy, setBusy] = useState(false);
  const starred = insight.starredAt !== null;
  async function toggle() {
    if (insight.id === null) return;
    setBusy(true);
    try {
      onChange(await api.setInsightStarred(insight.id, !starred));
    } catch (err) {
      console.error('[insight] star failed', err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={starred}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition disabled:opacity-50 ${
        starred
          ? 'border-accent bg-accent-soft text-ink'
          : 'border-rule text-ink-muted hover:border-ink hover:text-ink'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
        <path
          d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
          fill={starred ? 'var(--accent)' : 'none'}
          stroke={starred ? 'var(--accent)' : 'currentColor'}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      {starred ? 'Starred' : 'Star'}
    </button>
  );
}
