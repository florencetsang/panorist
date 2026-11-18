-- Per-report read status. NULL = unread; set when the user opens the report
-- and cleared by "mark unread". Existing reports start unread.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS read_at timestamptz;
