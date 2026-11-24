-- AI insights: highlights ("All I need to know" events, "Tell me more"
-- terms), shared explanations, the per-user library and usage quotas. See
-- ARCHITECTURE.md "AI insights".

-- Entitlements: PLAN_FEATURES / PLAN_LIMITS in packages/core/src/features.ts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
  CONSTRAINT users_plan_check CHECK (plan IN ('free', 'premium'));

-- AI-detected highlights for one shared markdown section:
-- [{kind, surface, key, displayName}]. One LLM call per section, shared by
-- every reader of it.
CREATE TABLE IF NOT EXISTS markdown_annotations (
  category       text NOT NULL,
  frequency      text NOT NULL,
  to_date        date NOT NULL,
  annotations    jsonb NOT NULL,
  model          text NOT NULL,
  prompt_version smallint NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category, frequency, to_date),
  FOREIGN KEY (category, frequency, to_date)
    REFERENCES markdown_cache (category, frequency, to_date) ON DELETE CASCADE
);

-- isKnownTarget checks a requested target against stored highlights.
CREATE INDEX IF NOT EXISTS markdown_annotations_gin_idx
  ON markdown_annotations USING gin (annotations jsonb_path_ops);

-- Normalized text (normalizeSelection) → canonical key, so different
-- spellings of one thing share an explanation. Filled from highlights and
-- from classifying readers' selections; 'reject' caches "nothing to explain".
CREATE TABLE IF NOT EXISTS insight_aliases (
  surface_norm  text PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('event', 'term', 'reject')),
  canonical_key text,
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'reject' OR (canonical_key IS NOT NULL AND display_name IS NOT NULL))
);

-- Shared explanations, one per (kind, key, freshness bucket, prompt version).
-- Events use a Hong Kong date bucket (refreshed daily); terms are long-lived.
-- A 'pending' row is a generation claim, so concurrent readers make one call.
CREATE TABLE IF NOT EXISTS ai_explanations (
  id             bigserial PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('event', 'term')),
  canonical_key  text NOT NULL,
  bucket         text NOT NULL,
  prompt_version smallint NOT NULL,
  display_name   text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  markdown       text,
  model          text,
  claimed_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, canonical_key, bucket, prompt_version),
  CHECK (status <> 'ready' OR markdown IS NOT NULL)
);

-- A user's library: pointers to the explanations they opened, with a star.
CREATE TABLE IF NOT EXISTS user_insights (
  id             bigserial PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  explanation_id bigint NOT NULL REFERENCES ai_explanations(id),
  report_id      bigint REFERENCES reports(id) ON DELETE SET NULL,
  source_text    text,
  starred_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, explanation_id)
);

CREATE INDEX IF NOT EXISTS user_insights_user_idx ON user_insights (user_id, id DESC);
CREATE INDEX IF NOT EXISTS user_insights_starred_idx
  ON user_insights (user_id, id DESC) WHERE starred_at IS NOT NULL;

-- Uncached AI calls per user per Hong Kong day (PLAN_LIMITS). Safe to prune.
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     date NOT NULL,
  calls   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS ai_usage_day_idx ON ai_usage (day);
