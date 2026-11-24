'use client';

/** Masthead: wordmark, section links, and the account menu. */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { initials, mastheadDate } from '@panorist/core/format';
import { authClient } from '../lib/client/auth.ts';
import { hasPushSubscription, isPushSupported, subscribeUser } from '../lib/client/push.ts';
import { applyTheme, readTheme, type Theme } from '../lib/client/theme.ts';
import { useClientValue } from '../lib/client/use-client-value.ts';
import { Wordmark } from './wordmark.tsx';

const LINKS = [
  { href: '/', label: 'Briefings' },
  { href: '/preferences', label: 'Preferences' },
];

export function AppHeader() {
  const pathname = usePathname();
  // Client-only: the server's clock and locale may differ from the reader's.
  const today = useClientValue(mastheadDate, '');

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' || pathname.startsWith('/reports') : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper/90 backdrop-blur supports-[backdrop-filter]:bg-paper/75">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <Wordmark className="text-2xl" />
          <span className="hidden truncate text-xs text-ink-faint sm:inline">{today}</span>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <nav className="flex items-center gap-1 text-sm">
            {LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? 'page' : undefined}
                className={`rounded-full px-3 py-1.5 transition ${
                  isActive(href)
                    ? 'bg-sunken font-medium text-ink'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}

type PushState = 'unknown' | 'off' | 'busy' | 'on' | 'denied' | 'unsupported' | 'error';

const PUSH_LABEL: Record<PushState, string> = {
  unknown: 'Notifications',
  off: 'Turn on notifications',
  busy: 'Turning on…',
  on: 'Notifications on',
  denied: 'Notifications blocked in browser',
  unsupported: 'Notifications not supported here',
  error: 'Couldn’t turn on — retry',
};

function AccountMenu() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const storedTheme = useClientValue(readTheme, 'system');
  const [chosenTheme, setTheme] = useState<Theme | null>(null);
  const theme = chosenTheme ?? storedTheme;
  const [push, setPush] = useState<PushState>('unknown');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      if (!isPushSupported()) return 'unsupported' as const;
      if (Notification.permission === 'denied') return 'denied' as const;
      return (await hasPushSubscription()) ? ('on' as const) : ('off' as const);
    })().then((s) => !cancelled && setPush((prev) => (prev === 'busy' ? prev : s)));
    const onDown = (e: MouseEvent) =>
      menuRef.current && !menuRef.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const user = session?.user;
  const display = user?.name || user?.email || '';

  function chooseTheme(next: Theme) {
    applyTheme(next);
    setTheme(next);
  }

  async function enablePush() {
    setPush('busy');
    const result = await subscribeUser();
    if (result.ok) setPush('on');
    else if (result.reason === 'denied' || result.reason === 'unsupported') setPush(result.reason);
    else setPush('error');
  }

  async function signOut() {
    await authClient.signOut();
    router.replace('/sign-in');
    router.refresh();
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-ink text-xs font-semibold text-paper transition hover:opacity-90"
      >
        {display ? initials(display) : ''}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-72 overflow-hidden rounded-2xl border border-rule bg-surface shadow-xl shadow-black/5"
        >
          <div className="border-b border-rule px-4 py-3">
            {user?.name && <p className="truncate font-medium">{user.name}</p>}
            <p className="truncate text-sm text-ink-muted">{user?.email}</p>
          </div>

          <div className="border-b border-rule px-4 py-3">
            <p className="eyebrow text-ink-faint">Appearance</p>
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-full bg-sunken p-1 text-sm">
              {(['system', 'light', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => chooseTheme(t)}
                  aria-pressed={theme === t}
                  className={`rounded-full py-1 capitalize transition ${
                    theme === t ? 'bg-surface font-medium text-ink shadow-sm' : 'text-ink-muted'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="py-1 text-sm">
            <button
              type="button"
              role="menuitem"
              onClick={enablePush}
              disabled={push !== 'off' && push !== 'error'}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-sunken disabled:hover:bg-transparent"
            >
              <span className={push === 'off' || push === 'error' ? '' : 'text-ink-muted'}>
                {PUSH_LABEL[push]}
              </span>
              {push === 'on' && <span className="h-2 w-2 rounded-full bg-success" />}
            </button>
            <Link
              role="menuitem"
              href="/preferences"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 hover:bg-sunken"
            >
              Delivery preferences
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="block w-full px-4 py-2.5 text-left text-danger hover:bg-sunken"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
