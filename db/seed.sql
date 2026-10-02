-- Idempotent seed (upserts): one test user with daily 08:00 preferences.
WITH u AS (
  INSERT INTO users (email, timezone)
  VALUES ('test@example.com', 'Asia/Hong_Kong')
  ON CONFLICT (email) DO UPDATE SET timezone = EXCLUDED.timezone
  RETURNING id
)
INSERT INTO preferences (user_id, frequency, delivery_hour, categories, push_subscription)
SELECT u.id, 'daily', 8, ARRAY['hong_kong', 'world', 'economics'], NULL
FROM u
ON CONFLICT (user_id) DO UPDATE SET
  frequency         = EXCLUDED.frequency,
  delivery_hour     = EXCLUDED.delivery_hour,
  categories        = EXCLUDED.categories,
  push_subscription = EXCLUDED.push_subscription,
  updated_at        = now();
