/**
 * The Panorist mark: a sun rising over a horizon rule, with two newsprint
 * column lines beneath. Drawn in the editorial palette from design.ts so the
 * logo and UI share one language: vermilion sun, ink/paper rules, sharp edges.
 *
 * Geometry lives on a 512 grid. Every app icon (scripts/generate-icons.ts),
 * the web <Mark> and the native Mark render from these shapes.
 */

export interface MarkColors {
  sun: string;
  horizon: string;
  lines: string;
}

/** Sun: a half disc sitting on the horizon. */
export const sun = { cx: 256, cy: 268, r: 116 } as const;

/** Horizon rule, then the two column lines (full width, then short). */
export const rules = {
  horizon: { x: 92, y: 290, width: 328, height: 20 },
  line1: { x: 92, y: 338, width: 328, height: 8 },
  line2: { x: 92, y: 368, width: 212, height: 8 },
} as const;

/** Full icon canvas, and a tight crop around the shapes for in-page use. */
export const viewBox = {
  icon: { x: 0, y: 0, width: 512, height: 512 },
  mark: { x: 84, y: 144, width: 344, height: 240 },
} as const;

/** App-icon tile: warm ink ground, sun brighter than the UI accent to glow on it. */
export const tile = {
  background: '#1d1a16',
  sun: '#d0482c',
  horizon: '#f7f3ec',
  lines: '#9a9184',
  /** Corner radius for non-masked (rounded) icons, on the 512 grid. */
  radius: 112,
} as const;

/** The mark's shapes as SVG elements, filled with the given colours. */
export function markShapes(c: MarkColors): string {
  const rect = (r: { x: number; y: number; width: number; height: number }, fill: string) =>
    `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${fill}"/>`;
  return [
    `<path d="M${sun.cx - sun.r} ${sun.cy}a${sun.r} ${sun.r} 0 0 1 ${2 * sun.r} 0z" fill="${c.sun}"/>`,
    rect(rules.horizon, c.horizon),
    rect(rules.line1, c.lines),
    rect(rules.line2, c.lines),
  ].join('');
}
