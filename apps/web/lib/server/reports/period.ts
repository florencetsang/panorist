/**
 * Report windows. Dates here are plain ISO calendar dates (YYYY-MM-DD), so
 * UTC arithmetic is exact; timezone-aware values come only from
 * localDate/isLocalMonday.
 */

import type { Frequency } from '@panorist/core/types';

const DAY_MS = 86_400_000;
/** Inclusive length of a weekly window. */
export const WEEKLY_WINDOW_DAYS = 7;

export function minusDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

/** First day of the window ending on `to`: the day itself for daily, 7 days inclusive for weekly. */
export function windowStart(to: string, frequency: Frequency): string {
  return frequency === 'weekly' ? minusDays(to, WEEKLY_WINDOW_DAYS - 1) : to;
}

export function reportPeriod(
  to: string,
  frequency: Frequency,
): { periodStart: Date; periodEnd: Date } {
  return {
    periodStart: new Date(`${windowStart(to, frequency)}T00:00:00Z`),
    periodEnd: new Date(`${to}T23:59:59.999Z`),
  };
}

/** The user's local calendar date. (en-CA formats as YYYY-MM-DD.) */
export function localDate(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
}

/** Weekly reports go out on the local Monday — matches `isodow = 1` in the due-user query. */
export function isLocalMonday(timezone: string, now: Date): boolean {
  return (
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(now) === 'Mon'
  );
}
