/**
 * POST /api/generate  body {userId, kind}  — the report worker for ONE user.
 *
 * Loads the user + preferences, derives the report window from their
 * frequency, runs the (search-enabled) LLM with the markdown cache so users
 * sharing a category+window cost one call, stores the report, and sends a
 * web push pointing at it.
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
import { sendPush } from '../../../lib/push.ts';
import { isUuid, jsonError, readJsonObject } from '../_lib/validate.ts';

// web-push (and its crypto) need the Node runtime; they can't load on edge.
export const runtime = 'nodejs';
// Search-grounded LLM calls are slow (up to 90s per attempt); the markdown
// cache keeps shared categories cheap. Raise on a Pro plan if timeouts bite.
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
  // timingSafeEqual throws on unequal lengths, so compare lengths first —
  // a high-entropy secret's length is not a meaningful leak.
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  const ok = providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
  return ok ? null : jsonError(401, 'unauthorized');
}

export async function POST(request: Request): Promise<Response> {
  const auth = checkSecret(request);
  if (auth) return auth;

  const body = await readJsonObject(request);
  if (!body) return jsonError(400, 'expected a JSON object body');

  const { userId, kind } = body;
  if (!isUuid(userId)) return jsonError(400, 'userId (uuid) is required');
  if (kind !== 'daily' && kind !== 'weekly') return jsonError(400, 'kind must be "daily" or "weekly"');

  try {
    const user = await getUserWithPreferences(userId);
    if (!user) return jsonError(404, 'user not found');

    // `kind` is a cross-check, not an input: the report window derives from
    // preferences.frequency — the single source of truth in lib/llm.ts, so
    // the two can never disagree. A mismatch means the cron payload is
    // stale (the user changed preferences after it was built); reject
    // rather than silently generating the wrong window.
    if (kind !== user.frequency) {
      return jsonError(409, `kind "${kind}" does not match the user's frequency "${user.frequency}"`);
    }

    // "Today" as YYYY-MM-DD in the user's IANA timezone — the only
    // timezone-sensitive value this route computes; the window itself
    // (today vs the 7 days ending today) is derived inside generateReport,
    // keyed to the same date so prompt, cache key and stored period always
    // agree. en-CA locale happens to format dates as YYYY-MM-DD.
    const to = new Intl.DateTimeFormat('en-CA', { timeZone: user.timezone }).format(new Date());

    const draft = await generateReport(user, user, to, dbMarkdownCache);
    if (draft.content.length === 0) {
      // Every category failed (each is logged inside generateReport) —
      // storing an empty report and pushing "your report is ready" would
      // be lying to the user. Report the upstream failure instead.
      return jsonError(502, 'report generation produced no content');
    }

    const reportId = await saveReport(user.id, draft);

    if (user.pushSubscription) {
      try {
        // Tiny pointer payload (push payloads cap near 4KB — see lib/push.ts):
        // say what's ready and where to tap; the client fetches the report
        // itself. The deep link targets the report page the frontend
        // milestone serves; public/sw.js opens it on notificationclick.
        const pushResult = await sendPush(user.pushSubscription, {
          title: `Panorist — your ${kind} briefing is ready`,
          body: draft.content.map((key) => key.category.replace(/_/g, ' ')).join(', '),
          url: `/reports/${reportId}`,
        });
        if (pushResult === 'expired') {
          // Push service answered 404/410: that subscription is gone — null
          // it out so future cron ticks stop retrying a dead endpoint.
          await updatePreferences(user.id, { pushSubscription: null });
        }
      } catch (err) {
        // The report is already saved; a failed push must not fail the
        // request. Log server-side and keep going.
        console.error('[api/generate] push failed for report', reportId, err);
      }
    }

    return Response.json({ reportId }, { status: 201 });
  } catch (err) {
    // Details (provider URLs, key names, …) go to the server log only; the
    // response is a fixed generic message so nothing sensitive leaks.
    console.error('[api/generate] failed', err);
    return jsonError(500, 'internal error');
  }
}
