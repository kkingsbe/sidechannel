# WS5 — Dashboard Data-Access Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the dashboard exactly one way to fetch, one way to paginate, typed per-resource clients, one response envelope contract and a stateless Jev adapter — deleting the six "fetch page" implementations, the stateful transport module and the fabricated contract values without changing a single rendered string or API payload.

**Architecture:** A dumb HTTP boundary (`lib/transport.ts`) plus a Jev adapter split into a **pure** route translator (`translate`) and a **bounded session** created by the provider (`createJevSession`) replaces today's module-global caches. Typed resource clients own every path, body and export URL (`lib/clients/*`), an `ApiClientProvider` composes them over one `Requester`, and the three path-keyed hooks in `lib/api.ts` read through that requester. Pages keep calling path-keyed hooks, so after this workstream no page owns transport, encoding, envelopes or pagination state, and WS6's decompositions become mechanical. Estimated: 5 tasks, 6–8 dev-days.

**Tech Stack:** React 19.3.1, react-router-dom 7.18.5, TypeScript 5.9.3 (dashboard), Vite 7.3.7, Vitest 5.1.0 + @testing-library/react 16.3.3 (jsdom via `// @vitest-environment jsdom`), Node 22.18+/24.11+, npm workspaces + Nx 23.

## Global Constraints

- **No behavioural change** unless a task explicitly states the change and its evidence. Experiment scheduling, tool admission, budget accounting, evidence hashes, event types, statuses, API payloads and dashboard copy stay identical.
- **Every task ships tests.** Backend tasks also require the Mongo integration suite.
- **Verification (repo root):** `npm run lint`, `node scripts/verify-boundaries.mjs`, `npm run check`, `npm test`, `npm run build`, `npm run test:integration` (Mongo required), `node scripts/verify-compiled.mjs`, `node scripts/verify-migration-equivalence.mjs`.
- **Test runner facts:**
  - `scripts/test.mjs <dir>` collects `*.test.ts`; with `--mongo` it collects only `*.mongo.test.ts`. Helper modules must not end in `.test.ts`.
  - Tests under `tests/integration/` import workspace packages through their declared exports, which resolve to `dist/`. **Rebuild before running** (`npm run build`) or use the nx target (`node scripts/nx.mjs run @sidechannel/integration:test`).
  - Mongo URI comes from `TEST_MONGODB_URI`; local default `127.0.0.1:27018` (docker compose), CI uses `27017`. Never hardcode.
  - Unit tests use `node:test` + `assert/strict`; dashboard tests use vitest + Testing Library.
- **Boundary rules stay intact** (`eslint.config.mjs` layer tags, `scripts/verify-boundaries.mjs`). Services must not import services; dashboard imports only `@sidechannel/contracts/browser` / `testing`.
- **Dependencies are frozen.** No upgrades.
- **No destructive DB migrations.** Changes are code + in-memory semantics; any Mongo change is query/return-value only and additive.
- **One task = one PR**, ≤ ~400 changed lines where possible, rebased on `main`.
- **WS5-specific:** dashboard source reaches the network only through `lib/transport.ts` (`fetch(` appears exactly once in `dashboard/src`). After Task 5.2 no dashboard test stubs the global `fetch`; tests inject a fake `Requester` through `ApiClientProvider`. Lib tests that need no DOM keep `// @vitest-environment node`; page/component tests keep `// @vitest-environment jsdom`.
- **File ownership:** WS5 owns `dashboard/src/lib/**` and page/component files *only* for data-hook, path and type removal. WS6 owns component extraction and markup moves; WS3a owns `api/src/routes/**`. The two cross-plan edits are called out explicitly (Task 5.3 `packages/contracts/src/browser.ts`; dependency D5.1 `api/src/routes/review-routes.ts`).

---

## File structure

**Create**

| Path | Responsibility |
| --- | --- |
| `dashboard/src/lib/transport.ts` | `ApiError`, `Requester`, `request` (the only `fetch` call), `withQuery` |
| `dashboard/src/lib/contracts.ts` | `Page<T>`, `OffsetPage<T>`, `Identified`, `RunProgress`, evidence-page types, `mergeProgress`, `ViewRegistry<TabId>` |
| `dashboard/src/lib/adapters/jev.ts` | Pure `translate(path, init)`, `JevSession`/`createJevSession`, view-model mappers, `createJevRequester` |
| `dashboard/src/lib/adapters/defaults.ts` | Documented client-side defaults for a **new** analysis (T5.4) |
| `dashboard/src/lib/clients/runs.ts` | `RunsClient` + `runPaths` |
| `dashboard/src/lib/clients/codebooks.ts` | `CodebooksClient` + `codebookPaths` |
| `dashboard/src/lib/clients/analyses.ts` | `AnalysesClient` + `analysisPaths` (wraps the Jev adapter) |
| `dashboard/src/lib/clients/monitor.ts` | `MonitorClient` + `monitorPaths` |
| `dashboard/src/lib/clients/reviews.ts` | `ReviewsClient` + `reviewPaths` (window-review list + run-outcome reviews) |
| `dashboard/src/lib/clients/workspace.ts` | `WorkspaceClient` + `workspacePaths` (mode, overview, drafts, config, datasets, adaption models) |
| `dashboard/src/lib/clients/context.tsx` | `ApiClients`, `createClients`, `ApiClientProvider`, `useClients` |
| `dashboard/src/lib/clients/query.ts` | `useResource`, `useResourcePage`, `useResourceOffsetPage` — the client/function-based read hooks WS6 pages and fake-client tests consume (binding signatures in conventions §3.4); path-keyed `useApi`/`usePage`/`useOffsetPage` become thin wrappers over these |
| `dashboard/src/lib/transport.test.ts` | The one real `fetch` call: prefix, headers, `ApiError` |
| `dashboard/src/lib/api.test.tsx` | Hook contract: path change clears data, stale response ignored, pager refusal, cursor chains |
| `dashboard/src/lib/contracts.test.ts` | Envelope + type-level assertions (checked by `npm run check`) |
| `dashboard/src/lib/adapters/jev.test.ts` | Translator/session/mapper characterization, ported from `jev-transport.test.ts` |
| `dashboard/src/lib/clients/runs.test.ts` | `RunsClient` request shapes against a fake `Requester` |
| `dashboard/src/lib/clients/analyses.test.ts` | `AnalysesClient` request shapes, preview→launch, export URLs |
| `dashboard/src/lib/review-types.test.ts` | Review-input split + dead-export removal (type level) |
| `dashboard/src/test/clients.tsx` | `fakeServer(handler)`, `fakeClients`, `renderWithClients` |

**Modify**

| Path | Change |
| --- | --- |
| `dashboard/src/lib/api.ts` | `useApi` (options object, path-keyed data), `usePage`, `useOffsetPage`, `usePageRequest`, `RequesterProvider`/`useRequester`; delete `api`/`rawApi`/`post`/`arrayOf`; keep `useMutation` |
| `dashboard/src/lib/paging.ts` | **Delete** (folded into `api.ts`) |
| `dashboard/src/lib/jev-transport.ts` + `.test.ts` | **Delete** (moved to `adapters/jev.ts` + `clients/*`) |
| `dashboard/src/lib/analysis-types.ts` | Envelope import, no fabricated `revision`/`archived`/`resolvedSettings`, `WindowReviewInput`/`OutcomeReviewInput`/`ReviewDraft`, dead exports deleted |
| `dashboard/src/lib/types.ts` | Delete `ConfigurationResponse`; add `OutcomeReviewInput`, `RunSummary` re-export, `PairView`/`RunEvidenceItem`/`DraftSave`/`ConfigSchema`/`Validation` |
| `dashboard/src/main.tsx` | Wrap `<App />` in `ApiClientProvider` |
| `dashboard/src/App.tsx` | `useClients()` for `/workspace`; drop `arrayOf` |
| `dashboard/src/pages/{Analysis,Oversight,Runs,Codebook,Overview,Experiments}.tsx` | Delete page-local hooks/pagers; use hooks + clients (move maps per task) |
| `dashboard/src/components/{model-controls,healthcare-preset,healthcare-results}.tsx` | Use clients instead of path literals |
| `dashboard/src/pages/{Analysis,RunsOversight,Codebook,Experiments,Healthcare}.test.tsx`, `dashboard/src/components/{healthcare,ui}.test.tsx`, `dashboard/src/workflows.test.tsx`, `dashboard/src/oversight-pagination.test.tsx` | Render through `ApiClientProvider` with fake clients |
| `packages/contracts/src/browser.ts` (+ `harness/contracts.ts` if needed) | Add `RunSummary` to the browser DTO barrel (one line, Task 5.3) |
| `api/src/routes/review-routes.ts` | Dependency D5.1 (WS3a-owned): enforce the one-source-event rule server-side |

**Do not touch in this workstream:** markup/component extraction (WS6), `dashboard/src/components/**` structure, `api/src/server/**`, `packages/contracts` beyond the one `browser.ts` barrel line, status vocabularies and `Badge` (WS7).

---

## Dependencies and ordering

| ID | Owner | Content | Blocks |
| --- | --- | --- | --- |
| D5.1 | WS3a — `packages/domain/src/analysis/jev-reviews.ts` | Server rejects event-scope reviews that do not carry exactly one source event, with the exact message the dashboard used today. **Delivered by WS3a Step 5.4b** (plan updated by the Lead; code in Task 5.4 Step 5.4.0). | T5.4 merge |
| D5.2 | WS3a | Route table stable: no `/api/*` path renamed while WS5 lands (program ordering rule 2). | T5.2 |
| D5.3 | WS5 | Add the one-line `RunSummary` export to `packages/contracts/src/browser.ts` (Task 5.3). **Approved by the Lead on 2026-11-07**; no fallback declaration needed. | T5.3 |

Order: 5.1 → 5.2 → 5.3 → 5.4 → 5.5. Each task leaves the tree green. T5.4 must not merge before D5.1.

---

## Task 5.1: Path-keyed `useApi` + single `usePage`/`useOffsetPage`

**Files:**
- Create: `dashboard/src/lib/transport.ts`, `dashboard/src/lib/contracts.ts` (envelopes only; extended in T5.3), `dashboard/src/lib/clients/query.ts`, `dashboard/src/lib/api.test.tsx`, `dashboard/src/lib/transport.test.ts`, `dashboard/src/lib/clients/query.test.tsx`, `dashboard/src/test/clients.tsx`
- Modify: `dashboard/src/lib/api.ts` (whole file)
- Delete: `dashboard/src/lib/paging.ts`
- Modify: `dashboard/src/pages/Oversight.tsx:44,72-183,199-213,334,341,354,394,399,413,428-429,450,784-786,1058,1078,1102,1117,1129,1170,1611-1628,1643-1648,1729,1736,1742,1912,1942`
- Modify: `dashboard/src/pages/Analysis.tsx:43-44,95-100,138-152,209-217,234-238,368,400,433,780,966-977,995-997,1268-1279,1324,1382,1943,2105-2117,2509-2520`
- Modify: `dashboard/src/pages/Runs.tsx:221-226,232-241,263-272,290-292,294,300,584-597,798-805`
- Modify: `dashboard/src/pages/Codebook.tsx:39-40,54-55,60-62,68,70,278,313,533,564`
- Modify: `dashboard/src/pages/Overview.tsx:18,29`
- Modify the tests listed in Step 1.11

**Interfaces:**
- Consumes: nothing (first task).
- Produces (conventions §3.4 verbatim):
  - `lib/transport.ts`: `class ApiError extends Error { constructor(public status: number, message: string, public details?: unknown); }`; `type Requester = <T>(path: string, options?: RequestInit) => Promise<T>`; `const request: Requester`; `function withQuery(path: string, parameters: Record<string, string | number | undefined>): string`.
  - `lib/api.ts`: `interface PageRequestOptions { interval?: number }`; `useApi<T>(path: string | null, options?: PageRequestOptions): { data: T | undefined; error: Error | undefined; loading: boolean; refresh: () => Promise<void>; updatedAt: number | undefined }`; `usePage<T>(path: string | null, options?: { interval?: number; cursorKey?: string; limit?: number }): { data: T[]; nextCursor: string | null; page: number; hasMore: boolean; loading: boolean; error: Error | undefined; onChange: (next: number) => void; refresh: () => Promise<void> }`; `useOffsetPage<T>(path: string | null, options?: { interval?: number; pageSize?: number }): { data: T[]; total: number; page: number; hasMore: boolean; loading: boolean; error: Error | undefined; onChange: (next: number) => void; refresh: () => Promise<void> }`; `usePageRequest<T>(action: (() => Promise<T>) | null)`; `RequesterProvider`, `useRequester`, `useMutation`.
  - `lib/contracts.ts`: `interface Page<T> { items: T[]; nextCursor: string | null }`, `interface OffsetPage<T> { items: T[]; total: number; nextOffset: number | null }`.
  - `lib/clients/query.ts` (binding signatures for WS6): `useResource<T>(key: string | null, load: () => Promise<T>, options?: { interval?: number })` → `{ data, error, loading, refresh, updatedAt }`; `useResourcePage<T>(key: string | null, load: (cursor: string | null) => Promise<Page<T>>, options?: { interval?: number; cursorKey?: string })` → `{ data: T[], nextCursor, page, hasMore, loading, error, onChange, refresh }`; `useResourceOffsetPage<T>(key: string | null, load: (offset: number) => Promise<OffsetPage<T>>, options?: { interval?: number; pageSize?: number })` → `{ data: T[], total, page, hasMore, loading, error, onChange, refresh }`.
- `usePageRequest` remains only as a deprecated alias of `useResource` for the single non-GET read; it must not carry a second implementation of the fetch/generation logic. The path-keyed `useApi`/`usePage`/`useOffsetPage` are thin wrappers that build `load` from `useRequester()` and the path; all staleness/pager logic lives in `query.ts`.

- [ ] **Step 1.1: Write the failing hook contract test**

Create `dashboard/src/lib/api.test.tsx`:

```tsx
// @vitest-environment jsdom
import React, { type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { RequesterProvider, useApi, useOffsetPage, usePage } from './api';

afterEach(cleanup);

/** A requester the test resolves by hand, one call at a time. */
function controlled() {
    const pending: { path: string; resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
    const request = vi.fn(<T,>(path: string) => new Promise<T>((resolve, reject) => {
        pending.push({ path, resolve: resolve as (value: unknown) => void, reject });
    }));
    return { request, pending, calls: () => request.mock.calls.map(call => call[0]) };
}

const wrapper = (request: ReturnType<typeof controlled>['request']) =>
    function Wrapper({ children }: { children: ReactNode }) {
        return <MemoryRouter initialEntries={['/?view=list']}><RequesterProvider value={request}>{children}</RequesterProvider></MemoryRouter>;
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
```

- [ ] **Step 1.2: Write the failing transport test**

Create `dashboard/src/lib/transport.test.ts`:

```ts
// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, request } from './transport';

afterEach(() => vi.unstubAllGlobals());

it('prefixes /api, sends JSON and returns the parsed envelope', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(request('/runs?limit=1')).resolves.toEqual({ items: [], total: 0 });
    expect(fetch.mock.calls[0]![0]).toBe('/api/runs?limit=1');
    expect((fetch.mock.calls[0]![1] as RequestInit).headers).toEqual({ 'Content-Type': 'application/json' });
});

it('throws ApiError carrying status and payload, preferring the server error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Codebook revision conflict' }), { status: 409 })));
    await expect(request('/codebooks/x')).rejects.toMatchObject({ name: 'ApiError', status: 409, message: 'Codebook revision conflict' });
    await expect(request('/codebooks/x')).rejects.toBeInstanceOf(ApiError);
});

it('falls back to a status message when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })));
    await expect(request('/overview')).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' });
});
```

- [ ] **Step 1.3: Run the tests to verify they fail**

```bash
npm test --workspace sidechannel-dashboard -- src/lib/api.test.tsx src/lib/transport.test.ts
```

Expected: FAIL — `Failed to resolve import "./transport"` / `usePage is not a function`.

- [ ] **Step 1.4: Implement `transport.ts`**

Create `dashboard/src/lib/transport.ts`:

```ts
/** The dashboard's single network boundary. Paths are API-relative (`/runs/x`, never `/api/runs/x`). */
export class ApiError extends Error {
    constructor(public status: number, message: string, public details?: unknown) {
        super(message);
        this.name = 'ApiError';
    }
}

export type Requester = <T>(path: string, options?: RequestInit) => Promise<T>;

export const request: Requester = async <T,>(path: string, options?: RequestInit): Promise<T> => {
    const response = await fetch('/api' + path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, (data as { error?: string } | null)?.error || `Request failed (${response.status})`, data);
    return data as T;
};

/** Builds `path?limit=..&after=..` query strings without dropping existing parameters. */
export function withQuery(path: string, parameters: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(parameters))
        if (value !== undefined && value !== '') search.set(key, String(value));
    const query = search.toString();
    return query ? path + (path.includes('?') ? '&' : '?') + query : path;
}
```

- [ ] **Step 1.5: Implement the hooks in `api.ts`; delete `paging.ts`; add `contracts.ts`**

Replace `dashboard/src/lib/api.ts` with:

```tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { request, withQuery, type Requester } from './transport';
import type { OffsetPage, Page } from './contracts';

const RequesterContext = createContext<Requester>(request);
export const RequesterProvider = ({ value, children }: { value: Requester; children: ReactNode }) =>
    <RequesterContext.Provider value={value}>{children}</RequesterContext.Provider>;
export const useRequester = (): Requester => useContext(RequesterContext);

export interface PageRequestOptions { interval?: number }

interface PathState<T> { path: string; data?: T; error?: Error; updatedAt?: number }

export function useApi<T>(path: string | null, options: PageRequestOptions = {}) {
    const { interval } = options;
    const requester = useRequester();
    const [state, setState] = useState<PathState<T>>();
    const generation = useRef(0);
    const refresh = useCallback(async () => {
        if (!path) return;
        const current = ++generation.current;
        try {
            const data = await requester<T>(path);
            if (current === generation.current) setState({ path, data, updatedAt: Date.now() });
        } catch (error) {
            if (current !== generation.current) return;
            setState(previous => ({ path, error: error as Error,
                data: previous?.path === path ? previous.data : undefined,
                updatedAt: previous?.path === path ? previous.updatedAt : undefined }));
        }
    }, [path, requester]);
    useEffect(() => {
        setState(undefined);
        void refresh();
        const timer = interval ? setInterval(() => { if (!document.hidden) void refresh(); }, interval) : undefined;
        return () => { generation.current++; clearInterval(timer); };
    }, [refresh, interval, path]);
    const current = state?.path === path ? state : undefined;
    return { data: current?.data, error: current?.error, loading: !!path && !current, refresh, updatedAt: current?.updatedAt };
}

export function usePage<T>(path: string | null, options: { interval?: number; cursorKey?: string; limit?: number } = {}) {
    const { interval, cursorKey, limit = 30 } = options;
    const [params, setParams] = useSearchParams();
    const saved = cursorKey ? ['', ...params.getAll(cursorKey)] : undefined;
    const [chain, setChain] = useState<string[]>(['']);
    const [localPage, setLocalPage] = useState(0);
    useEffect(() => { setChain(['']); setLocalPage(0); }, [path]);
    const page = saved ? saved.length - 1 : localPage;
    const cursor = (saved ?? chain)[page] ?? '';
    const resource = useApi<Page<T>>(path ? withQuery(path, { limit, after: cursor }) : null, { interval });
    const move = (nextChain: string[], next: number) => {
        if (cursorKey) setParams(previous => {
            previous.delete(cursorKey);
            nextChain.slice(1).forEach(value => previous.append(cursorKey, value));
            return previous;
        });
        else { setChain(nextChain); setLocalPage(next); }
    };
    const onChange = (next: number) => {
        if (!Number.isSafeInteger(next) || next < 0 || next === page) return;
        const current = saved ?? chain;
        if (next > page) {
            if (!resource.data?.nextCursor) return; // refuses to advance past the last page
            move([...current.slice(0, next), resource.data.nextCursor], next);
            return;
        }
        move(current.slice(0, next + 1), next);
    };
    return { data: resource.data?.items ?? [], nextCursor: resource.data?.nextCursor ?? null, page,
        hasMore: !!resource.data?.nextCursor, loading: resource.loading, error: resource.error, onChange, refresh: resource.refresh };
}

export function useOffsetPage<T>(path: string | null, options: { interval?: number; pageSize?: number } = {}) {
    const { interval, pageSize = 25 } = options;
    const [page, setPage] = useState(0);
    useEffect(() => setPage(0), [path]);
    const resource = useApi<OffsetPage<T>>(path ? withQuery(path, { limit: pageSize, offset: page * pageSize }) : null, { interval });
    const hasMore = resource.data?.nextOffset != null;
    const onChange = (next: number) => {
        if (!Number.isSafeInteger(next) || next < 0 || next === page) return;
        if (next > page && !hasMore) return; // refuses to advance past the last page
        setPage(next);
    };
    return { data: resource.data?.items ?? [], total: resource.data?.total ?? 0, page, hasMore,
        loading: resource.loading, error: resource.error, onChange, refresh: resource.refresh };
}

/** For the single non-GET read in the app (frozen preview window body). Not for path-keyed reads. */
export function usePageRequest<T>(action: (() => Promise<T>) | null) {
    const [state, setState] = useState<{ action: () => Promise<T>; data?: T; error?: Error }>();
    const generation = useRef(0);
    const refresh = useCallback(async () => {
        if (!action) return;
        const current = ++generation.current;
        try {
            const data = await action();
            if (current === generation.current) setState({ action, data });
        } catch (error) {
            if (current === generation.current) setState(previous => ({ action, error: error as Error, data: previous?.action === action ? previous.data : undefined }));
        }
    }, [action]);
    useEffect(() => { setState(undefined); void refresh(); return () => { generation.current++; }; }, [refresh, action]);
    const current = state?.action === action ? state : undefined;
    return { data: current?.data, error: current?.error, loading: !!action && !current, refresh };
}

export function useMutation() { const [busy, setBusy] = useState(false), [error, setError] = useState<Error>(), [message, setMessage] = useState(''); const run = async <T,>(action: () => Promise<T>, success?: string): Promise<T | undefined> => { setBusy(true); setError(undefined); setMessage(''); try { const result = await action(); if (success) setMessage(success); return result; } catch (e) { setError(e as Error); return undefined; } finally { setBusy(false); } }; return { busy, error, message, run, clear: () => { setError(undefined); setMessage(''); } }; }
```

Create `dashboard/src/lib/contracts.ts`:

```ts
import type { ComponentType } from 'react';

/** One cursor envelope (Jev `Page` and every paged list agree on this shape). */
export interface Page<T> { items: T[]; nextCursor: string | null }
/** One offset envelope (harness runs, evidence tabs). */
export interface OffsetPage<T> { items: T[]; total: number; nextOffset: number | null }
export interface Identified { id: string; createdAt: string }
export type ViewRegistry<TabId extends string> = Record<TabId, { title: string; description?: string; Component: ComponentType }>;
```

Delete `paging.ts`:

```bash
git rm dashboard/src/lib/paging.ts
```

- [ ] **Step 1.6: Run the tests to verify they pass**

```bash
npm test --workspace sidechannel-dashboard -- src/lib/api.test.tsx src/lib/transport.test.ts
```

Expected: PASS (9 hook tests + 3 transport tests).

- [ ] **Step 1.7: Delete the three page-defined hooks in `Oversight.tsx`**

1. Delete lines 72–183 (`type Page<T>`, the `useExactApi` doc comment and body, `useCursorPage`, `useRunPage`).
2. Replace line 44: `import { post, useApi, useMutation, useOffsetPage, usePage } from "../lib/api";`
3. Replace lines 199–213 with:

```tsx
  const history = usePage<MonitorDefinition>("/monitor-definitions/history", { limit: 25 });
  const runs = useOffsetPage<Run>("/runs?summary=true&status=completed", { pageSize: 25 });
  const referenceRuns = useOffsetPage<Run>(
    tab === "references"
      ? "/runs?summary=true&status=completed,failed,cancelled,interrupted"
      : null,
    { pageSize: 25 },
  );
  const [referenceRunId, setReferenceRunId] = useState(params.get("run") || "");
  const jobs = usePage<MonitorEvaluation>("/monitor-evaluations", { interval: 5000, cursorKey: "jobCursor", limit: 25 });
```

4. `arrayOf(referenceRuns.data)` → `referenceRuns.data` (lines 334, 341); `arrayOf(runs.data)` → `runs.data` (428, 429).
5. Every `<Pager {...x.pagination} />` becomes `<Pager page={x.page} hasMore={x.hasMore} onChange={x.onChange} />` at lines 354 (`referenceRuns`), 413 and 1078 (`history`), 450 (`runs`), 1170 (`jobs`), 1742 (`definitionHistory`), 1942 (`reviews`).
6. `history.data?.items` → `history.data` (394, 399, 1058); `jobs.data?.items.length` → `jobs.data.length` (1117); `jobs.data.items.map` → `jobs.data.map` (1129); `definitionHistory.data?.items` → `definitionHistory.data` (1729, 1736); `reviews.data?.items` → `reviews.data` (1912).
7. Replace lines 784–786: `const history = usePage<MonitorDefinition>(showHistory ? "/monitor-definitions/history" : null, { limit: 25 });`
8. Line 1102: `jobs: ReturnType<typeof useCursorPage<MonitorEvaluation>>;` → `jobs: ReturnType<typeof usePage<MonitorEvaluation>>;`
9. Replace lines 1611–1628 with:

```tsx
  const definitionHistory = usePage<MonitorDefinition>("/monitor-definitions/history", { limit: 25 });
  const context = useApi<RunReviewContext>(
    "/runs/" +
      runId +
      "/reviews/context" +
      (definitionRevisionId
        ? "?definitionRevisionId=" + encodeURIComponent(definitionRevisionId)
        : ""),
  );
  const reviews = usePage<RunOutcomeReview>("/runs/" + runId + "/reviews", { interval: 5000, limit: 25 });
  const agreements = useApi<RunOutcomeAgreement[]>(
    "/runs/" + runId + "/outcomes",
    { interval: 5000 },
  );
```

10. Line 1643 `useExactApi<RunOutcomeReview | null>(` → `useApi<RunOutcomeReview | null>(`; line 1647 `5000,` → `{ interval: 5000 },`.

- [ ] **Step 1.8: Delete the inline pagers in `Analysis.tsx`**

1. Line 44: delete the `paging` import; line 43 → `import { post, useApi, useMutation, useOffsetPage, usePage } from "../lib/api";`
2. Replace 95–100 and the pager at 138–152:

```tsx
  const jobs = usePage<AnalysisJob>("/analyses", { interval: 5000, limit: 30 });
  const returnTo = "/analysis" + (params.size ? "?" + params.toString() : "");
```

```tsx
        <Pager page={jobs.page} hasMore={jobs.hasMore} onChange={jobs.onChange} />
```

3. Replace 209–217:

```tsx
  const runs = useOffsetPage<Run>("/runs?summary=true", { pageSize: 50 });
  const source = useApi<Run>(runId ? "/runs/" + runId : null);
  const books = usePage<Codebook>("/codebooks", { limit: 30 });
  const cloned = useApi<AnalysisJob>(clone ? "/analyses/" + clone : null);
  const jobs = usePage<AnalysisJob>(runId ? "/runs/" + runId + "/analyses" : null, { interval: 5000, limit: 30 });
```

4. Replace 234–238:

```tsx
  const revisionHistory = usePage<CodebookRevision>(
    settings.codebookId ? "/codebooks/" + settings.codebookId + "/revisions" : null,
    { limit: 30 },
  );
```

5. Replace the `.pagination` spreads with the explicit three-prop form at 368 (`runs`), 400 (`books`), 433 (`revisionHistory`), 780 (`jobs`), 1324 (`sourceJobs`), 1943 (`batches`).
6. `*.data?.items` → `*.data` at 119, 129, 251, 296, 356, 375, 386, 393, 415, 422, 739, 750, 874, 1313, 1921, 1973, 2138, 2142, 2479; `windows.data?.items ?? []` → `windows.data` (1005); `otherWindows.data?.items ?? []` → `otherWindows.data` (1382).
7. Replace 966–977:

```tsx
  const windows = usePage<AnalysisWindow>("/analyses/" + id + "/windows", { interval: 6000, limit: 30 });
  const detail = useApi<WindowDetail>(
    windowId ? "/analyses/" + id + "/windows/" + windowId : null,
  );
```

8. Replace the windows pager (1268–1279) with `<Pager page={windows.page} hasMore={windows.hasMore} onChange={windows.onChange} />`.
9. Replace 995–997:

```tsx
  const sourceJobs = usePage<AnalysisJob>(job.data ? "/runs/" + job.data.runId + "/analyses" : null, { limit: 30 });
```

10. Replace 2105–2117:

```tsx
  const reviews = usePage<HumanReview>(
    "/analyses/" + job.id + "/reviews?windowId=" + detail.window.id,
    { interval: 4000, limit: 30 },
  );
```

11. Replace the review-history pager (2509–2520) with `{predictionsVisible && (<Pager page={reviews.page} hasMore={reviews.hasMore} onChange={reviews.onChange} />)}`.
12. The review-queue "Next selections" cursor (1903–1915, 1932) is **not** converted: it is a cursor over a filtered queue whose state machine belongs to WS6 T6.2 (see Out of scope).

- [ ] **Step 1.9: Delete the inline pagers in `Codebook.tsx`**

1. Lines 39–40 → `const books = usePage<Codebook>("/codebooks", { limit: 30 });` (drop `bookCursor`).
2. Delete `revisionCursor`/`revisionPages` state (54–55); line 68 → `useEffect(() => setHistoryRevision(undefined), [bookId]);`
3. Replace 60–62:

```tsx
  const revisions = usePage<CodebookRevision>(
    history && bookId ? "/codebooks/" + bookId + "/revisions" : null,
    { limit: 30 },
  );
```

4. `books.data?.items[0]` → `books.data[0]` and `books.data.items[0]` → `books.data[0]` (70); `!books.data?.items.length` → `!books.data.length` (278); `revisions.data?.items.map` → `revisions.data.map` (533).
5. Line 313 becomes:

```tsx
              {books.hasMore && <Pager page={books.page} hasMore={books.hasMore} onChange={books.onChange} />}
```

6. Line 564 becomes `<Pager page={revisions.page} hasMore={revisions.hasMore} onChange={revisions.onChange} />`; add `Pager` to the `../components/ui` import.

- [ ] **Step 1.10: Delete the two page-local pagers in `Runs.tsx`**

1. Replace 221–226 and 232–241 with:

```tsx
  const events = usePage<HarnessEvent>(
    tab === "timeline" || tab === "traces"
      ? withQuery("/runs/" + id + "/events", { limit: 50, ...(actor ? { actor } : {}), ...(phase ? { phase } : {}), ...(eventType ? { type: eventType } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })
      : null,
    { interval: 4000 },
  );
```

(`withQuery` imported from `../lib/transport`; T5.2 replaces this literal with `clients.runs.paths.events(id, query)`.)
2. Replace 263–268:

```tsx
  const evidence = useOffsetPage<unknown>(
    ["board", "artifacts", "memory", "reports"].includes(tab) ? `/runs/${id}/${tab}` : null,
    { interval: 5000, pageSize: 30 },
  );
```

3. Delete the reset effect at 269–272.
4. Event pager (584–597) → `<Pager page={events.page} hasMore={events.hasMore} onChange={events.onChange} />`; `events.data?.events` → `events.data` at 294 and 300.
5. Evidence pager (798–805) → `<Pager page={evidence.page} hasMore={evidence.hasMore} onChange={evidence.onChange} />`; the `items` computation (290–292) → `const items = evidence.data;`.
6. `Overview.tsx:18,29`: `useApi<...>(path, 5000)` → `useApi<...>(path, { interval: 5000 })`.

- [ ] **Step 1.11: Migrate the page tests to an injected requester**

Create `dashboard/src/test/clients.tsx`:

```tsx
import React, { type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { RequesterProvider } from '../lib/api';
import type { Requester } from '../lib/transport';

export interface FakeServer {
    request: Requester;
    calls: string[];
    respond(handler: (path: string, options?: RequestInit) => unknown): void;
}

/** Route-table fake. The handler receives the API-relative path (no `/api` prefix). */
export function fakeServer(handler: (path: string, options?: RequestInit) => unknown = () => { throw new Error('Unexpected request'); }): FakeServer {
    const calls: string[] = [];
    let route = handler;
    return {
        calls,
        respond(next) { route = next; },
        request: (async <T,>(path: string, options?: RequestInit) => {
            calls.push(path);
            return structuredClone(await route(path, options)) as T;
        }) as Requester,
    };
}

export const withServer = (server: FakeServer) =>
    function Wrapper({ children }: { children: ReactNode }) {
        return <RequesterProvider value={server.request}>{children}</RequesterProvider>;
    };

export const renderWithServer = (node: ReactNode, server: FakeServer) => render(<RequesterProvider value={server.request}>{node}</RequesterProvider>);
```

In `pages/{Analysis,Experiments,Codebook,RunsOversight,Healthcare}.test.tsx`, `components/{healthcare,ui}.test.tsx`, `workflows.test.tsx` and `oversight-pagination.test.tsx`, replace every `vi.stubGlobal('fetch', …)` with `const server = fakeServer(); server.respond((path, options) => …)` (same path cases; no `/api` in the handler) and wrap `render(...)` with the provider. Delete the `vi.mock('../lib/api', …)` block in `Analysis.test.tsx:14-36` — the `mocks.request(path)` table moves into `server.respond` unchanged.

- [ ] **Step 1.11b: Add the client-parameterised read hooks (shared seam with WS6)**

Create `dashboard/src/lib/clients/query.ts`. This is the one implementation of the read/staleness/pager logic; the path-based hooks in `lib/api.ts` become thin wrappers that call these with a `load` built from `useRequester()`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OffsetPage, Page } from '../contracts';

interface Resource<T> { data: T | undefined; error: Error | undefined; loading: boolean; refresh: () => Promise<void>; updatedAt: number | undefined; }

export function useResource<T>(key: string | null, load: () => Promise<T>, options: { interval?: number } = {}): Resource<T> {
    const [data, setData] = useState<T>();
    const [error, setError] = useState<Error>();
    const [loading, setLoading] = useState(Boolean(key));
    const [updatedAt, setUpdatedAt] = useState<number>();
    const generation = useRef(0);
    const refresh = useCallback(async () => {
        if (!key) return;
        const current = ++generation.current;
        try {
            const value = await load();
            if (current !== generation.current) return;
            setData(value); setError(undefined); setUpdatedAt(Date.now());
        } catch (caught) {
            if (current === generation.current) setError(caught as Error);
        } finally {
            if (current === generation.current) setLoading(false);
        }
    }, [key, load]);
    useEffect(() => {
        setData(undefined); setError(undefined); setLoading(Boolean(key));
        void refresh();
        const timer = options.interval ? setInterval(() => { if (!document.hidden) void refresh(); }, options.interval) : undefined;
        return () => { generation.current++; if (timer) clearInterval(timer); };
    }, [refresh, key, options.interval]);
    return { data, error, loading, refresh, updatedAt };
}

export function useResourcePage<T>(key: string | null, load: (cursor: string | null) => Promise<Page<T>>, options: { interval?: number; cursorKey?: string } = {}) {
    const [page, setPage] = useState(0);
    const [cursors, setCursors] = useState<string[]>(['']);
    useEffect(() => { setPage(0); setCursors(['']); }, [key]);
    const cursor = cursors[page] ?? '';
    const resource = useResource<Page<T>>(key, () => load(cursor === '' ? null : cursor), { interval: options.interval });
    const items = resource.data?.items ?? [];
    const nextCursor = resource.data?.nextCursor ?? null;
    const onChange = (next: number) => {
        if (next > page) {
            if (!nextCursor) return;                       // refuse to advance past the last page (F9)
            setCursors((previous) => [...previous.slice(0, next), nextCursor]);
        }
        setPage(next);
    };
    return { data: items, nextCursor, page, hasMore: nextCursor !== null, loading: resource.loading, error: resource.error, onChange, refresh: resource.refresh };
}

export function useResourceOffsetPage<T>(key: string | null, load: (offset: number) => Promise<OffsetPage<T>>, options: { interval?: number; pageSize?: number } = {}) {
    const pageSize = options.pageSize ?? 25;
    const [page, setPage] = useState(0);
    useEffect(() => setPage(0), [key]);
    const resource = useResource<OffsetPage<T>>(key, () => load(page * pageSize), { interval: options.interval });
    const items = resource.data?.items ?? [];
    return { data: items, total: resource.data?.total ?? 0, page, hasMore: resource.data?.nextOffset != null, loading: resource.loading, error: resource.error, onChange: setPage, refresh: resource.refresh };
}
```

Add `dashboard/src/lib/clients/query.test.tsx` with: path/key change clears data and ignores an in-flight response from the old key; `useResourcePage` refuses `onChange(page + 1)` when `nextCursor` is null; `useResourceOffsetPage` passes `page * pageSize` as the offset. Then refactor `lib/api.ts` so `useApi`/`usePage`/`useOffsetPage` delegate to these three (no duplicated generation refs or cursor arrays) and keep `usePageRequest` as `useResource` under a deprecated name.

```bash
npm test --workspace sidechannel-dashboard
npm run check --workspace sidechannel-dashboard
```

Expected: PASS.

- [ ] **Step 1.12: Run the dashboard suite and the gate**

```bash
npm test --workspace sidechannel-dashboard
npm run check --workspace sidechannel-dashboard
git grep -n "useCursorApi\|useOffsetApi\|useCursorPage\|useRunPage\|useExactApi\|pagination:" -- dashboard/src
```

Expected: PASS. `oversight-pagination.test.tsx` still asserts 125-run paging, page-3 restoration through `jobCursor` and "Previous" navigation; `Analysis.test.tsx` "carries the saved analyses cursor into the detail return link" still passes. Gate: no matches.

- [ ] **Step 1.13: Commit**

```bash
git add dashboard/src/lib/transport.ts dashboard/src/lib/contracts.ts dashboard/src/lib/api.ts dashboard/src/lib/clients/query.ts dashboard/src/lib/clients/query.test.tsx dashboard/src/lib/api.test.tsx dashboard/src/lib/transport.test.ts dashboard/src/test/clients.tsx dashboard/src/pages
git commit -m "refactor(dashboard): path-keyed useApi and one cursor/offset pager (WS5 T5.1)"
```

**Effort:** 1.5–2 dev-days. **Rollback:** `git revert` restores `paging.ts` and the page-local hooks. **Out of scope:** markup changes; the Analysis review-queue cursor (WS6 T6.2); `RunList`'s URL-offset pager (`Runs.tsx:76-90,192-199`) which reads `offset` from the URL and is not a pager implementation.

---

## Task 5.2: `transport.ts` clients, `ApiClientProvider`, stateless `translate` + session, no raw `/api/` in JSX

**Files:**
- Create: `dashboard/src/lib/adapters/jev.ts`, `dashboard/src/lib/clients/{runs,codebooks,analyses,monitor,reviews,workspace}.ts`, `dashboard/src/lib/clients/context.tsx`, `dashboard/src/lib/clients/runs.test.ts`, `dashboard/src/lib/clients/analyses.test.ts`, `dashboard/src/lib/adapters/jev.test.ts`
- Modify: `dashboard/src/main.tsx`, `dashboard/src/App.tsx`, `dashboard/src/pages/{Analysis,Oversight,Runs,Codebook,Overview,Experiments}.tsx`, `dashboard/src/components/{model-controls,healthcare-preset,healthcare-results}.tsx`, `dashboard/src/test/clients.tsx`, all page/component tests
- Delete: `dashboard/src/lib/jev-transport.ts`, `dashboard/src/lib/jev-transport.test.ts`; remove `api`/`rawApi`/`post` from `api.ts`

**Interfaces:**
- Consumes: `Requester`/`request`/`withQuery` (T5.1), `Page`/`OffsetPage` (T5.1), `useApi`/`usePage`/`useOffsetPage`/`useRequester` (T5.1), the browser DTOs already used by `jev-transport.ts`.
- Produces — §3.4 names/signatures verbatim; `+` = additive member required by an existing page; `paths` = pure route builders (hooks are path-keyed by convention):

```ts
// dashboard/src/lib/clients/runs.ts
export interface RunsClient {
    paths: typeof runPaths;
    list(query?: RunListQuery): Promise<OffsetPage<Run>>;
    get(id: string): Promise<Run>;
    progress(id: string): Promise<Partial<Run> & { observedAt: string }>;   // tightened to RunProgress in T5.4
    events(id: string, query?: RunEventQuery): Promise<Page<HarnessEvent>>;
    event(id: string, eventId: string): Promise<HarnessEvent>;
    evidence(id: string, kind: EvidenceKind, query: { offset: number; limit: number }): Promise<EvidencePage>;
    evidenceItem(id: string, kind: EvidenceKind, key: string): Promise<unknown>;
    board(id: string, query: { offset: number; limit: number }): Promise<BoardPage>;
    exportUrl(id: string): string;
    cancel(id: string): Promise<Run>;
    duplicate(id: string): Promise<Draft>;
    pair(id: string): Promise<PairView>;                                  // +
    evaluation(id: string): Promise<HealthcareEvaluation>;                // +
    createPair(input: PairLaunch): Promise<Run[]>;                        // +
}
// dashboard/src/lib/clients/codebooks.ts
export interface CodebooksClient {
    paths: typeof codebookPaths;
    list(query?: { limit?: number; after?: string }): Promise<Page<Codebook>>;
    get(id: string): Promise<{ codebook: Codebook; revision: CodebookRevision }>;
    revisions(id: string, query?: { limit?: number; after?: string }): Promise<Page<CodebookRevision>>;
    revision(id: string, revisionId: string): Promise<CodebookRevision>;
    create(input: CodebookDraft): Promise<{ codebook: Codebook; revision: CodebookRevision }>;
    revise(id: string, input: CodebookDraft): Promise<{ codebook: Codebook; revision: CodebookRevision }>;
}
// dashboard/src/lib/clients/analyses.ts  (wraps the Jev adapter)
export interface AnalysesClient {
    paths: typeof analysisPaths;
    list(query?: { limit?: number; after?: string }): Promise<Page<AnalysisJob>>;
    job(id: string): Promise<AnalysisJob>;
    windows(id: string, query?: { limit?: number; after?: string }): Promise<Page<AnalysisWindow>>;
    window(id: string, windowId: string): Promise<WindowDetail>;
    runJobs(runId: string, query?: { limit?: number; after?: string }): Promise<Page<AnalysisJob>>;
    preview(runId: string, settings: AnalysisSettings): Promise<AnalysisPreview>;
    previewWindow(token: string, windowId: string): Promise<{ state: string }>;
    launch(runId: string, settings: AnalysisSettings, previewToken: string): Promise<AnalysisJob>;
    cancel(id: string): Promise<AnalysisJob>;
    retry(id: string): Promise<AnalysisJob>;
    reviews(id: string, query: Record<string, string | number | undefined>): Promise<Page<HumanReview>>;
    saveReview(id: string, input: ReviewInput): Promise<HumanReview>;      // split into WindowReviewInput in T5.5
    batches(id: string): Promise<Page<ReviewBatch>>;
    batch(id: string, batchId: string, query: Record<string, string | number | undefined>): Promise<{ batch: ReviewBatch; selections: Page<ReviewSelection> }>;
    createBatch(id: string, input: ReviewBatchInput): Promise<ReviewBatch>;
    exportUrl(id: string): string;
    datasetExportUrl(id: string, dataset: string, limit?: number): string;
}
// dashboard/src/lib/clients/monitor.ts
export interface MonitorClient {
    paths: typeof monitorPaths;
    definition(): Promise<MonitorDefinition>;
    history(query?: { limit?: number; after?: string }): Promise<Page<MonitorDefinition>>;
    saveDefinition(input: MonitorDefinition & { expectedRevision?: number }): Promise<MonitorDefinition>;
    preview(input: MonitorSettings & { runIds: string[]; definitionRevision: number }): Promise<MonitorPreview>;
    evaluations(query?: { limit?: number; after?: string }): Promise<Page<MonitorEvaluation>>;
    launch(input: { previewId: string; previewHash: string; idempotencyKey: string }): Promise<MonitorEvaluation>;
    evaluation(id: string): Promise<MonitorEvaluation>;
    comparison(id: string): Promise<MonitorComparison>;
    exportEnvelope(id: string): Promise<{ evaluation: MonitorEvaluation; preview: MonitorPreview }>;
    exportUrl(id: string): string;
    cancel(id: string): Promise<MonitorEvaluation>;
}
// dashboard/src/lib/clients/reviews.ts
export interface ReviewsClient {
    paths: typeof reviewPaths;
    list(runId: string, query?: { limit?: number; after?: string; outcomeId?: string; definitionRevisionId?: string }): Promise<Page<RunOutcomeReview>>;
    context(runId: string, definitionRevisionId?: string): Promise<RunReviewContext>;
    latest(runId: string, query: { reviewer: string; outcomeId: string; definitionRevisionId: string }): Promise<RunOutcomeReview | null>;
    outcomes(runId: string): Promise<RunOutcomeAgreement[]>;
    save(runId: string, input: Record<string, unknown>): Promise<RunOutcomeReview>;   // typed in T5.5
    exportUrl(runId: string, definitionRevisionId: string): string;
}
// dashboard/src/lib/clients/workspace.ts  (+: resources §3.4 does not name)
export interface WorkspaceClient {
    paths: typeof workspacePaths;
    mode(): Promise<{ mode: 'demo' | 'research' }>;
    overview(): Promise<OverviewData>;
    drafts(): Promise<Draft[]>;
    draft(id: string): Promise<Draft>;
    saveDraft(input: DraftSave): Promise<Draft>;
    duplicateDraft(id: string): Promise<Draft>;
    defaults(): Promise<ExperimentConfig>;
    schema(): Promise<ConfigSchema>;
    validate(config: ExperimentConfig): Promise<Validation>;
    datasets(): Promise<DatasetCatalogItem[]>;
    preset(datasetId: string): Promise<ExperimentConfig>;
    adaptionModels(): Promise<AdaptionModelCatalog>;
}
// dashboard/src/lib/clients/context.tsx
export interface ApiClients {
    request: Requester;
    runs: RunsClient; codebooks: CodebooksClient; analyses: AnalysesClient;
    monitor: MonitorClient; reviews: ReviewsClient; workspace: WorkspaceClient;
}
export function createClients(overrides?: { request?: Requester }): ApiClients;
export function ApiClientProvider(props: { clients: ApiClients; children: ReactNode }): JSX.Element;
export function useClients(): ApiClients;
```

- Every `paths` builder returns an **API-relative** path (no `/api`). The five `exportUrl` builders are the replacements for the five raw `<a href="/api/…">` anchors and are the only functions returning an `/api/...` string.
- `createClients()` builds the real clients over `request`; `createClients({ request })` is how tests inject fakes. `ApiClientProvider` supplies `ClientsContext` and `RequesterProvider value={clients.request}`.

- [ ] **Step 2.1: Write the failing client tests**

Create `dashboard/src/lib/clients/runs.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createClients } from './context';

function stub(...responses: unknown[]) {
    const calls: { path: string; options?: RequestInit }[] = [];
    const request = vi.fn(async (path: string, options?: RequestInit) => {
        calls.push({ path, options });
        return structuredClone(responses.shift());
    });
    return { calls, request: request as unknown as Parameters<typeof createClients>[0]['request'] };
}

describe('runs client', () => {
    it('encodes run list queries and returns the offset envelope', async () => {
        const server = stub({ items: [{ id: 'r1' }], total: 1, nextOffset: null });
        const { runs } = createClients({ request: server.request });
        await expect(runs.list({ summary: true, status: 'failed,interrupted', limit: 25, offset: 50 }))
            .resolves.toEqual({ items: [{ id: 'r1' }], total: 1, nextOffset: null });
        expect(server.calls[0]!.path).toBe('/runs?summary=true&status=failed%2Cinterrupted&limit=25&offset=50');
    });

    it('keeps the progress payload unfabricated: exactly the server fields', async () => {
        const server = stub({ id: 'r1', configHash: 'h', status: 'running', round: 2, turn: 5, updatedAt: '2026-11-07T12:00:00Z', observedAt: '2026-11-07T12:00:01Z', executionPhase: 'action', rounds: 7 });
        const { runs } = createClients({ request: server.request });
        const progress = await runs.progress('r1');
        expect(progress.status).toBe('running');
        expect(progress.executionPhase).toBe('action');
        expect(server.calls[0]!.path).toBe('/runs/r1/progress');
    });

    it('normalises the numeric event cursor to an opaque string', async () => {
        const server = stub({ events: [{ id: 'e1', sequence: 4 }], items: [{ id: 'e1', sequence: 4 }], nextCursor: 4, hasMore: true });
        const { runs } = createClients({ request: server.request });
        await expect(runs.events('r1', { limit: 50, phase: 'action' })).resolves.toEqual({ items: [{ id: 'e1', sequence: 4 }], nextCursor: '4' });
        expect(server.calls[0]!.path).toBe('/runs/r1/events?limit=50&phase=action');
    });

    it('exposes export URLs and mutations without a page building a path', async () => {
        const server = stub({ id: 'r1', status: 'stopping' }, { id: 'd1' });
        const { runs } = createClients({ request: server.request });
        expect(runs.exportUrl('r1')).toBe('/api/runs/r1/export');
        expect(runs.paths.board('r1', { limit: 30, offset: 60 })).toBe('/runs/r1/board?limit=30&offset=60');
        await expect(runs.cancel('r1')).resolves.toMatchObject({ status: 'stopping' });
        await expect(runs.duplicate('r1')).resolves.toEqual({ id: 'd1' });
        expect(server.calls.map(call => `${call.options?.method ?? 'GET'} ${call.path}`)).toEqual(['POST /runs/r1/cancel', 'POST /runs/r1/duplicate']);
    });
});
```

Create `dashboard/src/lib/clients/analyses.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createClients } from './context';
import type { AnalysisSettings } from '../analysis-types';

function stub(...responses: unknown[]) {
    const calls: { path: string; options?: RequestInit; body?: any }[] = [];
    const request = vi.fn(async (path: string, options?: RequestInit) => {
        calls.push({ path, options, body: options?.body ? JSON.parse(String(options.body)) : undefined });
        return structuredClone(responses.shift());
    });
    return { calls, request: request as unknown as Parameters<typeof createClients>[0]['request'] };
}

const settings = { codebookId: 'book', codebookRevisionId: 'revision-1', model: 'jev-1.14.0', windowSize: 12, stride: 4, phases: ['action'], evidence: ['assistant'], headroom: 2000, timeoutMs: 60000, maxAttempts: 2, creator: 'Researcher' } as AnalysisSettings;

describe('analyses client', () => {
    it('previews and then launches with the frozen preview token', async () => {
        const server = stub(
            { previewHash: 'frozen', runId: 'run-1', windowCount: 1, scoredCodeCount: 1, partialWindows: 0, evidenceAvailability: {}, diagnostics: [], windows: [] },
            { id: 'analysis-1', runId: 'run-1', status: 'queued' },
        );
        const { analyses } = createClients({ request: server.request });
        await expect(analyses.preview('run-1', settings)).resolves.toMatchObject({ previewToken: 'frozen' });
        await analyses.launch('run-1', settings, 'frozen');
        expect(server.calls[0]!.path).toBe('/runs/run-1/analyses/preview');
        expect(server.calls[1]!.path).toBe('/runs/run-1/analyses');
        expect(server.calls[1]!.body).toMatchObject({ previewHash: 'frozen', idempotencyKey: 'frozen', codebookRevisionId: 'revision-1' });
    });

    it('exposes both analysis export URLs', () => {
        const { analyses } = createClients({ request: stub().request });
        expect(analyses.exportUrl('a1')).toBe('/api/jev/analyses/a1/export');
        expect(analyses.datasetExportUrl('a1', 'analysis')).toBe('/api/analyses/a1/export?dataset=analysis&limit=100');
    });

    it('addresses the Jev routes through the adapter, not through page-built strings', async () => {
        const server = stub({ items: [], nextCursor: null }, { items: [], nextCursor: null });
        const { analyses, codebooks } = createClients({ request: server.request });
        await analyses.list({ limit: 30 });
        await codebooks.list({ limit: 30 });
        expect(server.calls.map(call => call.path)).toEqual(['/jev/analyses?limit=30', '/jev/codebooks?limit=30']);
    });
});
```

- [ ] **Step 2.2: Run the tests to verify they fail**

```bash
npm test --workspace sidechannel-dashboard -- src/lib/clients
```

Expected: FAIL — `Cannot find module './context'`.

- [ ] **Step 2.3: Create `adapters/jev.ts` (translate + session + moved mappers)**

Create the file with this structure, then **move** the mappers verbatim from `jev-transport.ts` using the substitution table. Nothing else may change in this task (the fabricated values survive to T5.4 by design, so every page keeps rendering identically).

```ts
/** Explicit boundary between canonical Jev records and the dashboard's view models. */
import type {
    AnalysisConfiguration, AnalysisJob as JevJob, AnalysisResult as JevResult, Codebook as JevCodebook,
    CodebookRevision as JevRevision, EvidenceCategory as JevCategory, Page, Review as JevReview,
    ReviewBatch as JevBatch, SerializedWindow, WindowRecord,
} from '@sidechannel/contracts/browser';
import type {
    AnalysisJob, AnalysisPreview, AnalysisSettings, AnalysisWindow, Codebook, CodebookRevision,
    EvidenceCategory, HumanReview, ReviewBatch, ReviewSelection, WindowDetail,
} from '../analysis-types';
import type { Requester } from '../transport';

export interface PreviewContext { runId: string; body: Record<string, unknown> }

/** Bounded caches owned by the provider (never module scope). Insertion-ordered LRU. */
export interface JevSession {
    job(id: string): JevJob | undefined;
    rememberJob(job: JevJob): JevJob;
    review(id: string): JevReview | undefined;
    rememberReview(review: JevReview): JevReview;
    window(jobId: string, windowId: string): WindowRecord | undefined;
    rememberWindow(jobId: string, window: WindowRecord): void;
    preview(token: string): PreviewContext | undefined;
    rememberPreview(token: string, context: PreviewContext): void;
}

export function createJevSession(limit = 200): JevSession {
    const jobs = new Map<string, JevJob>(), reviews = new Map<string, JevReview>(), windows = new Map<string, WindowRecord>(), previews = new Map<string, PreviewContext>();
    const put = <T,>(map: Map<string, T>, key: string, value: T, max: number): T => {
        map.delete(key); map.set(key, value);
        while (map.size > max) map.delete(map.keys().next().value!);
        return value;
    };
    return {
        job: id => jobs.get(id),
        rememberJob: job => put(jobs, job.id, job, limit),
        review: id => reviews.get(id),
        rememberReview: review => put(reviews, review.id, review, limit),
        window: (jobId, windowId) => windows.get(JSON.stringify([jobId, windowId])),
        rememberWindow: (jobId, window) => { put(windows, JSON.stringify([jobId, window.id]), window, limit); },
        preview: token => previews.get(token),
        rememberPreview: (token, context) => { put(previews, token, context, 10); },
    };
}

const ROUTE = /^\/(codebooks(\/[^/]+(\/revisions(\/[^/]+)?)?)?|analyses(\/[^/]+(\/windows(\/[^/]+)?|\/reviews(\/[^/]+)?|\/review-batches(\/[^/]+)?|\/(cancel|retry))?)?|runs\/[^/]+\/analyses(\/preview)?|analysis-previews\/[^/]+\/windows\/[^/]+)$/;

/** Pure: dashboard path → canonical Jev path. `undefined` means "not a Jev route". */
export function translate(path: string, init?: RequestInit): { path: string; init?: RequestInit } | undefined {
    const url = new URL(path, 'http://local');
    return ROUTE.test(url.pathname) ? { path: '/jev' + path, init } : undefined;
}

/** Composes translation, transport and decoding over one injected requester and one session. */
export function createJevRequester(base: Requester, session: JevSession = createJevSession()): Requester {
    return async <T,>(path: string, init?: RequestInit): Promise<T> => {
        const translated = translate(path, init);
        if (!translated) return base<T>(path, init);
        const payload = await base<unknown>(translated.path, translated.init);
        const decoded = await decodeJev<T>(path, payload, session, id => base<JevJob>('/jev/analyses/' + encodeURIComponent(id), undefined));
        return (decoded ?? payload) as T;
    };
}
```

Then move `jev-transport.ts:8-21` and `:22-40` (the `jevTransport` dispatch) into `decodeJev(path, payload, session, readJob)` with these exact substitutions (everything else stays byte-identical):

| `jev-transport.ts` | Replacement |
| --- | --- |
| `const jobCache=new Map<string,JevJob>();` etc. (line 7) | deleted — `session` parameter |
| `jobCache.set(raw.id,raw)` (16) | `session.rememberJob(raw)` |
| `reviewCache.set(raw.id,raw)` (18) | `session.rememberReview(raw)` |
| `windowCache.set(JSON.stringify([raw.jobId,raw.id]),raw)` (17) | `session.rememberWindow(raw.jobId, raw)` |
| `jobCache.get(raw.jobId)` (17, 18) | `session.job(raw.jobId)` |
| `windowCache.get(JSON.stringify([raw.analysisId,windowId]))` (18) | `session.window(raw.analysisId, windowId)` |
| `previewCache.get(...)`, `.set(...)`, `.size>10` cap (30, 31, 37) | `session.preview(...)`, `session.rememberPreview(...)`; the 10-entry preview cap moves into `createJevSession` |
| `reviewCache.get(b.supersedesId)` (36) | `session.review(b.supersedesId)` |
| `ensureJob(fetch,id)` (19) | `ensureJob(id)` → `session.job(id) ?? session.rememberJob(await readJob(id))` |
| `fetch<...>(...)` calls (24-38) | **removed** — `decodeJev` receives the already-fetched `payload` |
| `jevTransport`'s `bodyOf`/`request` and the PATCH/POST branches (26, 29, 30, 36, 37) | moved to `clients/analyses.ts` + `clients/codebooks.ts` (Step 2.4); `decodeJev` only maps responses |
| `else return undefined;` (39) | `else return undefined;` (unchanged) |

Because request construction moves out, each `decodeJev` branch becomes payload→view-model. Pass 1 of the port keeps the mapping expressions verbatim (including `revision:1`, `archived:false`, `canonicalSettings`'s invented `inputLimits`, and the `windowRecord` `throw new Error('Source analysis manifest unavailable')`), so `adapters/jev.test.ts` (Step 2.5) is a true characterization.

- [ ] **Step 2.4: Create the client modules**

`clients/runs.ts`:

```ts
import type { BoardMessage, HarnessEvent, Run } from '@sidechannel/contracts/browser';
import type { EvidencePage } from '@sidechannel/contracts/harness/repository';
import type { Requester } from '../transport';
import { withQuery } from '../transport';
import type { OffsetPage, Page } from '../contracts';
import type { Draft, HealthcareEvaluation, PairLaunch, PairView } from '../types';

export type EvidenceKind = 'board' | 'artifacts' | 'reports';
export interface RunEventQuery { limit?: number; after?: string; actor?: string; phase?: string; type?: string; from?: number; to?: number }
export interface RunListQuery { status?: string; model?: string; condition?: string; scenario?: string; designation?: string; summary?: boolean; limit?: number; offset?: number }

export const runPaths = {
    list: (query: RunListQuery = {}) => withQuery('/runs', { summary: query.summary, status: query.status, model: query.model, condition: query.condition, scenario: query.scenario, designation: query.designation, limit: query.limit, offset: query.offset }),
    get: (id: string) => '/runs/' + encodeURIComponent(id),
    progress: (id: string) => '/runs/' + encodeURIComponent(id) + '/progress',
    events: (id: string, query: RunEventQuery = {}) => withQuery('/runs/' + encodeURIComponent(id) + '/events', query),
    event: (id: string, eventId: string) => '/runs/' + encodeURIComponent(id) + '/events/' + encodeURIComponent(eventId),
    evidence: (id: string, kind: EvidenceKind, page: { limit: number; offset: number }) => withQuery('/runs/' + encodeURIComponent(id) + '/' + kind, page),
    evidenceItem: (id: string, kind: EvidenceKind, key: string) => '/runs/' + encodeURIComponent(id) + '/' + kind + '/' + encodeURIComponent(key),
    board: (id: string, page: { limit: number; offset: number; afterDelivery?: number }) => withQuery('/runs/' + encodeURIComponent(id) + '/board', page),
    pair: (id: string) => '/pairs/' + encodeURIComponent(id),
    evaluation: (id: string) => '/runs/' + encodeURIComponent(id) + '/evaluation',
};

export interface RunsClient {
    paths: typeof runPaths;
    list(query?: RunListQuery): Promise<OffsetPage<Run>>;
    get(id: string): Promise<Run>;
    progress(id: string): Promise<Partial<Run> & { observedAt: string }>;
    events(id: string, query?: RunEventQuery): Promise<Page<HarnessEvent>>;
    event(id: string, eventId: string): Promise<HarnessEvent>;
    evidence(id: string, kind: EvidenceKind, query: { offset: number; limit: number }): Promise<EvidencePage>;
    evidenceItem(id: string, kind: EvidenceKind, key: string): Promise<unknown>;
    board(id: string, query: { offset: number; limit: number }): Promise<{ items: BoardMessage[]; total: number; nextOffset: number | null; posts: BoardMessage[]; deliveries: HarnessEvent[]; nextDeliveryCursor: number; deliveriesMayHaveMore: boolean }>;
    exportUrl(id: string): string;
    cancel(id: string): Promise<Run>;
    duplicate(id: string): Promise<Draft>;
    pair(id: string): Promise<PairView>;
    evaluation(id: string): Promise<HealthcareEvaluation>;
    createPair(input: PairLaunch): Promise<Run[]>;
}

export function createRunsClient(request: Requester): RunsClient {
    const post = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
    return {
        paths: runPaths,
        list: query => request(runPaths.list(query)),
        get: id => request(runPaths.get(id)),
        progress: id => request(runPaths.progress(id)),
        events: async (id, query) => {
            const payload = await request<{ events?: HarnessEvent[]; items: HarnessEvent[]; nextCursor: number; hasMore?: boolean }>(runPaths.events(id, query));
            return { items: payload.events ?? payload.items, nextCursor: payload.hasMore ? String(payload.nextCursor) : null };
        },
        event: (id, eventId) => request(runPaths.event(id, eventId)),
        evidence: (id, kind, query) => request(runPaths.evidence(id, kind, query)),
        evidenceItem: (id, kind, key) => request(runPaths.evidenceItem(id, kind, key)),
        board: (id, query) => request(runPaths.board(id, query)),
        exportUrl: id => '/api/runs/' + encodeURIComponent(id) + '/export',
        cancel: id => post('/runs/' + encodeURIComponent(id) + '/cancel', {}),
        duplicate: id => post('/runs/' + encodeURIComponent(id) + '/duplicate', {}),
        pair: id => request(runPaths.pair(id)),
        evaluation: id => request(runPaths.evaluation(id)),
        createPair: input => post('/pairs', input),
    };
}
```

`clients/codebooks.ts` — paths `list`/`get`/`revisions`/`revision`; methods exactly as the **Interfaces** block; `create` posts to `/codebooks` with `{ name, creator: author, definitions: codes }`, `revise` PATCHes `/codebooks/:id` with `{ expectedRevisionId, name, creator, definitions }`; both throw `'The edited codebook revision ID is required. Reload its revision before saving.'` when `expectedRevisionId` is empty (moved from `jev-transport.ts:29`). `get` performs the two requests the adapter used to make (`GET /codebooks/:id` then `GET /codebooks/:id/revisions/:currentRevisionId`) and returns the pair decoded by the adapter.

`clients/analyses.ts` — paths `list`/`job`/`windows` (`withResults=true` always)/`window`/`runJobs`/`preview`/`previewWindow`/`launch`/`cancel`/`retry`/`reviews`/`batches`/`batch`; methods as the **Interfaces** block. Request bodies are moved verbatim from `jev-transport.ts`:
- `preview(runId, settings)` → `POST /runs/:runId/analyses/preview` with `{ codebookId, codebookRevisionId, settings: canonicalSettings(settings) }`, then `session.rememberPreview(payload.previewHash, { runId, body })`.
- `launch(runId, settings, previewToken)` → `POST /runs/:runId/analyses` with `{ ...payload, previewHash: previewToken, idempotencyKey: settings.idempotencyKey ?? previewToken, creator: settings.creator, parentAnalysisId: settings.parentAnalysisId }`.
- `previewWindow(token, windowId)` → looks the token up in the session, throws `'Preview settings expired in this browser. Prepare a fresh preview.'` when absent, otherwise `POST /runs/:runId/analyses/preview/windows/:windowId` with `{ ...context.body, previewHash: token }` and returns `{ state: raw.input.state }`. This is the one route whose target depends on session state, so the client builds the path directly and `translate` never sees `/analysis-previews/...`.
- `saveReview(id, input)` → admission rules moved verbatim from `jev-transport.ts:36`: exactly-one-event for `scope==='event'`, superseded review must exist, subject/scope/code/reviewer must match the previous review; then `POST /analyses/:id/reviews` with `{ scope, subjectId: scope==='event' ? eventIds[0] : windowId, codeId, definitionRevision: job.manifest.codebook.id, evidenceRevision: job.manifest.source.evidenceHash, reviewer, decision, rationale, eventIds, stepIds, predictionsVisible, expectedRevision: previous?.revision ?? 0 }` (the job comes from the session, which the page's `job` query has already filled).

`clients/monitor.ts`, `clients/reviews.ts`, `clients/workspace.ts` — methods exactly as the **Interfaces** block, built like `runs.ts` over the injected requester (`post` helper inline).

`clients/context.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import { RequesterProvider } from '../api';
import { request, type Requester } from '../transport';
import { createJevRequester, createJevSession } from '../adapters/jev';
import { createRunsClient, type RunsClient } from './runs';
import { createCodebooksClient, type CodebooksClient } from './codebooks';
import { createAnalysesClient, type AnalysesClient } from './analyses';
import { createMonitorClient, type MonitorClient } from './monitor';
import { createReviewsClient, type ReviewsClient } from './reviews';
import { createWorkspaceClient, type WorkspaceClient } from './workspace';

export interface ApiClients {
    request: Requester;
    runs: RunsClient; codebooks: CodebooksClient; analyses: AnalysesClient;
    monitor: MonitorClient; reviews: ReviewsClient; workspace: WorkspaceClient;
}

/** Composition root for dashboard data access. Tests pass a fake `request`. */
export function createClients(overrides: { request?: Requester } = {}): ApiClients {
    const session = createJevSession();
    const api = createJevRequester(overrides.request ?? request, session);
    return {
        request: api,
        runs: createRunsClient(api),
        codebooks: createCodebooksClient(api, session),
        analyses: createAnalysesClient(api, session),
        monitor: createMonitorClient(api),
        reviews: createReviewsClient(api),
        workspace: createWorkspaceClient(api),
    };
}

const fallback = createClients();
const ClientsContext = createContext<ApiClients>(fallback);
export const useClients = (): ApiClients => useContext(ClientsContext);

export function ApiClientProvider({ clients, children }: { clients: ApiClients; children: ReactNode }) {
    return <ClientsContext.Provider value={clients}><RequesterProvider value={clients.request}>{children}</RequesterProvider></ClientsContext.Provider>;
}
```

- [ ] **Step 2.5: Port the transport characterization suite**

Create `dashboard/src/lib/adapters/jev.test.ts` and `add` the client cases to `clients/analyses.test.ts`:

```ts
// @vitest-environment node
import { expect, it } from 'vitest';
import { createJevRequester, createJevSession, translate } from './jev';

it('translate is pure: prefixes Jev routes and rejects every non-Jev route', () => {
    expect(translate('/codebooks?limit=30')).toEqual({ path: '/jev/codebooks?limit=30', init: undefined });
    expect(translate('/analyses/a1/windows?withResults=true')).toEqual({ path: '/jev/analyses/a1/windows?withResults=true', init: undefined });
    expect(translate('/runs/r1/analyses/preview')).toEqual({ path: '/jev/runs/r1/analyses/preview', init: undefined });
    expect(translate('/runs/r1')).toBeUndefined();
    expect(translate('/monitor-evaluations')).toBeUndefined();
    expect(translate('/drafts')).toBeUndefined();
    expect(translate('/runs/r1/outcomes')).toBeUndefined();
});

it('the session is bounded, keyed and never module scope', () => {
    const session = createJevSession(2);
    session.rememberJob({ id: 'a' } as never);
    session.rememberJob({ id: 'b' } as never);
    session.rememberJob({ id: 'c' } as never);
    expect(session.job('a')).toBeUndefined();
    expect(session.job('c')).toEqual({ id: 'c' });
    const previews = createJevSession();
    for (let index = 0; index < 12; index++) previews.rememberPreview('t' + index, { runId: 'r', body: {} });
    expect(previews.preview('t0')).toBeUndefined();
    expect(previews.preview('t11')).toBeDefined();
});

it('two requesters never share cached jobs', async () => {
    const first = createJevRequester(async path => path === '/jev/analyses/a1' ? { id: 'a1' } as never : ({} as never));
    await first('/analyses/a1');
    const second = createJevRequester(async () => { throw new Error('must not be called'); });
    await expect(second('/analyses/a1')).rejects.toThrow();
});
```

Then move every case from `jev-transport.test.ts` into `clients/analyses.test.ts` (or `adapters/jev.test.ts` where it tests mapping only), rewriting `jevTransport(path, init, server.fetch)` as `clients.<resource>.<method>(…)` and asserting `server.calls[i].path`/`.body` instead of the transport's adapted call arguments. The fixtures (`fixture()`, `summary()`, `stub()`) move unchanged. Expected case-by-case mapping:

| `jev-transport.test.ts` case | New home |
| --- | --- |
| "sends the form's captured revision ID…" | `clients/codebooks.test.ts` (add file) — asserts `PATCH /jev/codebooks/book` body `expectedRevisionId` + `definitions` |
| "rejects codebook PATCH without its explicit revision…" | `clients/codebooks.test.ts` |
| "preserves every resolved setting…" | `clients/analyses.test.ts` |
| "launches the selected codebook/model/window/evidence…" | `clients/analyses.test.ts` |
| "maps actual nested preview budgets and retrieves exact inputs…" | `adapters/jev.test.ts` (+ `analyses.previewWindow`) |
| "preserves zero probabilities and missing siblings…" | `adapters/jev.test.ts` (job must be loaded first; assert the `readJob` fetch) |
| "returns exact window state…" | `adapters/jev.test.ts` |
| "retains event subjects and expected review revision…" | `clients/analyses.test.ts` (the multi-event throw stays here until T5.4) |
| "never reconstructs hidden blind sampling reasons…" | `adapters/jev.test.ts` |
| "leaves independent run outcomes and monitor API calls untouched" | `adapters/jev.test.ts` (`translate` returns `undefined`) |
| "forwards exact latest-review and whole-population queue filters…" | `clients/analyses.test.ts` (`URLSearchParams` equality preserved) |
| "adapts the global analysis collection and preserves pagination" | `clients/analyses.test.ts` |

- [ ] **Step 2.6: Run the ported suite green, then delete the old module**

```bash
npm test --workspace sidechannel-dashboard -- src/lib/clients src/lib/adapters
git rm dashboard/src/lib/jev-transport.ts dashboard/src/lib/jev-transport.test.ts
```

Expected: PASS (all ported cases). Nothing else imports `jev-transport` after Step 2.7.

- [ ] **Step 2.7: Wire the provider and replace every page/component path literal**

`dashboard/src/main.tsx` — wrap the existing tree:

```tsx
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ApiClientProvider, createClients } from './lib/clients/context';
import './styles.css';

createRoot(document.getElementById('root')!).render(
    <BrowserRouter>
        <ApiClientProvider clients={createClients()}>
            <App />
        </ApiClientProvider>
    </BrowserRouter>,
);
```

(Keep the current `BrowserRouter`/stylesheet arrangement; only the provider is added.)

Move map — add `const clients = useClients();` once per component function; each row is `file:line → replacement`:

| File:line | Replacement |
| --- | --- |
| `App.tsx:26` | `useApi<{ mode: 'demo' \| 'research' }>(clients.workspace.paths.mode())` |
| `App.tsx:6` | drop `arrayOf` from the import |
| `Overview.tsx:18` | `useApi<Page<Job>>(path, { interval: 5000 })` (path passed by the caller) |
| `Overview.tsx:29` | `useApi<OverviewData>(clients.workspace.paths.overview(), { interval: 5000 })`, `useApi<OffsetPage<Run>>(clients.runs.paths.list({ summary: true, limit: 8 }), { interval: 5000 })` |
| `Overview.tsx:30` | `useApi<Draft[]>(clients.workspace.paths.drafts())` |
| `Overview.tsx:50` | `path={clients.analyses.paths.list({ limit: 6 })}` / `path={clients.monitor.paths.evaluations({ limit: 6 })}` |
| `Experiments.tsx:161-165` | `clients.workspace.paths.defaults()`, `.drafts()`, `.schema()` |
| `Experiments.tsx:218` | `clients.workspace.draft(params.get("draft")!)` |
| `Experiments.tsx:292` | `clients.workspace.saveDraft({ id: draft?.id, revision: draft?.revision, config, name: config?.label, notes })` |
| `Experiments.tsx:312` | `clients.workspace.validate(config!)` |
| `Experiments.tsx:330` | `clients.runs.createPair({ config, idempotencyKey: launchKey.current, pairingSeed: config?.scheduler?.seed, ...(!dirty && draft ? { sourceDraftId: draft.id, sourceDraftRevision: draft.revision } : {}) })` |
| `Experiments.tsx:366` | `clients.workspace.duplicateDraft(draft.id)` |
| `Runs.tsx:82,212,213,232,263,955,1076` | `clients.runs.paths.list({...})`, `.get(id)`, `.progress(id)`, `.events(id, query)`, `.board(id, page)` / `.evidence(id, kind, page)`, `.pair(id)`, `.get(summary.id)` |
| `Runs.tsx:316,323` | `clients.runs.cancel(id!)`, `clients.runs.duplicate(id!)` |
| `Runs.tsx:355` | `<a href={clients.runs.exportUrl(id!)} download>` |
| `Analysis.tsx:96,164,210,212,231,964,965,968,975,978,989,992,995,1697,1964,1967,2038,2107,2125,2131` | `clients.analyses.paths.*` / `clients.runs.paths.get(...)` with the same argument order; `books`/`revisionHistory` use `clients.codebooks.paths.*` |
| `Analysis.tsx:1045` | `<a href={clients.analyses.exportUrl(id!)} download>` |
| `Analysis.tsx:1431` | `href={clients.analyses.datasetExportUrl(id!, dataset)}` |
| `Analysis.tsx:281,291,1061,1077,1732,2156` | `clients.analyses.launch(runId, settings, preview.previewToken)`, `.preview(runId, settings)`, `.cancel(id!)`, `.retry(id!)`, `.createBatch(job.id, {…})`, `.saveReview(job.id, {…})` |
| `Oversight.tsx:198,199,202,203,209,784,1223,1227,1231,1611,1614,1622,1626,1643` | `clients.monitor.paths.*` / `clients.runs.paths.list(...)` / `clients.reviews.paths.*` |
| `Oversight.tsx:254,265,831,1288` | `clients.monitor.preview({…})`, `.launch({…})`, `.saveDefinition({ ...draft, expectedRevision: draft.revision })`, `.cancel(id!)` |
| `Oversight.tsx:1272` | `<a href={clients.monitor.exportUrl(id!)} download>` |
| `Oversight.tsx:1665` | `clients.reviews.save(runId, {…})` |
| `Oversight.tsx:1697-1702` | `href={clients.reviews.exportUrl(runId, data.definition.id)}` |
| `Codebook.tsx:40,44,61,144,160` | `clients.codebooks.paths.list({ limit: 30 })`, `.get(bookId)`, `.revisions(bookId, { limit: 30 })`, `.create({…})`, `.revise(bookId, {…})` |
| `model-controls.tsx:15-17` | `useApi<AdaptionModelCatalog>(config.model.provider === 'adaption' ? clients.workspace.paths.adaptionModels() : null)` |
| `healthcare-preset.tsx:15,25` | `useApi<DatasetCatalogItem[]>(clients.workspace.paths.datasets())`, `clients.workspace.preset(id)` |
| `healthcare-results.tsx:8` | `useApi<HealthcareEvaluation>(clients.runs.paths.evaluation(runId), { interval: 4000 })` |
| `Analysis.tsx:940-947` | `const state = usePageRequest(token ? () => clients.analyses.previewWindow(token, windowId) : null);` |

Any remaining `api(`/`post(`/`rawApi(` call becomes the matching client method; delete `api`, `rawApi` and `post` from `api.ts` (`arrayOf` is removed in T5.3 with its last users).

- [ ] **Step 2.8: Migrate every test to `ApiClientProvider`**

Extend `dashboard/src/test/clients.tsx`:

```tsx
import { ApiClientProvider, createClients } from '../lib/clients/context';

export const fakeClients = (server: FakeServer) => createClients({ request: server.request });
export const renderWithClients = (node: ReactNode, server: FakeServer) =>
    render(<ApiClientProvider clients={fakeClients(server)}>{node}</ApiClientProvider>);
```

In every page/component test (`pages/{Analysis,Experiments,Codebook,RunsOversight,Healthcare}.test.tsx`, `components/{healthcare,ui}.test.tsx`, `workflows.test.tsx`, `oversight-pagination.test.tsx`): delete `vi.stubGlobal('fetch', …)` and the `vi.mock('../lib/api', …)` block, create `const server = fakeServer(); server.respond((path, options) => …)` with the same route cases (paths now Jev-prefixed where the adapter prefixes them — assert via `server.calls`), and render through `renderWithClients(node, server)`. Keep the existing behavioural assertions verbatim.

- [ ] **Step 2.9: Run the suite and the gates**

```bash
npm test --workspace sidechannel-dashboard
npm run check --workspace sidechannel-dashboard
git grep -c "fetch(" -- dashboard/src
git grep -n '"/api/\|`/api/' -- dashboard/src/pages dashboard/src/components dashboard/src/App.tsx dashboard/src/main.tsx
```

Expected: PASS. `fetch(` appears only in `lib/transport.ts` (1) plus the `vi.stubGlobal('fetch')` line in `lib/transport.test.ts`. No page/component/JSX builds an `/api/` string (only `clients/*.ts` `exportUrl` builders do).

- [ ] **Step 2.10: Commit**

```bash
git add dashboard/src/lib dashboard/src/test dashboard/src/pages dashboard/src/components dashboard/src/App.tsx dashboard/src/main.tsx
git commit -m "refactor(dashboard): typed clients, ApiClientProvider and stateless jev translator (WS5 T5.2)"
```

**Effort:** 2–2.5 dev-days. **Behaviour-change statement:** none — this task only moves code (the mappers are copied verbatim, including the values T5.4 then removes), proven by the ported characterization suite. **Rollback:** `git revert` restores `jev-transport.ts` and the string paths. **Out of scope:** moving `RunTable` out of `App.tsx` (WS6 T6.7); component extraction; WS4's provider/scenario descriptors.

---

## Task 5.3: One envelope contract, typed `/runs/:id/:tab`, `arrayOf` deleted

**Files:**
- Modify: `dashboard/src/lib/contracts.ts`, `dashboard/src/lib/types.ts` (add `RunSummary` re-export, `PairView`, `PairLaunch`, `HealthcareEvaluation`, `RunEvidenceItem`, `DraftSave`, `ConfigSchema`, `Validation`), `dashboard/src/lib/analysis-types.ts` (drop its local `Page<T>`), `dashboard/src/lib/clients/runs.ts` (`progress` returns `RunProgress`), `dashboard/src/pages/{Runs,Overview,Oversight}.tsx`, `dashboard/src/App.tsx`
- Create: `dashboard/src/lib/contracts.test.ts`
- Modify (cross-plan, one line): `packages/contracts/src/browser.ts` (+ `harness/contracts.ts` if the barrel cannot reach `RunSummary`)

**Interfaces:**
- Consumes: `Page<T>`, `OffsetPage<T>`, `Identified` (T5.1/T5.2).
- Produces:

```ts
// dashboard/src/lib/contracts.ts
export interface RunReport { agentId: string; raw: string; parsed: Json | null }
export interface ReportingInstructions { instructions: string; schemaVersion: string }
export interface BoardPage extends OffsetPage<BoardMessage> {
    posts: BoardMessage[]; deliveries: HarnessEvent[];
    nextDeliveryCursor: number; deliveriesMayHaveMore: boolean;
}
export interface ArtifactPage extends OffsetPage<ArtifactVersion> { reporting?: ReportingInstructions }
export interface ReportPage extends OffsetPage<RunReport> { reporting?: ReportingInstructions }
export interface MemoryPage { items: HarnessEvent[]; nextOffset: number | null }
export interface EvidencePages { board: BoardPage; artifacts: ArtifactPage; reports: ReportPage; memory: MemoryPage }
export type RunTab = keyof EvidencePages;
export interface RunProgress {
    id: string; status: RunStatus; round: number; turn: number; updatedAt: string;
    activeAgentId?: string; failureReason?: string; cancelRequested?: boolean;
    usage?: Record<string, number>;
    observedAt: string; executionPhase: 'action' | 'report'; rounds: number;
}
export function mergeProgress(run: Run, progress: RunProgress | undefined): Run;
```

- `RunSummary` comes from `@sidechannel/contracts/browser` (added here); `RunProgress` is dashboard-owned because it composes a summary with observation metadata.
- `mergeProgress` makes the authority explicit (audit F12): `status`, `round`, `turn`, `updatedAt`, `activeAgentId`, `failureReason`, `cancelRequested` and `usage` come from `progress` when present; everything else — including `config` — comes from the frozen `run`.

- [ ] **Step 3.1: Write the failing envelope test**

Create `dashboard/src/lib/contracts.test.ts`:

```ts
// @vitest-environment node
import { expect, expectTypeOf, it } from 'vitest';
import type { ArtifactVersion, BoardMessage, HarnessEvent, Run, RunStatus, RunSummary } from '@sidechannel/contracts/browser';
import type { BoardPage, MemoryPage, OffsetPage, Page, RunProgress, RunTab } from './contracts';
import { mergeProgress } from './contracts';
import type { RunsClient } from './clients/runs';

it('declares one cursor envelope and one offset envelope', () => {
    expectTypeOf<Page<{ id: string }>>().toEqualTypeOf<{ items: { id: string }[]; nextCursor: string | null }>();
    expectTypeOf<OffsetPage<{ id: string }>>().toEqualTypeOf<{ items: { id: string }[]; total: number; nextOffset: number | null }>();
    expect(Object.keys({} as Page<never>)).toEqual([]);
});

it('types each /runs/:id/:tab response instead of Record<string, unknown> | unknown[]', () => {
    expectTypeOf<BoardPage['items']>().toEqualTypeOf<BoardMessage[]>();
    expectTypeOf<BoardPage['deliveries']>().toEqualTypeOf<HarnessEvent[]>();
    expectTypeOf<MemoryPage['items']>().toEqualTypeOf<HarnessEvent[]>();
    expectTypeOf<ArtifactVersion>().not.toBeNever();
    expectTypeOf<RunTab>().toEqualTypeOf<'board' | 'artifacts' | 'reports' | 'memory'>();
});

it('keeps the run list a summary and the progress endpoint explicit', () => {
    expectTypeOf<RunSummary['status']>().toEqualTypeOf<RunStatus>();
    expectTypeOf<RunProgress['executionPhase']>().toEqualTypeOf<'action' | 'report'>();
    expectTypeOf<ReturnType<RunsClient['progress']>>().toEqualTypeOf<Promise<RunProgress>>();
});

it('merges progress with an explicit authority order and never partially retypes the record', () => {
    const run = { id: 'r1', status: 'running', round: 1, turn: 2, updatedAt: 'a', config: { label: 'Frozen' }, board: [], artifacts: [], reports: [], operations: {}, usage: {} } as unknown as Run;
    const progress: RunProgress = { id: 'r1', status: 'completed', round: 3, turn: 6, updatedAt: 'b', observedAt: 'c', executionPhase: 'report', rounds: 7, usage: { tokens: 1 } };
    const merged = mergeProgress(run, progress);
    expect(merged.status).toBe('completed');
    expect(merged.round).toBe(3);
    expect(merged.config).toBe(run.config);
    expect(merged.usage).toEqual({ tokens: 1 });
    expect(mergeProgress(run, undefined)).toBe(run);
});
```

- [ ] **Step 3.2: Run the test to verify it fails**

```bash
npm test --workspace sidechannel-dashboard -- src/lib/contracts.test.ts
npm run check --workspace sidechannel-dashboard
```

Expected: FAIL — `Module './contracts' has no exported member 'BoardPage'`; `@sidechannel/contracts/browser` does not export `RunSummary`.

- [ ] **Step 3.3: Add the single cross-plan barrel line**

`packages/contracts/src/browser.ts:2` becomes:

```ts
export type { ExperimentConfig, Run, RunSummary, RunStatus, HarnessEvent, BoardMessage, ArtifactVersion, Json } from './harness/contracts.js';
```

`RunSummary` is defined at `packages/contracts/src/harness/repository.ts:26`; if the barrel cannot reach it, add `export type { RunSummary } from './repository.js';` to `packages/contracts/src/harness/contracts.ts` in the same PR. Coordinated as D5.3.

- [ ] **Step 3.4: Implement the envelope types and `mergeProgress`**

Extend `dashboard/src/lib/contracts.ts` with the **Interfaces** block plus:

```ts
export function mergeProgress(run: Run, progress: RunProgress | undefined): Run {
    if (!progress) return run;
    return {
        ...run, config: run.config,
        status: progress.status, round: progress.round, turn: progress.turn, updatedAt: progress.updatedAt,
        ...(progress.activeAgentId !== undefined ? { activeAgentId: progress.activeAgentId } : {}),
        ...(progress.failureReason !== undefined ? { failureReason: progress.failureReason } : {}),
        ...(progress.cancelRequested !== undefined ? { cancelRequested: progress.cancelRequested } : {}),
        ...(progress.usage !== undefined ? { usage: progress.usage } : {}),
    };
}
```

- [ ] **Step 3.5: Delete `arrayOf` and type the tab responses**

1. `analysis-types.ts:8` — delete `export interface Page<T> { … }`; import `Page` from `./contracts` (and re-export it for the pages that still import it from `analysis-types`).
2. Remove the `arrayOf` import from `App.tsx:6`, `Overview.tsx:4`, `Runs.tsx:44`, `Oversight.tsx:44`, then delete `export const arrayOf` from `api.ts`.
3. `Overview.tsx:18,31` → `const jobs = useApi<Page<Job>>(path, { interval: 5000 }); const rows = jobs.data?.items ?? [];`
4. `Runs.tsx:58-66` — delete the local `RecordPage<T>` type; `Runs.tsx:82-83` → `const runs = useApi<OffsetPage<RunSummary>>(clients.runs.paths.list({ ..., limit: 25, offset }), { interval: 5000 }); const items = runs.data?.items ?? [];`
5. `Runs.tsx:263-268` — split by tab: `const evidence = useApi<EvidencePages[RunTab]>(path, { interval: 5000 })` — all four `EvidencePages` variants carry `items`, so `const items = evidence.data?.items ?? [];` needs no cast.
6. `Runs.tsx:274` → `const data = run.data ? mergeProgress(run.data, progress.data) : undefined;` (replaces `{...run.data, ...progress.data, config: run.data.config}`); `Runs.tsx:213` → `const progress = useApi<RunProgress>(clients.runs.paths.progress(id!), { interval: 3500 });`; `clients/runs.ts` `progress(id): Promise<RunProgress>` returns the request result directly (the T5.2 `Partial<Run> & { observedAt }` placeholder type is deleted).
7. `Runs.tsx:693` — `item as Record<string, unknown>` becomes `item`.
8. `Oversight.tsx:202,203` — retype to `useOffsetPage<RunSummary>`.

- [ ] **Step 3.6: Run the tests and gates**

```bash
npm test --workspace sidechannel-dashboard
npm run check --workspace sidechannel-dashboard
git grep -n "arrayOf" -- dashboard/src
git grep -n "Record<string, unknown>" -- dashboard/src/pages dashboard/src/lib
```

Expected: PASS; no `arrayOf`; no `unknown` item renderer.

- [ ] **Step 3.7: Commit**

```bash
git add dashboard/src/lib/contracts.ts dashboard/src/lib/contracts.test.ts dashboard/src/lib/types.ts dashboard/src/lib/analysis-types.ts dashboard/src/pages dashboard/src/App.tsx packages/contracts/src/browser.ts packages/contracts/src/harness/contracts.ts
git commit -m "refactor(dashboard): one Page/OffsetPage envelope and typed run tab responses (WS5 T5.3)"
```

**Effort:** 0.75–1 dev-day. **Rollback:** `git revert` restores `arrayOf` and the `RecordPage` union. **Out of scope:** WS7's `SUMMARY_OMIT`/`toRunSummary` single source; removing `Overview`'s generic job table (WS6).

---

## Task 5.4: No silent contract lies in the Jev adapter

**Files:**
- Create: `dashboard/src/lib/adapters/defaults.ts`
- Modify: `dashboard/src/lib/adapters/jev.ts`, `dashboard/src/lib/analysis-types.ts` (`AnalysisSettings.frozen`, no `revision`/`archived`), `dashboard/src/lib/adapters/jev.test.ts`, `dashboard/src/lib/clients/analyses.ts` (admission rules deleted), `dashboard/src/pages/Analysis.tsx:2130-2152,1967-1976`, `dashboard/src/pages/{Oversight,Codebook}.tsx`
- Dependency: **D5.1** (WS3a) lands first.

**Interfaces:**
- Consumes: `translate`, `createJevSession`, `createJevRequester` (T5.2); `RunProgress`/`mergeProgress` (T5.3).
- Produces:

```ts
// dashboard/src/lib/adapters/jev.ts  (explicit job/window parameters: no cache read may decide correctness)
export function toJob(raw: JevJob): AnalysisJob;                                  // no `revision`
export function toCodebook(raw: JevCodebook, current?: JevRevision): Codebook;     // no `archived`
export function toRevision(raw: JevRevision): CodebookRevision;
export function toSettings(raw: AnalysisConfiguration, revision: JevRevision, creator: string, parentAnalysisId?: string): AnalysisSettings;
export function toCanonicalSettings(view: AnalysisSettings): Partial<AnalysisConfiguration>;
export function toWindow(raw: WindowRecord & { results?: JevResult[] | Page<JevResult> }, job: JevJob, input?: SerializedWindow): AnalysisWindow;
export function toReview(raw: JevReview): HumanReview;                             // windowId only for scope 'window'
export function toBatch(raw: JevBatch): ReviewBatch;                              // no `creator: ''`, no `revision: 1`
export async function decodeJev<T>(path: string, payload: unknown, session: JevSession, readJob: (id: string) => Promise<JevJob>): Promise<T | undefined>;
// dashboard/src/lib/adapters/defaults.ts
export const NEW_ANALYSIS_DEFAULTS: { model: string; windowSize: number; stride: number; headroom: number; timeoutMs: number; maxAttempts: number };
export const NEW_ANALYSIS_INPUT_LIMITS: AnalysisConfiguration['inputLimits'];
```

- [ ] **Step 5.4.0: Land dependency D5.1 (WS3a owner, separate PR)**

In `api/src/routes/review-routes.ts`, replace line 57 (`if (req.method === 'POST') return { status: 201, body: await service.save(id, await body(req)) };`) with:

```ts
                if (req.method === 'POST') {
                    const input = await body(req);
                    if (input.scope === 'event' && (!Array.isArray(input.eventIds) || input.eventIds.length !== 1))
                        return { status: 400, body: { error: 'Event annotations require exactly one source event. Save separate annotations for additional events.' } };
                    return { status: 201, body: await service.save(id, input) };
                }
```

Add two route assertions next to the existing review tests (400 + message for two event ids; 201 for one). **T5.4 does not merge before this lands.** The dashboard's second rule ("The previous review does not match this reviewer, code and evidence subject.") needs no server change: `packages/domain/src/analysis/jev-reviews.ts:37-38` hashes scope/subjectId/codeId/definitionRevision/evidenceRevision/reviewer into the revision key, so a mismatched `expectedRevision` already fails with `Review revision conflict`.

- [ ] **Step 5.4.1: Write the failing tests**

Append to `dashboard/src/lib/adapters/jev.test.ts`:

```ts
import { toBatch, toCodebook, toJob, toWindow, toReview } from './jev';

it('never stamps a revision the server did not return', () => {
    const mapped = toJob(job);
    expect(mapped).not.toHaveProperty('revision');
    expect(toWindow(window, job)).not.toHaveProperty('revision');
    expect(toBatch(rawBatch)).not.toHaveProperty('revision');
    expect(toBatch(rawBatch)).not.toHaveProperty('creator');
    expect(toCodebook(book)).not.toHaveProperty('archived');
});

it('keeps the frozen server settings without embedding the whole contract', () => {
    const settings = toSettings(job.manifest.settings, job.manifest.codebook, 'Researcher');
    expect(settings).not.toHaveProperty('resolvedSettings');
    expect(settings.frozen.evidence.toolResults).toBe(false);
    expect(settings.frozen.inputLimits.singleQuestionTokens).toBe(30000);
    expect(Object.keys(settings.frozen).sort()).toEqual(['concurrency', 'evidence', 'inputLimits', 'longContext', 'retryBaseMs']);
});

it('uses documented client defaults only for a brand-new analysis', () => {
    const fresh = { codebookId: 'b', codebookRevisionId: 'v', model: 'jev-1.14.0', windowSize: 7, stride: 2, phases: ['report'], evidence: ['memory', 'assistant'], headroom: 1234, timeoutMs: 23456, maxAttempts: 2, creator: 'Claimed' } as AnalysisSettings;
    const canonical = toCanonicalSettings(fresh);
    expect(canonical.inputLimits).toMatchObject({ singleQuestionTokens: 32000, combinedQuestionTokens: 64000, maxBodyBytes: 33554432, estimatorVersion: 'utf8-bytes-conservative-v1', headroomTokens: 1234 });
    expect(Object.entries(canonical.evidence!).filter(([, on]) => on).map(([key]) => key).sort()).toEqual(['assistantText', 'privateMemory']);
    const frozen = toCanonicalSettings({ ...fresh, frozen: { evidence: job.manifest.settings.evidence, inputLimits: job.manifest.settings.inputLimits, concurrency: 3, retryBaseMs: 2500, longContext: false } });
    expect(frozen.inputLimits!.singleQuestionTokens).toBe(30000);   // server value wins
    expect(frozen.concurrency).toBe(3);
});

it('never throws because of navigation history: the job is a parameter', async () => {
    const server = stub(job, { items: [window], nextCursor: null });
    const clients = createClients({ request: server.request });
    const page = await clients.analyses.windows(job.id);               // no prior job request on this session
    expect(page.items[0]!.runId).toBe(job.runId);
    expect(server.calls[0]!.path).toBe('/jev/analyses/' + job.id);      // explicit fetch, not a cache hit
    expect(server.calls[1]!.path).toContain('/windows?withResults=true');
});

it('derives window membership from the review subject, not from a window cache', () => {
    expect(toReview({ ...savedReview, scope: 'window', subjectId: window.id }).windowId).toBe(window.id);
    expect(toReview({ ...savedReview, scope: 'event', subjectId: 'event-101' }).windowId).toBeUndefined();
});
```

Append to `dashboard/src/lib/clients/analyses.test.ts`:

```ts
it('no longer carries dashboard-side review admission rules', async () => {
    const server = stub(job, { ...savedReview, revision: 8 });
    const clients = createClients({ request: server.request });
    await clients.analyses.job(job.id);
    await clients.analyses.saveReview(job.id, { ...reviewInput, eventIds: ['event-101', 'event-102'] });
    expect(server.calls.at(-1)!.body.eventIds).toEqual(['event-101', 'event-102']);   // server rejects it (D5.1)
});
```

- [ ] **Step 5.4.2: Run the tests to verify they fail**

```bash
npm test --workspace sidechannel-dashboard -- src/lib/adapters src/lib/clients
npm run check --workspace sidechannel-dashboard
```

Expected: FAIL — `mapped.revision` is `1`; `settings.resolvedSettings` present; `toCanonicalSettings` for a frozen analysis returns `32000`; `clients.analyses.windows` throws `'Source analysis manifest unavailable'`; the multi-event save throws client-side.

- [ ] **Step 5.4.3: Implement `defaults.ts`**

```ts
import type { AnalysisConfiguration } from '@sidechannel/contracts/browser';

/**
 * Client-side defaults for a NEW analysis. They are never sent in place of settings the
 * server has already frozen, and they live in exactly one module so the preflight limits
 * cannot drift between the preview form and the launch payload.
 */
export const NEW_ANALYSIS_DEFAULTS = { model: 'jev-1.14.0', windowSize: 12, stride: 4, headroom: 2000, timeoutMs: 60000, maxAttempts: 2 } as const;

export const NEW_ANALYSIS_INPUT_LIMITS: AnalysisConfiguration['inputLimits'] = {
    singleQuestionTokens: 32000, combinedQuestionTokens: 64000, maxBodyBytes: 33554432,
    estimatorVersion: 'utf8-bytes-conservative-v1', headroomTokens: NEW_ANALYSIS_DEFAULTS.headroom,
};
```

Point `Analysis.tsx:218-230` at `NEW_ANALYSIS_DEFAULTS` so the form defaults and the payload defaults cannot drift.

- [ ] **Step 5.4.4: Rewrite the mappers and delete the admission rules**

Replace the moved mapping bodies in `adapters/jev.ts` with the following (complete code):

```ts
export function toRevision(raw: JevRevision): CodebookRevision {
    return { id: raw.id, revision: raw.revision, createdAt: raw.createdAt, codebookId: raw.codebookId, codes: raw.definitions, author: raw.createdBy };
}

/** The server has no codebook-level `archived` flag; the view model must not invent one. */
export function toCodebook(raw: JevCodebook, current?: JevRevision): Codebook {
    return { id: raw.id, name: raw.name, currentRevisionId: raw.currentRevisionId, ...(current ? { revision: current.revision } : {}) };
}

export function toSettings(raw: AnalysisConfiguration, revision: JevRevision, creator: string, parentAnalysisId?: string): AnalysisSettings {
    return {
        codebookId: revision.codebookId, codebookRevisionId: revision.id,
        model: raw.model, windowSize: raw.window.size, stride: raw.window.stride,
        phases: raw.selection.phases,
        ...(raw.selection.startOrdinal !== undefined ? { startStep: raw.selection.startOrdinal } : {}),
        ...(raw.selection.endOrdinal !== undefined ? { endStep: raw.selection.endOrdinal } : {}),
        evidence: (Object.keys(categoryGroups) as EvidenceCategory[]).filter(category => categoryGroups[category].some(key => raw.evidence[key])),
        headroom: raw.inputLimits.headroomTokens, timeoutMs: raw.timeoutMs, maxAttempts: raw.maxAttempts, creator,
        ...(parentAnalysisId ? { parentAnalysisId } : {}),
        /** Frozen server settings, captured so a duplicate re-submits exactly what was frozen. */
        frozen: { evidence: raw.evidence, inputLimits: raw.inputLimits, concurrency: raw.concurrency, retryBaseMs: raw.retryBaseMs, longContext: raw.longContext },
    };
}

/** Only the fields the form can edit are overridden; everything else is the frozen server value. */
export function toCanonicalSettings(view: AnalysisSettings): Partial<AnalysisConfiguration> {
    const base = view.frozen;
    return {
        version: 1, model: view.model,
        window: { size: view.windowSize, stride: view.stride },
        selection: { phases: view.phases,
            ...(view.startStep !== undefined ? { startOrdinal: view.startStep } : {}),
            ...(view.endStep !== undefined ? { endOrdinal: view.endStep } : {}) },
        evidence: Object.fromEntries(Object.entries(categoryGroups).flatMap(([category, fields]) => fields.map(field => {
            const enabled = view.evidence.includes(category as EvidenceCategory);
            return [field, enabled && (base ? base.evidence[field] || enabled : true)];
        }))) as AnalysisConfiguration['evidence'],
        inputLimits: { ...(base?.inputLimits ?? NEW_ANALYSIS_INPUT_LIMITS), headroomTokens: view.headroom },
        timeoutMs: view.timeoutMs, maxAttempts: view.maxAttempts,
        ...(base ? { concurrency: base.concurrency, retryBaseMs: base.retryBaseMs, longContext: base.longContext } : {}),
    };
}

export function toWindow(raw: WindowRecord & { results?: JevResult[] | Page<JevResult> }, job: JevJob, input?: SerializedWindow): AnalysisWindow {
    const limits = job.manifest.settings.inputLimits;
    const results = Array.isArray(raw.results) ? raw.results : raw.results?.items ?? [];
    return {
        id: raw.id, createdAt: job.createdAt, analysisId: raw.jobId, runId: job.runId,
        index: raw.index, stepIds: raw.stepIds, eventIds: raw.eventIds,
        startStep: raw.startOrdinal, endStep: raw.endOrdinal, partial: raw.partial, incomplete: raw.incomplete,
        empty: input ? !input.hasEvidence : raw.status === 'skipped', state: input?.state ?? '',
        inputHash: raw.inputHash, status: raw.status === 'running' ? 'pending' : raw.status,
        ...(raw.diagnostics?.length ? { error: raw.diagnostics.join('; ') } : {}),
        budget: { bytes: raw.inputBytes, estimatedTokens: raw.estimatedTokens,
            estimatorVersion: input?.estimatorVersion ?? limits.estimatorVersion,
            perQuestionLimit: limits.singleQuestionTokens, perRequestLimit: limits.combinedQuestionTokens,
            headroom: limits.headroomTokens, oversized: raw.status === 'oversized', batches: raw.batches ?? [] },
        results: results.map(result => ({ ...result, analysisId: result.jobId })),
    };
}

/** Window membership is a property of the review subject, not of cached navigation history. */
export function toReview(raw: JevReview): HumanReview {
    return { ...raw, windowId: raw.scope === 'window' ? raw.subjectId : undefined, definitionRevisionId: raw.definitionRevision };
}

export function toBatch(raw: JevBatch): ReviewBatch {
    return { id: raw.id, createdAt: raw.createdAt, analysisId: raw.analysisId, mode: raw.mode,
        ...(raw.threshold !== undefined ? { threshold: raw.threshold } : {}),
        populationCount: raw.populationSize, selectionCount: raw.selectedCount, codebookRevisionId: raw.definitionRevision };
}

export function toJob(raw: JevJob): AnalysisJob {
    return {
        id: raw.id, createdAt: raw.createdAt, runId: raw.runId, status: raw.status,
        cancelRequested: raw.cancelRequested, updatedAt: raw.updatedAt,
        ...(raw.error !== undefined ? { error: raw.error } : {}),
        counters: { prepared: raw.counters.preparedWindows, submitted: raw.counters.submittedWindows, finished: raw.counters.finishedWindows, failed: raw.counters.failedWindows, skipped: raw.counters.skippedWindows, answers: raw.counters.returnedAnswers },
        manifest: {
            schemaVersion: 1, runId: raw.runId, configHash: raw.manifest.source.configHash, sourceStatus: raw.manifest.source.status,
            sequenceBoundary: raw.manifest.source.sequenceBoundary, evidenceHash: raw.manifest.source.evidenceHash,
            normalizerVersion: raw.manifest.normalizerVersion, serializationVersion: raw.manifest.serializationVersion,
            questionTemplateVersion: raw.manifest.questionTemplateVersion, adapterVersion: raw.manifest.providerAdapterVersion,
            sdkVersion: raw.manifest.sdkVersion, codebook: toRevision(raw.manifest.codebook),
            settings: toSettings(raw.manifest.settings, raw.manifest.codebook, raw.manifest.creator, raw.manifest.parentAnalysisId),
            settingsHash: raw.manifest.settingsHash, staticContext: { version: raw.manifest.staticContext.version },
            staticContextHash: raw.manifest.staticContext.hash,
            diagnostics: raw.manifest.diagnostics.map(diagnostic => diagnostic.message),
            availability: toAvailability(raw.manifest.availability),
            windowCount: raw.counters.preparedWindows,
            scoredCodeCount: raw.manifest.codebook.definitions.filter(definition => definition.enabled && !definition.archived).length,
        },
    };
}
```

`decodeJev` changes: `ensureJob` becomes a fetch-or-cache (`session.job(id) ?? session.rememberJob(await readJob(id))`) and every `toWindow(...)` call passes the job explicitly; `preview` responses record the session context from `clients/analyses.ts` (it needs the submitted settings).

Then delete from `clients/analyses.ts` `saveReview`: the three `throw new Error(...)` admission checks (exactly-one-event, superseded review missing, previous review mismatch) and the `session.review(...)` lookup. `expectedRevision` now comes from the caller's `supersedes` revision (`input.supersedesId ? previousRevision : 0`), and the page passes the review it is revising (it already holds the filtered `latest`).

- [ ] **Step 5.4.5: Update the call sites that relied on the fabricated fields**

| File:line | Change |
| --- | --- |
| `Analysis.tsx:2130-2152` | `ownReviews` filter: `r.subjectId === detail.window.id \|\| detail.window.eventIds.includes(r.subjectId ?? "")` |
| `Analysis.tsx:1967-1976` | `ReviewQueueRow.own` filter uses `detail.data?.window.eventIds.includes(r.subjectId ?? "")` |
| `Analysis.tsx:105-115` (`AnalysisCollectionRow`) | unchanged (reads `job.createdAt`, a real field) |
| `Codebook.tsx:140-165` | `clients.codebooks.create/revise` with `expectedRevisionId: baseRevisionId`; read `codebook.revision` (real) instead of `archived` |
| `Oversight.tsx:1925` | unchanged — run-outcome reviews carry real server revisions |

- [ ] **Step 5.4.6: Run the tests and the gates**

```bash
npm test --workspace sidechannel-dashboard
npm run check --workspace sidechannel-dashboard
git grep -n "resolvedSettings\|Partial<Run>\|archived: false\|revision: 1" -- dashboard/src/lib
git grep -n "exactly one source event" -- dashboard/src
```

Expected: PASS; no fabricated values in `lib/`; no client-side admission message.

- [ ] **Step 5.4.7: Commit**

```bash
git add dashboard/src/lib dashboard/src/pages api/src/routes/review-routes.ts api/src/server/server.test.ts
git commit -m "refactor(dashboard): remove fabricated contract values and dashboard-side review admission (WS5 T5.4)"
```

**Effort:** 1.5–2 dev-days. **Behaviour-change statement:** two intentional changes, both documented in `docs/solid-remediation-decisions.md`: (1) a two-event annotation is rejected by the server with a 400 carrying the identical message instead of by the client; (2) a preview-window probe without a session entry fails with the existing `Preview settings expired in this browser. Prepare a fresh preview.` message instead of a navigation-order-dependent error. All other output is unchanged — `settings.frozen` carries exactly the values `resolvedSettings` carried, so duplicate-analysis payloads are byte-identical (asserted by the ported test). **Rollback:** `git revert`; D5.1 can stay (the client simply no longer duplicates the check). **Out of scope:** WS6 T6.2's review-workspace split; the review-queue cursor; any server route move.

---

## Task 5.5: `WindowReviewInput`/`OutcomeReviewInput` split and dead type exports

**Files:**
- Modify: `dashboard/src/lib/analysis-types.ts`, `dashboard/src/lib/types.ts`, `dashboard/src/pages/Analysis.tsx:2153-2167`, `dashboard/src/pages/Oversight.tsx:1662-1674`, `dashboard/src/lib/clients/{analyses,reviews}.ts`
- Create: `dashboard/src/lib/review-types.test.ts`

**Interfaces:**
- Produces (audit F13's direction):

```ts
// dashboard/src/lib/analysis-types.ts
export interface ReviewDraft {
    reviewer: string; decision: Decision; rationale: string;
    eventIds: string[]; stepIds: string[]; predictionsVisible: boolean;
}
export interface WindowReviewInput extends ReviewDraft {
    scope: 'window' | 'event';
    windowId: string;              // the page's window; the server derives subjectId from eventIds[0] for event scope
    codeId: string;
    supersedes?: HumanReview;
}
export interface Codebook { id: string; name: string; currentRevisionId: string; revision?: number }
export interface AnalysisJob extends Identified { /* no revision */ }
export interface AnalysisWindow extends Identified { /* no revision */ }
export interface AnalysisResult { analysisId: string; windowId: string; codeId: string; probability: number; attemptId: string; returnedModel?: string }
export interface ReviewBatch extends Identified { analysisId: string; mode: 'assisted' | 'blind'; threshold?: number; populationCount: number; selectionCount: number; codebookRevisionId: string }
export interface HumanReview extends Identified, ReviewDraft { analysisId: string; runId: string; scope: 'window' | 'event'; codeId: string; subjectId: string; windowId?: string; definitionRevisionId: string; revision: number }
// dashboard/src/lib/types.ts
export interface OutcomeReviewInput {
    reviewer: string; outcomeId: string; definitionRevisionId: string; evidenceRevision: string;
    decision: Verdict; rationale: string; eventIds: string[]; supersedesId?: string;
}
```

- Deleted: `AnalysisAttempt`, `CanonicalStep`, `CanonicalContribution`, `AnalysisRequest`, `AnalysisResponse`, `OutcomeAgreement`, `ConfigurationResponse`, `ReviewInput`, `ResearchRecord` (replaced by `Identified`), `AnalysisSettings.resolvedSettings` (replaced by `frozen` in T5.4), `Codebook.archived`, `ReviewBatchInput.creator`.

- [ ] **Step 5.5.1: Write the failing type test**

Create `dashboard/src/lib/review-types.test.ts`:

```ts
// @vitest-environment node
import { expect, expectTypeOf, it } from 'vitest';
import type { AnalysisJob, Codebook, ReviewDraft, WindowReviewInput } from './analysis-types';
import type { OutcomeReviewInput } from './types';
import * as analysisTypes from './analysis-types';
import * as types from './types';

it('splits the two review domains and shares only the draft fields', () => {
    expectTypeOf<WindowReviewInput>().toHaveProperty('windowId');
    expectTypeOf<WindowReviewInput>().not.toHaveProperty('outcomeId');
    expectTypeOf<OutcomeReviewInput>().toHaveProperty('outcomeId');
    expectTypeOf<OutcomeReviewInput>().not.toHaveProperty('windowId');
    expectTypeOf<ReviewDraft['decision']>().toEqualTypeOf<'present' | 'absent' | 'uncertain'>();
});

it('no longer declares the unused or fabricated shapes', () => {
    for (const name of ['AnalysisAttempt', 'CanonicalStep', 'CanonicalContribution', 'AnalysisRequest', 'AnalysisResponse', 'OutcomeAgreement', 'ReviewInput', 'ResearchRecord'])
        expect(name in analysisTypes).toBe(false);
    expect('ConfigurationResponse' in types).toBe(false);
});

it('keeps only real server revision fields', () => {
    expectTypeOf<Codebook>().not.toHaveProperty('archived');
    expectTypeOf<AnalysisJob>().not.toHaveProperty('revision');
    expectTypeOf<AnalysisJob['createdAt']>().toEqualTypeOf<string>();
});
```

- [ ] **Step 5.5.2: Run it to verify it fails**

```bash
npm test --workspace sidechannel-dashboard -- src/lib/review-types.test.ts
npm run check --workspace sidechannel-dashboard
```

Expected: FAIL — `WindowReviewInput`/`OutcomeReviewInput` do not exist; `ReviewInput`/`ConfigurationResponse` still exported.

- [ ] **Step 5.5.3: Apply the split**

1. `analysis-types.ts` — implement the **Interfaces** block; `import type { Identified, Page } from './contracts';` and `export type { Page } from './contracts';` for existing importers; delete the eight dead interfaces and `ResearchRecord`.
2. `types.ts` — delete `ConfigurationResponse`; add `OutcomeReviewInput`; import `Verdict` from the browser barrel.
3. `clients/analyses.ts` — `saveReview(id: string, input: WindowReviewInput): Promise<HumanReview>`, body `{ scope: input.scope, subjectId: input.scope === 'event' ? input.eventIds[0] : input.windowId, codeId: input.codeId, eventIds: input.eventIds, stepIds: input.stepIds, reviewer: input.reviewer, decision: input.decision, rationale: input.rationale, predictionsVisible: input.predictionsVisible, expectedRevision: input.supersedes?.revision ?? 0, definitionRevision, evidenceRevision }` where the last two come from the session job (which the page's `job` query always loaded; the client fetches it when absent).
4. `clients/reviews.ts` — `save(runId: string, input: OutcomeReviewInput)` posts exactly those eight fields.
5. `Analysis.tsx:2153-2167` passes a `WindowReviewInput` (no `outcomeId`/`definitionRevisionId`/`evidenceRevision`); `Oversight.tsx:1662-1674` passes an `OutcomeReviewInput` (no `windowId`/`scope`).

- [ ] **Step 5.5.4: Run the tests and gates**

```bash
npm test --workspace sidechannel-dashboard
npm run check --workspace sidechannel-dashboard
git grep -n "ReviewInput\|resolvedSettings\|AnalysisAttempt\|CanonicalStep\|CanonicalContribution\|AnalysisRequest\|AnalysisResponse\|OutcomeAgreement\|ConfigurationResponse\|ResearchRecord" -- dashboard/src
```

Expected: PASS; the grep matches only `WindowReviewInput` / `OutcomeReviewInput` / `ReviewDraft` / `OutcomeReviewInput`'s own declaration. `npm run check` proves no consumer depended on a deleted field.

- [ ] **Step 5.5.5: Commit**

```bash
git add dashboard/src/lib dashboard/src/pages/Analysis.tsx dashboard/src/pages/Oversight.tsx
git commit -m "refactor(dashboard): split review inputs and delete dead type exports (WS5 T5.5)"
```

**Effort:** 0.5–0.75 dev-day. **Rollback:** `git revert`. **Out of scope:** F13's `RunSummary` vs `RunEvidence` split of `lib/types.ts` (WS6), `Badge`/status vocabularies (WS7).

---

## Verification summary

| Check | Command | Expected |
| --- | --- | --- |
| Dashboard unit tests | `npm test --workspace sidechannel-dashboard` | PASS, includes `lib/{api,transport,contracts,review-types}.test.*`, `lib/adapters/jev.test.ts`, `lib/clients/*.test.ts` |
| Dashboard types | `npm run check --workspace sidechannel-dashboard` | exit 0 (includes the type-level assertions) |
| Repo types | `npm run check` | exit 0 |
| Lint + boundaries | `npm run lint` | exit 0 (runs `verify-boundaries.mjs`) |
| Repo unit tests | `npm test` | PASS |
| Repo build | `npm run build` | PASS |
| Mongo integration | `npm run test:integration` | PASS (unchanged suites) |
| Compiled evidence | `node scripts/verify-compiled.mjs` | PASS |
| Migration equivalence | `node scripts/verify-migration-equivalence.mjs` | PASS |
| Dashboard smoke seed | `npm run smoke:dashboard` | PASS (server fixture unchanged) |
| Manual smoke | seeded workspace: Overview, Experiments (new + draft), Runs list/timeline/board/reports, Codebook (save + history), Analysis (preview, launch, detail, review, compare), Oversight (jobs, setup, definitions, references) | identical copy and evidence; pagination works; exports download |
| Gate 1 — no page data hooks | `git grep -n "useCursorApi\|useOffsetApi\|useCursorPage\|useRunPage\|useExactApi\|pagination:" -- dashboard/src` | no matches |
| Gate 2 — one fetch | `git grep -c "fetch(" -- dashboard/src` | `lib/transport.ts` only (+ the stub in `lib/transport.test.ts`) |
| Gate 3 — no raw anchors | `git grep -n '"/api/\|`/api/' -- dashboard/src/pages dashboard/src/components dashboard/src/App.tsx` | no matches |
| Gate 4 — no shape sniffing | `git grep -n "arrayOf" -- dashboard/src` | no matches |
| Gate 5 — no contract lies | `git grep -n "resolvedSettings\|Partial<Run>\|archived: false\|revision: 1\|exactly one source event" -- dashboard/src` | no matches |
| Gate 6 — module state | `git grep -n "new Map" -- dashboard/src/lib/adapters/jev.ts` | only inside `createJevSession` |

## Rollback

Every task is one commit and reverts independently; no migration, schema or persisted-identity change exists anywhere in WS5.

| Task | Revert effect |
| --- | --- |
| 5.1 | Restores `lib/paging.ts`, the three Oversight hooks and every inline pager; `useApi(path, interval)` positional signature returns. |
| 5.2 | Restores `lib/jev-transport.ts` and string paths in pages/components. Revert 5.2 before 5.1 (it builds on `Requester`/`RequesterProvider`). |
| 5.3 | Restores `arrayOf`, the `RecordPage` union, the `Partial<Run>` merge and the one-line `browser.ts` export. |
| 5.4 | Restores the fabricated fields and the client-side admission rules. D5.1 is a separate WS3a commit and may stay. |
| 5.5 | Restores the fat `ReviewInput` and the dead exports. |

## Out of scope

| Item | Owner |
| --- | --- |
| Page/component extraction (`Experiments`, `AnalysisDetail`, `OversightSetup`, `RunDetail`, `CodebookPage`, tab registries, `RunTable` move) | WS6 T6.1–T6.8 |
| Per-call-site stale-data filters in `Analysis.tsx` (redundant after T5.1; removed with the views) | WS6 T6.2 |
| The review-queue "Next selections" cursor (`Analysis.tsx:1903-1915,1932`) — a filtered-queue cursor, not a page pager | WS6 T6.2 |
| `RunList`'s URL-offset pager (`Runs.tsx:76-90,192-199`) — offset is URL state, not pager state | WS6 T6.5 |
| Provider/scenario descriptor maps, `/providers`, `/scenarios` | WS4 T4.3 + WS6 |
| Status tables, `Badge` tone, `eventMeta`, `SUMMARY_OMIT`/`toRunSummary` | WS7 T7.1–T7.3 |
| Route-table rename, unification of the three route-handler contracts | WS3a T3.4–T3.5 |
| Server-side review admission rule (delivered as D5.1) | WS3a |

## Self-review

- **Finding coverage.** F8 (six fetch/pager implementations → three hooks, zero page hooks), F9 (path-keyed data clearing, stale-response guard, advance-past-last-page refused, hook contract test), F10 (URL-string port + five anchors → typed clients and `exportUrl`), F11 (module caches → pure `translate` + provider-owned bounded `JevSession`; ordering-dependent throw → explicit job parameter/fetch; admission rules → server via D5.1), F12 (`revision: 1`, `archived: false`, `Partial<Run>`, `resolvedSettings`, invented limits → deleted, narrowed to `frozen`, or moved into one documented defaults module; `RunProgress` + `mergeProgress` make authority explicit), F16 (`arrayOf` → one `Page`/`OffsetPage`, typed tab pages), F13 (`ReviewInput` split; seven dead exports and `ConfigurationResponse` deleted; `resolvedSettings` narrowed).
- **Deviations from the conventions sheet, recorded deliberately.** (1) Clients expose `paths` builders alongside the §3.4 methods because `useApi` is path-keyed by convention; every §3.4 method exists with its exact name and return type. (2) `usePageRequest` is added for the single non-GET read and kept only as a deprecated alias of `useResource`. (3) A sixth `workspace` client owns `/workspace`, `/overview`, `/drafts`, `/config/*`, `/datasets`, `/models/adaption`, which §3.4's five clients do not name; WS6's `experimentsClient` is a facade over it plus `runs.createPair`, so no HTTP code is duplicated. (4) Task numbering follows this brief (envelopes = T5.3, stateless Jev = T5.4); the program plan's task table lists them the other way round — the finding-to-task mapping is unaffected. (5) `packages/contracts/src/browser.ts` gains one export line (D5.3, approved) so `RunSummary` is not re-declared a fifth time. (6) T5.2 moves the mapper code verbatim (fabricated values included) and T5.4 removes the fabrication, rather than doing both in one task — this is what keeps every task green and every mapping assertion characterized. (7) Step 1.11b adds `lib/clients/query.ts` (`useResource`/`useResourcePage`/`useResourceOffsetPage`) as the single implementation of read/staleness/pager logic; the path-keyed hooks become thin wrappers. This is the binding seam WS6 consumes — without it, decomposed pages cannot be rendered from fake clients. (8) `useMutation` stays the single mutation state machine; WS6's `useCommand` is a wrapper over it.
- **Placeholders.** Every code-changing step ships complete code or an exact `file:line → replacement` table. The one prose-instructed move (T5.2's `decodeJev` port) is specified by an unambiguous substitution table over named source lines plus the new function signature, because re-typing 40 dense lines into a plan invites transcription error.
- **Type consistency.** `ApiError`/`Requester`/`request`/`withQuery` are defined once in `transport.ts`; `Page`/`OffsetPage` come only from `lib/contracts.ts`; `RunProgress` is produced only by `clients/runs.ts` and consumed only by `mergeProgress`; `WindowReviewInput`/`OutcomeReviewInput` share `ReviewDraft`; `AnalysisSettings.frozen` is the sole place raw canonical evidence flags are retained.
- **Behaviour-change statement.** Rendered copy, payload fields and pagination results are unchanged except the two documented T5.4 cases (server-side rejection of a multi-event annotation with the same message; explicit preview-session expiry message). Everything else is a move or a deletion. The `settings.frozen` values are byte-identical to the former `resolvedSettings`, so duplicate-analysis preview/launch payloads do not drift — asserted explicitly in T5.4.
- **Residual risk.** `decodeJev` is the densest new module; its test file ports every case from `jev-transport.test.ts`, so a mapping regression fails a named assertion rather than a page render. If D5.1 cannot land, T5.4 stays unmerged and the branch keeps the T5.2 state (fully green, fabricated values still present) — that is the documented cut point.
