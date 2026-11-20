import type { ReactNode } from 'react';
import { AppHeader } from '../../components/app-header.tsx';

/** Signed-in pages (the proxy redirects signed-out visitors to /sign-in). */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pt-8 pb-20 sm:px-8 sm:pt-12">
        {children}
      </main>
      <footer className="border-t border-rule">
        <p className="mx-auto max-w-3xl px-5 py-6 text-xs leading-relaxed text-ink-faint sm:px-8">
          Briefings are researched and written by a search-enabled AI model. Check the linked
          sources for anything that matters.
        </p>
      </footer>
    </div>
  );
}
