'use client';

/**
 * Free-select: when the reader selects a short phrase inside `container`, a
 * small "Explain" button appears above it. Pressing it asks the server to
 * classify the phrase (event or term) and hands the result to `onResolved`,
 * which opens the matching action — so a selection only ever offers one.
 */

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { insightErrorMessage, selectionProblem } from '@panorist/core/insights';
import { ApiError, api } from '../lib/client/api.ts';
import type { PanelTarget } from './insight-panel.tsx';
import { Spinner } from './ui.tsx';

interface Pending {
  text: string;
  context: string;
  top: number;
  left: number;
}

export function SelectionExplainer({
  container,
  reportId,
  onResolved,
}: {
  container: RefObject<HTMLElement | null>;
  reportId: string;
  onResolved: (target: PanelTarget) => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readSelection = useCallback(() => {
    const root = container.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setPending(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      setPending(null);
      return;
    }
    const text = selection.toString().replace(/\s+/g, ' ').trim();
    if (selectionProblem(text) !== null) {
      setPending(null);
      return;
    }
    const node = range.commonAncestorContainer;
    const block = (node instanceof Element ? node : node.parentElement)?.closest('p, li');
    const rect = range.getBoundingClientRect();
    setError(null);
    setPending({
      text,
      context: block?.textContent ?? '',
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX + rect.width / 2,
    });
  }, [container]);

  useEffect(() => {
    // Defer one tick so a click that clears the selection is seen as cleared.
    const onUp = () => window.setTimeout(readSelection, 0);
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey || e.key.startsWith('Arrow')) onUp();
    };
    document.addEventListener('pointerup', onUp);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, [readSelection]);

  if (!pending) return null;

  async function resolve() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const target = await api.resolveSelection(pending.text, reportId);
      window.getSelection()?.removeAllRanges();
      setPending(null);
      onResolved({ ...target, sourceText: pending.context });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 422)) {
        console.error('[selection] resolve failed', err);
      }
      setError(insightErrorMessage(err instanceof ApiError ? err.status : null));
    } finally {
      setBusy(false);
    }
  }

  // Portalled to <body> so the page-relative coordinates line up.
  return createPortal(
    <div
      className="absolute z-30 -translate-x-1/2 -translate-y-full pb-2"
      style={{ top: pending.top, left: pending.left }}
      // Keep the selection alive while pressing the button.
      onPointerDown={(e) => e.preventDefault()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      {error ? (
        <p
          role="status"
          className="max-w-[280px] rounded-xl bg-ink px-3.5 py-2 text-sm text-paper shadow-lg"
        >
          {error}
        </p>
      ) : (
        <button
          type="button"
          onClick={resolve}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper shadow-lg transition hover:bg-ink/85 disabled:opacity-80"
        >
          {busy && <Spinner className="h-3.5 w-3.5" />}
          Explain “{pending.text.length > 32 ? `${pending.text.slice(0, 30)}…` : pending.text}”
        </button>
      )}
    </div>,
    document.body,
  );
}
