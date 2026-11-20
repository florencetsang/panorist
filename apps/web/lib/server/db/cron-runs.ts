/**
 * cron_runs: one diagnostic row per /api/cron invocation. The Vercel Hobby
 * plan has no runtime logs, so this is how ticks are verified from outside.
 */

import 'server-only';

import { db } from './client.ts';

/** Returns the new row id. */
export async function saveCronRun(authOk: boolean, detail: string | null): Promise<string> {
  const rows = await db()`
    INSERT INTO cron_runs (auth_ok, detail)
    VALUES (${authOk}, ${detail})
    RETURNING id
  `;
  return (rows[0] as { id: string }).id;
}

export async function finishCronRun(
  id: string,
  detail: string,
  logs: string | null,
): Promise<void> {
  await db()`
    UPDATE cron_runs SET detail = ${detail}, logs = ${logs}
    WHERE id = ${id}
  `;
}
