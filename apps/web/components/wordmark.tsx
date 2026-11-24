import Link from 'next/link';
import { Mark } from './mark.tsx';

/** Logo lockup: mark + "Panorist." — size it with a text-* class. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-[0.35em] font-serif font-semibold tracking-tight text-ink ${className}`}
      aria-label="Panorist home"
    >
      <Mark className="h-[0.8em] w-auto shrink-0" />
      <span>
        Panorist<span className="text-accent">.</span>
      </span>
    </Link>
  );
}
