/**
 * Fan out report generation to the /api/generate worker, one HTTP call per
 * user, so each user's run gets its own function time budget and logs.
 *
 * The cron's own budget is finite, so dispatch is deadline-aware: no new call
 * starts after the deadline, and in-flight calls stop being awaited at it
 * (the worker may still finish server-side; a retry is safe because saving
 * a report is idempotent).
 */

import { mapLimit } from '../util/async.ts';
import type { TickLogger } from './tick-logger.ts';

export interface DispatchOptions {
  /** Origin hosting /api/generate. */
  origin: string;
  secret: string;
  concurrency: number;
  /** Epoch ms after which no call starts and none is awaited. */
  deadline: number;
  logger: TickLogger;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface DispatchSummary {
  processed: number;
  succeeded: number;
  failed: number;
  /** Not started because the deadline had passed. */
  skipped: number;
}

type Outcome = 'succeeded' | 'failed' | 'skipped';

export async function dispatchReportJobs(
  userIds: readonly string[],
  {
    origin,
    secret,
    concurrency,
    deadline,
    logger,
    fetchImpl = fetch,
    now = Date.now,
  }: DispatchOptions,
): Promise<DispatchSummary> {
  const outcomes = await mapLimit(userIds, concurrency, async (userId): Promise<Outcome> => {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      logger.error(`[cron] /api/generate for user ${userId} skipped — cron deadline reached`);
      return 'skipped';
    }
    try {
      logger.log(`[cron] calling /api/generate for user ${userId}`);
      const res = await fetchImpl(`${origin}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-cron-secret': secret },
        body: JSON.stringify({ userId }),
        signal: AbortSignal.timeout(remainingMs),
      });
      if (res.ok) {
        logger.log(`[cron] /api/generate for user ${userId} succeeded`);
        return 'succeeded';
      }
      // The body is the worker's fixed error string — safe to log.
      logger.error(
        `[cron] /api/generate for user ${userId} returned ${res.status}: ${await res.text()}`,
      );
      return 'failed';
    } catch (err) {
      logger.error(`[cron] /api/generate for user ${userId} threw`, err);
      return 'failed';
    }
  });

  const count = (outcome: Outcome) => outcomes.filter((o) => o === outcome).length;
  return {
    processed: userIds.length,
    succeeded: count('succeeded'),
    failed: count('failed'),
    skipped: count('skipped'),
  };
}
