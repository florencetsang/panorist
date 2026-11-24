/**
 * AI insights storage: section highlights, selection aliases, shared
 * explanations (with generation claims), the per-user library and usage.
 * The stores implement the interfaces the insight services depend on.
 */

import 'server-only';

import { INSIGHT_PAGE_SIZE, isAnnotation } from '@panorist/core/insights';
import type { Annotation, Insight, InsightKind, MarkdownCacheKey } from '@panorist/core/types';
import type { AnnotationStore } from '../insights/annotate.ts';
import type {
  ExplanationIdentity,
  ExplanationStore,
  StoredExplanation,
} from '../insights/explain.ts';
import type { AliasStore, ResolvedAlias } from '../insights/resolve.ts';
import { db } from './client.ts';

/** A pending claim older than this is treated as abandoned (crashed or timed-out worker). */
const STALE_CLAIM_SECONDS = 150;

// ---------------------------------------------------------------------------
// Section highlights
// ---------------------------------------------------------------------------

export const dbAnnotationStore: AnnotationStore = {
  async has(key: MarkdownCacheKey): Promise<boolean> {
    const rows = await db()`
      SELECT 1 FROM markdown_annotations
      WHERE category = ${key.category} AND frequency = ${key.frequency} AND to_date = ${key.to}
    `;
    return rows.length > 0;
  },

  /**
   * First writer wins. Each highlight also seeds the alias table, so a
   * reader selecting the same words later lands on the same explanation
   * without a classification call.
   */
  async save(key, annotations, model, promptVersion, aliases): Promise<void> {
    await db().transaction((sql) => [
      sql`
        INSERT INTO markdown_annotations (category, frequency, to_date, annotations, model, prompt_version)
        VALUES (${key.category}, ${key.frequency}, ${key.to}, ${JSON.stringify(annotations)}::jsonb,
                ${model}, ${promptVersion})
        ON CONFLICT (category, frequency, to_date) DO NOTHING
      `,
      sql`
        INSERT INTO insight_aliases (surface_norm, kind, canonical_key, display_name)
        SELECT a->>'norm', a->>'kind', a->>'key', a->>'displayName'
        FROM jsonb_array_elements(${JSON.stringify(aliases)}::jsonb) AS a
        ON CONFLICT (surface_norm) DO NOTHING
      `,
    ]);
  },
};

/** Highlights across one of the user's reports (for nudging selection lookups toward known keys). */
export async function getReportAnnotations(
  userId: string,
  reportId: string,
): Promise<Annotation[]> {
  const rows = await db()`
    SELECT ma.annotations
    FROM reports r
    CROSS JOIN LATERAL jsonb_array_elements(r.content) AS item
    JOIN markdown_annotations ma
      ON ma.category = item->>'category'
     AND ma.frequency = item->>'frequency'
     AND ma.to_date = (item->>'to')::date
    WHERE r.id = ${reportId}::bigint AND r.user_id = ${userId}
  `;
  return (rows as { annotations: unknown }[]).flatMap((row) =>
    Array.isArray(row.annotations) ? row.annotations.filter(isAnnotation) : [],
  );
}

// ---------------------------------------------------------------------------
// Selection aliases
// ---------------------------------------------------------------------------

export const dbAliasStore: AliasStore = {
  async get(surfaceNorm: string): Promise<ResolvedAlias | null> {
    const rows = await db()`
      SELECT kind, canonical_key AS key, display_name AS "displayName"
      FROM insight_aliases WHERE surface_norm = ${surfaceNorm}
    `;
    const row = rows[0] as
      { kind: InsightKind | 'reject'; key: string | null; displayName: string | null } | undefined;
    if (!row) return null;
    if (row.kind === 'reject') return { kind: 'reject' };
    return { kind: row.kind, key: row.key as string, displayName: row.displayName as string };
  },

  async save(surfaceNorm: string, alias: ResolvedAlias): Promise<void> {
    const isReject = alias.kind === 'reject';
    await db()`
      INSERT INTO insight_aliases (surface_norm, kind, canonical_key, display_name)
      VALUES (${surfaceNorm}, ${alias.kind}, ${isReject ? null : alias.key},
              ${isReject ? null : alias.displayName})
      ON CONFLICT (surface_norm) DO NOTHING
    `;
  },
};

// ---------------------------------------------------------------------------
// Shared explanations
// ---------------------------------------------------------------------------

/**
 * The one trusted name for a server-produced key: the earliest highlight's
 * name, else the earliest resolved selection's. Null when the server never
 * produced this key. Explanations are shared across users, so they are
 * generated from this name — never from whatever name a client sends.
 */
export async function canonicalDisplayName(kind: InsightKind, key: string): Promise<string | null> {
  const rows = await db()`
    SELECT name FROM (
      SELECT a->>'displayName' AS name, 0 AS rank, ma.created_at
      FROM markdown_annotations ma
      CROSS JOIN LATERAL jsonb_array_elements(ma.annotations) AS a
      WHERE ma.annotations @> ${JSON.stringify([{ kind, key }])}::jsonb
        AND a->>'kind' = ${kind} AND a->>'key' = ${key}
      UNION ALL
      SELECT display_name, 1, created_at
      FROM insight_aliases
      WHERE kind = ${kind} AND canonical_key = ${key}
    ) AS candidates
    ORDER BY rank, created_at
    LIMIT 1
  `;
  return (rows[0] as { name: string } | undefined)?.name ?? null;
}

const EXPLANATION_COLUMNS = `
  id, kind, canonical_key AS key, display_name AS "displayName", status, markdown, model,
  created_at AS "generatedAt"
`;

export const dbExplanationStore: ExplanationStore = {
  async find(identity: ExplanationIdentity): Promise<StoredExplanation | null> {
    const rows = await db()`
      SELECT ${db().unsafe(EXPLANATION_COLUMNS)} FROM ai_explanations
      WHERE kind = ${identity.kind} AND canonical_key = ${identity.key}
        AND bucket = ${identity.bucket} AND prompt_version = ${identity.promptVersion}
    `;
    return (rows[0] as StoredExplanation | undefined) ?? null;
  },

  /**
   * Take the generation claim: insert a pending row, or take over a failed
   * or stale pending one. Null when another request holds a live claim or
   * the explanation is already ready.
   */
  async claim(identity: ExplanationIdentity, displayName: string): Promise<string | null> {
    const rows = await db()`
      INSERT INTO ai_explanations (kind, canonical_key, bucket, prompt_version, display_name)
      VALUES (${identity.kind}, ${identity.key}, ${identity.bucket}, ${identity.promptVersion},
              ${displayName})
      ON CONFLICT (kind, canonical_key, bucket, prompt_version) DO UPDATE
        SET status = 'pending', claimed_at = now()
        WHERE ai_explanations.status = 'failed'
           OR (ai_explanations.status = 'pending'
               AND ai_explanations.claimed_at < now() - make_interval(secs => ${STALE_CLAIM_SECONDS}))
      RETURNING id
    `;
    return (rows[0] as { id: string } | undefined)?.id ?? null;
  },

  async complete(id: string, markdown: string, model: string): Promise<StoredExplanation> {
    const rows = await db()`
      UPDATE ai_explanations
      SET status = 'ready', markdown = ${markdown}, model = ${model}, created_at = now()
      WHERE id = ${id}::bigint
      RETURNING ${db().unsafe(EXPLANATION_COLUMNS)}
    `;
    return rows[0] as StoredExplanation;
  },

  async fail(id: string): Promise<void> {
    await db()`UPDATE ai_explanations SET status = 'failed' WHERE id = ${id}::bigint AND status = 'pending'`;
  },
};

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

const INSIGHT_COLUMNS = `
  ui.id, e.kind, e.canonical_key AS key, e.display_name AS "displayName", e.markdown,
  e.created_at AS "generatedAt", ui.report_id AS "reportId", ui.source_text AS "sourceText",
  ui.starred_at AS "starredAt", ui.created_at AS "savedAt"
`;

/**
 * Add an explanation to the user's library (idempotent). `reportId` is kept
 * only when it is the user's own report.
 */
export async function saveUserInsight(
  userId: string,
  explanationId: string,
  reportId: string | null,
  sourceText: string | null,
): Promise<Insight> {
  const rows = await db()`
    WITH ui AS (
      INSERT INTO user_insights (user_id, explanation_id, report_id, source_text)
      VALUES (${userId}, ${explanationId}::bigint,
              (SELECT id FROM reports WHERE id = ${reportId}::bigint AND user_id = ${userId}),
              ${sourceText})
      ON CONFLICT (user_id, explanation_id) DO UPDATE
        SET report_id = COALESCE(user_insights.report_id, EXCLUDED.report_id),
            source_text = COALESCE(user_insights.source_text, EXCLUDED.source_text)
      RETURNING *
    )
    SELECT ${db().unsafe(INSIGHT_COLUMNS)}
    FROM ui JOIN ai_explanations e ON e.id = ui.explanation_id
  `;
  return rows[0] as Insight;
}

/** Newest first, a page at a time; `before` is the last id of the previous page. */
export async function listUserInsights(
  userId: string,
  options: { starred: boolean; before: string | null },
  limit = INSIGHT_PAGE_SIZE,
): Promise<Insight[]> {
  const rows = await db()`
    SELECT ${db().unsafe(INSIGHT_COLUMNS)}
    FROM user_insights ui JOIN ai_explanations e ON e.id = ui.explanation_id
    WHERE ui.user_id = ${userId}
      AND (${!options.starred}::boolean OR ui.starred_at IS NOT NULL)
      AND (${options.before}::bigint IS NULL OR ui.id < ${options.before}::bigint)
    ORDER BY ui.id DESC
    LIMIT ${limit}
  `;
  return rows as Insight[];
}

export async function getUserInsight(userId: string, id: string): Promise<Insight | null> {
  const rows = await db()`
    SELECT ${db().unsafe(INSIGHT_COLUMNS)}
    FROM user_insights ui JOIN ai_explanations e ON e.id = ui.explanation_id
    WHERE ui.id = ${id}::bigint AND ui.user_id = ${userId}
  `;
  return (rows[0] as Insight | undefined) ?? null;
}

/** Starring keeps the first `starred_at`. Null when the user has no such insight. */
export async function setUserInsightStarred(
  userId: string,
  id: string,
  starred: boolean,
): Promise<Insight | null> {
  const rows = await db()`
    WITH ui AS (
      UPDATE user_insights
      SET starred_at = CASE WHEN ${starred}::boolean THEN COALESCE(starred_at, now()) ELSE NULL END
      WHERE id = ${id}::bigint AND user_id = ${userId}
      RETURNING *
    )
    SELECT ${db().unsafe(INSIGHT_COLUMNS)}
    FROM ui JOIN ai_explanations e ON e.id = ui.explanation_id
  `;
  return (rows[0] as Insight | undefined) ?? null;
}

export async function deleteUserInsight(userId: string, id: string): Promise<boolean> {
  const rows = await db()`
    DELETE FROM user_insights WHERE id = ${id}::bigint AND user_id = ${userId} RETURNING id
  `;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Usage quota
// ---------------------------------------------------------------------------

/**
 * Count one uncached AI call against the user's daily limit and the optional
 * global one, atomically. False (nothing counted) when either is reached.
 */
export async function consumeAiCall(
  userId: string,
  day: string,
  limit: number,
  globalLimit: number | null,
): Promise<boolean> {
  const rows = await db()`
    INSERT INTO ai_usage (user_id, day, calls)
    SELECT ${userId}, ${day}::date, 1
    WHERE ${globalLimit}::int IS NULL
       OR (SELECT COALESCE(sum(calls), 0) FROM ai_usage WHERE day = ${day}::date) < ${globalLimit}::int
    ON CONFLICT (user_id, day) DO UPDATE
      SET calls = ai_usage.calls + 1
      WHERE ai_usage.calls < ${limit}
    RETURNING calls
  `;
  return rows.length > 0;
}

export async function getAiCallsUsed(userId: string, day: string): Promise<number> {
  const rows =
    await db()`SELECT calls FROM ai_usage WHERE user_id = ${userId} AND day = ${day}::date`;
  return (rows[0] as { calls: number } | undefined)?.calls ?? 0;
}
