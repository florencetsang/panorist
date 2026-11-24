import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApi } from '../src/api.ts';

function fakeFetch(status: number, body: unknown = {}) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(status === 204 ? null : JSON.stringify(body), { status }),
  );
}

describe('createApi', () => {
  it('sends auth headers and JSON bodies to the base URL', async () => {
    const fetch = fakeFetch(200, { reportId: 'r1', readAt: null });
    const api = createApi({
      baseUrl: 'https://panorist.test/',
      getAuthHeaders: async () => ({ authorization: 'Bearer t' }),
      fetch,
    });
    await api.setReportRead('r1', false);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://panorist.test/api/reports');
    expect(init?.method).toBe('PATCH');
    expect(init?.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer t',
    });
    expect(JSON.parse(String(init?.body))).toEqual({ reportId: 'r1', read: false });
  });

  it('reports 401s and throws ApiError with the status', async () => {
    const onUnauthorized = vi.fn();
    const api = createApi({ fetch: fakeFetch(401), onUnauthorized });
    const err = await api.getReports().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('encodes ids in paths', async () => {
    const fetch = fakeFetch(200, {});
    await createApi({ fetch }).getReport('a/b');
    expect(fetch.mock.calls[0][0]).toBe('/api/reports/a%2Fb');
  });

  it('explain polls while the explanation is pending, then gives up with 504', async () => {
    const replies = [202, 202, 200];
    const fetch = vi.fn(async () => {
      const status = replies.shift() ?? 202;
      return new Response(JSON.stringify(status === 200 ? { id: 'i1' } : { status: 'pending' }), {
        status,
      });
    });
    const api = createApi({ fetch });
    const input = { kind: 'term' as const, key: 'cpi', displayName: 'CPI' };
    await expect(api.explain(input, { intervalMs: 0, maxAttempts: 5 })).resolves.toEqual({
      id: 'i1',
    });
    expect(fetch).toHaveBeenCalledTimes(3);

    const err = await api.explain(input, { intervalMs: 0, maxAttempts: 2 }).catch((e) => e);
    expect((err as ApiError).status).toBe(504);
  });
});
