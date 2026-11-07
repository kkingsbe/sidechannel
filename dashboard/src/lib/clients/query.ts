import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { OffsetPage, Page } from '../contracts';

/**
 * The single implementation of dashboard read state: one generation counter, one interval
 * policy and one staleness rule. Every page-level hook (`useApi`, `usePage`,
 * `useOffsetPage`) is a thin wrapper over the three hooks in this module.
 */

export interface Resource<T> {
    data: T | undefined; error: Error | undefined; loading: boolean;
    refresh: () => Promise<void>; updatedAt: number | undefined;
}

/** Stable empty page so consumers can depend on the array identity in effects. */
const EMPTY_ITEMS: never[] = [];

/** Client/function-parameterised read. `key` is the staleness identity: changing it resets the resource. */
export function useResource<T>(key: string | null, load: () => Promise<T>, options: { interval?: number } = {}): Resource<T> {
    const interval = options.interval ?? 0;
    const [data, setData] = useState<T>();
    const [error, setError] = useState<Error>();
    const [loading, setLoading] = useState(Boolean(key));
    const [updatedAt, setUpdatedAt] = useState<number>();
    const generation = useRef(0);
    // The loader closes over current props/state; identity changes must not restart the effect.
    const latest = useRef(load);
    latest.current = load;
    const refresh = useCallback(async () => {
        if (!key) return;
        const current = ++generation.current;
        try {
            const value = await latest.current();
            if (current !== generation.current) return;
            setData(value);
            setError(undefined);
            setUpdatedAt(Date.now());
        } catch (caught) {
            if (current === generation.current) setError(caught as Error);
        } finally {
            if (current === generation.current) setLoading(false);
        }
    }, [key]);
    useEffect(() => {
        setData(undefined);
        setError(undefined);
        setLoading(Boolean(key));
        if (!key) {
            generation.current++;
            return;
        }
        void refresh();
        const timer = interval ? setInterval(() => { if (!document.hidden) void refresh(); }, interval) : undefined;
        return () => { generation.current++; if (timer) clearInterval(timer); };
    }, [refresh, interval, key]);
    return { data, error, loading, refresh, updatedAt };
}

/** Cursor pager. Refuses to advance past the last page; `cursorKey` keeps the chain in the URL. */
export function useResourcePage<T>(key: string | null, load: (cursor: string | null) => Promise<Page<T>>, options: { interval?: number; cursorKey?: string } = {}) {
    const interval = options.interval ?? 0;
    const cursorKey = options.cursorKey;
    const [params, setParams] = useSearchParams();
    const [pager, setPager] = useState<{ key: string | null; page: number; cursors: (string | null)[] }>({ key, page: 0, cursors: [null] });
    const stale = pager.key !== key;
    const saved = cursorKey ? ['', ...params.getAll(cursorKey)] : undefined;
    const page = stale ? 0 : saved ? saved.length - 1 : pager.page;
    const chain = stale ? [null] : pager.cursors;
    const cursor = cursorKey ? saved![page] ?? null : chain[page] ?? null;
    useEffect(() => {
        if (stale) setPager({ key, page: 0, cursors: [null] });
    }, [stale, key]);
    const resource = useResource<Page<T>>(key ? `${key}|${cursor ?? ''}` : null, () => load(cursor), { interval });
    const nextCursor = resource.data?.nextCursor ?? null;
    const onChange = (next: number) => {
        if (!Number.isSafeInteger(next) || next < 0 || next === page) return;
        if (cursorKey) {
            if (next > page && !nextCursor) return;
            const nextChain = next > page ? [...saved!.slice(1), nextCursor!] : saved!.slice(1, next + 1);
            setParams(previous => {
                previous.delete(cursorKey);
                nextChain.forEach(value => previous.append(cursorKey, value));
                return previous;
            });
            return;
        }
        if (next > page) {
            if (!nextCursor) return;
            setPager(previous => ({ key, page: next, cursors: [...previous.cursors.slice(0, next), nextCursor] }));
            return;
        }
        setPager(previous => ({ key, page: next, cursors: previous.cursors }));
    };
    return {
        data: resource.data?.items ?? EMPTY_ITEMS, nextCursor, page, hasMore: nextCursor !== null,
        loading: resource.loading, error: resource.error, onChange, refresh: resource.refresh,
    };
}

/** Offset pager. Refuses to advance once the envelope reports no next offset. */
export function useResourceOffsetPage<T>(key: string | null, load: (offset: number) => Promise<OffsetPage<T>>, options: { interval?: number; pageSize?: number } = {}) {
    const interval = options.interval ?? 0;
    const pageSize = options.pageSize ?? 25;
    const [pager, setPager] = useState<{ key: string | null; page: number }>({ key, page: 0 });
    const stale = pager.key !== key;
    const page = stale ? 0 : pager.page;
    useEffect(() => {
        if (stale) setPager({ key, page: 0 });
    }, [stale, key]);
    const resource = useResource<OffsetPage<T>>(key ? `${key}|${page}` : null, () => load(page * pageSize), { interval });
    const hasMore = resource.data?.nextOffset != null;
    const onChange = (next: number) => {
        if (!Number.isSafeInteger(next) || next < 0 || next === page) return;
        if (next > page && !hasMore) return;
        setPager({ key, page: next });
    };
    return {
        data: resource.data?.items ?? EMPTY_ITEMS, total: resource.data?.total ?? 0, page, hasMore,
        loading: resource.loading, error: resource.error, onChange, refresh: resource.refresh,
    };
}
