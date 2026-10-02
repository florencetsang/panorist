-- Panorist prototype schema (three tables only).
-- Idempotent: safe to re-run via `npm run db:setup`.

-- gen_random_uuid() is built into Postgres 13+; pgcrypto covers older servers
-- (and is a no-op to enable on Neon), so user ids can default to it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE,
  -- IANA timezone name; we never do offset math in app code, we hand it to Postgres.
  timezone   text NOT NULL DEFAULT 'Asia/Hong_Kong',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS preferences (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  frequency  text NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  -- Local wall-clock hour (0-23) in the user's timezone.
  delivery_hour smallint NOT NULL DEFAULT 8 CHECK (delivery_hour BETWEEN 0 AND 23),
  -- Only the prototype's fixed category slugs are allowed.
  categories text[] NOT NULL DEFAULT '{}'
    CHECK (categories <@ ARRAY['world','asia_pacific','hong_kong','economics','sport','entertainment','lifestyle']),
  -- Browser PushSubscription.toJSON() payload; consumed later by web-push.
  push_subscription jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- App-defined kind; currently the user's frequency ('daily' | 'weekly').
  kind         text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end   timestamptz NOT NULL,
  -- Array of topics: [{category, headline, body, sources:[{title,url}]}]
  content      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Report list view: "recent reports for user, newest first".
CREATE INDEX IF NOT EXISTS reports_user_created_idx ON reports (user_id, created_at DESC);

-- "Who is due now" lookups filter by frequency + delivery_hour (the cron handler resolves
-- timezones to concrete hour values before querying, making these constants).
CREATE INDEX IF NOT EXISTS preferences_due_idx ON preferences (frequency, delivery_hour);
