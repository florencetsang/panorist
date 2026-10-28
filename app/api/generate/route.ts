/**
 * POST /api/generate  body {userId}  — the report worker for ONE user.
 *
 * Loads the user + preferences and generates ONE REPORT PER FREQUENCY the
 * user is due for: their DAILY list (every day at their delivery hour), and —
 * on the user's LOCAL Monday — their WEEKLY list as a SEPARATE report. Every
 * report is exactly one frequency (never mixed); on a Monday an eligible
 * user gets two. The cron route no longer tells us which kind to build —
 * it sends just {userId} and we re-read the preferences here, the single
 * source of truth, so a stale cron payload can never generate the wrong
 * window.
 *
 * Per report: derive the window from its frequency, run the (search-enabled)
 * LLM with the markdown cache so users sharing a category+window cost one
 * call, store the report, and send a web push per generated report.
 *
 * Guarded: requires header `x-cron-secret` === CRON_SECRET — this route
 * spends real LLM money, so only the cron job and an admin may call it.
 */

import { timingSafeEqual } from 'node:crypto';

import {
  dbMarkdownCache,
  getUserWithPreferences,
  saveReport,
  updatePreferences,
} from '../../../lib/db.ts';
import { generateReport } from '../../../lib/llm.ts';
import type { CategorySlug, Frequency, ReportDraft, UserWithPreferences } from '../../../lib/types.ts';
import { sendPush } from '../../../lib/push.ts';
import { isUuid, jsonError, readJsonObject } from '../_lib/validate.ts';

// web-push (and its crypto) need the Node runtime; they can't load on edge.
export const runtime = 'nodejs';
// Search-grounded LLM calls are slow (up to 90s per attempt); the markdown
// cache keeps shared categories cheap. On a local Monday this runs up to TWO
// reports back to back — raise on a Pro plan if timeouts bite.
export const maxDuration = 60;

/**
 * Secret check. Returns null when authorized, otherwise the response to send.
 * Constant-time compare so the secret can't be probed byte-by-byte over
 * timing; the response body is a fixed string either way (never the secret
 * or a length hint).
 */
function checkSecret(request: Request): Response | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Fail closed AND loud: an unguarded route that spends LLM budget is
    // worse than a deploy that clearly reports the missing variable.
    console.error('[api/generate] CRON_SECRET is not set — refusing every request');
    return jsonError(500, 'server misconfigured');
  }
  const provided = request.headers.get('x-cron-secret') ?? '';
  // timingSafeEqual throws on unequal lengths, so check lengths first —
  // a high-entropy secret's length is not a meaningful leak.
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  const ok = providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
  return ok ? null : jsonError(401, 'unauthorized');
}

/** The user's local weekday abbreviation ('Mon', 'Tue', …) right now.
 * en-US gives stable three-letter keys; the weekly day is hardcoded to
 * Monday, matching the cron's `isodow = 1` due-check in lib/db.ts. */
function localWeekday(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(now);
}

/**
 * Generate, store and push ONE frequency's report. Returns the new report id,
 * or null when EVERY category of this frequency failed (each failure is
 * logged inside generateReport) — the caller then still attempts the sibling
 * report and decides how to surface the failure. Per-category failures are
 * contained inside generateReport; an infrastructure error (e.g. the DB) still
 * propagates to the outer 500 handler, as before.
 */
async function generateAndStoreOne(
  user: UserWithPreferences,
  categories: CategorySlug[],
  frequency: Frequency,
  to: string,
): Promise<{ id: string } | null> {
  const draft: ReportDraft = await generateReport(user, categories, frequency, to, dbMarkdownCache);
  if (draft.content.length === 0) {
    // Every category failed (each is logged inside generateReport) —
    // storing an empty report and pushing "your report is ready" would
    // be lying to the user. Surface the upstream failure to the caller.
    return null;
  }

  const reportId = await saveReport(user.id, draft);

  if (user.pushSubscription) {
    try {
      // Tiny pointer payload (push payloads cap near 4KB — see lib/push.ts):
      // say what's ready and where to tap; the client fetches the report
      // itself. One push per generated report, so the title names the
      // frequency and the deep link targets that report's page
      // (public/sw.js opens it on notificationclick).
      const pushResult = await sendPush(user.pushSubscription, {
        title: `Panorist — your ${frequency} briefing is ready`,
        body: draft.content.map((key) => key.category.replace(/_/g, ' ')).join(', '),
        url: `/reports/${reportId}`,
      });
      if (pushResult === 'expired') {
        // Push service answered 404/410: that subscription is gone — null
        // it out so future cron ticks stop retrying a dead endpoint.
        // (Idempotent if a Monday's second report also finds it expired.)
        await updatePreferences(user.id, { pushSubscription: null });
      }
    } catch (err) {
      // The report is already saved; a failed push must not fail the
      // request. Log server-side and keep going.
      console.error('[api/generate] push failed for report', reportId, err);
    }
  }

  return { id: reportId };
}

export async function POST(request: Request): Promise<Response> {
  const auth = checkSecret(request);
  if (auth) return auth;

  const body = await readJsonObject(request);
  if (!body) return jsonError(400, 'expected a JSON object body');

  const { userId } = body;
  if (!isUuid(userId)) return jsonError(400, 'userId (uuid) is required');

  try {
    const user = await getUserWithPreferences(userId);
    if (!user) return jsonError(404, 'user not found');

    // "Today" as YYYY-MM-DD and the local weekday — the only
    // timezone-sensitive values this route computes; each window itself
    // (today vs the 7 days ending today) is derived inside generateReport,
    // keyed to the same date so prompt, cache key and stored period always
    // agree. en-CA locale happens to format dates as YYYY-MM-DD.
    const now = new Date();
    const to = new Intl.DateTimeFormat('en-CA', { timeZone: user.timezone }).format(now);
    // Weekly day hardcoded to Monday, matching the due-check (isodow = 1).
    const isLocalMonday = localWeekday(user.timezone, now) === 'Mon';

    // Which of the user's per-frequency lists want a report right now.
    // Both empty ("paused") → nothing is due → a clean 200 no-op, not an
    // error: the cron just never picks such a user up in the first place,
    // and a manual/admin call should say so rather than fail.
    const wantsDaily = user.dailyCategories.length > 0;
    const wantsWeekly = isLocalMonday && user.weeklyCategories.length > 0;
    if (!wantsDaily && !wantsWeekly) {
      return Response.json({ dailyReportId: null, weeklyReportId: null });
    }

    // One report per frequency. A total failure of one (null) must not
    // abort the other, so each is attempted independently.
    const daily = wantsDaily ? await generateAndStoreOne(user, user.dailyCategories, 'daily', to) : null;
    const weekly = wantsWeekly ? await generateAndStoreOne(user, user.weeklyCategories, 'weekly', to) : null;

    if (!daily && !weekly) {
      // At least one report was due but every one of its categories failed —
      // nothing was stored, so report the upstream failure (per-report
      // behavior: 502, not a stored empty report).
      return jsonError(502, 'report generation produced no content');
    }

    return Response.json(
      {
        dailyReportId: daily?.id ?? null,
        weeklyReportId: weekly?.id ?? null,
      },
      { status: 201 },
    );
  } catch (err) {
    // Details (provider URLs, key names, …) go to the server log only; the
    // response is a fixed generic message so nothing sensitive leaks.
    console.error('[api/generate] failed', err);
    return jsonError(500, 'internal error');
  }
}