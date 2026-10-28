-- Idempotent seed (upserts): one test user, delivery 08:00 Asia/Hong_Kong.
-- Per-frequency lists: DAILY = world + economics, WEEKLY = hong_kong (see
-- db/schema.sql — a category may sit in either list, both, or neither).
WITH u AS (
  INSERT INTO users (email, timezone)
  VALUES ('test@example.com', 'Asia/Hong_Kong')
  ON CONFLICT (email) DO UPDATE SET timezone = EXCLUDED.timezone
  RETURNING id
)
INSERT INTO preferences (user_id, delivery_hour, daily_categories, weekly_categories, push_subscription)
SELECT u.id, 8, ARRAY['world', 'economics'], ARRAY['hong_kong'], NULL
FROM u
ON CONFLICT (user_id) DO UPDATE SET
  delivery_hour     = EXCLUDED.delivery_hour,
  daily_categories  = EXCLUDED.daily_categories,
  weekly_categories = EXCLUDED.weekly_categories,
  push_subscription = EXCLUDED.push_subscription,
  updated_at        = now();