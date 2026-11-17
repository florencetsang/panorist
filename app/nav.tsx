'use client';

/**
 * Shared header: brand, section links, and the notifications button.
 * Client-side because it keeps ?userId across links and drives web push.
 */

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { hasPushSubscription, isPushSupported, subscribeUser } from '../lib/client/push.ts';
import { getUserIdFrom } from '../lib/shared/user-id.ts';

type PushState = 'mount' | 'idle' | 'busy' | 'on' | 'denied' | 'unsupported' | 'error';

const PUSH_LABEL: Record<PushState, string> = {
  mount: 'Enable notifications', // matches 'idle' so first paint doesn't flash
  idle: 'Enable notifications',
  busy: 'Enabling…',
  on: 'Notifications on ✓',
  denied: 'Blocked in browser settings',
  unsupported: 'Push not supported here',
  error: 'Enable notifications',
};

const PUSH_TONE: Record<PushState, string> = {
  mount: 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100',
  idle: 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100',
  error: 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100',
  busy: 'border-stone-200 bg-white text-stone-400',
  on: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  denied: 'border-stone-200 bg-stone-100 text-stone-400',
  unsupported: 'border-stone-200 bg-stone-100 text-stone-400',
};

/** Permission alone isn't enough for "on" — the browser must hold a subscription. */
async function detectPushState(): Promise<PushState> {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return (await hasPushSubscription()) ? 'on' : 'idle';
}

export default function Nav() {
  const pathname = usePathname();
  const search = useSearchParams();
  // Carry ?userId across links so the prototype's fake identity survives
  // navigation. TODO(auth): remove with real auth.
  const qs = search.toString();
  const withQs = (path: string) => (qs ? `${path}?${qs}` : path);
  const userId = getUserIdFrom(Object.fromEntries(search.entries()));
  const [push, setPush] = useState<PushState>('mount');

  useEffect(() => {
    let cancelled = false;
    detectPushState().then(
      (state) => !cancelled && setPush(state),
      () => !cancelled && setPush('idle'),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const pushDisabled = !userId || push === 'busy' || push === 'denied' || push === 'unsupported';

  async function enableNotifications() {
    if (pushDisabled || !userId) return;
    setPush('busy');
    const result = await subscribeUser(userId);
    if (result.ok) setPush('on');
    else if (result.reason === 'denied' || result.reason === 'unsupported') setPush(result.reason);
    else setPush('error');
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
            disabled={pushDisabled}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${PUSH_TONE[push]}`}
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
