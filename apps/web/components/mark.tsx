import { rules, sun, viewBox } from '@panorist/core/brand';

/** The sunrise mark, inked with theme colours so it follows light/dark. */
export function Mark({ className = '' }: { className?: string }) {
  const { x, y, width, height } = viewBox.mark;
  return (
    <svg
      viewBox={`${x} ${y} ${width} ${height}`}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={`M${sun.cx - sun.r} ${sun.cy}a${sun.r} ${sun.r} 0 0 1 ${2 * sun.r} 0z`}
        className="fill-accent"
      />
      <rect {...rules.horizon} className="fill-ink" />
      <rect {...rules.line1} className="fill-ink-faint" />
      <rect {...rules.line2} className="fill-ink-faint" />
    </svg>
  );
}
