/**
 * Typed client for Panorist's JSON API, shared by the web and mobile apps.
 * One place for URLs, request encoding and error handling, so screens only
 * deal in data.
 *
 * Identity is never part of a request: the server derives the user from the
 * session cookie (web, same origin) or an `Authorization: Bearer <jwt>`
 * header (mobile, via `getAuthHeaders`).
 */

import type {
  FeaturesWire,
  HydratedReportWire,
  InsightRequest,
  InsightTarget,
  InsightWire,
  ReportWire,
  PreferencesPatch,
  PushSubscriptionJSON,
  ReportReadStatusWire,
  UserWithPreferencesWire,
} from './types.ts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  /** Origin of the web app, e.g. `https://panorist.app`. Empty = same origin (browser). */
  baseUrl?: string;
  /** Extra headers per request, e.g. a bearer token. May refresh it first. */
  getAuthHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
  /** Called on a 401 so the app can drop its session and show sign-in. */
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
}

/** How long `explain` waits for an explanation another request is generating. */
export interface ExplainPolling {
  intervalMs: number;
  maxAttempts: number;
}

const DEFAULT_POLLING: ExplainPolling = { intervalMs: 3_000, maxAttempts: 40 };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createApi(options: ApiOptions = {}) {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await requestWithStatus<T>(method, path, body)).data;
  }

  async function requestWithStatus<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.getAuthHeaders ? await options.getAuthHeaders() : {}),
    };
    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) options.onUnauthorized?.();
    if (!res.ok) {
      throw new ApiError(res.status, `${method} ${path.split('?')[0]} answered ${res.status}`);
    }
    return { status: res.status, data: (res.status === 204 ? undefined : await res.json()) as T };
  }

  return {
    /** Recent reports without their markdown (topics are the `content` pointers). */
    getReports: () => request<ReportWire[]>('GET', '/api/reports'),

    getReport: (reportId: string) =>
      request<HydratedReportWire>('GET', `/api/reports/${encodeURIComponent(reportId)}`),

    setReportRead: (reportId: string, read: boolean) =>
      request<ReportReadStatusWire>('PATCH', '/api/reports', { reportId, read }),

    getPreferences: () => request<UserWithPreferencesWire>('GET', '/api/preferences'),

    updatePreferences: (patch: PreferencesPatch) =>
      request<UserWithPreferencesWire>('PATCH', '/api/preferences', { patch }),

    getVapidPublicKey: async () =>
      (await request<{ publicKey: string }>('GET', '/api/push/subscribe')).publicKey,

    savePushSubscription: (subscription: PushSubscriptionJSON) =>
      request<void>('POST', '/api/push/subscribe', { subscription }),

    /** Permanently delete the signed-in account; the caller then drops its session. */
    deleteAccount: () => request<void>('DELETE', '/api/account'),

    /** The caller's plan, enabled AI features and today's AI allowance. */
    getFeatures: () => request<FeaturesWire>('GET', '/api/features'),

    /**
     * Classify a selection from one of the reader's briefings as an event or
     * a term. Throws ApiError 422 when there is nothing worth explaining.
     */
    resolveSelection: (text: string, reportId: string) =>
      request<InsightTarget>('POST', '/api/insights/resolve', { text, reportId }),

    /**
     * Get (or generate) the explanation for a highlight or resolved selection.
     * While another request is generating the same one the server answers
     * 202; this waits and asks again. Throws ApiError 429 at the daily limit.
     */
    explain: async (
      input: InsightRequest,
      polling: ExplainPolling = DEFAULT_POLLING,
    ): Promise<InsightWire> => {
      for (let attempt = 1; ; attempt++) {
        const { status, data } = await requestWithStatus<InsightWire>(
          'POST',
          '/api/insights',
          input,
        );
        if (status !== 202) return data;
        if (attempt >= polling.maxAttempts) {
          throw new ApiError(504, 'POST /api/insights is still generating');
        }
        await wait(polling.intervalMs);
      }
    },

    /** Saved insights, newest first; `before` is the last id of the previous page. */
    listInsights: (options: { starred?: boolean; before?: string } = {}) => {
      const query = new URLSearchParams();
      if (options.starred) query.set('starred', '1');
      if (options.before) query.set('before', options.before);
      const qs = query.toString();
      return request<InsightWire[]>('GET', `/api/insights${qs ? `?${qs}` : ''}`);
    },

    getInsight: (id: string) =>
      request<InsightWire>('GET', `/api/insights/${encodeURIComponent(id)}`),

    setInsightStarred: (id: string, starred: boolean) =>
      request<InsightWire>('PATCH', `/api/insights/${encodeURIComponent(id)}`, { starred }),

    /** Remove from the library; the shared explanation itself is kept. */
    deleteInsight: (id: string) =>
      request<void>('DELETE', `/api/insights/${encodeURIComponent(id)}`),
  };
}

export type Api = ReturnType<typeof createApi>;
