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
  HydratedReportWire,
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

export function createApi(options: ApiOptions = {}) {
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
    return (res.status === 204 ? undefined : await res.json()) as T;
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
  };
}

export type Api = ReturnType<typeof createApi>;
