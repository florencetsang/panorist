/**
 * GET /api/cron — scheduler entry point, called by Vercel Cron (vercel.json)
 * with `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Finds users due this hour and fans out to /api/generate. Every invocation,
 * including rejected ones, leaves a cron_runs row (the Hobby plan has no
 * runtime logs); with CRON_DB_LOGS on, the tick's log lines are stored too.
 */

import { bearerToken, checkCronSecret, secretCheckResponse } from '../../../lib/server/auth.ts';
import { dispatchReportJobs } from '../../../lib/server/cron/dispatch.ts';
import { createTickLogger } from '../../../lib/server/cron/tick-logger.ts';
import { finishTrace, startTrace } from '../../../lib/server/cron/trace.ts';
import { getUsersDueForReport } from '../../../lib/server/db/users.ts';
import { env } from '../../../lib/server/env.ts';
import { jsonError } from '../../../lib/server/http.ts';
import { errorMessage } from '../../../lib/server/util/errors.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Max /api/generate calls in flight. */
const CONCURRENCY = 3;
/** Stop dispatching this long before maxDuration so the trace can still be written. */
const DEADLINE_MARGIN_MS = 20_000;

const REJECTION_DETAIL = {
  unauthorized: 'unauthorized (bad or missing Bearer token)',
  misconfigured: 'server misconfigured (CRON_SECRET not set)',
} as const;

export async function GET(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const logger = createTickLogger(env.cronDbLogs());

  const auth = checkCronSecret(bearerToken(request));
  if (auth !== 'ok') {
    await startTrace(false, REJECTION_DETAIL[auth]);
    return secretCheckResponse(auth, 'api/cron');
  }
  const runId = await startTrace(true, null);

  try {
    const tick = new Date(startedAt);
    const dueUsers = await getUsersDueForReport(tick);
    logger.log(`[cron] ${dueUsers.length} user(s) due at ${tick.toISOString()}`);

    if (dueUsers.length === 0) {
      await finishTrace(runId, `no users due (utcHour=${tick.getUTCHours()})`, logger.text());
      return Response.json({ processed: 0, succeeded: 0, failed: 0, skipped: 0 });
    }

    const summary = await dispatchReportJobs(
      dueUsers.map((user) => user.id),
      {
        // Never the request's own host: on Vercel that's the deployment's
        // unique URL, which Deployment Protection guards. Locally (no alias)
        // the request origin is the dev server.
        origin: env.productionOrigin() ?? new URL(request.url).origin,
        secret: env.cronSecret() as string,
        concurrency: CONCURRENCY,
        deadline: startedAt + maxDuration * 1000 - DEADLINE_MARGIN_MS,
        logger,
      },
    );
    await finishTrace(
      runId,
      `processed=${summary.processed} succeeded=${summary.succeeded} failed=${summary.failed} skipped=${summary.skipped}`,
      logger.text(),
    );
    return Response.json(summary);
  } catch (err) {
    logger.error('[cron] failed', err);
    await finishTrace(runId, `internal error: ${errorMessage(err)}`, logger.text());
    return jsonError(500, 'internal error');
  }
}
