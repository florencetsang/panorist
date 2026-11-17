-- Development seed: one test user (08:00 Asia/Hong_Kong). Insert-only, so
-- re-running never overwrites edited preferences. The id matches the
-- TEST_USER_ID fallback in lib/shared/user-id.ts.
WITH u AS (
  INSERT INTO users (id, email, timezone)
  VALUES ('b19d6a47-bc86-43da-b963-88da91383ea8', 'test@example.com', 'Asia/Hong_Kong')
  ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
  RETURNING id
)
INSERT INTO preferences (user_id, delivery_hour, daily_categories, weekly_categories)
SELECT u.id, 8, ARRAY['world', 'economics'], ARRAY['hong_kong']
FROM u
ON CONFLICT (user_id) DO NOTHING;
