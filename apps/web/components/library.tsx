'use client';

/**
 * The reader's saved explanations ("All I need to know" / "Tell me more"),
 * newest first, with an All / Starred filter. Each entry expands in place.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { INSIGHT_KIND_LABEL, INSIGHT_PAGE_SIZE } from '@panorist/core/insights';
import type { InsightWire } from '@panorist/core/types';
import { ApiError, api } from '../lib/client/api.ts';
import { InsightBody } from './insight-panel.tsx';
import { Button, Notice, Skeleton } from './ui.tsx';

type Filter = 'all' | 'starred';

type State =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error' }
  /** `filter` is the tab the items were loaded for, so late pages for another tab are dropped. */
  | { status: 'ready'; filter: Filter; items: InsightWire[]; more: boolean };

export function Library() {
  const [filter, setFilter] = useState<Filter>('all');
  const [state, setState] = useState<State>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (which: Filter, before?: string) => {
    const page = await api.listInsights({
      starred: which === 'starred',
      ...(before && { before }),
    });
    return { page, more: page.length === INSIGHT_PAGE_SIZE };
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(filter).then(
      ({ page, more }) => !cancelled && setState({ status: 'ready', filter, items: page, more }),
      (err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403) setState({ status: 'unavailable' });
        else {
          console.error('[library] load failed', err);
          setState({ status: 'error' });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [filter, load]);

  async function loadMore() {
    if (state.status !== 'ready') return;
    const which = state.filter;
    setLoadingMore(true);
    try {
      const { page, more } = await load(which, state.items.at(-1)?.id ?? undefined);
      setState((prev) =>
        prev.status === 'ready' && prev.filter === which
          ? { ...prev, items: [...prev.items, ...page], more }
          : prev,
      );
    } catch (err) {
      console.error('[library] load more failed', err);
    } finally {
      setLoadingMore(false);
    }
  }

  function replace(insight: InsightWire) {
    setState((prev) =>
      prev.status === 'ready'
        ? {
            ...prev,
            items: prev.items
              .map((item) => (item.id === insight.id ? insight : item))
              .filter((item) => prev.filter === 'all' || item.starredAt !== null),
          }
        : prev,
    );
  }

  async function remove(id: string) {
    try {
      await api.deleteInsight(id);
      setState((prev) =>
        prev.status === 'ready'
          ? { ...prev, items: prev.items.filter((item) => item.id !== id) }
          : prev,
      );
    } catch (err) {
      console.error('[library] delete failed', err);
    }
  }

  return (
    <section>
      <header className="border-b border-ink pb-6">
        <p className="eyebrow text-accent">Your library</p>
        <h1 className="mt-3 font-serif text-4xl font-medium tracking-tight">Saved explanations</h1>
        <p className="mt-3 text-ink-muted">
          Everything you’ve asked about, ready to revisit. Star the ones you want to keep handy.
        </p>
      </header>

      <div role="tablist" aria-label="Filter" className="mt-6 flex gap-2 text-sm">
        {(['all', 'starred'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={filter === value}
            onClick={() => {
              if (value === filter) return;
              setFilter(value);
              setState({ status: 'loading' });
            }}
            className={`rounded-full px-3.5 py-1.5 transition ${
              filter === value
                ? 'bg-ink font-medium text-paper'
                : 'border border-rule text-ink-muted hover:text-ink'
            }`}
          >
            {value === 'all' ? 'All' : 'Starred'}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {state.status === 'loading' && (
          <div className="space-y-4" aria-label="Loading library">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        )}
        {state.status === 'unavailable' && (
          <Notice>The library isn’t available on your plan.</Notice>
        )}
        {state.status === 'error' && (
          <Notice>We couldn’t load your library. Refresh the page to try again.</Notice>
        )}
        {state.status === 'ready' && state.items.length === 0 && (
          <p className="py-12 text-center text-ink-muted">
            {filter === 'starred'
              ? 'No starred explanations yet.'
              : 'Nothing saved yet. Tap a highlighted event or term in a briefing to get started.'}
          </p>
        )}
        {state.status === 'ready' && state.items.length > 0 && (
          <ul className="divide-y divide-rule border-y border-rule">
            {state.items.map((item) => {
              const id = item.id ?? '';
              const expanded = open === id;
              return (
                <li key={id} className="py-5">
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : id)}
                    aria-expanded={expanded}
                    className="flex w-full items-start justify-between gap-4 text-left"
                  >
                    <div className="min-w-0">
                      <p className="eyebrow text-ink-faint">
                        {INSIGHT_KIND_LABEL[item.kind]}
                        {item.starredAt && <span className="ml-2 text-accent">★ Starred</span>}
                      </p>
                      <p className="mt-1.5 font-serif text-xl font-medium">{item.displayName}</p>
                      {!expanded && (
                        <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
                          {plainPreview(item.markdown)}
                        </p>
                      )}
                    </div>
                    <span className="mt-1 text-ink-faint" aria-hidden>
                      {expanded ? '−' : '+'}
                    </span>
                  </button>
                  {expanded && (
                    <div className="mt-5">
                      <InsightBody insight={item} onChange={replace} />
                      <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
                        {item.reportId && (
                          <Link
                            href={`/reports/${item.reportId}`}
                            className="text-ink-muted underline underline-offset-2 hover:text-ink"
                          >
                            Open the briefing
                          </Link>
                        )}
                        <button
                          type="button"
                          onClick={() => remove(id)}
                          className="text-danger hover:underline"
                        >
                          Remove from library
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {state.status === 'ready' && state.more && (
          <div className="mt-6 text-center">
            <Button variant="secondary" onClick={loadMore} busy={loadingMore}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function plainPreview(markdown: string): string {
  return markdown
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>[\]]|\(https?:[^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}
