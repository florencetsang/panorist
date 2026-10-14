/**
 * GET /api/cron — the scheduler entry point, hit by Vercel Cron (see
 * vercel.json).
 *
 * Schedule rationale: every user is currently daily @ 8am Asia/Hong_Kong,
 * which is exactly 00:00 UTC — so ONE daily cron at "0 0 * * *" covers the
 * whole user base and stays within the Hobby plan's once-a-day cron cap.
 * The route still derives the due hour from the current UTC time and asks
 * the database whose LOCAL hour it is (Postgres does the AT TIME ZONE math,
 * DST and half-hour zones included), so when a future multi-timezone user
 * base needs hourly scans, only the schedule changes — the code doesn't.
 * (Hourly requires Pro, or an external free scheduler curling this route
 * with the same Bearer header; see README "Scheduling".)
 *
 * For each due user we POST to /api/generate (the per-user worker that runs
 * the LLM, saves the report and pushes). We call it over HTTP rather than
 * importing the handler so the worker's own maxDuration/timeout budget and
 * logs stay isolated per user.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`
 * automatically (when the env var is set on the deployment); anything else
 * is rejected with 401.
 */

import { timingSafeEqual } from 'node:crypto';

import { getUsersDueForReport } from '../../../lib/db.ts';
import { jsonError } from '../_lib/validate.ts';

// web-push / node:crypto live in the generate worker, and Buffer below is
// Node-only — keep this route off the edge runtime too.
export const runtime = 'nodejs';
// Each /api/generate call can run up to its own 60s budget; with
// CONCURRENCY users in flight the batch needs headroom. At prototype scale
// (a handful of due users per tick) 60s is comfortable — raise both together
// on a Pro plan if the due-user count grows.
export const maxDuration = 60;

/** Max /api/generate calls in flight at once (matches lib/llm.ts's category
 *  concurrency — the shared markdown cache already collapses duplicate
 *  categories across users, so the real LLM load is far below this). */
const CONCURRENCY = 3;

/**
 * Bearer check, timing-safe like the generate route: compare the token half
 * of the header against CRON_SECRET so the secret can't be probed by timing.
 * Returns null when authorized, otherwise the 401/500 to send.
 */
function checkAuthorization(request: Request): Response | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Fail closed AND loud — without a secret anyone could trigger spends.
    console.error('[api/cron] CRON_SECRET is not set — refusing every request');
    return jsonError(500, 'server misconfigured');
  }
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  // timingSafeEqual throws on unequal lengths, so check length first — the
  // length of a high-entropy secret is not a meaningful leak.
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  const ok =
    tokenBuf.length === expectedBuf.length && timingSafeEqual(tokenBuf, expectedBuf);
  return ok ? null : jsonError(401, 'unauthorized');
}

export async function GET(request: Request): Promise<Response> {
  const auth = checkAuthorization(request);
  if (auth) return auth;

  try {
    // The UTC hour this tick belongs to; getUsersDueForReport converts it to
    // each user's local hour (and local weekday, for weekly users) in SQL.
    const currentUtcHour = new Date().getUTCHours();
    const dueUsers = await getUsersDueForReport(currentUtcHour);
    console.log("Number of due users: "+dueUsers.length);

    if (dueUsers.length > 0) {
      // Same-origin self-call: works on Vercel (the request's own host) and
      // against `next dev` during local curl testing.
      const origin = new URL(request.url).origin;

      let succeeded = 0;
      let failed = 0;

      // Fixed-size batches instead of a worker pool — simpler, and the batch
      // size bounds the concurrent LLM spend.
      for (let i = 0; i < dueUsers.length; i += CONCURRENCY) {
        const batch = dueUsers.slice(i, i + CONCURRENCY);
        // Promise.all here is safe: every member catches its own failures,
        // so one bad user can never abort the batch (or the whole run).
        await Promise.all(
          batch.map(async (user) => {
            try {
              const res = await fetch(`${origin}/api/generate`, {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  // The worker route's own guard (it spends LLM money).
                  'x-cron-secret': process.env.CRON_SECRET!,
                },
                body: JSON.stringify({ userId: user.id, kind: user.frequency }),
              });
              if (res.ok) {
                succeeded += 1;
              } else {
                failed += 1;
                // Body is the worker's fixed error string — safe to log.
                console.error(
                  `[api/cron] /api/generate for user ${user.id} ` +
                    `returned ${res.status}: ${await res.text()}`,
                );
              }
            } catch (err) {
              failed += 1;
              console.error(`[api/cron] /api/generate for user ${user.id} threw`, err);
            }
          }),
        );
      }

      return Response.json({ processed: dueUsers.length, succeeded, failed });
    }

    // Nobody due this hour — still 200 so the cron doesn't look failing.
    return Response.json({ processed: 0, succeeded: 0, failed: 0 });
  } catch (err) {
    console.error('[api/cron] failed', err);
    return jsonError(500, 'internal error');
  }
}
