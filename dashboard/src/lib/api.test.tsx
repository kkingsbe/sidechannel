// @vitest-environment jsdom
import React, { type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { RequesterProvider, useApi, useOffsetPage, usePage, usePageRequest } from './api';
import type { Requester } from './transport';

afterEach(cleanup);

/** A requester the test resolves by hand, one call at a time. */
function controlled() {
    const pending: { path: string; resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
    const request = vi.fn(<T,>(path: string) => new Promise<T>((resolve, reject) => {
        pending.push({ path, resolve: resolve as (value: unknown) => void, reject });
    }));
    return { request, pending, calls: () => request.mock.calls.map(call => call[0] as string) };
}

const wrapper = (request: ReturnType<typeof controlled>['request']) =>
    function Wrapper({ children }: { children: ReactNode }) {
        return <MemoryRouter initialEntries={['/?view=list']}><RequesterProvider value={request as Requester}>{children}</RequesterProvider></MemoryRouter>;
    };

describe('path-keyed useApi', () => {
    it('clears data the moment the path changes, before the new response arrives', async () => {
        const server = controlled();
        const { result, rerender } = renderHook(({ path }: { path: string }) => useApi<{ value: string }>(path), {
            wrapper: wrapper(server.request), initialProps: { path: '/runs/a' },
        });
        expect(result.current.loading).toBe(true);
        await act(async () => { server.pending.shift()!.resolve({ value: 'a' }); });
        expect(result.current.data).toEqual({ value: 'a' });
        expect(result.current.loading).toBe(false);
        rerender({ path: '/runs/b' });
        expect(result.current.data).toBeUndefined();
        expect(result.current.error).toBeUndefined();
        expect(result.current.loading).toBe(true);
    });

    it('ignores a stale response that resolves after the path changed', async () => {
        const server = controlled();
        const { result, rerender } = renderHook(({ path }: { path: string }) => useApi<string>(path), {
            wrapper: wrapper(server.request), initialProps: { path: '/runs/a' },
        });
        rerender({ path: '/runs/b' });
        await act(async () => { server.pending.shift()!.resolve('stale-a'); });
        expect(result.current.data).toBeUndefined();
        await act(async () => { server.pending.shift()!.resolve('fresh-b'); });
        expect(result.current.data).toBe('fresh-b');
    });

    it('keeps data for the current path when a refresh fails and reports the error', async () => {
        const server = controlled();
        const { result } = renderHook(() => useApi<string>('/runs/a'), { wrapper: wrapper(server.request) });
        await act(async () => { server.pending.shift()!.resolve('a'); });
        await act(async () => { void result.current.refresh(); });
        await act(async () => { server.pending.shift()!.reject(new Error('offline')); });
        expect(result.current.data).toBe('a');
        expect(result.current.error?.message).toBe('offline');
        expect(result.current.loading).toBe(false);
    });

    it('does not request anything for a null path', async () => {
        const server = controlled();
        const { result } = renderHook(() => useApi<string>(null), { wrapper: wrapper(server.request) });
        expect(server.request).not.toHaveBeenCalled();
        expect(result.current.loading).toBe(false);
        expect(result.current.data).toBeUndefined();
    });
});

describe('cursor usePage', () => {
    it('appends limit and after and refuses to advance past the last page', async () => {
        const server = controlled();
        const { result } = renderHook(() => usePage<{ id: string }>('/analyses', { limit: 30 }), { wrapper: wrapper(server.request) });
        await act(async () => { server.pending.shift()!.resolve({ items: [{ id: 'one' }], nextCursor: null }); });
        expect(server.calls()).toEqual(['/analyses?limit=30']);
        expect(result.current.page).toBe(0);
        expect(result.current.hasMore).toBe(false);
        act(() => { result.current.onChange(1); });
        expect(result.current.page).toBe(0);
        expect(server.request).toHaveBeenCalledTimes(1);
    });

    it('walks forward and backward through opaquely encoded cursors', async () => {
        const server = controlled();
        const { result } = renderHook(() => usePage<string>('/codebooks', { limit: 30 }), { wrapper: wrapper(server.request) });
        await act(async () => { server.pending.shift()!.resolve({ items: ['a'], nextCursor: 'cursor:1' }); });
        act(() => { result.current.onChange(1); });
        await act(async () => { server.pending.shift()!.resolve({ items: ['b'], nextCursor: 'cursor:2' }); });
        expect(server.calls().at(-1)).toBe('/codebooks?limit=30&after=cursor%3A1');
        expect(result.current.data).toEqual(['b']);
        act(() => { result.current.onChange(0); });
        await act(async () => { server.pending.shift()!.resolve({ items: ['a'], nextCursor: 'cursor:1' }); });
        expect(server.calls().at(-1)).toBe('/codebooks?limit=30');
        expect(result.current.page).toBe(0);
    });

    it('accepts a cursorKey without disturbing unrelated search parameters', async () => {
        const server = controlled();
        let search = '';
        function View() {
            const page = usePage<string>('/monitor-evaluations', { cursorKey: 'jobCursor', limit: 25 });
            const [params] = useSearchParams();
            search = params.toString();
            return <span>{page.page}</span>;
        }
        const { rerender } = renderHook(() => View(), { wrapper: wrapper(server.request) });
        await act(async () => { server.pending.shift()!.resolve({ items: ['a'], nextCursor: 'cursor-1' }); });
        expect(search).toBe('view=list');
        rerender();
        expect(search).toBe('view=list');
    });

    it('replaces the saved URL cursor chain and restores a page from it', async () => {
        const server = controlled();
        let pager: ReturnType<typeof usePage<string>> | undefined;
        function View() {
            pager = usePage<string>('/monitor-evaluations', { cursorKey: 'jobCursor', limit: 25 });
            return <span>{pager!.page}</span>;
        }
        renderHook(() => View(), { wrapper: wrapper(server.request) });        await act(async () => { server.pending.shift()!.resolve({ items: ['a'], nextCursor: 'cursor-1' }); });
        act(() => { pager!.onChange(1); });
        await act(async () => { server.pending.shift()!.resolve({ items: ['b'], nextCursor: null }); });
        expect(server.calls().at(-1)).toBe('/monitor-evaluations?limit=25&after=cursor-1');
        expect(pager!.hasMore).toBe(false);
        expect(pager!.page).toBe(1);
    });

    it('resets to the first page when the path changes', async () => {
        const server = controlled();
        const { result, rerender } = renderHook(({ path }: { path: string }) => usePage<string>(path, { limit: 25 }), {
            wrapper: wrapper(server.request), initialProps: { path: '/monitor-evaluations' },
        });
        await act(async () => { server.pending.shift()!.resolve({ items: ['a'], nextCursor: 'cursor-1' }); });
        act(() => { result.current.onChange(1); });
        await act(async () => { server.pending.shift()!.resolve({ items: ['b'], nextCursor: null }); });
        rerender({ path: '/runs/x/reviews' });
        await act(async () => { server.pending.shift()!.resolve({ items: ['c'], nextCursor: null }); });
        expect(result.current.page).toBe(0);
        expect(server.calls().at(-1)).toBe('/runs/x/reviews?limit=25');
    });
});

describe('offset useOffsetPage', () => {
    it('computes offset from the page size and refuses to advance past the total', async () => {
        const server = controlled();
        const { result } = renderHook(() => useOffsetPage<string>('/runs?summary=true', { pageSize: 25 }), { wrapper: wrapper(server.request) });
        await act(async () => { server.pending.shift()!.resolve({ items: ['a'], total: 26, nextOffset: 25 }); });
        expect(server.calls()).toEqual(['/runs?summary=true&limit=25&offset=0']);
        expect(result.current.total).toBe(26);
        expect(result.current.hasMore).toBe(true);
        act(() => { result.current.onChange(1); });
        await act(async () => { server.pending.shift()!.resolve({ items: ['b'], total: 26, nextOffset: null }); });
        expect(server.calls().at(-1)).toBe('/runs?summary=true&limit=25&offset=25');
        act(() => { result.current.onChange(2); });
        expect(result.current.page).toBe(1);
    });
});

describe('usePageRequest', () => {
    it('runs the action and re-runs it when the action identity changes', async () => {
        const server = controlled();
        const call = <T,>(path: string) => server.request(path) as Promise<T>;
        let action = () => call<string>('/a');
        const { result, rerender } = renderHook(() => usePageRequest<string>(action), { wrapper: wrapper(server.request) });
        await act(async () => { server.pending.shift()!.resolve('first'); });
        expect(result.current.data).toBe('first');
        action = () => call<string>('/b');
        rerender();
        await act(async () => { server.pending.shift()!.resolve('second'); });
        expect(result.current.data).toBe('second');
    });
});
