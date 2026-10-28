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

-- Per-FREQUENCY category subscriptions: each user independently picks which
-- categories go into their DAILY report and which into their WEEKLY one. A
-- category may appear in both lists, in exactly one, or in neither; every
-- generated report covers exactly ONE frequency (never mixed), and on the
-- user's local Monday an eligible user gets TWO separate reports (the daily
-- one plus the weekly one) — both delivered at the same global delivery_hour.
--
-- Both lists empty is a valid, intentionally allowed "paused" state: the DB
-- imposes no non-emptiness CHECK (the app layer is where that rule lives, if
-- anywhere) and the cron simply never generates anything for such a user.
CREATE TABLE IF NOT EXISTS preferences (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Local wall-clock hour (0-23) in the user's timezone — ONE global delivery
  -- time per user for both frequencies.
  delivery_hour smallint NOT NULL DEFAULT 8 CHECK (delivery_hour BETWEEN 0 AND 23),
  -- Categories in the daily report. Only the prototype's fixed slugs are allowed.
  daily_categories text[] NOT NULL DEFAULT '{}'
    CONSTRAINT preferences_daily_categories_check
    CHECK (daily_categories <@ ARRAY['world','asia_pacific','hong_kong','economics','sport','entertainment','lifestyle','technology']),
  -- Categories in the weekly (local Monday) report. Same slug vocabulary.
  weekly_categories text[] NOT NULL DEFAULT '{}'
    CONSTRAINT preferences_weekly_categories_check
    CHECK (weekly_categories <@ ARRAY['world','asia_pacific','hong_kong','economics','sport','entertainment','lifestyle','technology']),
  -- Browser PushSubscription.toJSON() payload; consumed later by web-push.
  push_subscription jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Migration for databases created with the OLD single-frequency shape
-- (global `frequency` text + `categories` text[]). Idempotent: on a fresh
-- database every statement below is a no-op, and re-running after a
-- completed migration skips the guarded backfill (the old columns are gone).

-- 1) Add the two new list columns (no-op when the CREATE TABLE above already
--    made them; ADD COLUMN fills existing rows with the '{}' default).
ALTER TABLE preferences ADD COLUMN IF NOT EXISTS daily_categories text[] NOT NULL DEFAULT '{}';
ALTER TABLE preferences ADD COLUMN IF NOT EXISTS weekly_categories text[] NOT NULL DEFAULT '{}';

-- 2) ADD COLUMN can't carry a CHECK, so re-add the slug constraints the same
--    guarded way for migrated rows (fresh databases already have them inline
--    above — the name guard makes this a no-op there).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'preferences'::regclass
      AND conname = 'preferences_daily_categories_check'
  ) THEN
    ALTER TABLE preferences ADD CONSTRAINT preferences_daily_categories_check
      CHECK (daily_categories <@ ARRAY['world','asia_pacific','hong_kong','economics','sport','entertainment','lifestyle','technology']);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'preferences'::regclass
      AND conname = 'preferences_weekly_categories_check'
  ) THEN
    ALTER TABLE preferences ADD CONSTRAINT preferences_weekly_categories_check
      CHECK (weekly_categories <@ ARRAY['world','asia_pacific','hong_kong','economics','sport','entertainment','lifestyle','technology']);
  END IF;
END
$$;

-- 3) Backfill the new lists from the old global pair while it still exists:
--    old daily users keep their categories in daily_categories, old weekly
--    users in weekly_categories. Guarded so it runs at most once (the DROP
--    below removes the old columns, so the guard fails on every later run).
--    The UPDATEs run as dynamic SQL so they are only parsed when the branch
--    executes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'preferences'::regclass AND attname = 'frequency' AND NOT attisdropped
  ) AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'preferences'::regclass AND attname = 'categories' AND NOT attisdropped
  ) THEN
    EXECUTE 'UPDATE preferences SET daily_categories = categories WHERE frequency = ''daily''';
    EXECUTE 'UPDATE preferences SET weekly_categories = categories WHERE frequency = ''weekly''';
  END IF;
END
$$;

-- 4) Drop the old pair. Dropping `frequency` also drops the old
--    preferences_due_idx index (an index can't outlive its column).
ALTER TABLE preferences DROP COLUMN IF EXISTS frequency;
ALTER TABLE preferences DROP COLUMN IF EXISTS categories;

CREATE TABLE IF NOT EXISTS reports (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- App-defined kind; currently mirrors `frequency`, left free for future kinds.
  kind         text NOT NULL,
  -- The frequency this report was generated FOR ('daily' | 'weekly') — i.e.
  -- which of the user's per-frequency category lists it covers. It drives the
  -- prompt's time window ("today" vs "the 7 days ending today"), so it belongs
  -- on the stored report; a local-Monday tick can store TWO reports (one per
  -- frequency) for the same user.
  frequency    text NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  period_start timestamptz NOT NULL,
  period_end   timestamptz NOT NULL,
  -- Array of markdown-cache pointers: [{category, frequency, to}] — each
  -- resolves to one cached LLM markdown via markdown_cache (getReportMarkdown).
  content      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- LLM-response cache: one markdown per (category, frequency, to_date) —
-- frequency implies the window length (daily = that day, weekly = the 7 days
-- ending on to_date), so a from date would be redundant. Users sharing
-- category+window+frequency read the same row instead of each paying for an
-- LLM call. A category in BOTH of a user's lists naturally gets two distinct
-- cache rows (daily key and weekly key). Not a source of truth, but stored
-- reports POINT at it, so don't truncate casually.
CREATE TABLE IF NOT EXISTS markdown_cache (
  category    text NOT NULL
    CHECK (category IN ('world','asia_pacific','hong_kong','economics','sport','entertainment','lifestyle','technology')),
  frequency   text NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  to_date     date NOT NULL,
  markdown    text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category, frequency, to_date)
);

-- Report list view: "recent reports for user, newest first".
CREATE INDEX IF NOT EXISTS reports_user_created_idx ON reports (user_id, created_at DESC);

-- "Who is due now" lookups filter by delivery_hour (the cron handler resolves
-- timezones to concrete hour values before querying, making it a constant).
-- The old shape was (frequency, delivery_hour): frequency is no longer a
-- per-user column — one user can be due for a daily report, a weekly one, or
-- both on a local Monday — so the hour alone carries the index.
CREATE INDEX IF NOT EXISTS preferences_due_idx ON preferences (delivery_hour);