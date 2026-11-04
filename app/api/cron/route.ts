/**
 * GET /api/cron — the scheduler entry point, hit by Vercel Cron (see
 * vercel.json).
 *
 * Schedule rationale: every user is currently delivered @ 8am Asia/Hong_Kong
 * time, which is exactly 00:00 UTC — so ONE daily cron at "0 0 * * *" covers
 * the whole user base and stays within the Hobby plan's once-a-day cron cap.
 * The route still derives the due hour from the current UTC time and asks
 * the database whose LOCAL hour it is (Postgres does the AT TIME ZONE math,
 * DST and half-hour zones included), so when a future multi-timezone user
 * base needs hourly scans, only the schedule changes — the code doesn't.
 * (Hourly requires Pro, or an external free scheduler curling this route
 * with the same Bearer header; see README "Scheduling".)
 *
 * Per-frequency note: a due user may produce TWO reports in one tick — on
 * their local Monday the /api/generate worker runs their daily list AND
 * their weekly list as separate reports. The POST body is just {userId}: the
 * worker re-reads preferences and decides per frequency what to generate.
 *
 * For each due user we POST to /api/generate (the per-user worker that runs
 * the LLM, saves the report(s) and pushes). We call it over HTTP rather than
 * importing the handler so the worker's own maxDuration/timeout budget and
 * logs stay isolated per user. The POST targets the PRODUCTION ALIAS
 * (VERCEL_PROJECT_PRODUCTION_URL), never the request's own host — inside a
 * Vercel function that host is the deployment's unique URL, which Deployment
 * Protection guards with Vercel Authentication even in production.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`
 * automatically (when the env var is set on the deployment); anything else
 * is rejected with 401.
 *
 * Observability: the Hobby plan shows no runtime logs, so EVERY invocation
 * leaves a trace row in cron_runs (see traceCronRun) — the only way to
 * verify from outside that a tick reached this route and what it did. With
 * the CRON_DB_LOGS feature flag enabled, the tick's own log lines are ALSO
 * mirrored into that row's logs column (see makeTickLogger).
 */

import { timingSafeEqual } from 'node:crypto';

import { finishCronRun, getUsersDueForReport, saveCronRun } from '../../../lib/db.ts';
import { jsonError } from '../_lib/validate.ts';

// web-push / node:crypto live in the generate worker, and Buffer below is
// Node-only — keep this route off the edge runtime too.
export const runtime = 'nodejs';
// Always run at request time: the response depends on the Authorization
// header and the current hour, so a cached response would be wrong (and
// could serve one tick's user batch to a later tick).
export const dynamic = 'force-dynamic';
// Each /api/generate call can run up to its own 60s budget; with
// CONCURRENCY users in flight the batch needs headroom. At prototype scale
// (a handful of due users per tick) 60s is comfortable — raise both together
// on a Pro plan if the due-user count grows.
export const maxDuration = 300;

/** Max /api/generate calls in flight at once (matches lib/llm.ts's category
 *  concurrency — the shared markdown cache already collapses duplicate
 *  categories across users, so the real LLM load is far below this). */
const CONCURRENCY = 3;

/**
 * Feature flag CRON_DB_LOGS ('1' or 'true'): mirror every log line of a tick
 * into that tick's cron_runs.logs column, on top of the usual console
 * output. Off by default — console output happens either way; the flag only
 * controls the extra DB write per tick (and per line of capture memory).
 */
function isDbLogsEnabled(): boolean {
  const value = process.env.CRON_DB_LOGS;
  return value === '1' || value === 'true';
}

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

// ---------------------------------------------------------------------------
// Invocation trace — the Hobby plan has no runtime logs
// ---------------------------------------------------------------------------

/**
 * Record one invocation in cron_runs BEFORE anything else runs: this row is
 * the only observable proof that Vercel Cron actually reached the route, and
 * whether the Bearer check passed. Best-effort by design — a failing trace
 * (table missing, DB hiccup) must never fail the cron itself, it only logs.
 * Returns the new row id, or null when the trace could not be written.
 */
async function traceCronRun(authOk: boolean, detail: string | null): Promise<string | null> {
  try {
    return await saveCronRun(authOk, detail);
  } catch (err) {
    console.error('[api/cron] failed to record the invocation in cron_runs', err);
    return null;
  }
}

/** Stamp the tick's outcome (and captured log lines) onto its trace row
 *  (no-op when tracing failed). */
async function finishCronTrace(
  runId: string | null,
  detail: string,
  logs: string | null,
): Promise<void> {
  if (runId === null) return;
  try {
    await finishCronRun(runId, detail, logs);
  } catch (err) {
    console.error('[api/cron] failed to stamp the invocation outcome', err);
  }
}

/**
 * Per-tick log collector. Every line goes to the console either way (what
 * Pro-plan users see in the dashboard); when the CRON_DB_LOGS flag is
 * enabled the same lines are also captured for the cron_runs.logs column —
 * the Hobby-plan poor man's log. Captured lines carry a UTC timestamp so
 * even a function killed mid-tick leaves a readable partial timeline.
 */
function makeTickLogger(enabled: boolean) {
  const lines: string[] = [];
  const capture = (message: string): void => {
    if (!enabled) return;
    lines.push(`${new Date().toISOString().slice(11, 23)} ${message}`);
  };
  return {
    log(message: string): void {
      console.log(message);
      capture(message);
    },
    error(message: string, err?: unknown): void {
      if (err === undefined) console.error(message);
      else console.error(message, err);
      // For the DB, fold the error into one line (message + message only —
      // stacks would bloat the column; the console keeps the full object).
      capture(
        err === undefined
          ? message
          : `${message}: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
    /** Joined lines for cron_runs.logs, or null when the flag is off / nothing captured. */
    text(): string | null {
      return enabled && lines.length > 0 ? lines.join('\n') : null;
    },
  };
}

export async function GET(request: Request): Promise<Response> {
  const tickLogs = makeTickLogger(isDbLogsEnabled());
  const auth = checkAuthorization(request);
  // Trace first: rejected ticks get a row naming the reason; authorized ticks
  // get theirs stamped with the outcome before every return below.
  const authDetail = auth
    ? auth.status === 401
      ? 'unauthorized (bad or missing Bearer token)'
      : 'server misconfigured (CRON_SECRET not set)'
    : null;
  const runId = await traceCronRun(auth === null, authDetail);
  if (auth) {
    // authDetail is non-null exactly when auth is; re-stamp the same detail
    // plus the logs (usually empty on this path).
    await finishCronTrace(runId, authDetail ?? 'rejected', tickLogs.text());
    return auth;
  }

  try {
    // The UTC hour this tick belongs to; getUsersDueForReport converts it to
    // each user's local hour (and local weekday, for weekly users) in SQL.
    const currentUtcHour = new Date().getUTCHours();
    const dueUsers = await getUsersDueForReport(currentUtcHour);
    tickLogs.log("Number of users due: "+dueUsers.length+" for currentUtcHour "+currentUtcHour+".");

    if (dueUsers.length > 0) {
      // Self-call to the /api/generate worker — via the PRODUCTION ALIAS, not
      // the request's own host: inside a Vercel function, request.url carries
      // the deployment's UNIQUE URL (e.g. panorist-abc123-you.vercel.app),
      // which Deployment Protection guards with Vercel Authentication even
      // in production — fetching it yields 401 "Protected deployment" (the
      // SSO page) instead of invoking the worker. VERCEL_PROJECT_PRODUCTION_URL
      // (injected automatically on Vercel) is the unprotected production
      // alias; locally (next dev) it's absent and we fall back to the
      // request's own origin, which is the dev server.
      const productionDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL?.replace(
        /^https?:\/\//,
        '',
      );
      const origin = productionDomain
        ? `https://${productionDomain}`
        : new URL(request.url).origin;

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
              tickLogs.log(
                  `[api/cron] Calling /api/generate for user ${user.id}.`
              )
              const res = await fetch(`${origin}/api/generate`, {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  // The worker route's own guard (it spends LLM money).
                  'x-cron-secret': process.env.CRON_SECRET!,
                },
                body: JSON.stringify({ userId: user.id }),
              });
              if (res.ok) {
                succeeded += 1;
                tickLogs.log(
                    `[api/cron] /api/generate for user ${user.id} succeeded`
                )
              } else {
                failed += 1;
                // Body is the worker's fixed error string — safe to log.
                tickLogs.error(
                  `[api/cron] /api/generate for user ${user.id} ` +
                    `returned ${res.status}: ${await res.text()}`,
                );
              }
            } catch (err) {
              failed += 1;
              tickLogs.error(`[api/cron] /api/generate for user ${user.id} threw`, err);
            }
          }),
        );
      }

      await finishCronTrace(
        runId,
        `processed=${dueUsers.length} succeeded=${succeeded} failed=${failed}`,
        tickLogs.text(),
      );
      return Response.json({ processed: dueUsers.length, succeeded, failed });
    }

    // Nobody due this hour — still 200 so the cron doesn't look failing.
    await finishCronTrace(
      runId,
      `no users due (currentUtcHour=${currentUtcHour})`,
      tickLogs.text(),
    );
    return Response.json({ processed: 0, succeeded: 0, failed: 0 });
  } catch (err) {
    tickLogs.error('[api/cron] failed', err);
    await finishCronTrace(
      runId,
      `internal error: ${err instanceof Error ? err.message : String(err)}`,
      tickLogs.text(),
    );
    return jsonError(500, 'internal error');
  }
}
