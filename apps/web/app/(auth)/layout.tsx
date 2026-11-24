import type { ReactNode } from 'react';
import { Mark } from '../../components/mark.tsx';
import { Wordmark } from '../../components/wordmark.tsx';

/** Signed-out pages: an editorial cover on wide screens, the form beside it. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-rule bg-surface p-12 lg:flex">
        <Wordmark className="text-3xl" />
        <div className="max-w-md">
          <Mark className="mb-8 h-14 w-auto" />
          <p className="eyebrow text-accent">Your morning edition</p>
          <p className="mt-4 font-serif text-5xl leading-[1.05] font-medium tracking-tight text-balance">
            The news you care about, read in minutes.
          </p>
          <p className="mt-6 text-lg leading-relaxed text-ink-muted">
            Pick your beats. Panorist researches them overnight and delivers one calm, well-sourced
            briefing at the hour you choose — daily, weekly, or both.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-6 border-t border-rule pt-6 text-sm text-ink-muted">
          <div>
            <p className="font-serif text-2xl text-ink">8</p>
            beats to follow
          </div>
          <div>
            <p className="font-serif text-2xl text-ink">1</p>
            briefing, your hour
          </div>
          <div>
            <p className="font-serif text-2xl text-ink">0</p>
            infinite feeds
          </div>
        </div>
      </aside>
      <main className="flex flex-col px-6 py-10 sm:px-12">
        <Wordmark className="text-2xl lg:hidden" />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
