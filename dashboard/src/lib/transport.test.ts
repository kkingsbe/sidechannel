// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, request } from './transport';

afterEach(() => vi.restoreAllMocks());

it('prefixes /api, sends JSON and returns the parsed envelope', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_path: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    await expect(request('/runs?limit=1')).resolves.toEqual({ items: [], total: 0 });
    expect(fetch.mock.calls[0]![0]).toBe('/api/runs?limit=1');
    expect(fetch.mock.calls[0]![1]?.headers).toEqual({ 'Content-Type': 'application/json' });
});

it('throws ApiError carrying status and payload, preferring the server error message', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ error: 'Codebook revision conflict' }), { status: 409 }));
    await expect(request('/codebooks/x')).rejects.toMatchObject({ name: 'ApiError', status: 409, message: 'Codebook revision conflict' });
    await expect(request('/codebooks/x')).rejects.toBeInstanceOf(ApiError);
});

it('falls back to a status message when the body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('<html>', { status: 502 }));
    await expect(request('/overview')).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' });
});
