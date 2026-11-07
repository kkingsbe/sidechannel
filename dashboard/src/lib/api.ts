import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useResource, useResourceOffsetPage, useResourcePage } from './clients/query';
import type { OffsetPage, Page } from './contracts';
import { ApiError, request, withQuery, type Requester } from './transport';

export { ApiError };

const RequesterContext = createContext<Requester>(request);
export const RequesterProvider = ({ value, children }: { value: Requester; children: ReactNode }) =>
    createElement(RequesterContext.Provider, { value }, children);
export const useRequester = (): Requester => useContext(RequesterContext);


export interface PageRequestOptions { interval?: number }

/** Path-keyed read. A changed path clears the resource and drops the earlier response. */
export function useApi<T>(path: string | null, options: PageRequestOptions = {}) {
    const requester = useRequester();
    const load = useCallback(() => requester<T>(path!), [requester, path]);
    return useResource<T>(path, load, { interval: options.interval });
}

/** Path-keyed cursor pager; `cursorKey` mirrors the cursor chain into the URL. */
export function usePage<T>(path: string | null, options: { interval?: number; cursorKey?: string; limit?: number } = {}) {
    const requester = useRequester();
    const limit = options.limit ?? 30;
    return useResourcePage<T>(
        path,
        cursor => requester<Page<T>>(withQuery(path!, { limit, after: cursor ?? undefined })),
        { interval: options.interval, cursorKey: options.cursorKey },
    );
}

/** Path-keyed offset pager. */
export function useOffsetPage<T>(path: string | null, options: { interval?: number; pageSize?: number } = {}) {
    const requester = useRequester();
    const pageSize = options.pageSize ?? 25;
    return useResourceOffsetPage<T>(
        path,
        offset => requester<OffsetPage<T>>(withQuery(path!, { limit: pageSize, offset })),
        { interval: options.interval, pageSize },
    );
}

/**
 * Deprecated alias of `useResource` for the single non-GET read in the app (frozen preview
 * window body). It must not carry a second implementation of the fetch/generation logic.
 */
export function usePageRequest<T>(action: (() => Promise<T>) | null) {
    const load = useCallback(async () => {
        if (!action) throw new Error('No request action was provided');
        return action();
    }, [action]);
    const resource = useResource<T>(action ? 'page-request' : null, load);
    const previous = useRef(action);
    useEffect(() => {
        if (previous.current === action) return;
        previous.current = action;
        void resource.refresh();
    }, [action, resource.refresh]);
    return { data: resource.data, error: resource.error, loading: resource.loading, refresh: resource.refresh };
}

export function useMutation() { const [busy, setBusy] = useState(false), [error, setError] = useState<Error>(), [message, setMessage] = useState(''); const run = async <T,>(action: () => Promise<T>, success?: string): Promise<T | undefined> => { setBusy(true); setError(undefined); setMessage(''); try { const result = await action(); if (success) setMessage(success); return result; } catch (e) { setError(e as Error); return undefined; } finally { setBusy(false); } }; return { busy, error, message, run, clear: () => { setError(undefined); setMessage(''); } }; }
