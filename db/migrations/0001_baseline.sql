-- Baseline schema. Databases created before the migration runner existed are
-- detected by scripts/migrate.mjs and have this file marked as applied.
--
-- Category slugs in the CHECKs must match CATEGORY_SLUGS in
-- lib/shared/categories.ts (a unit test enforces this).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE,
  -- IANA name; all offset math happens in Postgres.
  timezone   text NOT NULL DEFAULT 'Asia/Hong_Kong',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Independent daily and weekly (local Monday) category lists, one delivery
-- hour for both. Both lists empty = paused.
CREATE TABLE IF NOT EXISTS preferences (
  user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  delivery_hour     smallint NOT NULL DEFAULT 8 CHECK (delivery_hour BETWEEN 0 AND 23),
  daily_categories  text[] NOT NULL DEFAULT '{}'
    CONSTRAINT preferences_daily_categories_check
    CHECK (daily_categories <@ ARRAY['world','asia_pacific','hong_kong','economics','sport','entertainment','lifestyle','technology']),
  weekly_categories text[] NOT NULL DEFAULT '{}'
    CONSTRAINT preferences_weekly_categories_check
    CHECK (weekly_categories <@ ARRAY['world','asia_pacific','hong_kong','economics','sport','entertainment','lifestyle','technology']),
  -- Browser PushSubscription.toJSON() payload.
  push_subscription jsonb,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS preferences_due_idx ON preferences (delivery_hour);

CREATE TABLE IF NOT EXISTS reports (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Currently mirrors frequency; free for future report kinds.
  kind         text NOT NULL,
  frequency    text NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  period_start timestamptz NOT NULL,
  period_end   timestamptz NOT NULL,
  -- Pointers into markdown_cache: [{category, frequency, to}].
  content      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reports_user_created_idx ON reports (user_id, created_at DESC);

-- Shared LLM output, one row per (category, frequency, to_date). Reports point
-- here, so don't truncate it casually.
CREATE TABLE IF NOT EXISTS markdown_cache (
  category   text NOT NULL
    CHECK (category IN ('world','asia_pacific','hong_kong','economics','sport','entertainment','lifestyle','technology')),
  frequency  text NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  to_date    date NOT NULL,
  markdown   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category, frequency, to_date)
);

-- Diagnostic trace of /api/cron invocations (see ARCHITECTURE.md). Safe to truncate.
CREATE TABLE IF NOT EXISTS cron_runs (
  id         bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  auth_ok    boolean NOT NULL,
  detail     text,
  logs       text
);
