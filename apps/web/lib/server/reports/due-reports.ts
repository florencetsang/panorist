/**
 * Generate, store and announce the reports one user is due for right now:
 * the daily list every day, plus the weekly list on the user's local Monday.
 * Each frequency is a separate report, and one failing never blocks the other.
 */

import 'server-only';

import type { CategorySlug } from '@panorist/core/categories';
import type { Frequency, ReportDraft, UserWithPreferences } from '@panorist/core/types';
import { dbMarkdownCache } from '../db/markdown-cache.ts';
import { saveReport } from '../db/reports.ts';
import { savePushSubscription } from '../db/users.ts';
import { getLlmProvider } from '../llm/index.ts';
import { sendPush } from '../push.ts';
import { generateReport, type ReportGenerationDeps } from './generate-report.ts';
import { isLocalMonday, localDate } from './period.ts';

export type DueReportsResult =
  | { status: 'nothing-due' }
  /** Something was due but every category failed; nothing was stored. */
  | { status: 'no-content' }
  | { status: 'generated'; dailyReportId: string | null; weeklyReportId: string | null };

/** The frequencies (and their category lists) due for this user at `now`. */
export function dueFrequencies(
  user: UserWithPreferences,
  now: Date,
): { frequency: Frequency; categories: CategorySlug[] }[] {
  const due: { frequency: Frequency; categories: CategorySlug[] }[] = [];
  if (user.dailyCategories.length > 0) {
    due.push({ frequency: 'daily', categories: user.dailyCategories });
  }
  if (user.weeklyCategories.length > 0 && isLocalMonday(user.timezone, now)) {
    due.push({ frequency: 'weekly', categories: user.weeklyCategories });
  }
  return due;
}

export async function generateDueReports(
  user: UserWithPreferences,
  now: Date,
  deps?: ReportGenerationDeps,
): Promise<DueReportsResult> {
  const due = dueFrequencies(user, now);
  if (due.length === 0) return { status: 'nothing-due' };
  const generationDeps = deps ?? { llm: getLlmProvider(), cache: dbMarkdownCache };

  const to = localDate(user.timezone, now);
  const ids: Partial<Record<Frequency, string>> = {};
  for (const { frequency, categories } of due) {
    console.log(`[reports] generating ${frequency} report for user ${user.id}`);
    const draft = await generateReport(categories, frequency, to, generationDeps);
    // Every category failed: storing an empty report and announcing it would mislead.
    if (draft.content.length === 0) continue;

    const { id, created } = await saveReport(user.id, draft);
    ids[frequency] = id;
    // A retried run finds the existing report — don't notify twice.
    if (created) await notifyReportReady(user, draft, id);
  }

  if (!ids.daily && !ids.weekly) return { status: 'no-content' };
  return {
    status: 'generated',
    dailyReportId: ids.daily ?? null,
    weeklyReportId: ids.weekly ?? null,
  };
}

/** Best-effort: the report is already stored, so a push failure is only logged. */
async function notifyReportReady(
  user: UserWithPreferences,
  draft: ReportDraft,
  reportId: string,
): Promise<void> {
  if (!user.pushSubscription) return;
  try {
    const result = await sendPush(user.pushSubscription, {
      title: `Panorist — your ${draft.frequency} briefing is ready`,
      body: draft.content.map((key) => key.category.replace(/_/g, ' ')).join(', '),
      url: `/reports/${encodeURIComponent(reportId)}`,
    });
    if (result === 'expired') {
      await savePushSubscription(user.id, null);
      user.pushSubscription = null;
    }
  } catch (err) {
    console.error(`[reports] push failed for user ${user.id}`, err);
  }
}
