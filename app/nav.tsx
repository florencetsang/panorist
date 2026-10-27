'use client';

/**
 * Shared header: brand, section links, and the "Enable notifications"
 * button. Client-side because it reads the URL (to keep ?userId across
 * links) and drives web-push permission state.
 */

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getUserIdFrom } from '../lib/user-id.ts';
import { registerServiceWorker, subscribeUser } from '../lib/push-client.ts';

/** What the push button shows — mirrors Notification.permission + results. */
type PushState = 'mount' | 'idle' | 'busy' | 'on' | 'denied' | 'unsupported' | 'error';

const PUSH_LABEL: Record<PushState, string> = {
  mount: 'Enable notifications', // SSR/first paint (matches 'idle' — no flash)
  idle: 'Enable notifications',
  busy: 'Enabling…',
  on: 'Notifications on ✓',
  denied: 'Blocked in browser settings',
  unsupported: 'Push not supported here',
  error: 'Enable notifications',
};

export default function Nav() {
  const pathname = usePathname();
  const search = useSearchParams();
  // Brand/section links carry ?userId along, so the prototype's fake identity
  // survives navigation. TODO(auth): dies with real auth.
  const qs = search.toString();
  const withQs = (path: string) => (qs ? `${path}?${qs}` : path);
  const userId = getUserIdFrom(Object.fromEntries(search.entries()));
  const [push, setPush] = useState<PushState>('mount');

  // Reflect the browser's current permission on load (before any click).
  useEffect(() => {
    if (typeof Notification === 'undefined') setPush('unsupported');
    else if (Notification.permission === 'granted') setPush('on');
    else if (Notification.permission === 'denied') setPush('denied');
    else setPush('idle');
  }, []);

  async function enableNotifications() {
    if (!userId || push === 'busy' || push === 'denied' || push === 'unsupported') return;
    setPush('busy');
    // register + subscribe (idempotent: re-registering a worker and re-POSTing
    // a live subscription are both no-ops — see lib/push-client.ts).
    await registerServiceWorker();
    const result = await subscribeUser(userId);
    setPush(
      result.ok
        ? 'on'
        : result.reason === 'denied'
          ? 'denied'
          : result.reason === 'unsupported'
            ? 'unsupported'
            : 'error',
    );
  }

  const link = (path: string, label: string) => (
    <Link
      href={withQs(path)}
      aria-current={pathname === path ? 'page' : undefined}
      className={
        pathname === path
          ? 'font-medium text-stone-900'
          : 'text-stone-500 transition-colors hover:text-stone-900'
      }
    >
      {label}
    </Link>
  );

  const pushTone =
    push === 'on'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : push === 'denied' || push === 'unsupported'
        ? 'border-stone-200 bg-stone-100 text-stone-400'
        : push === 'busy'
          ? 'border-stone-200 bg-white text-stone-400'
          : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100';

  return (
    <header className="border-b border-stone-200 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Link href={withQs('/')} className="text-lg font-semibold tracking-tight">
          Panorist
        </Link>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {link('/', 'Reports')}
          {link('/preferences', 'Preferences')}
          <button
            type="button"
            onClick={enableNotifications}
            disabled={!userId || push === 'busy' || push === 'denied' || push === 'unsupported'}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${pushTone}`}
          >
            {PUSH_LABEL[push]}
          </button>
        </nav>
      </div>
      {push === 'error' && (
        <p className="mt-2 text-xs text-red-600">
          Couldn’t subscribe — check the console, then retry.
        </p>
      )}
    </header>
  );
}