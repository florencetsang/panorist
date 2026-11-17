/**
 * Typed browser client for the app's JSON API. One place for URLs, request
 * encoding and error handling, so components only deal in data.
 */

import type {
  HydratedReportWire,
  PreferencesPatch,
  PushSubscriptionJSON,
  ReportReadStatusWire,
  UserWithPreferencesWire,
} from '../shared/types.ts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok)
    throw new ApiError(res.status, `${method} ${path.split('?')[0]} answered ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const withUser = (path: string, userId: string, extra = '') =>
  `${path}?userId=${encodeURIComponent(userId)}${extra}`;

export const api = {
  getReports: (userId: string) =>
    request<HydratedReportWire[]>('GET', withUser('/api/reports', userId, '&hydrate=1')),

  setReportRead: (userId: string, reportId: string, read: boolean) =>
    request<ReportReadStatusWire>('PATCH', '/api/reports', { userId, reportId, read }),

  getPreferences: (userId: string) =>
    request<UserWithPreferencesWire>('GET', withUser('/api/preferences', userId)),

  updatePreferences: (userId: string, patch: PreferencesPatch) =>
    request<UserWithPreferencesWire>('PATCH', '/api/preferences', { userId, patch }),

  getVapidPublicKey: async () =>
    (await request<{ publicKey: string }>('GET', '/api/push/subscribe')).publicKey,

  savePushSubscription: (userId: string, subscription: PushSubscriptionJSON) =>
    request<void>('POST', '/api/push/subscribe', { userId, subscription }),
};
