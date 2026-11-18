import Link from 'next/link';

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`font-serif font-semibold tracking-tight text-ink ${className}`}
      aria-label="Panorist home"
    >
      Panorist<span className="text-accent">.</span>
    </Link>
  );
}
