/**
 * Panorist's design language, shared by web (CSS variables in
 * apps/web/app/globals.css mirror these) and mobile (used directly).
 *
 * Editorial: warm paper, near-black ink, one vermilion accent, serif
 * headlines (Newsreader) over a quiet sans (Inter) for UI text. The logo
 * mark (brand.ts) is drawn in this same palette.
 */

export interface Palette {
  /** Page background. */
  paper: string;
  /** Raised surfaces: cards, sheets, inputs. */
  surface: string;
  /** Slightly sunken areas: skeletons, chips, code. */
  sunken: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  /** Hairlines and borders. */
  rule: string;
  accent: string;
  /** Text/icons on an accent fill. */
  onAccent: string;
  accentSoft: string;
  success: string;
  danger: string;
  dangerSoft: string;
}

export const palette: { light: Palette; dark: Palette } = {
  light: {
    paper: '#f7f3ec',
    surface: '#fffdf9',
    sunken: '#efe9df',
    ink: '#1d1a16',
    inkMuted: '#5c554b',
    inkFaint: '#9a9184',
    rule: '#e3dbcd',
    accent: '#b3361f',
    onAccent: '#fffdf9',
    accentSoft: '#f5e2db',
    success: '#2f6b46',
    danger: '#a3261b',
    dangerSoft: '#f8e1de',
  },
  dark: {
    paper: '#14120f',
    surface: '#1c1a16',
    sunken: '#25221d',
    ink: '#ece6db',
    inkMuted: '#b1a999',
    inkFaint: '#776f63',
    rule: '#2f2b25',
    accent: '#e8735c',
    onAccent: '#14120f',
    accentSoft: '#3a2119',
    success: '#7fc29a',
    danger: '#f08a7e',
    dangerSoft: '#3b1d19',
  },
};

export const fonts = {
  serif: 'Newsreader',
  sans: 'Inter',
} as const;

/** Type scale in px: [size, lineHeight]. */
export const type = {
  display: [40, 44],
  title: [28, 34],
  heading: [21, 28],
  body: [18, 29],
  ui: [15, 22],
  small: [13, 18],
  eyebrow: [11, 14],
} as const;

/** 4px grid. */
export const space = (n: number) => n * 4;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;
