/** Generated reports. `content` holds markdown_cache pointers, not markdown. */

import 'server-only';

import type { HydratedReport, Report, ReportDraft, ReportReadStatus } from '@panorist/core/types';
import { db } from './client.ts';

const REPORT_COLUMNS = `
  r.id, r.user_id AS "userId", r.kind, r.frequency,
  r.period_start AS "periodStart", r.period_end AS "periodEnd",
  r.content, r.created_at AS "createdAt", r.read_at AS "readAt"
`;

export interface SaveReportResult {
  id: string;
  /** False when an identical report (same user, frequency and period) already existed. */
  created: boolean;
}

/**
 * Insert a report, idempotently: a retried generation for the same user,
 * frequency and period returns the existing row instead of a duplicate.
 */
export async function saveReport(userId: string, draft: ReportDraft): Promise<SaveReportResult> {
  // Dates are bound as ISO strings: the HTTP driver JSON-encodes parameters.
  const inserted = await db()`
    INSERT INTO reports (user_id, kind, frequency, period_start, period_end, content)
    VALUES (${userId}, ${draft.kind}, ${draft.frequency},
            ${draft.periodStart.toISOString()}, ${draft.periodEnd.toISOString()},
            ${JSON.stringify(draft.content)}::jsonb)
    ON CONFLICT (user_id, frequency, period_start, period_end) DO NOTHING
    RETURNING id
  `;
  if (inserted.length > 0) return { id: (inserted[0] as { id: string }).id, created: true };

  const existing = await db()`
    SELECT id FROM reports
    WHERE user_id = ${userId} AND frequency = ${draft.frequency}
      AND period_start = ${draft.periodStart.toISOString()}
      AND period_end = ${draft.periodEnd.toISOString()}
  `;
  return { id: (existing[0] as { id: string }).id, created: false };
}

/** A user's recent reports, newest first. */
export async function getReportsForUser(userId: string, limit = 60): Promise<Report[]> {
  const rows = await db()`
    SELECT ${db().unsafe(REPORT_COLUMNS)}
    FROM reports r
    WHERE r.user_id = ${userId}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${limit}
  `;
  return rows as Report[];
}

/**
 * A report's pointers resolved into [{category, markdown, annotations}]; a
 * missing cache row yields '' and missing highlights []. Callers filter
 * annotations to the user's entitlements (lib/server/features.ts).
 */
const TOPICS_COLUMN = `
  COALESCE((
    SELECT jsonb_agg(
             jsonb_build_object(
               'category', item->>'category',
               'markdown', COALESCE(mc.markdown, ''),
               'annotations', COALESCE(ma.annotations, '[]'::jsonb)
             ) ORDER BY ord)
    FROM jsonb_array_elements(r.content) WITH ORDINALITY AS e(item, ord)
    LEFT JOIN markdown_cache mc
      ON mc.category = item->>'category'
     AND mc.frequency = item->>'frequency'
     AND mc.to_date = (item->>'to')::date
    LEFT JOIN markdown_annotations ma
      ON ma.category = mc.category
     AND ma.frequency = mc.frequency
     AND ma.to_date = mc.to_date
  ), '[]'::jsonb) AS topics
`;

/** Recent reports with their pointers resolved into renderable topics, in a single query. */
export async function getHydratedReportsForUser(
  userId: string,
  limit = 20,
): Promise<HydratedReport[]> {
  const rows = await db()`
    SELECT ${db().unsafe(REPORT_COLUMNS)}, ${db().unsafe(TOPICS_COLUMN)}
    FROM reports r
    WHERE r.user_id = ${userId}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${limit}
  `;
  return rows as HydratedReport[];
}

/** One of the user's reports with its topics; null when the user has no such report. */
export async function getHydratedReportForUser(
  userId: string,
  reportId: string,
): Promise<HydratedReport | null> {
  const rows = await db()`
    SELECT ${db().unsafe(REPORT_COLUMNS)}, ${db().unsafe(TOPICS_COLUMN)}
    FROM reports r
    WHERE r.id = ${reportId}::bigint AND r.user_id = ${userId}
  `;
  return (rows[0] as HydratedReport | undefined) ?? null;
}

/**
 * Mark one of the user's reports read or unread. Marking read keeps the first
 * `read_at`, so re-opening doesn't bump it. Null when the user has no such report.
 */
export async function setReportRead(
  userId: string,
  reportId: string,
  read: boolean,
): Promise<ReportReadStatus | null> {
  const rows = await db()`
    UPDATE reports
    SET read_at = CASE WHEN ${read}::boolean THEN COALESCE(read_at, now()) ELSE NULL END
    WHERE id = ${reportId}::bigint AND user_id = ${userId}
    RETURNING id, read_at AS "readAt"
  `;
  return (rows[0] as ReportReadStatus | undefined) ?? null;
}
