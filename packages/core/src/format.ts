/** Display helpers shared by web and mobile. Pure; locale-aware via Intl. */

import { categoryLabel } from './categories.ts';
import type { Frequency } from './types.ts';

interface Dated {
  frequency: Frequency;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

const day = (locale?: string) =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fullDay = (locale?: string) =>
  new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

/**
 * "Tuesday 18 November" for daily, "12 – 18 Nov" for weekly. Periods are
 * stored as whole UTC days, so they are formatted in UTC.
 */
export function periodLabel(report: Dated, locale?: string): string {
  const end = new Date(report.periodEnd);
  if (report.frequency === 'daily') return fullDay(locale).format(end);
  return `${day(locale).format(new Date(report.periodStart))} – ${day(locale).format(end)}`;
}

export function frequencyLabel(frequency: Frequency): string {
  return frequency === 'daily' ? 'Daily briefing' : 'Weekly review';
}

/** "Good morning" etc. for the viewer's local hour. */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Masthead date line, e.g. "Wednesday, 18 November 2026". */
export function mastheadDate(now: Date = new Date(), locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
}

/** "Delivered 08:02" today, otherwise "Delivered 12 Nov". */
export function deliveredLabel(createdAt: string, now: Date = new Date(), locale?: string): string {
  const at = new Date(createdAt);
  const sameDay = at.toDateString() === now.toDateString();
  const fmt = sameDay
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
    : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  return `Delivered ${fmt.format(at)}`;
}

/** "World · Economics & Business · +2" for a compact topic line. */
export function topicsSummary(categories: readonly string[], max = 3): string {
  const labels = categories.map(categoryLabel);
  const shown = labels.slice(0, max).join(' · ');
  return labels.length > max ? `${shown} · +${labels.length - max}` : shown;
}

/** Group items by "November 2026" (local), keeping order. */
export function groupByMonth<T extends { createdAt: string }>(
  items: readonly T[],
  locale?: string,
): { month: string; items: T[] }[] {
  const fmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
  const groups: { month: string; items: T[] }[] = [];
  for (const item of items) {
    const month = fmt.format(new Date(item.createdAt));
    const last = groups.at(-1);
    if (last?.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }
  return groups;
}

/** "08:00" style label for a delivery hour. */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** Rough reading time for markdown, at ~230 words a minute. */
export function readingMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

/** Initials for an avatar: "Florence Tsang" → "FT", "a@b.c" → "A". */
export function initials(nameOrEmail: string): string {
  const parts = nameOrEmail
    .split('@')[0]
    .split(/[\s._-]+/)
    .filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0]?.[0] ?? '?')).toUpperCase();
}

/** "World, Sport and Technology" — a report's headline from its topics. */
export function reportHeadline(categories: readonly string[]): string {
  const labels = categories.map(categoryLabel);
  if (labels.length === 0) return 'Your briefing';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}
