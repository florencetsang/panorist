-- One report per (user, frequency, period): makes report generation
-- idempotent when a cron tick or /api/generate call is retried.
-- saveReport() relies on this index for ON CONFLICT.

-- Keep the earliest of any existing duplicates.
DELETE FROM reports r
USING reports keep
WHERE r.user_id = keep.user_id
  AND r.frequency = keep.frequency
  AND r.period_start = keep.period_start
  AND r.period_end = keep.period_end
  AND r.id > keep.id;

CREATE UNIQUE INDEX IF NOT EXISTS reports_user_period_uidx
  ON reports (user_id, frequency, period_start, period_end);
