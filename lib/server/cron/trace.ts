/**
 * Best-effort wrappers around cron_runs: a tracing failure (missing table,
 * DB hiccup) must never fail the cron tick itself.
 */

import 'server-only';

import { finishCronRun, saveCronRun } from '../db/cron-runs.ts';

export async function startTrace(authOk: boolean, detail: string | null): Promise<string | null> {
  try {
    return await saveCronRun(authOk, detail);
  } catch (err) {
    console.error('[cron] failed to record the invocation in cron_runs', err);
    return null;
  }
}

export async function finishTrace(
  runId: string | null,
  detail: string,
  logs: string | null,
): Promise<void> {
  if (runId === null) return;
  try {
    await finishCronRun(runId, detail, logs);
  } catch (err) {
    console.error('[cron] failed to stamp the invocation outcome', err);
  }
}
