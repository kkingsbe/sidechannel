// @vitest-environment jsdom
import { type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useResource, useResourceOffsetPage, useResourcePage } from './query';

afterEach(cleanup);

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/?view=list']}>{children}</MemoryRouter>;

function deferred<T>() {
    const pending: { resolve: (value: T) => void; reject: (error: Error) => void }[] = [];
    const load = vi.fn(() => new Promise<T>((resolve, reject) => { pending.push({ resolve, reject }); }));
    return { load, pending };
}

it('clears data when the staleness key changes and ignores the earlier in-flight response', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const loads = new Map([['runs:a', first.load], ['runs:b', second.load]]);
    const { result, rerender } = renderHook(({ key }: { key: string }) => useResource(key, loads.get(key)!), {
        wrapper, initialProps: { key: 'runs:a' },
    });
    await act(async () => { first.pending.shift()!.resolve('a'); });
    expect(result.current.data).toBe('a');
    rerender({ key: 'runs:b' });
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(true);
    await act(async () => { second.pending.shift()!.resolve('b'); });
    expect(result.current.data).toBe('b');
});

it('refuses to advance a cursor page when the envelope has no next cursor', async () => {
    const loads = vi.fn(async (cursor: string | null) => cursor === null
        ? { items: ['a'], nextCursor: null }
        : { items: ['b'], nextCursor: null });
    const { result } = renderHook(() => useResourcePage<string>('probe', loads, {}), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.data).toEqual(['a']);
    act(() => { result.current.onChange(1); });
    expect(result.current.page).toBe(0);
    expect(loads).toHaveBeenCalledTimes(1);
});

it('passes the absolute offset derived from the page and page size', async () => {
    const loads = vi.fn(async (offset: number) => ({ items: [String(offset)], total: 75, nextOffset: offset + 25 < 75 ? offset + 25 : null }));
    const { result } = renderHook(() => useResourceOffsetPage<string>('runs', loads, { pageSize: 25 }), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(loads).toHaveBeenLastCalledWith(0);
    act(() => { result.current.onChange(2); });
    await act(async () => { await Promise.resolve(); });
    expect(loads).toHaveBeenLastCalledWith(50);
    expect(result.current.data).toEqual(['50']);
});
