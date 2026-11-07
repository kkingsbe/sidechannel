# WS6 — Dashboard Page Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the six dashboard pages into routers over small, individually testable views that own their own data, so that no dashboard file exceeds 500 lines, no page file defines a data hook, and every view renders from fixture clients instead of a stubbed global `fetch`.

**Architecture:** Each page becomes a route shell plus a `ViewRegistry<TabId>` (`dashboard/src/lib/contracts.ts`, conventions §3.4) whose prop-less `ComponentType` entries read route identity from `useParams`/`useSearchParams` and obtain data from hooks in `pages/<page>/use-*.ts`. Hooks read through `ApiClientProvider` clients (`useResource`/`useResourcePage`/`useResourceOffsetPage` in `dashboard/src/lib/clients/query.ts`), write through the same clients, and keep command state in `components/use-command.ts`; tests render views with `fakeClients()`. Markup, ARIA labels, copy and URL parameters move verbatim; the only deliberate behaviour change is that an unknown `view` value renders a not-found view instead of another feature (T6.9, finding F7). WS5 primitives, WS4 registries, WS3 routes and WS7 vocabularies are consumed as-is and never re-implemented.

**Tech Stack:** React 19.3.1, react-router-dom 7.18.5, Vite 7.3.7, TypeScript 5.9.3 (dashboard) / 6.0.3 (workspaces), Vitest 5.1.0 + @testing-library/react 16.3.3 + jsdom 27.4.0, npm 11.5.1, Nx 23.3.1, ESLint 9.39.4.

**Estimated:** 10 tasks, 12–18 dev-days (nominal 18: T6.0 1.5, T6.1 2.5, T6.2 2.5, T6.3 2, T6.4 2, T6.5 2, T6.6 1.5, T6.7 1.5, T6.8 1.5, T6.9 1).

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

**WS6-specific constraints**

- Dashboard source is the only tree written: `dashboard/src/pages/**`, `dashboard/src/components/**` (except `ui.tsx`), `dashboard/src/App.tsx`, plus `dashboard/src/test/**` and the two new `dashboard/src/lib/clients/{query,experiments}.ts` seams defined in T6.0/T6.1.
- **No copy edits.** Every string in a moved block is moved byte-identically, including the em dash in "Scripted driver — no provider context" and the doubled spaces in `"Window 2  -  steps 5 - 16"`-style strings (e.g. `Window ${index + 1}  -  steps …`). Tests assert copy, not implementation.
- **No markup edits beyond wrapper identity.** `role`, `aria-label`, `aria-labelledby`, `aria-describedby`, `tabIndex`, `<h1..h4>` levels, table `label`/`headers` and `data-config-path` attributes are preserved exactly; only the enclosing module changes.
- **URL contract is frozen:** `?view=`, `?window=`, `?evidence=`, `?seq=`, `?batch=`, `?blind=`, `?compare=`, `?return=`, `?returnTo=`, `?run=`, `?clone=`, `?draft=`, `?recover=`, `?cursor=`, `?jobCursor=`, `?offset=`, `?definition=`.
- **Page files define no hooks.** After T6.9, `dashboard/src/pages/*.tsx` contain no `function use*`/`const use*` declarations; hooks live in `pages/<page>/use-*.ts`.
- **Registry views take no props** (`ComponentType` per conventions §3.4). A view reads `useParams()`/`useSearchParams()` itself.
- **Reads go through `lib/clients/query.ts`; writes go through `*Client` objects.** Path literals live only in `dashboard/src/lib/**` and in `pages/*/use-*.ts` hook bodies — never in JSX and never in a component.
- **Tests never touch global `fetch`.** Each task removes the `vi.stubGlobal('fetch', …)` / `vi.mock('../lib/api', …)` scaffolding it replaces; `git grep "stubGlobal('fetch'" dashboard/src` must reach 0 at T6.9.

## Preconditions (verify before Task 6.1; WS6 is blocked on WS5)

Run these checks and stop if any fails. The plan assumes the conventions §3.4 interfaces exist with those exact names.

- [ ] **P.1: WS5 interfaces exist**

```bash
node -e "const fs=require('fs');for(const f of ['dashboard/src/lib/transport.ts','dashboard/src/lib/contracts.ts','dashboard/src/lib/clients/context.tsx','dashboard/src/lib/adapters/jev.ts'])console.log(fs.existsSync(f)?'present '+f:'MISSING '+f)"
git grep -n "export type ViewRegistry" -- dashboard/src
git grep -n "export function useApi" -- dashboard/src
```

Expected: four `present` lines; `ViewRegistry<TabId extends string>` in `lib/contracts.ts`; `useApi` in `lib/api.ts` with the §3.4 signature. If `ViewRegistry` or `useApi` is missing, WS5 has not landed — stop.

- [ ] **P.2: WS4 metadata endpoints exist**

```bash
git grep -n "'/providers'\|\"/providers\"\|/api/scenarios" -- api packages | head
```

Expected: the router registers `GET /providers` and `GET /scenarios` (conventions §3.3). T6.8 is blocked on this; T6.1–T6.7 are not.

- [ ] **P.3: Dashboard baseline is green**

```bash
npm run test --workspace sidechannel-dashboard
npm run check --workspace sidechannel-dashboard
```

Expected: PASS. Record the current test count; each task must not lower it by more than the number of tests it deliberately rewrites (T6.2 and T6.3 rewrite the largest suites).

- [ ] **P.4: Record the landed client member names**

```bash
git grep -n "export const .*Client" -- dashboard/src/lib/clients
```

Expected: one export per resource. Write the discovered member names next to the `Consumes:` lines of T6.1–T6.6 before starting. Naming in this plan follows conventions §3.4 exactly for `runsClient` (fixed there) and the most direct verb otherwise (`get`, `list`, `windows`, `reviews`, `batches`); `npm run check` fails loudly on any mismatch and only `pages/*/use-*.ts` may change to reconcile — tests inject `Partial<ReturnType<typeof useClients>[…]>`, so they are unaffected.

---

## File structure

**Create**

| Path | Responsibility |
| --- | --- |
| `dashboard/src/components/view-registry.tsx` | `ViewPanel`, `tabItems`, `NotFoundView`: the only tab-dispatch implementation |
| `dashboard/src/components/use-command.ts` | `useCommand()` — thin alias over `useMutation()` from `lib/api.ts` (no second state machine) |
| `dashboard/src/components/run-table.tsx` | `RunTable` moved out of `App.tsx` (F17) |
| `dashboard/src/components/claimed-reviewer.ts` | `useClaimedReviewer()` + `REVIEWER_STORAGE_KEY` (F18) |
| `dashboard/src/components/cancel-job-button.tsx` | `CancelJobButton` — one cancel-with-confirm control (F18) |
| `dashboard/src/components/review-history.tsx` | `ReviewHistoryRow` — one review-history row row-shape (F18) |
| `dashboard/src/test/clients.tsx` | `fakeClients()`, `renderWithClients()` — the only test harness |
| `dashboard/src/lib/clients/query.ts` | **Extend WS5's module** (WS5 Step 1.11b ships it): `cursorKey` URL support + the tests; never a second module |
| `dashboard/src/lib/clients/experiments.ts` | `createExperimentsClient(clients)` — **facade** over WS5's `workspace`/`runs` clients (no new HTTP code) |
| `dashboard/src/pages/experiments/**` | Experiments views + hooks + CSS (T6.1) |
| `dashboard/src/pages/analysis/**` | Analysis views + hooks + CSS (T6.2, T6.4) |
| `dashboard/src/pages/oversight/**` | Oversight views + hooks + CSS (T6.3) |
| `dashboard/src/pages/runs/**` | Runs views + hooks + CSS (T6.5) |
| `dashboard/src/pages/codebook/**` | Codebook views + hooks (T6.6) |
| `dashboard/src/lib/descriptors.ts` | Provider/scenario descriptors (T6.8) |

**Modify**

| Path | Change |
| --- | --- |
| `dashboard/src/pages/Experiments.tsx` | 1,209 → route shell ≤ 120 lines (T6.1) |
| `dashboard/src/pages/Analysis.tsx` | 2,524 → 958 (T6.2) → ≤ 200 (T6.4) |
| `dashboard/src/pages/Oversight.tsx` | 1,946 → route shell ≤ 250 (T6.3) |
| `dashboard/src/pages/Runs.tsx` | 1,202 → route shell ≤ 150 (T6.5) |
| `dashboard/src/pages/Codebook.tsx` | 568 → ≤ 350 (T6.6) |
| `dashboard/src/pages/Overview.tsx` | `RunTable` import + typed reads, no `arrayOf` (T6.7) |
| `dashboard/src/App.tsx` | drop `RunTable`, drop dead imports (T6.7) |
| `dashboard/src/components/{model-controls,budget-summary,healthcare-preset}.tsx` | consume descriptors (T6.8) |
| `dashboard/src/lib/clients/context.tsx` | register the `experiments` facade in `ApiClients` (T6.1) |
| `dashboard/src/pages/{Analysis,RunsOversight,Codebook,Experiments,workflows}.test.tsx`, `dashboard/src/components/healthcare.test.tsx` | fake-client rendering (per task) |

**Delete**

| Path | After |
| --- | --- |
| `dashboard/src/pages/runs-oversight.css` | T6.7 (split into `pages/runs/pair-condition.css` + `pages/oversight/oversight.css`) |
| `dashboard/src/pages/{Analysis,Experiments}.css` | moved into the page folder (T6.2/T6.1) |
| All `vi.stubGlobal('fetch')` / `vi.mock('../lib/api')` blocks | per task |

---

## T6.0 — Shared scaffolding: registry helper, fake clients, page pattern

**Files:**
- Create: `dashboard/src/components/view-registry.tsx`, `dashboard/src/components/use-command.ts`, `dashboard/src/lib/clients/query.ts`, `dashboard/src/test/clients.tsx`
- Test: `dashboard/src/components/view-registry.test.tsx`, `dashboard/src/lib/clients/query.test.tsx`, `dashboard/src/test/clients.test.tsx`

**Interfaces:**
- Consumes: `ViewRegistry<TabId extends string>`, `Page<T>`, `OffsetPage<T>` from `dashboard/src/lib/contracts.ts` (conventions §3.4); `ApiClientProvider`, `useClients` from `dashboard/src/lib/clients/context.tsx`; `ApiError`/`request` from `dashboard/src/lib/transport.ts`.
- Produces (binding for T6.1–T6.9):

```ts
// dashboard/src/components/view-registry.tsx
export function tabItems<TabId extends string>(registry: ViewRegistry<TabId>, order: readonly TabId[]): { id: TabId; label: string }[];
export function ViewPanel<TabId extends string>(props: {
    registry: ViewRegistry<TabId>; order: readonly TabId[]; tab: string; panelId: string;
    onChange: (tab: TabId) => void;
}): ReactElement;
export function NotFoundView({ what }: { what: string }): ReactElement;

// dashboard/src/components/use-command.ts
export function useCommand(): {
    busy: boolean; error: Error | undefined; message: string;
    run<R>(action: () => Promise<R>, success?: string): Promise<R | undefined>;
    clear(): void;
};

// dashboard/src/lib/clients/query.ts
export function useResource<T>(key: string | null, load: () => Promise<T>, options?: { interval?: number }): {
    data: T | undefined; error: Error | undefined; loading: boolean;
    refresh: () => Promise<void>; updatedAt: number | undefined;
};
export function useResourcePage<T>(key: string | null, load: (cursor: string | null) => Promise<Page<T>>,
    options?: { interval?: number; cursorKey?: string }): {
    data: T[]; page: number; hasMore: boolean; loading: boolean; error: Error | undefined;
    onChange: (next: number) => void; refresh: () => Promise<void>;
};
export function useResourceOffsetPage<T>(key: string | null, load: (offset: number) => Promise<OffsetPage<T>>,
    options?: { interval?: number; pageSize?: number }): {
    data: T[]; total: number; page: number; hasMore: boolean; loading: boolean; error: Error | undefined;
    onChange: (next: number) => void; refresh: () => Promise<void>;
};

// dashboard/src/test/clients.tsx
type Clients = ReturnType<typeof useClients>;
export type ClientOverrides = { [K in keyof Clients]?: Partial<Clients[K]> };
export function fakeClients(overrides?: ClientOverrides): Clients;
export function renderWithClients(ui: ReactElement, options?: { clients?: Clients; route?: string | string[] }): RenderResult;
```

**Why `query.ts` exists (record in the PR description):** WS5's read hooks (`useApi`/`usePage`/`useOffsetPage`) are path-keyed, so a page rendered from fake clients cannot be fed by them. WS6 mandates fake-client fixture rendering, so reads are parameterised by a client call instead of a path. `query.ts` keeps the *exact* §3.4 result shapes (`data/error/loading/refresh/updatedAt`, `data/page/hasMore/onChange/refresh`) and is the single seam: path-keyed hooks stay for `lib/` internals and WS5's own tests; pages import only from `query.ts`.

**The pattern every page task repeats** (copy this checklist into each task's PR):

1. **Characterization first.** Render the *new* file at the exact route with fixture clients; assert the copy/ARIA that exists today. Red before any move.
2. **One registry per page.** `pages/<page>/views.ts(x)` exports `PAGE_TABS` (const tuple), `PAGETab` (type), `DEFAULT_PAGE_TAB`, `PAGE_VIEWS: ViewRegistry<PAGETab>`. Titles are the *labels that exist today*.
3. **One hook file per data dependency.** `pages/<page>/use-<thing>.ts`. Hooks take identity (`id`, `filter`, `page`) as arguments; only components call `useParams`/`useSearchParams`. Hooks never import `ui.tsx`.
4. **Views own data.** A registry entry is a prop-less component that calls its own hooks; sibling views must not require each other's data.
5. **Reads** `useResource(key, () => clients.<resource>.<read>())`; **writes** `clients.<resource>.<write>()` inside `useCommand().run(...)`. `key` is a stable string (`'analysis:' + id + ':windows'`), never a JSON blob.
6. **Markup moves verbatim.** Move map rows give `old:line-range → new:line`; the new file's export signature is stated; no JSX is retyped by hand.
7. **Page CSS moves with the page:** `pages/<Page>.css` → `pages/<page>/<page>.css`, imported once by the page shell (or by the single owning component for a split block).
8. **Tests:** delete the fetch stub, add `fakeClients` overrides, assert the same visible strings. Keep every existing `it(...)` title unless the plan says otherwise.
9. **Line gate** before commit (see the task's gate).

- [ ] **Step 0.1: Write the failing `ViewPanel` tests**

Create `dashboard/src/components/view-registry.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ViewRegistry } from "../lib/contracts";
import { NotFoundView, ViewPanel, tabItems } from "./view-registry";

afterEach(cleanup);

type Tab = "alpha" | "beta";
const registry: ViewRegistry<Tab> = {
  alpha: { title: "Alpha view", Component: () => <p>alpha body</p> },
  beta: { title: "Beta view", Component: () => <p>beta body</p> },
};

it("renders the registered view and one tab per registry entry in declared order", async () => {
  const onChange = vi.fn();
  render(<ViewPanel registry={registry} order={["beta", "alpha"]} tab="alpha" panelId="probe-panel" onChange={onChange} />);
  expect(screen.getByText("alpha body")).toBeTruthy();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Beta view", "Alpha view"]);
  expect(tabItems(registry, ["beta", "alpha"])).toEqual([
    { id: "beta", label: "Beta view" },
    { id: "alpha", label: "Alpha view" },
  ]);
  await userEvent.click(screen.getByRole("tab", { name: "Beta view" }));
  expect(onChange).toHaveBeenCalledWith("beta");
});

it("keeps the tabpanel wiring identical to the pages it replaces", () => {
  render(<ViewPanel registry={registry} order={["alpha", "beta"]} tab="alpha" panelId="probe-panel" onChange={vi.fn()} />);
  const panel = screen.getByRole("tabpanel");
  expect(panel.id).toBe("probe-panel");
  expect(panel.getAttribute("aria-labelledby")).toBe("probe-panel-tab-alpha");
  expect(screen.getByRole("tab", { name: "Alpha view" }).getAttribute("aria-controls")).toBe("probe-panel");
});

it("renders not-found for an unknown view instead of another feature", () => {
  render(<ViewPanel registry={registry} order={["alpha", "beta"]} tab="gamma" panelId="probe-panel" onChange={vi.fn()} />);
  expect(screen.getByText("This view does not exist")).toBeTruthy();
  expect(screen.queryByText("alpha body")).toBeNull();
  expect(screen.getByRole("tabpanel").getAttribute("aria-label")).toBe("Unknown view");
  render(<NotFoundView what="gamma" />);
  expect(screen.getAllByText(/“gamma” is not a view on this page/).length).toBeGreaterThan(0);
});
```

- [ ] **Step 0.2: Run the test to verify it fails**

```bash
npm run test --workspace sidechannel-dashboard -- src/components/view-registry.test.tsx
```

Expected: FAIL — `Failed to load url ./view-registry … Does the file exist?` (the module does not exist yet).

- [ ] **Step 0.3: Implement `view-registry.tsx`**

```tsx
import type { ComponentType, ReactElement } from "react";
import type { ViewRegistry } from "../lib/contracts";
import { Card, Empty, Tabs } from "./ui";

export function tabItems<TabId extends string>(registry: ViewRegistry<TabId>, order: readonly TabId[]) {
  return order.map((id) => ({ id, label: registry[id].title }));
}

/**
 * One tab list, one panel. `Tabs` generates `\`${panelId}-tab-${id}\`` ids, so the panel's
 * `aria-labelledby` is derived instead of re-typed by each page.
 */
export function ViewPanel<TabId extends string>({
  registry,
  order,
  tab,
  panelId,
  onChange,
}: {
  registry: ViewRegistry<TabId>;
  order: readonly TabId[];
  tab: string;
  panelId: string;
  onChange: (tab: TabId) => void;
}): ReactElement {
  const entry = (registry as Record<string, { Component: ComponentType } | undefined>)[tab];
  const Active = entry?.Component;
  return (
    <>
      <Tabs panelId={panelId} value={tab} onChange={(value) => onChange(value as TabId)} items={tabItems(registry, order)} />
      <section
        role="tabpanel"
        id={panelId}
        {...(Active ? { "aria-labelledby": `${panelId}-tab-${tab}` } : { "aria-label": "Unknown view" })}
        tabIndex={0}
      >
        {Active ? <Active /> : <NotFoundView what={tab} />}
      </section>
    </>
  );
}

export function NotFoundView({ what }: { what: string }) {
  return (
    <Card>
      <Empty
        title="This view does not exist"
        description={`“${what}” is not a view on this page. Choose another tab; nothing was changed.`}
      />
    </Card>
  );
}
```

- [ ] **Step 0.4: Write the failing `query.ts` tests**

> **WS5 reconciliation (authoritative):** WS5 Step 1.11b ships `dashboard/src/lib/clients/query.ts` with `useResource`/`useResourcePage`/`useResourceOffsetPage` and the binding §3.4 signatures. Do **not** create a second module. This step and Step 0.6 are the *target state*: extend WS5's `query.ts` in place (add `cursorKey` URL-cursor support and the tests below), and keep the path-based hooks in `lib/api.ts` as wrappers over it. If WS5 has not landed, stop — WS6's precondition forbids starting.

Create/extend `dashboard/src/lib/clients/query.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useResource, useResourcePage } from "./query";

afterEach(cleanup);

function Read({ load }: { load: () => Promise<{ value: string }> }) {
  const resource = useResource("probe:1", load);
  return <p>{resource.loading ? "loading" : (resource.data?.value ?? "none")}</p>;
}

it("keeps the last resolved value when a slower earlier request settles", async () => {
  let resolveFirst: (value: { value: string }) => void = () => {};
  const first = new Promise<{ value: string }>((resolve) => (resolveFirst = resolve));
  const second = Promise.resolve({ value: "second" });
  const loads = [first, second];
  const { container, rerender } = render(<Read load={() => loads.shift()!} />);
  rerender(<Read load={() => loads.shift()!} />);
  await waitFor(() => expect(container.textContent).toBe("second"));
  resolveFirst({ value: "first" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(container.textContent).toBe("second");
});

it("paginates a client page function with an exclusive cursor", async () => {
  const pages = new Map<string | null, { items: string[]; nextCursor: string | null }>([
    [null, { items: ["a"], nextCursor: "c2" }],
    ["c2", { items: ["b"], nextCursor: null }],
  ]);
  function Paged() {
    const [key, setKey] = useState("probe");
    const page = useResourcePage(key, async (cursor) => pages.get(cursor)!, {});
    return (
      <button onClick={() => { page.onChange(page.page + 1); setKey(`probe:${page.page + 1}`); }}>
        {page.data.join(",") || "empty"}!
      </button>
    );
  }
  const { container } = render(<Paged />);
  await waitFor(() => expect(container.textContent).toBe("a!"));
  container.querySelector("button")!.click();
  await waitFor(() => expect(container.textContent).toBe("b!"));
});
```

- [ ] **Step 0.5: Run the test to verify it fails**

```bash
npm run test --workspace sidechannel-dashboard -- src/lib/clients/query.test.tsx
```

Expected: FAIL — WS5's `query.ts` exists (Step 1.11b), so the failure is the new capability, not a missing module: the `key`-change/`cursorKey` assertions fail (WS5's version has no URL-cursor support). If the module is genuinely missing, WS5 has not landed and WS6 must stop (precondition P.1).

- [ ] **Step 0.6: Extend `query.ts` to its target state**

> WS5 ships this module (Step 1.11b). Apply the code below **in place** (replacing WS5's simpler page/offset hooks), not as a new file.

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { OffsetPage, Page } from "../contracts";

/**
 * Client-parameterised read hook with the §3.4 result shape. `key` is the staleness identity:
 * changing it resets the resource, exactly like a changed path does for `useApi`.
 */
export function useResource<T>(key: string | null, load: () => Promise<T>, options: { interval?: number } = {}) {
  const { interval = 0 } = options;
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(!!key);
  const [updatedAt, setUpdatedAt] = useState<number>();
  const generation = useRef(0);
  const latest = useRef(load);
  latest.current = load;
  const refresh = useCallback(async () => {
    if (!key) return;
    const request = ++generation.current;
    try {
      const value = await latest.current();
      if (request !== generation.current) return;
      setData(value);
      setError(undefined);
      setUpdatedAt(Date.now());
    } catch (caught) {
      if (request === generation.current) setError(caught as Error);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [key]);
  useEffect(() => {
    setData(undefined);
    setError(undefined);
    setLoading(!!key);
    void refresh();
    const timer = interval ? setInterval(() => { if (!document.hidden) void refresh(); }, interval) : undefined;
    return () => { generation.current++; clearInterval(timer); };
  }, [refresh, interval, key]);
  return { data, error, loading, refresh, updatedAt };
}

export function useResourcePage<T>(
  key: string | null,
  load: (cursor: string | null) => Promise<Page<T>>,
  options: { interval?: number; cursorKey?: string } = {},
) {
  const { interval = 0, cursorKey } = options;
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const saved = cursorKey ? ["", ...params.getAll(cursorKey)] : null;
  const currentPage = cursorKey ? saved!.length - 1 : page;
  const cursor = cursorKey ? saved![currentPage] || null : (cursors[currentPage] ?? null);
  const resource = useResource(key ? `${key}|${cursor ?? ""}` : null, () => load(cursor), { interval });
  const onChange = (next: number) => {
    if (cursorKey) {
      if (next > currentPage && !resource.data?.nextCursor) return;
      const chain = next > currentPage ? [...saved!.slice(1), resource.data!.nextCursor!] : saved!.slice(1, next + 1);
      setParams((previous) => {
        previous.delete(cursorKey);
        chain.forEach((value) => previous.append(cursorKey, value));
        return previous;
      });
      return;
    }
    if (next > currentPage) {
      if (!resource.data?.nextCursor) return;
      setCursors((previous) => [...previous.slice(0, next), resource.data!.nextCursor!]);
    }
    setPage(next);
  };
  return {
    data: resource.data?.items ?? [],
    page: currentPage,
    hasMore: !!resource.data?.nextCursor,
    loading: resource.loading,
    error: resource.error,
    onChange,
    refresh: resource.refresh,
  };
}

export function useResourceOffsetPage<T>(
  key: string | null,
  load: (offset: number) => Promise<OffsetPage<T>>,
  options: { interval?: number; pageSize?: number } = {},
) {
  const { interval = 0, pageSize = 25 } = options;
  const [page, setPage] = useState(0);
  const resource = useResource(key ? `${key}|${page}` : null, () => load(page * pageSize), { interval });
  return {
    data: resource.data?.items ?? [],
    total: resource.data?.total ?? 0,
    page,
    hasMore: resource.data?.nextOffset != null,
    loading: resource.loading,
    error: resource.error,
    onChange: setPage,
    refresh: resource.refresh,
  };
}
```

- [ ] **Step 0.7: Run the query tests to verify they pass**

```bash
npm run test --workspace sidechannel-dashboard -- src/lib/clients/query.test.tsx src/components/view-registry.test.tsx
```

Expected: PASS (5 tests).

- [ ] **Step 0.8: Write the failing harness tests**

Create `dashboard/src/test/clients.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useClients } from "../lib/clients/context";
import { fakeClients, renderWithClients } from "./clients";

afterEach(cleanup);

function Probe() {
  const clients = useClients();
  return <p>{typeof clients.runs.get}</p>;
}

it("provides a client for every resource and fails loudly on an unscripted call", async () => {
  const clients = fakeClients({ runs: { get: async () => ({ id: "run-1" }) } });
  renderWithClients(<Probe />, { clients });
  expect(screen.getByText("function")).toBeTruthy();
  expect((await clients.runs.get("run-1")).id).toBe("run-1");
  await expect(clients.runs.cancel("run-1")).rejects.toThrow("Unexpected runs.cancel call in this test");
});

it("renders at the requested route", () => {
  renderWithClients(<Probe />, { route: "/runs/run-1?view=board" });
  expect(screen.getByText("function")).toBeTruthy();
});
```

- [ ] **Step 0.9: Run the harness test to verify it fails**

```bash
npm run test --workspace sidechannel-dashboard -- src/test/clients.test.tsx
```

Expected: FAIL — `Failed to load url ./clients`.

- [ ] **Step 0.10: Implement `test/clients.tsx` and `use-command.ts`**

```tsx
// dashboard/src/test/clients.tsx
/** Fixture clients for view tests. No global fetch, no path strings, no endpoint tables. */
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { render, type RenderResult } from "@testing-library/react";
import { ApiClientProvider, useClients } from "../lib/clients/context";

type Clients = ReturnType<typeof useClients>;
export type ClientOverrides = { [K in keyof Clients]?: Partial<Clients[K]> };

function stub<T extends object>(name: string, overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, key) {
      if (key in target) return (target as Record<string | symbol, unknown>)[key];
      return () => Promise.reject(new Error(`Unexpected ${name}.${String(key)} call in this test`));
    },
  });
}

export function fakeClients(overrides: ClientOverrides = {}): Clients {
  return {
    runs: stub<Clients["runs"]>("runs", overrides.runs),
    codebooks: stub<Clients["codebooks"]>("codebooks", overrides.codebooks),
    analyses: stub<Clients["analyses"]>("analyses", overrides.analyses),
    monitor: stub<Clients["monitor"]>("monitor", overrides.monitor),
    reviews: stub<Clients["reviews"]>("reviews", overrides.reviews),
    experiments: stub<Clients["experiments"]>("experiments", overrides.experiments),
  } as Clients;
}

export function renderWithClients(
  ui: ReactElement,
  options: { clients?: Clients; route?: string | string[] } = {},
): RenderResult {
  const entries = options.route === undefined ? ["/"] : Array.isArray(options.route) ? options.route : [options.route];
  return render(
    <MemoryRouter initialEntries={entries}>
      <ApiClientProvider clients={options.clients ?? fakeClients()}>{ui}</ApiClientProvider>
    </MemoryRouter>,
  );
}
```

The `experiments` member is added by T6.1 Step 1.5; add it there in the same commit that registers `experimentsClient`, and delete the line here if T6.1 lands later than T6.0 (the file is otherwise unchanged). `ApiClientProvider`'s prop name is fixed by WS5; if it differs, change only this file.

```ts
// dashboard/src/components/use-command.ts
import { useMutation } from "../lib/api";

/** Thin alias over the single mutation state machine in `lib/api.ts` (no second implementation). */
export function useCommand() {
  return useMutation();
}
```

- [ ] **Step 0.11: Run the full dashboard suite**

```bash
npm run test --workspace sidechannel-dashboard
npm run check --workspace sidechannel-dashboard
npm run lint --workspace sidechannel-dashboard
```

Expected: PASS, same test count as P.3 plus 7.

- [ ] **Step 0.12: Commit**

```bash
git add dashboard/src/components/view-registry.tsx dashboard/src/components/view-registry.test.tsx \
        dashboard/src/components/use-command.ts dashboard/src/lib/clients/query.ts \
        dashboard/src/lib/clients/query.test.tsx dashboard/src/test/clients.tsx dashboard/src/test/clients.test.tsx
git commit -m "refactor(dashboard): view registry, client-backed reads and fake-client test harness"
```

**Gate:** new files ≤ 200 lines each; all four tests pass; no page edited yet.

---

## T6.1 — `Experiments.tsx` (1,209 lines) → `pages/experiments/`

**Files:**
- Create: `pages/experiments/{use-experiment-draft.ts,use-experiment-validation.ts,launch-payload.ts,config-edit.ts,config-field.tsx,draft-library.tsx,incomplete-draft.tsx,experiment-editor.tsx,scenario-section.tsx,agents-section.tsx,execution-section.tsx,board-memory-section.tsx,artifact-report-section.tsx,launch-review.tsx,experiments.css}`
- Create: `lib/clients/experiments.ts`; modify `lib/clients/context.tsx`, `lib/clients/query.ts` (no change expected), `test/clients.tsx` (add `experiments` stub)
- Rewrite: `pages/Experiments.tsx`
- Test: `pages/experiments/{launch-payload.test.ts,draft-library.test.tsx,use-experiment-draft.test.tsx}` + rewritten `pages/Experiments.test.tsx`, `workflows.test.tsx` (Experiments block)

**Interfaces:**
- Consumes: `Page`/`OffsetPage` from `lib/contracts`; `useResource`/`useResourceOffsetPage` from `lib/clients/query`; `experimentsClient`; `runDrafts` (below); `HealthcarePreset`, `ModelControls`, `BudgetSummary` (unchanged props until T6.8).
- Produces:

```ts
// dashboard/src/lib/clients/experiments.ts
// WS6 reconciliation: this is a FACADE over WS5's clients, not new HTTP code.
// `createExperimentsClient(clients)` delegates to `clients.workspace` (config/drafts/datasets/
// adaption models) and `clients.runs.createPair` (pair launch), mapping only the view-model
// types (`DraftSaveInput`→`DraftSave`, `Validation`→`ConfigValidation`).
export interface ConfigValidation { valid: boolean; errors: string[]; fieldErrors?: Record<string, string>; config?: ExperimentConfig; }
export interface DraftSaveInput { id?: string; revision?: number; config: ExperimentConfig; name: string; notes: string; }

export interface ExperimentsClient {
    defaults(): Promise<ExperimentConfig>;
    schema(): Promise<{ fields: { path: string; required: boolean }[] }>;
    validate(config: ExperimentConfig): Promise<ConfigValidation>;
    drafts(): Promise<Draft[]>;
    draft(id: string): Promise<Draft>;
    saveDraft(input: DraftSaveInput): Promise<Draft>;
    duplicateDraft(id: string): Promise<Draft>;
    datasets(): Promise<DatasetCatalogItem[]>;
    preset(datasetId: string): Promise<ExperimentConfig>;
    launchPair(input: LaunchPayload): Promise<Run[]>;
}
export function createExperimentsClient(clients: ApiClients): ExperimentsClient;

// dashboard/src/pages/experiments/launch-payload.ts
export interface LaunchPayload { config: ExperimentConfig; idempotencyKey: string; pairingSeed: number | undefined; sourceDraftId?: string; sourceDraftRevision?: number; }
export function buildLaunchPayload(input: { config: ExperimentConfig; launchKey: string; dirty: boolean; draft: Draft | undefined }): LaunchPayload;

// dashboard/src/pages/experiments/config-edit.ts
export const readableName: (value: string) => string;
export function focusField(path: string): void;
export function isEditableConfiguration(value: ExperimentConfig): boolean;
export function completeConfiguration(defaults: ExperimentConfig, input: unknown): ExperimentConfig;
export function valueAt(config: ExperimentConfig, path: string): unknown;
export function setAt(config: ExperimentConfig, path: string, value: unknown): ExperimentConfig;

// dashboard/src/pages/experiments/use-experiment-draft.ts
export function useExperimentDraft(source: { draftId: string | null; editing: boolean; recover: boolean; routeKey: string }): {
    config: ExperimentConfig | undefined; draft: Draft | undefined; notes: string; dirty: boolean;
    savedLocal: boolean; draftError: Error | undefined; launchKey: string;
    defaults: ExperimentConfig | undefined; defaultsLoading: boolean; defaultsError: Error | undefined;
    schema: { fields: { path: string; required: boolean }[] } | undefined; schemaError: Error | undefined;
    drafts: Draft[]; draftsLoading: boolean; draftsError: Error | undefined;
    change(path: string, value: unknown): void;
    replace(config: ExperimentConfig): void;
    editNotes(value: string): void;
    load(item: Draft): void;
    complete(): void;
    startNew(): void;
    saved(revision: Draft): void;
    rotateLaunchKey(): void;
};

// dashboard/src/pages/experiments/use-experiment-validation.ts
export function useExperimentValidation(input: {
    config: ExperimentConfig | undefined;
    onAccepted(config: ExperimentConfig): void;
    invalidateOn: unknown;            // pass `config`; any identity change drops the verdict
}): {
    result: ConfigValidation | undefined;
    reviewing: boolean;               // launch review panel is open
    busy: boolean; error: Error | undefined; message: string;
    launchable: boolean;              // server accepted the configuration now in the form
    validate(): Promise<ConfigValidation | undefined>;
    dismissReview(): void;
};
```

**Behaviour:** none. Validation stays server-owned: `useExperimentValidation.validate()` is the only producer of `result`; `isEditableConfiguration` remains a *structural* gate (renamed from `editableConfiguration`) and is not a validity signal.

**Inventory (source line spans of `dashboard/src/pages/Experiments.tsx`)**

| Span | Symbol | Target |
| --- | --- | --- |
| 1–38 | imports | split per target file |
| 39–43 | `readableName` | `config-edit.ts` |
| 44–54 | `focusField` | `config-edit.ts` |
| 55–60 | `Validation` | `lib/clients/experiments.ts` (`ConfigValidation`) |
| 61–70 | `tools` | `agents-section.tsx` |
| 71–79 | `supportedSettings` | `agents-section.tsx` |
| 80–106 | `editableConfiguration` | `config-edit.ts` → `isEditableConfiguration` |
| 107–136 | `completeConfiguration` | `config-edit.ts` |
| 137–144 | `valueAt` | `config-edit.ts` |
| 145–159 | `setAt` | `config-edit.ts` |
| 160–185 | `Experiments`: reads + 9 `useState` + 2 `useRef` | `use-experiment-draft.ts`, `use-experiment-validation.ts`, page shell |
| 186–214 | route initialisation effect + local recovery | `use-experiment-draft.ts` |
| 215–227 | `?draft=` hydration effect | `use-experiment-draft.ts` |
| 228–234 | localStorage persistence effect | `use-experiment-draft.ts` |
| 235–249 | `change` / `replace` | `use-experiment-draft.ts` |
| 250–288 | `field()` factory | `config-field.tsx` (`ConfigField`) |
| 289–309 | `save` | `use-experiment-draft.ts` → `saved()` |
| 310–327 | `validate` + focus | `use-experiment-validation.ts` |
| 328–344 | `launch` | `use-experiment-draft.ts` + `buildLaunchPayload` |
| 345–362 | `load` | `use-experiment-draft.ts` |
| 363–375 | `duplicate` | `use-experiment-draft.ts` |
| 376–393 | `duration()` factory | `config-field.tsx` (`DurationField`) |
| 394–453 | UI 1 — draft library | `draft-library.tsx` |
| 454–460 | UI 2 — draft load error | page shell |
| 461–463 | UI 3 — loading | page shell |
| 464–534 | UI 4 — incomplete draft | `incomplete-draft.tsx` |
| 541–624 | UI 5 — editor header + notices | `experiment-editor.tsx` |
| 605–622 | launched notice | `launch-review.tsx` |
| 625–752 | scenario & data section | `scenario-section.tsx` |
| 753–907 | agents & shared model section | `agents-section.tsx` |
| 908–956 | execution & limits section | `execution-section.tsx` |
| 957–1009 | advanced board & private memory | `board-memory-section.tsx` |
| 1010–1027 | artifact & report settings | `artifact-report-section.tsx` |
| 1029–1127 | launch review aside | `launch-review.tsx` |
| 1128–1198 | saved drafts card | `draft-library.tsx` |
| 1199–1209 | schema warning + closing | `experiment-editor.tsx` |

**Data ownership**

| Component | Reads | Writes |
| --- | --- | --- |
| `DraftLibrary` | `experiments.drafts()`, `localStorage['sidechannel-experiment-draft']` | — |
| `IncompleteDraft` | — (props: `config`, `draft`, `defaults`, `change`, `save`, `complete`, `startNew`) | via props |
| `ScenarioSection` | `experiments.datasets()` (through `HealthcarePreset`) | `experiments.preset(id)` (through `HealthcarePreset`) |
| `AgentsSection` | `experiments.defaults()` not needed; optional `/models/adaption` through `ModelControls` | — |
| `ExecutionSection` / `BoardMemorySection` / `ArtifactReportSection` | — | — |
| `LaunchReview` | — (props: `config`, `validation`, `busy`, `onValidate`, `onLaunch`, `launched`, `onBack`) | via props |
| `ExperimentEditor` | composes the above; `readableName`, `valueAt` | `experiments.saveDraft`, `validate`, `launchPair` via hooks |

**Invariants:** labels "Experiment name", "Designation", "Scenario version", "Dataset identifier", "Task", "Policy", "Research notes", "Role 1", "Allowed tools", "Request timeout (seconds)", "Maximum run duration (minutes)", "Validate & review launch", "Launch matched pair", "Save draft", "Shared saved drafts", "Recover local edits", "Incomplete experiment draft", "Complete with supported default fields", "Start a new draft"; `experiments/new`, `/experiments?draft=`, `?recover=1` routes; `data-config-path` attributes for every field; `#experiment-errors` focus target; 409 copy block; millisecond conversion (`* 1000`, `* 60000`) and `Math.round`.

- [ ] **Step 1.1: Write the failing `buildLaunchPayload` test**

Create `dashboard/src/pages/experiments/launch-payload.test.ts`:

```ts
import { expect, it } from "vitest";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { buildLaunchPayload } from "./launch-payload";

const config = { ...defaultFixtureConfiguration(), label: "Pilot matched pair" };

it("sends the frozen matched-pair body for a saved, unedited draft", () => {
  expect(buildLaunchPayload({ config, launchKey: "key-1", dirty: false, draft: { id: "draft-1", revision: 4, config } })).toEqual({
    config,
    idempotencyKey: "key-1",
    pairingSeed: config.scheduler.seed,
    sourceDraftId: "draft-1",
    sourceDraftRevision: 4,
  });
});

it("omits draft provenance when the form is dirty, unsaved or draftless", () => {
  const dirty = buildLaunchPayload({ config, launchKey: "key-2", dirty: true, draft: { id: "draft-1", revision: 4, config } });
  expect(dirty).toEqual({ config, idempotencyKey: "key-2", pairingSeed: config.scheduler.seed });
  expect("sourceDraftId" in dirty).toBe(false);
  expect(buildLaunchPayload({ config, launchKey: "key-3", dirty: false, draft: undefined })).toEqual({
    config,
    idempotencyKey: "key-3",
    pairingSeed: config.scheduler.seed,
  });
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

```bash
npm run test --workspace sidechannel-dashboard -- src/pages/experiments/launch-payload.test.ts
```

Expected: FAIL — `Failed to load url ./launch-payload`.

- [ ] **Step 1.3: Create the pure modules (`launch-payload.ts`, `config-edit.ts`) and `experimentsClient`**

`launch-payload.ts` is new code:

```ts
import type { Draft, ExperimentConfig } from "../../lib/types";

export interface LaunchPayload {
  config: ExperimentConfig;
  idempotencyKey: string;
  pairingSeed: number | undefined;
  sourceDraftId?: string;
  sourceDraftRevision?: number;
}

/** The matched-pair launch body. Draft provenance is sent only for an unmodified saved draft. */
export function buildLaunchPayload({ config, launchKey, dirty, draft }: {
  config: ExperimentConfig;
  launchKey: string;
  dirty: boolean;
  draft: Draft | undefined;
}): LaunchPayload {
  return {
    config,
    idempotencyKey: launchKey,
    pairingSeed: config.scheduler.seed,
    ...(!dirty && draft ? { sourceDraftId: draft.id, sourceDraftRevision: draft.revision } : {}),
  };
}
```

`config-edit.ts`: move `Experiments.tsx:39–159` verbatim; rename `editableConfiguration` → `isEditableConfiguration`; export all seven members listed in **Produces**.

`lib/clients/experiments.ts`: new code. Paths live here only.

```ts
import type { DatasetCatalogItem } from "@sidechannel/contracts/browser";
import type { Draft, ExperimentConfig, Run } from "../types";
import { request } from "../transport";
import type { LaunchPayload } from "../../pages/experiments/launch-payload";

export interface ConfigValidation { valid: boolean; errors: string[]; fieldErrors?: Record<string, string>; config?: ExperimentConfig; }
export interface DraftSaveInput { id?: string; revision?: number; config: ExperimentConfig; name: string; notes: string; }

export const experimentsClient = {
  defaults: () => request<ExperimentConfig>("/config/default"),
  schema: () => request<{ fields: { path: string; required: boolean }[] }>("/config/schema"),
  validate: (config: ExperimentConfig) => request<ConfigValidation>("/config/validate", { method: "POST", body: JSON.stringify({ config }) }),
  drafts: () => request<Draft[]>("/drafts"),
  draft: (id: string) => request<Draft>("/drafts/" + encodeURIComponent(id)),
  saveDraft: (input: DraftSaveInput) => request<Draft>("/drafts", { method: "POST", body: JSON.stringify(input) }),
  duplicateDraft: (id: string) => request<Draft>("/drafts/" + id + "/duplicate", { method: "POST", body: JSON.stringify({}) }),
  datasets: () => request<DatasetCatalogItem[]>("/datasets"),
  preset: (datasetId: string) => request<ExperimentConfig>("/datasets/" + encodeURIComponent(datasetId) + "/preset"),
  launchPair: (input: LaunchPayload) => request<Run[]>("/pairs", { method: "POST", body: JSON.stringify(input) }),
};
```

Register it in `lib/clients/context.tsx` (`experiments: experimentsClient` beside the five §3.4 clients) and add `experiments: stub<Clients["experiments"]>("experiments", overrides.experiments)` to `test/clients.tsx`. JSON body serialisation for the other clients stays WS5's implementation; `request` sets `Content-Type` as it does today.

- [ ] **Step 1.4: Create the hooks (`use-experiment-draft.ts`, `use-experiment-validation.ts`)**

Move `Experiments.tsx:160–249, 289–375` into `useExperimentDraft`, keeping every state name and effect dependency list. Rules that must survive the move:

- `initializedRoute.current` guard against re-initialising on every `params` identity change (the effect deps stay `[defaults.data, editing, location.pathname, location.search, params]`).
- `launchKey.current = crypto.randomUUID()` on: `change`, `replace`, `editNotes`, `load`, `complete`, `startNew`, `saved`, `recover`.
- localStorage write effect deps `[config, draft, dirty, notes]`, key `sidechannel-experiment-draft`, payload `{ config, draft, notes }`.
- `load()`'s `dirty` confirm text verbatim.

`useExperimentValidation` owns `validate()` (310–327) including `focusField` via `requestAnimationFrame`, and derives `launchable` from `reviewing && result?.valid === true`.

- [ ] **Step 1.5: Write the failing editor/library render tests**

Create `dashboard/src/pages/experiments/draft-library.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { fakeClients, renderWithClients } from "../../test/clients";
import { DraftLibrary } from "./draft-library";

const config = defaultFixtureConfiguration();
beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("lists shared drafts separately from explicit local recovery", async () => {
  localStorage.setItem("sidechannel-experiment-draft", JSON.stringify({ config }));
  renderWithClients(<DraftLibrary />, {
    route: "/experiments",
    clients: fakeClients({ experiments: { drafts: async () => [{ id: "shared", config, revision: 2 }] } }),
  });
  expect(await screen.findByRole("link", { name: /revision 2/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: "New experiment" }).getAttribute("href")).toBe("/experiments/new");
  expect(screen.getByRole("link", { name: "Recover local edits" }).getAttribute("href")).toContain("recover=1");
  expect(screen.queryByLabelText("Experiment name")).toBeNull();
});

it("renders the empty state without a fetch stub", async () => {
  renderWithClients(<DraftLibrary />, {
    route: "/experiments",
    clients: fakeClients({ experiments: { drafts: async () => [] } }),
  });
  expect(await screen.findByText("No shared drafts yet. Create an experiment to begin.")).toBeTruthy();
});
```

Add `dashboard/src/pages/experiments/use-experiment-validation.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { fakeClients, renderWithClients } from "../../test/clients";
import { useExperimentValidation } from "./use-experiment-validation";
import type { ExperimentConfig } from "../../lib/types";

afterEach(cleanup);

function Probe({ config, onAccepted }: { config: ExperimentConfig; onAccepted: (value: ExperimentConfig) => void }) {
  const validation = useExperimentValidation({ config, onAccepted, invalidateOn: config });
  return (
    <button onClick={() => void validation.validate()} disabled={validation.busy}>
      {validation.launchable ? "launchable" : "not launchable"}
    </button>
  );
}

it("treats the server verdict as the only validity owner and reports field errors in order", async () => {
  const config = defaultFixtureConfiguration();
  const validate = vi.fn(async () => ({
    valid: false,
    errors: ["Fix memory"],
    fieldErrors: { "memory.contextBudget": "Use a positive memory budget" },
  }));
  renderWithClients(<Probe config={config} onAccepted={() => {}} />, { clients: fakeClients({ experiments: { validate } }) });
  expect(screen.getByText("not launchable")).toBeTruthy();
  await userEvent.click(screen.getByRole("button"));
  expect(validate).toHaveBeenCalledWith(config);
  expect(screen.getByText("not launchable")).toBeTruthy();
});
```

- [ ] **Step 1.6: Run to verify both fail**

```bash
npm run test --workspace sidechannel-dashboard -- src/pages/experiments
```

Expected: FAIL — `Failed to load url ./draft-library` then `./use-experiment-validation`.

- [ ] **Step 1.7: Move the components and rewrite the page shell**

Create each file by moving the mapped range verbatim, then apply only these edits:

| New file | Source | Export signature |
| --- | --- | --- |
| `draft-library.tsx` | 394–453 + 1128–1198 | `export function DraftLibrary(): ReactElement` |
| `incomplete-draft.tsx` | 464–534 | `export function IncompleteDraft(props: { config: ExperimentConfig; draft: Draft \| undefined; canComplete: boolean; busy: boolean; error: Error \| undefined; onChange(path: string, value: unknown): void; onComplete(): void; onSave(): void; onStartNew(): void }): ReactElement` |
| `experiment-editor.tsx` | 541–624, 1199–1209 | `export function ExperimentEditor(props: EditorProps): ReactElement` |
| `scenario-section.tsx` | 625–752 | `export function ScenarioSection(props: { config: ExperimentConfig; replace(config: ExperimentConfig): void; field: ConfigFieldFactory; errors?: Record<string, string> }): ReactElement` |
| `agents-section.tsx` | 61–79, 753–907 | `export function AgentsSection(props: { config: ExperimentConfig; change(path: string, value: unknown): void; field: ConfigFieldFactory; errors?: Record<string, string> }): ReactElement` |
| `execution-section.tsx` | 908–956 | `export function ExecutionSection(props: { field: ConfigFieldFactory; duration: DurationFieldFactory }): ReactElement` |
| `board-memory-section.tsx` | 957–1009 | `export function BoardMemorySection(props: ExecutionSectionProps): ReactElement` |
| `artifact-report-section.tsx` | 1010–1027 | `export function ArtifactReportSection(props: { field: ConfigFieldFactory }): ReactElement` |
| `launch-review.tsx` | 605–622, 1029–1127 | `export function LaunchReview(props: { config: ExperimentConfig; launched: Run[] \| undefined; reviewing: boolean; valid: boolean; busy: boolean; error: Error \| undefined; message: string; onValidate(): void; onLaunch(): void; onBack(): void }): ReactElement` |
| `config-field.tsx` | 250–288, 376–393 | `export interface ConfigFieldFactory { (path: string, label: string, hint?: string, kind?: "text" \| "textarea" \| "number", min?: number): ReactElement }` `export function useConfigField(config: ExperimentConfig, errors: Record<string, string> \| undefined, required: (path: string) => boolean, change: (path: string, value: unknown) => void): { field: ConfigFieldFactory; duration: DurationFieldFactory }` |
| `pages/Experiments.tsx` | new | `export default function Experiments(): ReactElement` — reads `useLocation`, `useSearchParams`, `editing = pathname.endsWith("/new") \|\| params.has("draft") \|\| params.has("recover")`, `localRecovery = localStorage.getItem("sidechannel-experiment-draft")`, `draftId = params.get("draft")`, and renders `DraftLibrary` / `IncompleteDraft` / `ExperimentEditor` |

`experiments.css` is `git mv` of `pages/Experiments.css`; the shell imports `./experiments/experiments.css`. `field`/`duration` close over `config`, `validation` and `change`, so they become a hook (`useConfigField`) that returns the two factories with the identical JSX; the sections take the factories as props.

- [ ] **Step 1.8: Rewrite `Experiments.test.tsx` and the `workflows.test.tsx` Experiments block**

Replace the `vi.stubGlobal("fetch", …)` handler with fake clients, keeping all four test titles and assertions:

```tsx
// dashboard/src/pages/Experiments.test.tsx (header only; bodies unchanged)
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import Experiments from "./Experiments";
import { fakeClients, renderWithClients, type ClientOverrides } from "../test/clients";

const config = defaultFixtureConfiguration();
let submitted: { config: typeof config } | undefined;
function renderAt(path: string, overrides: ClientOverrides = {}) {
  return renderWithClients(<Experiments />, { route: path, clients: fakeClients({ experiments: { defaults: async () => config, schema: async () => ({ fields: [] }), drafts: async () => [], ...overrides.experiments }, ...overrides }) });
}
```

`workflows.test.tsx`'s "validates ordinary form fields and explicitly launches one idempotent matched pair" becomes `clients: fakeClients({ experiments: { defaults, schema, drafts: async () => [], validate: async () => ({ valid: true, errors: [] }), launchPair: async (payload) => { submitted = payload; return [run, second]; } } })`; the `setupConfig` helper and `mockApi` are deleted. The "recovers a structurally incomplete saved draft" test uses `experiments: { draft: async () => ({ id: "incomplete", revision: 4, config: { label: "Unfinished draft", roles: [null] } }) }`.

- [ ] **Step 1.9: Run the experiments suites green**

```bash
npm run test --workspace sidechannel-dashboard -- src/pages/experiments src/pages/Experiments.test.tsx src/workflows.test.tsx src/components/healthcare.test.tsx
npm run test --workspace sidechannel-dashboard
npm run check --workspace sidechannel-dashboard
```

Expected: PASS. `git grep "stubGlobal" dashboard/src/pages/Experiments.test.tsx` → no matches.

- [ ] **Step 1.10: Line gate + commit**

```bash
node -e "const fs=require('fs');for(const f of ['dashboard/src/pages/Experiments.tsx','dashboard/src/pages/experiments/experiment-editor.tsx','dashboard/src/pages/experiments/scenario-section.tsx','dashboard/src/pages/experiments/agents-section.tsx','dashboard/src/pages/experiments/launch-review.tsx','dashboard/src/pages/experiments/use-experiment-draft.ts'])console.log(fs.readFileSync(f,'utf8').split('\n').length.toString().padStart(4),f)"
```

Expected: `Experiments.tsx` < 400 (target ≤ 120); every other file < 300.

```bash
git add dashboard/src/pages/Experiments.tsx dashboard/src/pages/Experiments.test.tsx dashboard/src/pages/experiments \
        dashboard/src/lib/clients/experiments.ts dashboard/src/lib/clients/context.tsx dashboard/src/test/clients.tsx \
        dashboard/src/workflows.test.tsx dashboard/src/pages/Experiments.css
git commit -m "refactor(dashboard): split Experiments into draft hooks, launch payload and section views"
```

**Gate:** page < 400 lines, files < 300, single validity owner (`experiments.validate`), launch payload snapshot test green.

---

## T6.2 — `Analysis.tsx` detail (959–1511) → `pages/analysis/` detail views

**Files:**
- Create: `pages/analysis/{use-analysis-job.ts,use-analysis-windows.ts,use-review-batches.ts,analysis-detail.tsx,views.tsx,score-panel.tsx,probability-plot.tsx,score-table.tsx,heatmap-table.tsx,compare-analyses.tsx,provenance-view.tsx,review-workspace.tsx,review-queue-row.tsx,canonical-event.tsx,window-inspector.tsx}`
- Move: `pages/Analysis.css` → `pages/analysis/analysis.css`
- Modify: `pages/Analysis.tsx` (delete 959–2524; keep collection + setup for T6.4)
- Test: `pages/analysis/{analysis-detail.test.tsx,score-panel.test.tsx}` + rewrite `pages/Analysis.test.tsx`, `workflows.test.tsx` (blinded block)

**Interfaces:**
- Consumes: `analysesClient`, `reviewsClient`, `runsClient`; `useResource`, `useResourcePage`; `ViewPanel`, `NotFoundView` (T6.0); `useCommand`.
- Produces:

```ts
// pages/analysis/views.tsx
export const ANALYSIS_TABS = ["probability", "heatmap", "table", "review", "compare", "provenance"] as const;
export type AnalysisTab = (typeof ANALYSIS_TABS)[number];
export const DEFAULT_ANALYSIS_TAB: AnalysisTab = "heatmap";
export const ANALYSIS_VIEWS: ViewRegistry<AnalysisTab>;

// pages/analysis/use-analysis-job.ts
export function useAnalysisJob(id: string | undefined): {
    job: AnalysisJob | undefined; sourceRun: Run | undefined;
    loading: boolean; error: Error | undefined; refresh(): Promise<void>;
    active: boolean;                       // queued | preparing | running
    command: ReturnType<typeof useCommand>; // cancel / retry
    cancel(): Promise<void>; retry(): Promise<void>;
};

// pages/analysis/use-analysis-windows.ts
export function useAnalysisWindows(id: string | undefined): {
    windows: AnalysisWindow[]; page: number; hasMore: boolean; onChange(next: number): void;
    loading: boolean; error: Error | undefined; refresh(): Promise<void>;
    codes: BehaviorCode[]; shown: BehaviorCode[];
    threshold: number; setThreshold(value: number): void;
    visible: string[] | undefined; toggleCode(codeId: string): void;
    detail: WindowDetail | undefined; detailLoading: boolean; detailError: Error | undefined; refreshDetail(): Promise<void>;
    open(windowId: string): void; close(): void;
};

// pages/analysis/use-review-batches.ts
export function useReviewBatches(job: AnalysisJob): {
    reviewer: string; identifyReviewer(value: string): void;
    batches: ReviewBatch[]; batchesLoading: boolean; batchesError: Error | undefined;
    batchesPage: number; batchesHasMore: boolean; onBatchesPage(next: number): void; refreshBatches(): Promise<void>;
    batchId: string; batch: { batch: ReviewBatch; selections: Page<ReviewSelection> } | undefined;
    batchLoading: boolean; batchError: Error | undefined; refreshBatch(): Promise<void>;
    mode: "assisted" | "blind"; setMode(value: "assisted" | "blind"): void;
    threshold: number; setThreshold(value: number): void;
    randomCount: number; setRandomCount(value: number): void;
    seed: string; setSeed(value: string): void;
    queueFilter: string; setQueueFilter(value: string): void;
    nextSelections(): void; create(): Promise<void>;
    blind: boolean; command: ReturnType<typeof useCommand>;
    queue: string[];
};
```

**Behaviour:** none. Deliberate removals of *duplicate* filtering only: `useReviewBatches` and `useAnalysisWindows` key every read by `'analysis:' + id + ':…'`, so WS5's path-keyed staleness guard replaces the page-level re-filtering (`reviews.data?.items.filter(r => r.windowId === …)` in `ReviewQueueRow`/`WindowInspector` stays only where it is a *semantic* filter, i.e. matching the requested subject).

**Inventory (`dashboard/src/pages/Analysis.tsx`)**

| Span | Symbol | Target |
| --- | --- | --- |
| 959–997 | `AnalysisDetail` reads (8 `useApi`/pagers, 5 `useState`) | `use-analysis-job.ts`, `use-analysis-windows.ts`, `use-review-batches.ts` |
| 998–1016 | guards, `codes`/`shown`, `openWindow`, `setTab`, `active` | `use-analysis-windows.ts` + `analysis-detail.tsx` |
| 1017–1089 | back link, `PageHeader`, actions (badge, duplicate, export, cancel, retry) | `analysis-detail.tsx` |
| 1090–1128 | `run-metadata`, stale/error/success notices | `analysis-detail.tsx` |
| 1129–1157 | `Tabs` + panel + coverage `Notice` | `ViewPanel` + `score-panel.tsx` |
| 1158–1211 | filter bar + probability branch | `score-panel.tsx` |
| 1212–1260 | heatmap branch | `heatmap-table.tsx` |
| 1261–1267 | score-table branch | `score-table.tsx` (existing 1612–1671) |
| 1268–1279 | windows `Pager` | `score-panel.tsx` |
| 1282–1293 | review branch → `ReviewWorkspace` props | `review-workspace.tsx` |
| 1294–1406 | compare branch | `compare-analyses.tsx` |
| 1407–1450 | provenance branch | `provenance-view.tsx` |
| 1452–1508 | window drawer | `analysis-detail.tsx` + `window-inspector.tsx` |
| 1512–1611 | `ProbabilityPlot` | `probability-plot.tsx` |
| 1612–1671 | `ScoreTable` | `score-table.tsx` |
| 1672–1948 | `ReviewWorkspace` | `review-workspace.tsx` |
| 1949–2021 | `ReviewQueueRow` | `review-queue-row.tsx` |
| 2023–2086 | `CanonicalEvent` | `canonical-event.tsx` |
| 2087–2524 | `WindowInspector` | `window-inspector.tsx` |

**Data ownership**

| Component | Reads | Writes |
| --- | --- | --- |
| `AnalysisDetail` (shell) | `useAnalysisJob(id)` | cancel/retry via `useAnalysisJob` |
| `ScorePanel` (`kind` prop) | `useAnalysisWindows(id)` | — |
| `ReviewWorkspace` | `useReviewBatches(job)` via `useAnalysisJob` parent-free call (`id` from route + `analysesClient.get`) | `reviews.batches.create` |
| `ReviewQueueRow` | `analyses.window(id, windowId)`, `reviews.list(...)` | — |
| `CompareAnalyses` | `analyses.get(compareId)`, `analyses.windows(compareId)`, `analyses.listForRun(runId)` | — |
| `ProvenanceView` | — (`useAnalysisJob`) | — |
| `WindowInspector` | `reviews.list(...)`, `runs.event(...)` per citation, `reviews.latest(...)` | `reviews.save(...)` |
| `CanonicalEvent` | `runs.event(runId, eventId)` when `supplied` is absent | — |

**Invariants:** tab labels "Probability timeline", "Heatmap", "Score table", "Human review", "Compare analyses", "Provenance & exports"; `panelId="analysis-view-panel"`; coverage `Notice` copy; threshold hint "Highlight threshold (display only)"; heatmap `aria-label="Behavior probability heatmap"`; `Table label="Window probability scores"`; SVG `role="img"` + `aria-label`; drawer `wide`, title `Window N · steps A–B`, description "Exact normalized evidence and canonical source links."; `?view=`, `?window=`, `?batch=`, `?blind=`, `?compare=`, `?return=` behaviour; the "Complete linked datasets" export anchors (`/api/analyses/:id/export?dataset=analysis&limit=100`); `"Estimate behaviors…"` copy.

- [ ] **Step 2.1: Write the failing detail characterization test**

Create `dashboard/src/pages/analysis/analysis-detail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { fakeClients, renderWithClients } from "../../test/clients";
import { AnalysisDetail } from "./analysis-detail";
import type { AnalysisJob, AnalysisWindow } from "../../lib/analysis-types";

afterEach(cleanup);

const code = { id: "visibility", code: "VISIBILITY", name: "Visibility", definition: "An explicit visibility reference", enabled: true, archived: false, color: "#2563eb", inclusionCriteria: [], exclusionCriteria: [], examples: [], counterexamples: [], qualifyingEvidenceTypes: [] };
const job = {
  id: "analysis-a", runId: "source-run", status: "completed", createdAt: "2026-11-07T12:00:00Z", updatedAt: "2026-11-07T12:00:00Z",
  cancelRequested: false, counters: { prepared: 1, submitted: 1, finished: 1, failed: 0, skipped: 0, answers: 1 },
  manifest: { sourceStatus: "completed", sequenceBoundary: 35, codebook: { id: "revision-a", revision: 1, codes: [code] },
    settings: { model: "jev-1.14.0", windowSize: 12, stride: 4 }, configHash: "config", evidenceHash: "evidence", diagnostics: [], availability: {} },
} as unknown as AnalysisJob;
const window: AnalysisWindow = { id: "window-a", analysisId: "analysis-a", runId: "source-run", index: 0, startStep: 1, endStep: 12, stepIds: ["s1"], eventIds: ["event-a"], partial: true, incomplete: false, empty: false, state: "", inputHash: "hash", status: "completed", budget: { bytes: 10, estimatedTokens: 10, estimatorVersion: "v1", perQuestionLimit: 1, perRequestLimit: 2, headroom: 0, oversized: false, batches: [] }, results: [{ codeId: code.id, probability: 0 }] } as AnalysisWindow;

function clients() {
  return fakeClients({
    analyses: {
      get: async () => job,
      windows: async () => ({ items: [window], nextCursor: null }),
      listForRun: async () => ({ items: [job], nextCursor: null }),
    },
    runs: { get: async () => ({ id: "source-run", config: { ...defaultFixtureConfiguration(), label: "Study", condition: { id: "reviewed", text: "Reviewed" } } }) },
  });
}

it("keeps the frozen job header, coverage notice and heatmap scores", async () => {
  renderWithClients(<AnalysisDetail />, { route: "/analysis/analysis-a", clients: clients() });
  expect(await screen.findByText(/Coverage on this page: 1 windows .* 1 partial/)).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Heatmap" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("table", { name: "Behavior probability heatmap" })).toBeTruthy();
  expect(screen.getByText("0%")).toBeTruthy();
  expect(screen.getByText("Source boundary")).toBeTruthy();
});

it("renders not-found for an unknown view instead of the provenance panel", async () => {
  renderWithClients(<AnalysisDetail />, { route: "/analysis/analysis-a?view=typo", clients: clients() });
  expect(await screen.findByText("This view does not exist")).toBeTruthy();
  expect(screen.queryByText("Reproducible provenance")).toBeNull();
});
```

- [ ] **Step 2.2: Run to verify it fails**

```bash
npm run test --workspace sidechannel-dashboard -- src/pages/analysis/analysis-detail.test.tsx
```

Expected: FAIL — `Failed to load url ./analysis-detail`.

- [ ] **Step 2.3: Create the three hooks**

Move the reads at 964–997 into the hooks with these exact client calls (member names per P.4):

| Old call | New |
| --- | --- |
| `useApi<AnalysisJob>("/analyses/" + id, 4000)` | `useResource("analysis:" + id, () => clients.analyses.get(id!), { interval: 4000 })` |
| `useApi<Run>(job.data ? "/runs/" + job.data.runId : null)` | `useResource(job.data ? "analysis:" + id + ":source" : null, () => clients.runs.get(job.data!.runId))` |
| hand-rolled cursor pager (966–974) | `useResourcePage("analysis:" + id + ":windows", (cursor) => clients.analyses.windows(id!, cursor), { interval: 6000 })` |
| `useApi<WindowDetail>(windowId ? … )` | `useResource(windowId ? "analysis:" + id + ":window:" + windowId : null, () => clients.analyses.window(id!, windowId!))` |
| `useApi<{batch}>(params.get("batch") ? … ?limit=1 : null)` | `useResource(batchId ? "analysis:" + id + ":batch:" + batchId : null, () => clients.reviews.batch(id!, batchId, { limit: 1 }))` |
| `useApi<AnalysisJob>(compareId ? …)` | `useResource(compareId ? "analysis:" + compareId : null, () => clients.analyses.get(compareId))` |
| `useApi<Page<AnalysisWindow>>(compareId ? … ?limit=30)` | `useResource(compareId ? "analysis:" + compareId + ":windows" : null, () => clients.analyses.windows(compareId, null))` |
| `useCursorApi<AnalysisJob>(job.data ? "/runs/"+runId+"/analyses" : null)` | `useResourcePage(job.data ? "run:" + job.data.runId + ":analyses" : null, (cursor) => clients.analyses.listForRun(job.data!.runId, cursor))` |

`useReviewBatches` replaces 978–997 + 1683–1760 (`batches`, `batch`, `mode`, `threshold`, `randomCount`, `seed`, `queueFilter`, `batchCursor`, `reviewer`, `create`, `refreshBatch`, `queueIds` → `onQueue`). It takes `job` and reads `batchId` from `useSearchParams`.

- [ ] **Step 2.4: Write the failing score-panel test, then move the views**

Create `dashboard/src/pages/analysis/score-panel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { fakeClients, renderWithClients } from "../../test/clients";
import { ScorePanel } from "./score-panel";
import { analysisFixture } from "./analysis-fixture"; // created in this step

afterEach(cleanup);
const { job, windows } = analysisFixture();

it("shows the same estimate caveat above the probability, heatmap and table views", async () => {
  const clients = fakeClients({ analyses: { get: async () => job, windows: async () => ({ items: windows, nextCursor: null }) } });
  for (const kind of ["probability", "heatmap", "table"] as const) {
    renderWithClients(<ScorePanel kind={kind} id="analysis-a" />, { route: "/analysis/analysis-a", clients });
    expect(await screen.findByText(/Estimated probability the behavior occurs in this window/)).toBeTruthy();
    cleanup();
  }
});

it("keeps missing scores as gaps, never zeros", async () => {
  const clients = fakeClients({ analyses: { get: async () => job, windows: async () => ({ items: [{ ...windows[0], results: [] }], nextCursor: null }) } });
  renderWithClients(<ScorePanel kind="table" id="analysis-a" />, { route: "/analysis/analysis-a", clients });
  expect(await screen.findByText("— missing")).toBeTruthy();
});
```

`analysis-fixture.ts` is a helper (not a `.test` file) exporting `analysisFixture()` with the job/window objects used by both tests.

Then move the views exactly as mapped in the inventory and export:

| New file | Source | Export |
| --- | --- | --- |
| `analysis-detail.tsx` | 1017–1151, 1452–1508 | `export function AnalysisDetail(): ReactElement` |
| `views.tsx` | new | `ANALYSIS_TABS`, `AnalysisTab`, `DEFAULT_ANALYSIS_TAB`, `ANALYSIS_VIEWS` (six entries; titles copied from 1134–1139) |
| `score-panel.tsx` | 1150–1280 | `export function ScorePanel({ kind, id }: { kind: "probability" \| "heatmap" \| "table"; id: string }): ReactElement` |
| `probability-plot.tsx` | 1512–1611 | `export function ProbabilityPlot(props: { code: BehaviorCode; windows: AnalysisWindow[]; onSelect(window: AnalysisWindow): void }): ReactElement` |
| `score-table.tsx` | 1612–1671 | `export function ScoreTable(props: { windows: AnalysisWindow[]; codes: BehaviorCode[]; onSelect(window: AnalysisWindow): void }): ReactElement` |
| `heatmap-table.tsx` | 1214–1259 | `export function HeatmapTable(props: { windows: AnalysisWindow[]; codes: BehaviorCode[]; threshold: number; onSelect(window: AnalysisWindow): void }): ReactElement` |
| `compare-analyses.tsx` | 1295–1406 | `export function CompareAnalyses(): ReactElement` (reads `id`, `compare` from route) |
| `provenance-view.tsx` | 1408–1449 | `export function ProvenanceView(): ReactElement` |
| `review-workspace.tsx` | 1672–1948 | `export function ReviewWorkspace(props: { id: string; windowId: string \| undefined; onSelectWindow(windowId: string): void; reviewVersion: number; onQueue(ids: string[]): void }): ReactElement` |
| `review-queue-row.tsx` | 1949–2021 | `export function ReviewQueueRow(props: { job: AnalysisJob; selection: ReviewSelection; index: number; reviewer: string; blind: boolean; onSelect(id: string): void }): ReactElement` |
| `canonical-event.tsx` | 2023–2086 | `export function CanonicalEvent(props: { eventId: string; runId: string; supplied?: HarnessEvent; selected: boolean; onToggle(): void; onAnnotate(): void }): ReactElement` |
| `window-inspector.tsx` | 2087–2524 | `export function WindowInspector(props: { detail: WindowDetail; job: AnalysisJob; blind: boolean; onSaved?(): void; onNext?(): void; onReturn?(): void }): ReactElement` |

`AnalysisDetail` reads `id`, `view` (default `DEFAULT_ANALYSIS_TAB`), `window`, `batch`, `compare`, `return` from the route and renders `<ViewPanel registry={ANALYSIS_VIEWS} order={ANALYSIS_TABS} tab={tab} panelId="analysis-view-panel" onChange={(next) => setParams(prev => { prev.set("view", next); return prev; })} />` plus the window drawer.

- [ ] **Step 2.5: Rewrite `Analysis.test.tsx` and the `workflows.test.tsx` blinded block**

Every test keeps its title and assertions; only the data source changes. Mapping:

| Test | Fake client overrides |
| --- | --- |
| "derives initial blinding from persisted batch mode…" | `reviews: { batch: async () => ({ batch: { id: "blind-batch", mode: "blind" }, selections: { items: [], nextCursor: null } }), list: async () => ({ items: [], nextCursor: null }) }`, `analyses: { get, windows, window }` |
| "fails closed when a path change temporarily retains metadata…" | same, with `batch` returning `{ id: "old-assisted-batch", mode: "assisted" }` for any id not equal to `new-blind-batch` |
| "revises the exact event subject…" | `reviews: { list: async (query) => query.subjectId === "event-b" ? { items: [eventB], nextCursor: null } : { items: [eventA], nextCursor: null }, save: async () => ({ id: "saved" }) }` |
| "selects multiple exact citations…" | `reviews: { list, save: async () => { throw new Error("Connection lost"); } }` for the first click, then resolve |
| "renders canonical recorded text first…" | `runs: { event: async () => event }` for the `supplied`-absent case |
| "opens saved analyses as a collection…" | `analyses: { list: async () => ({ items: [], nextCursor: null }) }` |
| "explains preview prerequisites…" | T6.4 owns this test (setup split); move it there and delete it here |
| "keeps later queue pages and filters…" | `reviews: { batch: async (id, batchId, query) => … }` reading `query` instead of parsing a path |
| "does not claim an item is unreviewed…" | `reviews: { batch, list: async () => ({ items: [], nextCursor: null }) }` |
| "carries the saved analyses cursor into the detail return link" | `analyses: { list: async (cursor) => ({ items: [job], nextCursor: cursor ? null : "second-page" }) }` |

`vi.mock("../lib/api", …)` is deleted; imports become `import { WindowInspector } from "./analysis/window-inspector";`. In `workflows.test.tsx` the blinded block imports from `./pages/analysis/window-inspector` and injects `reviews`/`runs` fakes (no `mockApi`).

- [ ] **Step 2.6: Run the analysis suites green**

```bash
npm run test --workspace sidechannel-dashboard -- src/pages/analysis src/pages/Analysis.test.tsx src/workflows.test.tsx
npm run check --workspace sidechannel-dashboard
```

Expected: PASS. `git grep "vi.mock(\"../lib/api\"" dashboard/src` → no matches.

- [ ] **Step 2.7: Line gate + commit**

```bash
node -e "const fs=require('fs');for(const f of ['dashboard/src/pages/Analysis.tsx','dashboard/src/pages/analysis/analysis-detail.tsx','dashboard/src/pages/analysis/window-inspector.tsx','dashboard/src/pages/analysis/review-workspace.tsx'])console.log(fs.readFileSync(f,'utf8').split('\n').length.toString().padStart(4),f)"
```

Expected: `Analysis.tsx` < 1,000 (still holds setup until T6.4); `analysis-detail.tsx` < 300; `window-inspector.tsx` < 450; `review-workspace.tsx` < 300.

```bash
git add dashboard/src/pages/Analysis.tsx dashboard/src/pages/Analysis.test.tsx dashboard/src/pages/analysis \
        dashboard/src/workflows.test.tsx dashboard/src/pages/Analysis.css
git commit -m "refactor(dashboard): split Analysis detail into a registry of independent views"
```

**Gate:** six registered views; no per-call-site stale filtering (every read keyed); `AnalysisDetail` < 300 lines.

---

## T6.3 — `Oversight.tsx` setup (194–772) → `pages/oversight/`

**Files:**
- Create: `pages/oversight/{views.tsx,jobs-tab.tsx,monitor-setup-tab.tsx,definitions-tab.tsx,references-tab.tsx,run-reference-editor.tsx,evaluation-detail.tsx,projection-inspector.tsx,projection-grid.tsx,monitor-launch-card.tsx,use-monitor-definition.ts,oversight.css}`
- Modify: `pages/Oversight.tsx` (router + `ViewPanel` shell)
- Test: `pages/oversight/{monitor-setup-tab.test.tsx,jobs-tab.test.tsx}` + rewrite `pages/RunsOversight.test.tsx` (two oversight tests)

**Interfaces:**
- Consumes: `monitorClient`, `reviewsClient`, `runsClient`; `useResource`, `useResourcePage` (`cursorKey: "jobCursor"`).
- Produces:

```ts
// pages/oversight/views.tsx
export const OVERSIGHT_TABS = ["jobs", "setup", "definitions", "references"] as const;
export type OversightTab = (typeof OVERSIGHT_TABS)[number];
export function defaultOversightTab(query: URLSearchParams, creating: boolean): OversightTab; // creating || run ? "setup" : "jobs"
export const OVERSIGHT_VIEWS: ViewRegistry<OversightTab>;

// pages/oversight/monitor-setup-tab.tsx
export function MonitorSetupTab(): ReactElement;   // reads `run` from the route, owns preview/launch

// pages/oversight/use-monitor-definition.ts
export function useMonitorDefinitionHistory(): {
    items: MonitorDefinition[]; page: number; hasMore: boolean; onChange(next: number): void;
    loading: boolean; error: Error | undefined; refresh(): Promise<void>;
};
export function useCurrentDefinition(): {
    definition: MonitorDefinition | undefined; loading: boolean; error: Error | undefined; refresh(): Promise<void>;
};
```

**Behaviour:** none. The server handler fusion (`api/src/routes/oversight.ts:20–21,42–51`) is **out of scope** (WS3).

**Inventory (`dashboard/src/pages/Oversight.tsx`)**

| Span | Symbol | Target |
| --- | --- | --- |
| 64–73 | `viewNames`, `views`, local `Page<T>` | `views.tsx` (`viewNames` used by preview table + drawer) |
| 74–115 | `useExactApi` | deleted → `useResource` (T6.0) |
| 116–166 | `useCursorPage` | deleted → `useResourcePage({ cursorKey })` |
| 167–183 | `useRunPage` | deleted → `useResourceOffsetPage` |
| 185–193 | `Oversight` router | page shell |
| 194–208 | tab, `current`, `history`, `runs`, `referenceRuns` | `DefinitionsTab` (`current`), `MonitorSetupTab` (`history`, `runs`), `ReferencesTab` (`referenceRuns`) |
| 209–217 | evaluations page, selection, revision | `JobsTab` (page), `MonitorSetupTab` (selection, revision) |
| 218–272 | settings, preview, launchKey, change, prerequisites, preview/launch | `MonitorSetupTab` |
| 273–307 | `PageHeader`, `Tabs`, error notice, tabpanel | page shell |
| 308–316 | definitions branch | `DefinitionsTab` |
| 317–366 | references branch | `ReferencesTab` |
| 367–368 | jobs branch | `JobsTab` |
| 369–758 | setup branch (config card, projection grid, preview table, launch aside) | `MonitorSetupTab`, `ProjectionGrid`, `MonitorLaunchCard` |
| 760–769 | projection drawer | page shell renders `ProjectionInspector`? see note |
| 773–1088 | `DefinitionEditor` | `DefinitionsTab` |
| 1089–1091 | `evaluationName` | `evaluation-detail.tsx` (exported, used by `jobs-tab.tsx` too) |
| 1092–1098 | `evaluationReturn` | `evaluation-detail.tsx` |
| 1099–1173 | `EvaluationList` | `JobsTab` (renamed; owns its page) |
| 1174–1219 | `ProjectionInspector` | `projection-inspector.tsx` |
| 1220–1600 | `EvaluationDetail` | `evaluation-detail.tsx` |
| 1601–1946 | `RunReferenceEditor` | `run-reference-editor.tsx` |

The projection drawer (760–769) is owned by `MonitorSetupTab` (its state is `Projection` from the preview table), not by the page shell.

**Data ownership**

| Component | Reads | Writes |
| --- | --- | --- |
| `JobsTab` | `monitor.evaluations(cursor)`, `cursorKey: "jobCursor"` | — |
| `MonitorSetupTab` | `monitor.definitionHistory(page)`, `runs.list({ status: 'completed', summary: true, offset })` | `monitor.preview(body)`, `monitor.launch(body)` |
| `DefinitionsTab` | `monitor.definition()`, `monitor.definitionHistory(page)` (only when history is opened) | `monitor.saveDefinition(body)` |
| `ReferencesTab` | `runs.list({ status: 'completed,failed,cancelled,interrupted', summary: true, offset })` | — (delegates to `RunReferenceEditor`) |
| `RunReferenceEditor` | `monitor.definitionHistory`, `reviews.runContext`, `reviews.listForRun`, `reviews.outcomes`, `reviews.latestOutcome` | `reviews.saveOutcome` |
| `EvaluationDetail` | `monitor.evaluation(id)`, `monitor.comparison(id)`, `monitor.export(id)` | `monitor.cancel(id)` |

**Invariants:** tab labels "Evaluation jobs", "Configure & preview", "Questions & outcome definitions", "Human reference outcomes"; `panelId="oversight-view-panel"`; default tab rule (`creating || ?run` → setup, else jobs); "Preview four views", "Launch monitor comparison", "New evaluation", "Before previewing"; `viewNames` copy for the four monitor views; projection table `label="Monitor evidence projection previews"`; "Oversight runs only when explicitly launched.…" notice; `?view=`, `?run=`, `?definition=`, `?jobCursor=` round-trip (the cursor test must still pass).

- [ ] **Step 3.1: Write the failing setup-tab test**

Create `dashboard/src/pages/oversight/monitor-setup-tab.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeClients, renderWithClients } from "../../test/clients";
import { MonitorSetupTab } from "./monitor-setup-tab";

afterEach(cleanup);

const definition = { id: "definition:1", revision: 1, createdAt: "2026-11-07T12:00:00Z", questions: "Assess.", outcomes: [], schemaVersion: 1 };

function clients() {
  return fakeClients({
    monitor: { definitionHistory: async () => ({ items: [definition], nextCursor: null }) },
    runs: { list: async () => ({ items: [], total: 0, nextOffset: null }) },
  });
}

it("requires an explicit provider and model and lists the four evidence views", async () => {
  renderWithClients(<MonitorSetupTab />, { route: "/oversight?view=setup&run=source", clients: clients() });
  expect(await screen.findByText("Enter a monitor provider.")).toBeTruthy();
  expect(screen.getByText("Enter a monitor model.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Preview four views" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Reports")).toBeTruthy();
  expect(screen.getByText("Full observable trace")).toBeTruthy();
  expect(screen.getByText("No completed source runs yet.")).toBeTruthy();
});

it("clears the prepared preview whenever a setting changes", async () => {
  const preview = { id: "preview-1", hash: "hash", definition, settings: { model: { provider: "fixture", id: "monitor" }, maxInputChars: 1000, contextWindowTokens: 8192, outputAllowanceTokens: 512, timeoutMs: 1000 }, runs: [] };
  renderWithClients(<MonitorSetupTab />, {
    route: "/oversight?view=setup&run=source",
    clients: fakeClients({
      monitor: { definitionHistory: async () => ({ items: [definition], nextCursor: null }), preview: async () => preview },
      runs: { list: async () => ({ items: [{ id: "source", config: { label: "Study", condition: { id: "reviewed" } } }], total: 1, nextOffset: null }) },
    }),
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("checkbox", { name: /Study/ }));
  await user.type(screen.getByLabelText("Monitor provider"), "fixture");
  await user.type(screen.getByLabelText("Monitor model"), "monitor");
  await user.click(screen.getByRole("button", { name: "Preview four views" }));
  expect(await screen.findByRole("button", { name: "Launch monitor comparison" })).toBeTruthy();
  await user.type(screen.getByLabelText("Monitor model"), "x");
  expect(screen.queryByRole("button", { name: "Launch monitor comparison" })).toBeNull();
});
```

- [ ] **Step 3.2: Run to verify it fails**

```bash
npm run test --workspace sidechannel-dashboard -- src/pages/oversight/monitor-setup-tab.test.tsx
```

Expected: FAIL — `Failed to load url ./monitor-setup-tab`.

- [ ] **Step 3.3: Move the four tabs and their children**

Move ranges verbatim from the inventory. `DefinitionEditor` keeps its `current`/`onSaved` props internally but now renders as a prop-less `DefinitionsTab` that owns `useCurrentDefinition()` and calls `refresh()` after save. `EvaluationList` becomes `JobsTab` and owns `useResourcePage("oversight:jobs", (cursor) => clients.monitor.evaluations(cursor), { interval: 5000, cursorKey: "jobCursor" })`. The page shell becomes:

```tsx
import { Route, Routes, useSearchParams } from "react-router-dom";
import { ViewPanel } from "../components/view-registry";
import { OVERSIGHT_TABS, OVERSIGHT_VIEWS, defaultOversightTab } from "./oversight/views";
import { EvaluationDetail } from "./oversight/evaluation-detail";

export default function Oversight() {
  return (
    <Routes>
      <Route index element={<OversightSetup />} />
      <Route path="new" element={<OversightSetup creating />} />
      <Route path=":id" element={<EvaluationDetail />} />
    </Routes>
  );
}

function OversightSetup({ creating = false }: { creating?: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("view") || defaultOversightTab(params, creating);
  return (
    <>
      <PageHeader eyebrow="ISOLATED EVIDENCE COMPARISONS" title="Oversight monitor" description="Compare what the same monitor detects from four explicitly different evidence views." actions={<Button asChild><Link to="/oversight/new">New evaluation</Link></Button>} />
      <ViewPanel registry={OVERSIGHT_VIEWS} order={OVERSIGHT_TABS} tab={tab} panelId="oversight-view-panel" onChange={(view) => setParams((prev) => { prev.set("view", view); return prev; })} />
    </>
  );
}
```

The `mutation.error` notice at 301 moves into `MonitorSetupTab` (it was the only producer).

- [ ] **Step 3.4: Rewrite the two oversight tests in `RunsOversight.test.tsx`**

Delete `mock`/`vi.stubGlobal`. "defaults oversight to evaluations and keeps setup explicit with visible prerequisites" keeps both mounts:

```tsx
renderWithClients(<Oversight />, { clients: fakeClients({ monitor: { evaluations: async () => ({ items: [], nextCursor: null }) }, runs: { list: async () => ({ items: [], total: 0, nextOffset: null }) } }) });
// assertions unchanged
renderWithClients(<Oversight />, { route: "/?run=source", clients: fakeClients({ monitor: { definitionHistory: async () => ({ items: [], nextCursor: null }), definition: async () => ({ revision: 1 }) }, runs: { list: async () => ({ items: [], total: 0, nextOffset: null }) } }) });
// assertions unchanged
```

"restores an evaluation cursor page after detail navigation…" uses `monitor: { evaluations: async (cursor) => pageFor(cursor), evaluation: async () => job, comparison: async () => ({ comparisons: [] }), export: async () => ({ preview: { runs: [] } }), definitionHistory: async () => ({ items: [], nextCursor: null }) }` and asserts the same `jobCursor%3Dcursor-1%26jobCursor%3Dcursor-2` href and "Page 3"/"Page 2" labels.

- [ ] **Step 3.5: Run green + line gate + commit**

```bash
npm run test --workspace sidechannel-dashboard -- src/pages/oversight src/pages/RunsOversight.test.tsx
npm run check --workspace sidechannel-dashboard
node -e "const fs=require('fs');for(const f of ['dashboard/src/pages/Oversight.tsx','dashboard/src/pages/oversight/monitor-setup-tab.tsx','dashboard/src/pages/oversight/run-reference-editor.tsx'])console.log(fs.readFileSync(f,'utf8').split('\n').length.toString().padStart(4),f)"
git add dashboard/src/pages/Oversight.tsx dashboard/src/pages/oversight dashboard/src/pages/RunsOversight.test.tsx
git commit -m "refactor(dashboard): split Oversight setup into independent tabs that own their fetches"
```

Expected: PASS; `Oversight.tsx` < 250; every `oversight/*` file < 300 (split `run-reference-editor.tsx` further only if it exceeds 300, by extracting its history table into `review-history` usage from T6.7).

**Gate:** four tab components; each tab fetches only what it renders (verified by `fakeClients` "unexpected call" rejections in the new tests).

---

## T6.4 — `Analysis.tsx` setup (205–932) → `pages/analysis/` setup views

**Files:**
- Create: `pages/analysis/{analysis-collection.tsx,analysis-setup.tsx,use-analysis-draft.ts,use-codebook-picker.ts,use-preview.ts,source-section.tsx,windowing-section.tsx,prepared-windows.tsx,saved-analyses.tsx,preview-launch.tsx,preview-window-input.tsx,preview-window-drawer.tsx}`
- Modify: `pages/Analysis.tsx` → router only
- Test: `pages/analysis/{use-preview.test.tsx,analysis-setup.test.tsx}` + move the "explains preview prerequisites…" test out of `Analysis.test.tsx`

**Interfaces:**
- Produces:

```ts
// pages/analysis/use-analysis-draft.ts
export function useAnalysisDraft(input: { runId: string; cloneId: string | null; defaultCreator: string }): {
    settings: AnalysisSettings;
    change(patch: Partial<AnalysisSettings>): void;         // returns a new object identity every call
    adoptClone(job: AnalysisJob): void;
    setRun(runId: string): void;
    prerequisites: string[];
    canPrepare: boolean;
};

// pages/analysis/use-codebook-picker.ts
export function useCodebookPicker(input: { codebookId: string; revisionId: string; onChange(patch: Partial<AnalysisSettings>): void }): {
    books: Codebook[]; booksPage: number; booksHasMore: boolean; onBooksPage(next: number): void;
    codebook: Codebook | undefined; revision: CodebookRevision | undefined;
    currentRevision: CodebookRevision | undefined;
    revisions: CodebookRevision[]; revisionsPage: number; revisionsHasMore: boolean; onRevisionsPage(next: number): void;
    selectCodebook(id: string): void; selectRevision(id: string): void;
    loading: boolean; error: Error | undefined;
};

// pages/analysis/use-preview.ts
export function usePreview(input: { runId: string; settings: AnalysisSettings; enabled: boolean }): {
    preview: AnalysisPreview | undefined;
    window: (AnalysisPreview["windows"][number] & { state?: string }) | undefined;
    busy: boolean; error: Error | undefined; message: string;
    prepare(): Promise<void>; launch(): Promise<AnalysisJob | undefined>;
    inspect(window: AnalysisPreview["windows"][number]): void; close(): void;
    scoreable: number;
};
```

**Behaviour:** none, except **the manual generation counter is deleted** (`Analysis.tsx:244,247,260,274,289,293`). `usePreview` compares the `settings` object identity it captured at request time with the current `settings`; `change()` always produces a new object, so a stale response is discarded by identity instead of by a counter. The counter never exists in the new code (assert with `git grep "settingsGeneration" dashboard/src` → 0).

**Inventory (setup half)**

| Span | Symbol | Target |
| --- | --- | --- |
| 85–92 | `AnalysisEntry` | page shell |
| 93–156 | `AnalysisCollection` | `analysis-collection.tsx` |
| 157–204 | `AnalysisCollectionRow` | `analysis-collection.tsx` |
| 205–217 | setup reads: runs page, source, books, clone, jobs | `use-codebook-picker.ts`, `saved-analyses.tsx`, `use-analysis-draft.ts` |
| 218–238 | 12-field settings state, revision, revision history | `use-analysis-draft.ts`, `use-codebook-picker.ts` |
| 239–249 | preview state, mutation, `settingsGeneration` | `use-preview.ts` (generation deleted) |
| 250–277 | auto-select first codebook, clone hydration, `change` | `use-codebook-picker.ts`, `use-analysis-draft.ts` |
| 278–316 | `launch`, `doPreview`, `currentRevision`, `prerequisites`, `scoreable` | `use-preview.ts`, `use-analysis-draft.ts`, `use-codebook-picker.ts` |
| 317–332 | back link, header, notices | `analysis-setup.tsx` |
| 333–471 | source & frozen definitions card | `source-section.tsx` |
| 472–647 | windowing & evidence card | `windowing-section.tsx` |
| 648–728 | prepared windows card | `prepared-windows.tsx` |
| 729–782 | saved analyses card | `saved-analyses.tsx` |
| 784–883 | preview & launch aside | `preview-launch.tsx` |
| 885–929 | preview window drawer | `preview-window-drawer.tsx` |
| 933–958 | `PreviewWindowInput` | `preview-window-input.tsx` |

**Data ownership**

| Component | Reads | Writes |
| --- | --- | --- |
| `AnalysisCollection` | `analyses.list(cursor)` (`cursor` URL key), `runs.get` per row | — |
| `AnalysisSetup` (shell) | composes hooks | `analyses.preview`, `analyses.launch` via `usePreview` |
| `SourceSection` | `runs.list` (offset), `useCodebookPicker` | — |
| `WindowingSection` | — | — |
| `PreparedWindows` | — (`preview` prop) | — |
| `SavedAnalyses` | `analyses.listForRun(runId)` | — |
| `PreviewLaunch` | — (props) | — |
| `PreviewWindowInput` | `analyses.previewWindow(token, windowId)` | — |

**Invariants:** "New analysis" link, prerequisites list text (`"Select a source run."`, `"Wait for the source run to finish before previewing."`, `"Select a codebook revision."`, `"Enter a researcher / creator identity."`, `"Enter a positive window size."`, `"Enter a positive step interval."`, `"Select at least one evidence category."`, `"Select at least one phase."`), `id="analysis-prerequisites"` + `aria-describedby`, "Preview analysis"/"Preparing…", "Launch analysis job"/"Save unscored analysis record", "No scores will be produced. Adjust Windowing & evidence, or explicitly save an unscored record.", codebook Pager ×3, `?run=`, `?clone=`, `?cursor=`, drawer title `Preview window N`.

- [ ] **Step 4.1: Write the failing `usePreview` staleness test**

Create `dashboard/src/pages/analysis/use-preview.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { fakeClients, renderWithClients } from "../../test/clients";
import { usePreview } from "./use-preview";
import type { AnalysisSettings } from "../../lib/analysis-types";

afterEach(cleanup);

const settings = (stride: number): AnalysisSettings => ({
  codebookId: "book", codebookRevisionId: "revision", model: "jev-1.14.0", windowSize: 12, stride,
  phases: ["action", "report"], evidence: ["assistant"], headroom: 2000, timeoutMs: 60000, maxAttempts: 2, creator: "Reviewer A",
});

function Probe() {
  const [current, setCurrent] = useState(() => settings(4));
  const draft = usePreview({ runId: "source-run", settings: current, enabled: true });
  return (
    <>
      <button onClick={() => void draft.prepare()}>prepare</button>
      <button onClick={() => setCurrent(settings(8))}>change</button>
      <p>{draft.preview ? "prepared" : "clear"}</p>
    </>
  );
}

it("discards a preview whose settings were edited while the request was in flight", async () => {
  let resolve: (value: unknown) => void = () => {};
  const pending = new Promise((done) => (resolve = done));
  renderWithClients(<Probe />, {
    clients: fakeClients({ analyses: { preview: () => pending as never } }),
  });
  screen.getByText("prepare").click();
  screen.getByText("change").click();
  resolve({ previewToken: "token", manifest: { windowCount: 1, diagnostics: [], availability: {}, selectedStepCount: 1, partialWindowCount: 0, scoredCodeCount: 1 }, windows: [] });
  await waitFor(() => expect(screen.getByText("clear")).toBeTruthy());
});

it("keeps a preview whose settings are unchanged", async () => {
  renderWithClients(<Probe />, {
    clients: fakeClients({ analyses: { preview: async () => ({ previewToken: "token", manifest: { windowCount: 1, diagnostics: [], availability: {}, selectedStepCount: 1, partialWindowCount: 0, scoredCodeCount: 1 }, windows: [] }) } }),
  });
  screen.getByText("prepare").click();
  await waitFor(() => expect(screen.getByText("prepared")).toBeTruthy());
});
```

- [ ] **Step 4.2: Run to verify it fails**

```bash
npm run test --workspace sidechannel-dashboard -- src/pages/analysis/use-preview.test.tsx
```

Expected: FAIL — `Failed to load url ./use-preview`.

- [ ] **Step 4.3: Implement the hooks and move the setup views**

Move ranges per the inventory. `usePreview.prepare()` captures `const request = settings;` and only calls `setPreview(result)` when `settings === request` at resolution time; `inspect/close/scoreable` move from 239–242, 313–316, 885–929. `useAnalysisDraft.change()` is the only writer of `settings`, which is what makes identity-based staleness correct.

- [ ] **Step 4.4: Move the prerequisites test and add the setup render test**

Delete "explains preview prerequisites and distinguishes unscored records while invalidating changed settings" from `Analysis.test.tsx` and recreate it as `dashboard/src/pages/analysis/analysis-setup.test.tsx` with the same assertions and fake clients:

```tsx
renderWithClients(<Analysis />, {
  route: "/new?run=source-run",
  clients: fakeClients({
    runs: { list: async () => ({ items: [], total: 0, nextOffset: null }), get: async () => ({ id: "source-run", status: "completed", configHash: "hash", config: { label: "Study", model: { provider: "demo", id: "test" } } }) },
    codebooks: { list: async () => ({ items: [{ id: "book", name: "Behaviors", currentRevisionId: "revision" }], nextCursor: null }), get: async () => ({ codebook: { name: "Behaviors" }, revision: { id: "revision", revision: 1, codes: [code] } }), revisions: async () => ({ items: [], nextCursor: null }) },
    analyses: { preview: async () => oversizedPreview },
  }),
});
```

The assertions stay byte-identical (`"Enter a researcher / creator identity."`, `"No scores will be produced"`, `"Save unscored analysis record"`, then clearing the size field removes the button).

- [ ] **Step 4.5: Run green + gate + commit**

```bash
npm run test --workspace sidechannel-dashboard -- src/pages/analysis src/pages/Analysis.test.tsx src/workflows.test.tsx
npm run check --workspace sidechannel-dashboard
git grep -c "settingsGeneration" -- dashboard/src || echo "0 occurrences (expected)"
node -e "const fs=require('fs');for(const f of ['dashboard/src/pages/Analysis.tsx','dashboard/src/pages/analysis/analysis-setup.tsx','dashboard/src/pages/analysis/source-section.tsx','dashboard/src/pages/analysis/windowing-section.tsx'])console.log(fs.readFileSync(f,'utf8').split('\n').length.toString().padStart(4),f)"
git add dashboard/src/pages/Analysis.tsx dashboard/src/pages/Analysis.test.tsx dashboard/src/pages/analysis
git commit -m "refactor(dashboard): split Analysis setup into draft, codebook and preview hooks"
```

Expected: PASS; `git grep -c settingsGeneration` prints nothing/0; `Analysis.tsx` < 200 lines (router only); section files < 300.

**Gate:** generation counter gone; one validation owner (`useAnalysisDraft.prerequisites` is the only prerequisite producer, `/runs/:id/analyses/preview` is the only authority on preview validity).

---

## T6.5 — `Runs.tsx` detail (206–897) → `pages/runs/`

**Files:**
- Create: `pages/runs/{run-list.tsx,run-detail.tsx,views.tsx,use-run-record.ts,use-run-progress.ts,use-run-evidence.ts,timeline-panel.tsx,traces-panel.tsx,board-panel.tsx,artifacts-panel.tsx,memory-panel.tsx,reports-panel.tsx,configuration-panel.tsx,evidence-drawer.tsx,evidence-key.ts,pair-detail.tsx,pair-condition.tsx,pair-settings.ts,board-delivery.tsx}`
- Modify: `pages/Runs.tsx` → router only
- Test: `pages/runs/{run-detail.test.tsx,pair-detail.test.tsx,evidence-key.test.ts}` + rewrite `workflows.test.tsx` board block and `RunsOversight.test.tsx` pair test

**Interfaces:**
- Produces:

```ts
// pages/runs/views.tsx
export const RUN_TABS = ["timeline", "board", "artifacts", "memory", "reports", "traces", "configuration"] as const;
export type RunsTab = (typeof RUN_TABS)[number] | "results";
export const DEFAULT_RUN_TAB: RunsTab = "timeline";
export function runsViews(hasResults: boolean): ViewRegistry<RunsTab>;
export function runsOrder(hasResults: boolean): readonly RunsTab[];

// pages/runs/use-run-record.ts
export function useRunRecord(id: string | undefined): {
    run: Run | undefined; loading: boolean; error: Error | undefined; refresh(): Promise<void>;
    active: boolean; cancelRequested: boolean; failureReason: string | undefined;
    command: ReturnType<typeof useCommand>;
    cancel(): Promise<void>; duplicate(): Promise<void>;
};

// pages/runs/use-run-progress.ts
export function useRunProgress(id: string | undefined): {
    progress: Partial<Run> | undefined; updatedAt: number | undefined; stale: boolean; refresh(): Promise<void>;
};

// pages/runs/use-run-evidence.ts
export function useRunEvidence(id: string | undefined, kind: "timeline" | "traces" | "board" | "artifacts" | "memory" | "reports"): {
    events: HarnessEvent[]; page: number; hasMore: boolean; onChange(next: number): void;
    loading: boolean; error: Error | undefined; refresh(): Promise<void>;
    filters: { actor: string; phase: string; type: string; from: string; to: string };
    setFilter(name: keyof Filters, value: string): void;
    selection: string | null; inspect(key: string, sequence?: number): void; close(): void;
    selected: { event: HarnessEvent | undefined; item: unknown };
};
```

**Behaviour:** none. `RunRecord` keeps the current merge exactly: `{ ...run.data, ...progress.data, config: run.data.config }` (a `Partial<Run>` merge, WS5 F12 keeps this until a typed `RunProgress` lands — WS6 must not change it).

**Inventory (`dashboard/src/pages/Runs.tsx`)**

| Span | Symbol | Target |
| --- | --- | --- |
| 58–66 | `RecordPage<T>` | deleted (replaced by `Page<T>`/`OffsetPage<T>` + typed evidence reads) |
| 67–75 | `Runs` router | page shell |
| 76–205 | `RunList` | `run-list.tsx` |
| 206–213 | `run`, `progress` | `use-run-record.ts`, `use-run-progress.ts` |
| 214–231 | mutation, 5 filter states, pager, query | `use-run-evidence.ts` |
| 232–268 | events, selected event/record, evidence page | `use-run-evidence.ts` |
| 269–272 | page reset effect | `use-run-evidence.ts` |
| 273–302 | merge, `setTab`, `inspect`, `items`, `event`, `selectedItem`, `traceEvents` | `use-run-record.ts` / `use-run-evidence.ts` |
| 303–326 | guards, `active`, `cancel`, `duplicate` | `use-run-record.ts` |
| 327–372 | back link + header + actions | `run-detail.tsx` |
| 373–437 | run metadata + notices | `run-detail.tsx` |
| 438–460 | `Tabs` + panel | `ViewPanel` |
| 461–462 | results branch | registry entry `results` → `HealthcareResults` |
| 463–598 | timeline/traces branch | `timeline-panel.tsx`, `traces-panel.tsx` |
| 599–646 | configuration branch | `configuration-panel.tsx` |
| 647–807 | board/artifacts/memory/reports branch | `board-panel.tsx`, `artifacts-panel.tsx`, `memory-panel.tsx`, `reports-panel.tsx` |
| 809–823 | freshness note + post-completion actions | `run-detail.tsx` |
| 824–894 | evidence drawer | `evidence-drawer.tsx` |
| 898–908 | `evidenceKey` | `evidence-key.ts` |
| 909–944 | `BoardDelivery` | `board-delivery.tsx` |
| 945–947 | `safeRunReturn` | `run-detail.tsx` (exported) |
| 948–1038 | `PairDetail` | `pair-detail.tsx` |
| 1040–1052 | `settingLabel` | `pair-settings.ts` |
| 1053–1068 | `configValue` | `pair-settings.ts` |
| 1069–1202 | `PairCondition` | `pair-condition.tsx` |

**Data ownership**

| Component | Reads | Writes |
| --- | --- | --- |
| `RunList` | `runs.list(query)` (offset from `?offset=`) | — |
| `RunDetail` (shell) | `useRunRecord`, `useRunProgress` | cancel/duplicate via `useRunRecord` |
| `TimelinePanel` / `TracesPanel` | `useRunEvidence(id, kind)` | — |
| `BoardPanel` | `runs.board(id, { offset })` + `runs.evidenceItem` for the drawer | — |
| `ArtifactsPanel` | `runs.evidence(id, 'artifacts', { offset, limit })` | — |
| `MemoryPanel` | `runs.evidence(id, 'memory', { offset, limit })` | — |
| `ReportsPanel` | `runs.evidence(id, 'reports', { offset, limit })` | — |
| `ConfigurationPanel` | — (`runs.get` via `useRunRecord`) | — |
| `EvidenceDrawer` | `runs.event` / `runs.evidenceItem` for the selected key | — |
| `PairDetail` | `runs`-pair read + `runs.get` per condition | — |

**Invariants:** all seven tab labels ("Timeline", "Board & deliveries", "Artifacts", "Private memory", "Reports", "Model & traces", "Configuration") and the conditional "Researcher results"; `panelId="run-evidence-panel"`; header eyebrow switch ("SCRIPTED FIXTURE · NOT SPONTANEOUS MODEL BEHAVIOR" — descriptor-driven only after T6.8); filters ("All actors", "All phases", "Action", "Report", "Exact type", "Sequence from", "Sequence through"); `Table label`s; `BoardDelivery` copy ("No read/delivery event for this post is present in this response. Posting alone does not establish receipt."); pair copy ("Frozen configurations match outside the intended condition difference."); `?view=`, `?evidence=`, `?seq=`, `?returnTo=`, `?offset=`; `?view=board` deep link from the analysis citation.

- [ ] **Step 5.1: Write the failing detail + evidence-key tests**

Create `dashboard/src/pages/runs/evidence-key.test.ts`:

```ts
import { expect, it } from "vitest";
import { evidenceKey } from "./evidence-key";

it("prefers id, then artifact version, then report agent, then position", () => {
  expect(evidenceKey({ id: "message-1" }, 0)).toBe("message-1");
  expect(evidenceKey({ version: 3 }, 1)).toBe("version-3");
  expect(evidenceKey({ agentId: "alpha" }, 2)).toBe("agent-alpha");
  expect(evidenceKey({}, 4)).toBe("record-4");
  expect(evidenceKey(null, 5)).toBe("record-5");
});
```

Create `dashboard/src/pages/runs/run-detail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { fakeClients, renderWithClients } from "../../test/clients";
import { RunDetail } from "./run-detail";
import type { Run } from "../../lib/types";

afterEach(cleanup);
const config = defaultFixtureConfiguration();
const run = { id: "run-1", config, status: "completed", configHash: "fixture-hash", launchKey: "key", createdAt: "2026-11-07T12:00:00Z", updatedAt: "2026-11-07T12:01:00Z", round: 3, turn: 6, board: [], artifacts: [], reports: [], operations: {}, scenarioState: null, usage: {} } as unknown as Run;

it("merges live progress into the frozen record and keeps the seven evidence tabs", async () => {
  renderWithClients(<RunDetail />, {
    route: "/runs/run-1?view=timeline",
    clients: fakeClients({ runs: { get: async () => run, progress: async () => ({ round: 4, turn: 7 }) } }),
  });
  expect(await screen.findByText(/Round/)).toBeTruthy();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.slice(0, 8))).toContain("Timeline");
  expect(screen.getByRole("tab", { name: "Timeline" }).getAttribute("aria-selected")).toBe("true");
});

it("renders not-found for an unknown evidence view", async () => {
  renderWithClients(<RunDetail />, {
    route: "/runs/run-1?view=typo",
    clients: fakeClients({ runs: { get: async () => run } }),
  });
  expect(await screen.findByText("This view does not exist")).toBeTruthy();
});

it("opens the evidence drawer from the URL and never substitutes an event sequence for a message id", async () => {
  const message = { id: "message-1", runId: "run-1", authorId: "alpha", sequence: 1, timestamp: run.createdAt, text: "board evidence" };
  renderWithClients(<RunDetail />, {
    route: "/runs/run-1?view=board&evidence=message-1",
    clients: fakeClients({ runs: { get: async () => run, board: async () => ({ items: [message], total: 1, nextOffset: null, deliveries: [] }), evidenceItem: async () => message } }),
  });
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("message-1");
  expect(dialog.textContent).toContain("board evidence");
});
```

- [ ] **Step 5.2: Run to verify they fail**

```bash
npm run test --workspace sidechannel-dashboard -- src/pages/runs
```

Expected: FAIL — `Failed to load url ./evidence-key` and `./run-detail`.

- [ ] **Step 5.3: Implement the hooks and move the panels**

`useRunRecord` merges `run` + `progress` (273–275) and owns cancel/duplicate (308–326) with the confirm text verbatim. `useRunProgress` polls `runs.progress(id)` every 3500 ms via `useResource(key, load, { interval: 3500 })` and exposes `stale = !!error`. `useRunEvidence` builds the query object (223–231) inside the loader, not in JSX, and resets the page on filter change (269–272) by folding the filters into `key`.

Registry:

```tsx
export function runsViews(hasResults: boolean): ViewRegistry<RunsTab> {
  return {
    timeline: { title: "Timeline", Component: TimelinePanel },
    board: { title: "Board & deliveries", Component: BoardPanel },
    artifacts: { title: "Artifacts", Component: ArtifactsPanel },
    memory: { title: "Private memory", Component: MemoryPanel },
    reports: { title: "Reports", Component: ReportsPanel },
    traces: { title: "Model & traces", Component: TracesPanel },
    configuration: { title: "Configuration", Component: ConfigurationPanel },
    ...(hasResults ? { results: { title: "Researcher results", Component: ResultsPanel } } : {}),
  } as ViewRegistry<RunsTab>;
}
```

`ResultsPanel` is a three-line wrapper around `HealthcareResults` reading `id` from the route **until** T6.8 replaces the gate with `scenario.presentation.tabs.includes("results")`.

- [ ] **Step 5.4: Rewrite the board + pair tests**

`workflows.test.tsx` "looks up a board message by its own ID…" keeps every assertion and drops `mockApi`:

```tsx
renderWithClients(<Runs />, {
  route: "/run-1?view=board",
  clients: fakeClients({ runs: { get: async () => run, board: async () => ({ items: [message], total: 1, nextOffset: null, deliveries: [] }), evidenceItem: async () => message } }),
});
```

The final assertion (`no call contains "/events"`) is replaced by the stronger fake-client assertion `expect(clients.runs.event).not.toHaveBeenCalled()` using a `vi.fn()` override. `RunsOversight.test.tsx` "aligns exact pair wording…" uses `runs: { pair: async () => ({ runs: [a, b], matched: true, configurationDifferences: ["condition.id", "condition.text"] }), get: async (id) => … }`.

- [ ] **Step 5.5: Run green + gate + commit**

```bash
npm run test --workspace sidechannel-dashboard -- src/pages/runs src/pages/RunsOversight.test.tsx src/workflows.test.tsx
npm run check --workspace sidechannel-dashboard
node -e "const fs=require('fs');for(const f of ['dashboard/src/pages/Runs.tsx','dashboard/src/pages/runs/run-detail.tsx','dashboard/src/pages/runs/pair-condition.tsx'])console.log(fs.readFileSync(f,'utf8').split('\n').length.toString().padStart(4),f)"
git add dashboard/src/pages/Runs.tsx dashboard/src/pages/runs dashboard/src/pages/RunsOversight.test.tsx dashboard/src/workflows.test.tsx
git commit -m "refactor(dashboard): split RunDetail into a registry of evidence panels"
```

Expected: PASS; `Runs.tsx` < 150; panels < 300.

**Gate:** seven (plus conditional eighth) tabs as components; polling isolated in `useRunProgress`.

---

## T6.6 — `Codebook.tsx` (568) → `pages/codebook/`

**Files:**
- Create: `pages/codebook/{use-codebook-draft.ts,validate-codebook.ts,codebook-selector.tsx,behavior-list.tsx,behavior-editor.tsx,revision-history-drawer.tsx}`
- Modify: `pages/Codebook.tsx`
- Test: `pages/codebook/validate-codebook.test.ts` + rewrite `pages/Codebook.test.tsx`

**Interfaces:**
- Produces:

```ts
// pages/codebook/validate-codebook.ts
export interface CodebookDraft { name: string; author: string; codes: BehaviorCode[]; baseRevisionId: string; }
export interface CodebookValidation {
    invalid: boolean;
    /** Rendered in the save-status region, in this order. */
    status: string;
    nameError: string | undefined;
    codeError(code: BehaviorCode): string | undefined;   // duplicate display code
    duplicateNames: boolean;
    readyToSave: boolean;
}
export function validateCodebook(draft: CodebookDraft, state: { dirty: boolean; baseLoaded: boolean }): CodebookValidation;

// pages/codebook/use-codebook-draft.ts
export function useCodebookDraft(): {
    books: Codebook[]; bookId: string; selectBook(id: string): void; loadMoreBooks(): void; hasMoreBooks: boolean;
    name: string; setName(value: string): void;
    author: string; setAuthor(value: string): void;
    codes: BehaviorCode[]; selected: string; select(id: string): void;
    code: BehaviorCode | undefined;
    dirty: boolean;
    add(): void; duplicate(): void; reorder(direction: number): void;
    edit(patch: Partial<BehaviorCode>): void;
    recovery: { name: string; codes: BehaviorCode[]; baseRevision: number } | undefined;
    restoreRecovery(): void;
    validation: CodebookValidation;
    current: { codebook: Codebook; revision: CodebookRevision } | undefined;
    loading: boolean; error: Error | undefined;
    command: ReturnType<typeof useCommand>;
    create(): Promise<void>; save(): Promise<void>; loadLatest(): Promise<void>;
    historyOpen: boolean; setHistoryOpen(open: boolean): void;
    revisions: CodebookRevision[]; revisionsLoading: boolean; revisionsError: Error | undefined;
    historyRevision: CodebookRevision | undefined; selectRevision(revision: CodebookRevision): void;
    revisionsPage: { page: number; hasMore: boolean; onChange(next: number): void; back(): void };
};
```

**Behaviour:** none. The three validation paths (`204–206`, `207–213`, `422–431`) collapse into `validateCodebook`; the save-status string (242) is produced by `validation.status`.

**Inventory**

| Span | Symbol | Target |
| --- | --- | --- |
| 38–64 | 16 `useState`, 5 fetches, `useMutation` | hooks + components |
| 65–71 | book options merge, reset on book change, auto-select first | `use-codebook-draft.ts` |
| 72–99 | hydration + recovery | `use-codebook-draft.ts` |
| 100–110 | localStorage mirror | `use-codebook-draft.ts` |
| 111–141 | `edit`, `code`, `add` | `use-codebook-draft.ts` |
| 142–179 | `create`, `save` | `use-codebook-draft.ts` |
| 180–203 | `duplicate`, `reorder` | `use-codebook-draft.ts` |
| 204–213 | `duplicateNames`, `invalid` | `validate-codebook.ts` |
| 214–273 | header, save-status, notices, recovery card | `pages/Codebook.tsx` |
| 274–337 | loading/empty + selector row | `codebook-selector.tsx` |
| 338–390 | behavior list | `behavior-list.tsx` |
| 391–517 | behavior editor | `behavior-editor.tsx` |
| 522–565 | revision history drawer | `revision-history-drawer.tsx` |

**Data ownership**

| Component | Reads | Writes |
| --- | --- | --- |
| `CodebookPage` (shell) | `useCodebookDraft()` | create/save via the hook |
| `CodebookSelector` | — (props) | — |
| `BehaviorList` | — (props) | — |
| `BehaviorEditor` | — (props) | — |
| `RevisionHistoryDrawer` | `codebooks.revisions(bookId, cursor)` via the hook | — |

**Invariants:** "Research codebook", "New codebook", "Revision history", "Save revision", "Save codebook edits", "Load latest for reconciliation", "Restore local edits for reconciliation", "Recover edits from an older revision", "Display codes must be unique among active definitions.", "Enter a codebook name.", "This display code is already used.", the save-status sentence list (242), `sidechannel-codebook-<id>` storage key, switch-codebook confirm text, 409 block, `ProseListEditor` field labels, `aria-label`s on move/add buttons, `Definition` label (used by `Codebook.test.tsx`).

- [ ] **Step 6.1: Write the failing validator test**

Create `dashboard/src/pages/codebook/validate-codebook.test.ts`:

```ts
import { expect, it } from "vitest";
import { validateCodebook } from "./validate-codebook";
import type { BehaviorCode } from "../../lib/analysis-types";

const code = (patch: Partial<BehaviorCode> = {}): BehaviorCode => ({ id: "supply", code: "SUPPLY", name: "Supply", definition: "Original definition", inclusionCriteria: [], exclusionCriteria: [], examples: [], counterexamples: [], qualifyingEvidenceTypes: [], enabled: true, archived: false, color: "#123456", ...patch });

it("names every blocking reason in a single status string", () => {
  const missingName = validateCodebook({ name: "", author: "Reviewer", codes: [code()], baseRevisionId: "revision-1" }, { dirty: true, baseLoaded: true });
  expect(missingName.invalid).toBe(true);
  expect(missingName.nameError).toBe("Enter a codebook name.");
  expect(missingName.status).toBe("Complete the name, display code and definition for every active behavior; display codes must be unique.");
  expect(validateCodebook({ name: "Study", author: "", codes: [code()], baseRevisionId: "r" }, { dirty: true, baseLoaded: true }).status).toBe("Enter a revision author to save your changes.");
  expect(validateCodebook({ name: "Study", author: "A", codes: [code()], baseRevisionId: "r" }, { dirty: false, baseLoaded: true }).status).toBe("No unsaved changes.");
  expect(validateCodebook({ name: "Study", author: "A", codes: [code()], baseRevisionId: "r" }, { dirty: true, baseLoaded: true }).status).toBe("Ready to save a new revision. Existing analyses keep their frozen definitions.");
});

it("reports duplicate display codes per code and ignores archived definitions", () => {
  const duplicate = validateCodebook({ name: "Study", author: "A", codes: [code(), code({ id: "second" })], baseRevisionId: "r" }, { dirty: true, baseLoaded: true });
  expect(duplicate.duplicateNames).toBe(true);
  expect(duplicate.codeError(code())).toBe("This display code is already used.");
  const archived = validateCodebook({ name: "Study", author: "A", codes: [code(), code({ id: "second", archived: true, enabled: false })], baseRevisionId: "r" }, { dirty: true, baseLoaded: true });
  expect(archived.duplicateNames).toBe(false);
  expect(archived.invalid).toBe(false);
});
```

- [ ] **Step 6.2: Run to verify it fails**

```bash
npm run test --workspace sidechannel-dashboard -- src/pages/codebook/validate-codebook.test.ts
```

Expected: FAIL — `Failed to load url ./validate-codebook`.

- [ ] **Step 6.3: Implement `validate-codebook.ts`, the hook, and move the views**

`validateCodebook` is the single owner of the three validity questions:
- name required (`nameError: "Enter a codebook name."`),
- every non-archived code has `code`/`name`/`definition`,
- display codes unique among non-archived codes.
It returns the status string in the exact priority order of 242: `busy` is handled by the caller ("Saving revision…"), then `!dirty`, then `!author`, then `invalid`, then ready.

`useCodebookDraft` replaces the two hand-rolled cursor pagers with `useResourcePage("codebooks", (cursor) => clients.codebooks.list(cursor), {})` for the book list and `useResourcePage(bookId ? "codebook:" + bookId + ":revisions" : null, (cursor) => clients.codebooks.revisions(bookId, cursor))` for history; the history drawer's Previous/Next buttons map to `onChange(page ± 1)` (the "Previous revisions"/"Next revisions" labels are kept in `revision-history-drawer.tsx`).

- [ ] **Step 6.4: Rewrite `Codebook.test.tsx`**

Keep the single test title and all assertions; replace the `vi.stubGlobal("fetch", …)` handler with a stateful fake that still returns 409 on the first PATCH:

```tsx
let revision = 1;
const submissions: any[] = [];
const overrides = {
  codebooks: {
    list: async () => ({ items: [{ id: "book", name: "Study", currentRevisionId: "revision-" + revision }], nextCursor: null }),
    get: async () => ({ codebook: { id: "book", name: "Study", currentRevisionId: "revision-" + revision }, revision: revisionRecord(revision) }),
    revisions: async () => ({ items: [], nextCursor: null }),
    save: async (input: { expectedRevisionId: string; name: string; codes: BehaviorCode[]; author: string }) => {
      submissions.push({ expectedRevisionId: input.expectedRevisionId, definitions: input.codes, name: input.name });
      if (revision === 1) { revision = 2; throw new ApiError(409, "Codebook revision conflict"); }
      return { codebook: { id: "book", name: input.name, currentRevisionId: "revision-3" }, revision: { ...revisionRecord(3), codes: input.codes } };
    },
  },
};
renderWithClients(<CodebookPage />, { clients: fakeClients(overrides) });
```

Assertions stay: `Definition` field edits to "My preserved changes", "Load latest for reconciliation" → heading "Recover edits from an older revision" → definition becomes "Teammate definition" → "Restore local edits for reconciliation" → definition "My preserved changes" → save → success message → `submissions.map(v => v.expectedRevisionId) === ["revision-1", "revision-2"]` → `submissions[1].definitions.map(v => v.id) === ["supply", "new"]`.

- [ ] **Step 6.5: Run green + gate + commit**

```bash
npm run test --workspace sidechannel-dashboard -- src/pages/codebook src/pages/Codebook.test.tsx
npm run check --workspace sidechannel-dashboard
node -e "const fs=require('fs');for(const f of ['dashboard/src/pages/Codebook.tsx','dashboard/src/pages/codebook/behavior-editor.tsx','dashboard/src/pages/codebook/use-codebook-draft.ts'])console.log(fs.readFileSync(f,'utf8').split('\n').length.toString().padStart(4),f)"
git add dashboard/src/pages/Codebook.tsx dashboard/src/pages/Codebook.test.tsx dashboard/src/pages/codebook
git commit -m "refactor(dashboard): single codebook validator and draft hook"
```

Expected: PASS; `Codebook.tsx` < 350; helper files < 300.

**Gate:** one `validateCodebook`; zero hand-rolled cursor pagers in the page folder.

---

## T6.7 — Shell and shared components (F17, F18, F19)

**Files:**
- Create: `components/{run-table.tsx,claimed-reviewer.ts,cancel-job-button.tsx,review-history.tsx}`, `pages/runs/pair-condition.css`, `pages/oversight/oversight.css`
- Modify: `App.tsx`, `pages/Overview.tsx`, `pages/Runs.tsx` (import), `pages/oversight/*` + `pages/runs/*` (use the new components), `pages/analysis/*` (same)
- Delete: `pages/runs-oversight.css`
- Test: `components/{run-table.test.tsx,claimed-reviewer.test.tsx,cancel-job-button.test.tsx,review-history.test.tsx}`

**Interfaces:**
- Produces:

```ts
// components/run-table.tsx
export function RunTable({ runs, detailSearch = "" }: { runs: Run[]; detailSearch?: string }): ReactElement;

// components/claimed-reviewer.ts
export const REVIEWER_STORAGE_KEY = "sidechannel-reviewer";
export function useClaimedReviewer(): { reviewer: string; identifyReviewer(value: string): void };

// components/cancel-job-button.tsx
export function CancelJobButton(props: {
    active: boolean; cancelRequested: boolean; busy: boolean;
    confirm: string; idleLabel: ReactNode; requestedLabel: ReactNode;
    onCancel(): Promise<void> | void;
}): ReactElement | null;

// components/review-history.tsx
export function ReviewHistoryRow(props: {
    reviewer: string; decision: Decision | Verdict; meta: ReactNode; rationale: string; note: ReactNode;
}): ReactElement;
```

**Behaviour:** none. `CancelJobButton` returns `null` when `!active`, preserving each caller's conditional `{active && …}`.

**Inventory**

| Span | Symbol | Target |
| --- | --- | --- |
| `App.tsx:30` | `RunTable` | `components/run-table.tsx` |
| `App.tsx:1–29` | shell (keeps routing/theme/nav) | unchanged minus the `RunTable` export and its now-unused imports |
| `Overview.tsx:7` | `import { RunTable } from '../App'` | `'../components/run-table'` |
| `Overview.tsx:18,31` | `arrayOf(...)` | typed `Page<Job>`/`OffsetPage<Run>` reads |
| `Runs.tsx:53` | `import { RunTable } from "../App"` | `"../components/run-table"` |
| `Analysis.tsx:225–229, 1685–1687, 2102–2104` (now in `analysis/*`) | reviewer localStorage read + write | `useClaimedReviewer()` |
| `Oversight.tsx:1630–1632, 1755–1762` (now in `oversight/*`) | reviewer localStorage | `useClaimedReviewer()` |
| `Codebook.tsx:49–51, 329–335` (now in `codebook/*`) | reviewer localStorage | `useClaimedReviewer()` |
| `Analysis.tsx:1050–1070` → `analysis-detail.tsx` | cancel | `CancelJobButton` |
| `Oversight.tsx:1277–1299` → `evaluation-detail.tsx` | cancel | `CancelJobButton` |
| `Runs.tsx:360–369` → `run-detail.tsx` | cancel | `CancelJobButton` |
| `Analysis.tsx:2479–2506` → `window-inspector.tsx` | review row | `ReviewHistoryRow` |
| `Oversight.tsx:1911–1941` → `run-reference-editor.tsx` | review row | `ReviewHistoryRow` |
| `runs-oversight.css:1–15, 24–28` | `.pair-condition-grid` blocks + their media query | `pages/runs/pair-condition.css` (imported by `pair-condition.tsx`) |
| `runs-oversight.css:16–23` | `.action-prerequisites` blocks | `pages/oversight/oversight.css` (imported by `pages/Oversight.tsx`) |
| `Oversight.tsx:70`, `Runs.tsx:54` | `import "./runs-oversight.css"` | removed |

**Invariants:** every `aria-label` ("Inspect <label> · <condition> · <id>", "Remove source <id>", "Move code up/down"), the `detailSearch` join (`'?returnTo=' + encodeURIComponent(...)`), badge copy ("Scripted fixture"), the two cancel confirm strings and their requested labels, the review-row structure (`<strong>{reviewer}</strong>`, `<Badge status={decision}>`, meta span, rationale paragraph, note paragraph) and the exact `style={{ padding: "13px 0", borderBottom: "1px solid var(--border)" }}` wrapper (keep it as-is in `ReviewHistoryRow` so no CSS churn).

- [ ] **Step 7.1: Write the failing shell/shared tests**

```tsx
// dashboard/src/components/run-table.test.tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { RunTable } from "./run-table";

afterEach(cleanup);
it("keeps the run table headers, fixture badge and inspect link", () => {
  const run = { id: "run-1", config: { ...defaultFixtureConfiguration(), label: "Study", model: { provider: "scripted", id: "fixture", settings: {} } }, status: "completed", round: 3, turn: 6, updatedAt: "2026-11-07T12:01:00Z" };
  render(<MemoryRouter><RunTable runs={[run]} detailSearch="?returnTo=%2Fruns" /></MemoryRouter>);
  expect(screen.getByRole("table", { name: "Experiment runs" })).toBeTruthy();
  expect(screen.getByText("Scripted fixture")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Inspect Study/ }).getAttribute("href")).toBe("/runs/run-1?returnTo=%2Fruns");
});
```

```tsx
// dashboard/src/components/cancel-job-button.test.tsx
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CancelJobButton } from "./cancel-job-button";

afterEach(cleanup);
it("renders nothing for a terminal job and confirms before cancelling", async () => {
  const onCancel = vi.fn();
  const { rerender } = render(<CancelJobButton active={false} cancelRequested={false} busy={false} confirm="Cancel?" idleLabel="Cancel" requestedLabel="Cancellation requested" onCancel={onCancel} />);
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<CancelJobButton active cancelRequested={false} busy={false} confirm="Cancel?" idleLabel="Cancel run" requestedLabel="Cancellation requested" onCancel={onCancel} />);
  vi.spyOn(window, "confirm").mockReturnValue(false);
  await userEvent.click(screen.getByRole("button", { name: "Cancel run" }));
  expect(onCancel).not.toHaveBeenCalled();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await userEvent.click(screen.getByRole("button", { name: "Cancel run" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
```

```tsx
// dashboard/src/components/claimed-reviewer.test.tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { REVIEWER_STORAGE_KEY, useClaimedReviewer } from "./claimed-reviewer";

afterEach(() => { cleanup(); localStorage.clear(); });
function Probe() {
  const { reviewer, identifyReviewer } = useClaimedReviewer();
  return <><input aria-label="reviewer" value={reviewer} onChange={(event) => identifyReviewer(event.target.value)} /><p>{localStorage.getItem(REVIEWER_STORAGE_KEY) ?? "empty"}</p></>;
}
it("reads and writes the single claimed-reviewer key", async () => {
  localStorage.setItem(REVIEWER_STORAGE_KEY, "Reviewer A");
  render(<Probe />);
  expect(screen.getByLabelText("reviewer").getAttribute("value")).toBe("Reviewer A");
  await userEvent.type(screen.getByLabelText("reviewer"), "B");
  expect(screen.getByText("Reviewer AB")).toBeTruthy();
});
```

`review-history.test.tsx` asserts the reviewer/decision/meta/rationale/note structure and that a `supersedesId` note appears when supplied via `note`.

- [ ] **Step 7.2: Run to verify they fail**

```bash
npm run test --workspace sidechannel-dashboard -- src/components
```

Expected: FAIL — `Failed to load url ./run-table`, `./cancel-job-button`, `./claimed-reviewer`, `./review-history`.

- [ ] **Step 7.3: Implement the four components and rewire the call sites**

`git mv` the `RunTable` line into `components/run-table.tsx` with the imports it needs (`NavLink`, `ArrowUpRight`, `Badge`, `Button`, `Table`, `short`, `when`). Then apply the call-site edits listed in the inventory (three cancel sites, two review-row sites, six reviewer sites, two CSS imports).

- [ ] **Step 7.4: Verify the cycle is gone and the CSS has one owner**

```bash
git grep -n "from \"../App\"\|from './App'" -- dashboard/src
git grep -n "runs-oversight.css" -- dashboard/src
git grep -c "sidechannel-reviewer" -- dashboard/src | sort
```

Expected: no `App` imports outside `main.tsx`/tests; no `runs-oversight.css`; every `sidechannel-reviewer` occurrence in the single `components/claimed-reviewer.ts` (tests may reference the constant, not the literal — replace literal uses with `REVIEWER_STORAGE_KEY`).

- [ ] **Step 7.5: Run green + commit**

```bash
npm run test --workspace sidechannel-dashboard
npm run check --workspace sidechannel-dashboard
npm run lint --workspace sidechannel-dashboard
node scripts/verify-boundaries.mjs
git rm dashboard/src/pages/runs-oversight.css
git add dashboard/src/components dashboard/src/App.tsx dashboard/src/pages
git commit -m "refactor(dashboard): move RunTable, claimed reviewer, cancel control and review row into components"
```

**Gate:** no `App ↔ Runs` cycle; `runs-oversight.css` deleted with each block owned by one page; `git grep "sidechannel-reviewer"` = 1 source file.

---

## T6.8 — Provider and scenario descriptors (F14)

**Files:**
- Create: `lib/descriptors.ts`, `lib/descriptors.test.tsx`, `components/providers.test.tsx`
- Modify: `components/{model-controls,budget-summary,healthcare-preset}.tsx`, `pages/runs/{run-detail,views}.tsx`, `pages/experiments/{scenario-section,agents-section}.tsx`, `pages/experiments/use-experiment-draft.ts` (provider default), `App.tsx` (listing badge), `pages/Overview.tsx` (uses `RunTable`, so it inherits the descriptor automatically)

**Interfaces:**
- Consumes: `GET /api/providers` / `GET /api/scenarios` (WS4 T4.3, conventions §3.3) via `useResource` + `request`; `useApi` is **not** used here because the descriptors must be fixture-injectable (same reasoning as T6.0).
- Produces:

```ts
// dashboard/src/lib/descriptors.ts
export interface ProviderCatalogEntry { id: string; label: string; settings: string[]; fixture: boolean; }        // §3.3 providerCatalog()
export interface ScenarioCatalogEntry { version: string; label: string; fixture: boolean; artifactSchemaVersion: string;
    presentation: { title: string; tabs: readonly string[]; hasDatasetPreset: boolean } }                        // §3.3 scenarioCatalog()

export interface ProviderView {
    readonly id: string;
    readonly label: string;            // server label
    readonly optionLabel: string;      // exact select copy, dashboard-owned
    readonly fixture: boolean;         // server-supplied
    readonly settings: readonly string[];
    readonly catalogPath: string | undefined;   // hosted deployment catalog, when one exists
    readonly defaultPhase: "development" | "pilot" | "study" | undefined;
    readonly defaultModelId: string | undefined;
    readonly copiesCapacity: boolean;  // copy deployment capacity into tokenBudget.capacity on select
    readonly capacityNote: string | undefined;  // budget-summary copy when no capacity applies
    readonly runEyebrow: string | undefined;    // run detail eyebrow override
    readonly listingBadge: string | undefined;  // run table badge copy
}
export interface ScenarioView {
    readonly version: string;
    readonly label: string;
    readonly fixture: boolean;
    readonly artifactSchemaVersion: string;
    readonly presentation: ScenarioCatalogEntry["presentation"];
    readonly showDatasetFields: boolean;   // !presentation.hasDatasetPreset
    readonly modelSection: "catalog" | "freeText";
}
export function providerView(id: string, catalog: readonly ProviderCatalogEntry[]): ProviderView;
export function scenarioView(version: string, catalog: readonly ScenarioCatalogEntry[]): ScenarioView;
export function useProviders(): { providers: ProviderView[]; view: (id: string) => ProviderView; loading: boolean; error: Error | undefined };
export function useScenarios(): { scenarios: ScenarioView[]; view: (version: string) => ScenarioView; loading: boolean; error: Error | undefined };
```

**Behaviour:** the intentional, documented change is that an unknown provider/scenario no longer falls through hand-written branches: it renders the *generic* descriptor (`optionLabel = id`, `copyCapacity = false`, `runEyebrow = "EXPERIMENT RUN"`, `listingBadge` from `fixture`, `showDatasetFields = true`, `modelSection = "freeText"`). For `scripted`/`adaption` and `healthcare-points-v0.3` the rendered output is byte-identical to today.

**Hardcoded sites replaced**

| Site (current) | Branch | Descriptor field |
| --- | --- | --- |
| `components/model-controls.tsx:16` | catalog endpoint | `providerView.catalogPath` |
| `model-controls.tsx:39–52` | default phase, default model id, capacity deletion | `defaultPhase`, `defaultModelId`, token-budget capacity handling stays |
| `model-controls.tsx:56–62` | select options + unknown option | `providers.map(p => p.optionLabel)` |
| `components/budget-summary.tsx:23–27` | capacity copy | `capacityNote`, `copiesCapacity` |
| `pages/runs/run-detail.tsx` (was 336–340) | eyebrow | `runEyebrow` |
| `components/run-table.tsx` (was `App.tsx:30`) | listing badge | `listingBadge` derived from `fixture` |
| `pages/experiments/scenario-section.tsx` (was 650, 687) | dataset fields | `showDatasetFields` |
| `pages/experiments/agents-section.tsx` (was 759) | model controls vs free text | `modelSection` |
| `pages/runs/views.tsx` (was `Runs.tsx:450`) | results tab | `presentation.tabs.includes("results")` |
| `components/healthcare-preset.tsx:17` | preset visibility | `presentation.hasDatasetPreset` |

**Invariants:** the exact strings `"Scripted healthcare · development"`, `"Live Adaption · pilot"`, `"Scripted driver — no provider context"`, `"Unverified — select a supported model"`, `"SCRIPTED FIXTURE · NOT SPONTANEOUS MODEL BEHAVIOR"`, `"EXPERIMENT RUN"`, `"Scripted fixture"`, `"Scripted execution validates instrumentation. It is not spontaneous agent behavior."`, `"Validated healthcare dataset"`, `"Use healthcare smoke preset"`. These live in the dashboard presentation table (copy is a dashboard concern); the server supplies `id`/`label`/`settings`/`fixture`/`presentation`.

- [ ] **Step 8.1: Write the failing descriptor tests**

Create `dashboard/src/lib/descriptors.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { providerView, scenarioView, useProviders } from "./descriptors";
import { fakeClients, renderWithClients } from "../test/clients";

afterEach(cleanup);

const providers = [
  { id: "scripted", label: "Scripted healthcare", settings: [], fixture: true },
  { id: "adaption", label: "Live Adaption", settings: ["temperature"], fixture: false },
];
const scenarios = [{ version: "healthcare-points-v0.3", label: "Healthcare points", fixture: true, artifactSchemaVersion: "healthcare-ranking-v0.3", presentation: { title: "Healthcare", tabs: ["results"], hasDatasetPreset: true } }];

it("keeps the exact provider copy for known providers", () => {
  expect(providerView("scripted", providers)).toMatchObject({
    optionLabel: "Scripted healthcare · development",
    defaultPhase: "development",
    defaultModelId: "healthcare-points-v0.3",
    fixture: true,
    runEyebrow: "SCRIPTED FIXTURE · NOT SPONTANEOUS MODEL BEHAVIOR",
    listingBadge: "Scripted fixture",
  });
  expect(providerView("adaption", providers)).toMatchObject({ optionLabel: "Live Adaption · pilot", catalogPath: "/models/adaption", copiesCapacity: true, fixture: false });
});

it("falls back to a generic descriptor for an unknown provider", () => {
  const view = providerView("acme", providers);
  expect(view.optionLabel).toBe("acme");
  expect(view.catalogPath).toBeUndefined();
  expect(view.defaultPhase).toBeUndefined();
  expect(view.runEyebrow).toBeUndefined();
  expect(view.listingBadge).toBeUndefined();
  expect(view.fixture).toBe(false);
});

it("derives the dataset and results capabilities from the scenario descriptor", () => {
  expect(scenarioView("healthcare-points-v0.3", scenarios)).toMatchObject({ showDatasetFields: false, modelSection: "catalog" });
  expect(scenarioView("healthcare-points-v0.3", scenarios).presentation.tabs).toContain("results");
  const unknown = scenarioView("future-v9", scenarios);
  expect(unknown.showDatasetFields).toBe(true);
  expect(unknown.modelSection).toBe("freeText");
  expect(unknown.presentation.tabs).toEqual([]);
});
```

Create `dashboard/src/components/providers.test.tsx` with the zero-edit gate:

```tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { ModelControls } from "./model-controls";
import { fakeClients, renderWithClients } from "../test/clients";

afterEach(cleanup);

it("renders a provider that exists only in the metadata response with zero component edits", async () => {
  const config = { ...defaultFixtureConfiguration(), model: { ...defaultFixtureConfiguration().model, provider: "acme", id: "" } };
  function Controls() {
    const [value, setValue] = useState(config);
    return <ModelControls config={value} replace={setValue} />;
  }
  renderWithClients(<Controls />, {
    clients: fakeClients({ experiments: { providers: async () => ({ providers: [{ id: "scripted", label: "Scripted healthcare", settings: [], fixture: true }, { id: "acme", label: "Acme research", settings: ["temperature"], fixture: false }] }) } }),
  });
  expect(await screen.findByRole("option", { name: "Acme research" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Scripted healthcare · development" })).toBeTruthy();
});
```

`experimentsClient` gains `providers()`/`scenarios()` so the metadata is fixture-injectable (T6.1's client owns the harness-facing reads; `useApi` would reintroduce a fetch stub).

- [ ] **Step 8.2: Run to verify they fail**

```bash
npm run test --workspace sidechannel-dashboard -- src/lib/descriptors.test.tsx src/components/providers.test.tsx
```

Expected: FAIL — `Failed to load url ./descriptors`; then `Acme research` option missing.

- [ ] **Step 8.3: Implement `descriptors.ts` and rewire the ten sites**

Implementation shape (presentation table is dashboard copy, catalog is server truth):

```ts
const PROVIDER_PRESENTATION: Record<string, Partial<Pick<ProviderView, "optionLabel" | "defaultPhase" | "defaultModelId" | "copiesCapacity" | "capacityNote" | "runEyebrow" | "listingBadge" | "catalogPath">>> = {
  scripted: { optionLabel: "Scripted healthcare · development", defaultPhase: "development", defaultModelId: "healthcare-points-v0.3", copiesCapacity: false, capacityNote: "Scripted driver — no provider context", runEyebrow: "SCRIPTED FIXTURE · NOT SPONTANEOUS MODEL BEHAVIOR", listingBadge: "Scripted fixture" },
  adaption: { optionLabel: "Live Adaption · pilot", defaultPhase: "pilot", defaultModelId: "", copiesCapacity: true, catalogPath: "/models/adaption" },
};
const SCENARIO_PRESENTATION: Record<string, { modelSection: "catalog" | "freeText" }> = {
  "healthcare-points-v0.3": { modelSection: "catalog" },
};

export function providerView(id: string, catalog: readonly ProviderCatalogEntry[]): ProviderView {
  const entry = catalog.find((candidate) => candidate.id === id);
  const presentation = PROVIDER_PRESENTATION[id] ?? {};
  return {
    id,
    label: entry?.label ?? id,
    optionLabel: presentation.optionLabel ?? id,
    fixture: entry?.fixture ?? false,
    settings: entry?.settings ?? [],
    catalogPath: presentation.catalogPath,
    defaultPhase: presentation.defaultPhase,
    defaultModelId: presentation.defaultModelId,
    copiesCapacity: presentation.copiesCapacity ?? false,
    capacityNote: presentation.capacityNote,
    runEyebrow: presentation.runEyebrow,
    listingBadge: presentation.listingBadge,
  };
}
```

`scenarioView` mirrors it and derives `showDatasetFields = !(entry?.presentation.hasDatasetPreset ?? false)`, `presentation = entry?.presentation ?? { title: version, tabs: [], hasDatasetPreset: false }`.

`useProviders()`/`useScenarios()` load both catalogs once per page via `useResource("descriptors:providers", () => clients.experiments.providers())` and return stable `view` callbacks (`useCallback` keyed on the catalog array).

- [ ] **Step 8.4: Run green + gate + commit**

```bash
npm run test --workspace sidechannel-dashboard
npm run check --workspace sidechannel-dashboard
git grep -n "\"scripted\"\|'scripted'\|adaption\|healthcare-points-v0.3" -- dashboard/src | grep -v "lib/descriptors" | grep -v "\.test\."
node -e "const fs=require('fs');console.log(fs.readFileSync('dashboard/src/lib/descriptors.ts','utf8').split('\n').length)"
git add dashboard/src/lib/descriptors.ts dashboard/src/lib/descriptors.test.tsx dashboard/src/components dashboard/src/pages dashboard/src/App.tsx dashboard/src/lib/clients
git commit -m "refactor(dashboard): provider and scenario descriptors from the server registries"
```

Expected: the grep returns only `lib/descriptors.ts` (and tests); `descriptors.ts` < 250 lines.

**Gate:** adding a provider to a test metadata response requires zero edits outside `lib/descriptors.ts` (proved by `providers.test.tsx`).

---

## T6.9 — Registry dispatch close-out (F7)

**Files:**
- Modify: the four page shells (`Analysis`, `Oversight`, `Runs`, `Experiments` if it grows a `view` param — it does not), `pages/analysis/views.tsx`, `pages/oversight/views.tsx`, `pages/runs/views.tsx`
- Test: `dashboard/src/pages/registry.test.tsx` (page-level dispatch matrix)

**Behaviour (explicit change):** an unknown `?view=` value now renders `NotFoundView` instead of another feature. Before: `Analysis` rendered the provenance panel, `Oversight` rendered the setup tab, `Runs` rendered the evidence panel, for any unrecognised value. Evidence: this task's dispatch matrix test plus the per-page unknown-view tests from T6.2/T6.3/T6.5.

- [ ] **Step 9.1: Write the failing dispatch matrix test**

```tsx
// dashboard/src/pages/registry.test.tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { fakeClients, renderWithClients } from "../test/clients";
import Analysis from "./Analysis";
import Oversight from "./Oversight";
import Runs from "./Runs";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";

afterEach(cleanup);
const config = defaultFixtureConfiguration();
const run = { id: "run-1", config, status: "completed", configHash: "h", launchKey: "k", createdAt: "2026-11-07T12:00:00Z", updatedAt: "2026-11-07T12:00:00Z", round: 1, turn: 1, board: [], artifacts: [], reports: [], operations: {}, scenarioState: null, usage: {} };

it("renders not-found for every unknown view on every page", async () => {
  const analyses = { get: async () => ({ id: "analysis-a", runId: "run-1", status: "completed", counters: { prepared: 0, submitted: 0, finished: 0, failed: 0, skipped: 0, answers: 0 }, manifest: { sourceStatus: "completed", sequenceBoundary: 1, codebook: { id: "r", revision: 1, codes: [] }, settings: { model: "jev", windowSize: 12, stride: 4 }, configHash: "c", evidenceHash: "e", diagnostics: [], availability: {} } }), windows: async () => ({ items: [], nextCursor: null }), list: async () => ({ items: [], nextCursor: null }), listForRun: async () => ({ items: [], nextCursor: null }) };
  for (const [element, route, clients] of [
    [<Analysis />, "/analysis/analysis-a?view=typo", fakeClients({ analyses, runs: { get: async () => run } })],
    [<Oversight />, "/oversight?view=typo", fakeClients({ monitor: { evaluations: async () => ({ items: [], nextCursor: null }) } })],
    [<Runs />, "/run-1?view=typo", fakeClients({ runs: { get: async () => run, progress: async () => ({}) } })],
  ] as const) {
    renderWithClients(element as never, { route: route as string, clients: clients as never });
    expect(await screen.findByText("This view does not exist")).toBeTruthy();
    cleanup();
  }
});
```

- [ ] **Step 9.2: Run to verify it fails**

```bash
npm run test --workspace sidechannel-dashboard -- src/pages/registry.test.tsx
```

Expected: FAIL on the first page that still uses an else-chain (some page renders a feature panel instead of not-found).

- [ ] **Step 9.3: Replace the remaining chains and delete dead branches**

```bash
git grep -n "tab ===" -- dashboard/src/pages
git grep -n "\[.*\"probability\".*\"heatmap\".*\].includes" -- dashboard/src
```

Expected before: matches in whichever shells still branch; after this step: none. Each page shell must render exactly `<ViewPanel … />` and nothing else between the header and the drawer.

- [ ] **Step 9.4: Run the structural gates**

```bash
npm run test --workspace sidechannel-dashboard
npm run check --workspace sidechannel-dashboard
npm run lint
node scripts/verify-boundaries.mjs
node -e "const fs=require('fs'),p=require('path');const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p.join(d,e.name)):[p.join(d,e.name)]);const rows=walk('dashboard/src').filter(f=>/\.(ts|tsx)$/.test(f)).map(f=>[f,fs.readFileSync(f,'utf8').split('\n').length]).sort((a,b)=>b[1]-a[1]);for(const [f,n] of rows.slice(0,6))console.log(String(n).padStart(5),f)"
git grep -nE "function use[A-Z]|const use[A-Z][A-Za-z]* *=" -- "dashboard/src/pages/*.tsx" || echo "no page defines a hook"
git grep -n "useApi(\|usePage(\|useOffsetPage(" -- "dashboard/src/pages/*.tsx" || echo "no page reads a path"
git grep -c "stubGlobal('fetch'\|\"fetch\"" -- dashboard/src || echo "no fetch stubs"
```

Expected: all green; the six largest dashboard files are all < 500 lines (`components/ui.tsx` at 419 is the largest legitimate remainder; if a page view exceeds 500, split it further in this task and record the split in the PR); no page defines a hook; no page reads a path; no fetch stubs.

- [ ] **Step 9.5: Manual smoke (R4 mitigation)**

```bash
npm run smoke:dashboard
```

Expected: PASS. Then, with the fixture stack running (`npm run dev:api` + `npm run dev:dashboard`), click through `/`, `/experiments`, `/experiments/new`, `/runs`, `/runs/<id>?view=board`, `/codebook`, `/analysis`, `/analysis/<id>?view=review`, `/oversight?view=setup`, and confirm the tab lists, evidence drawers and cancel controls behave exactly as before. Record the route list in the PR description.

- [ ] **Step 9.6: Commit**

```bash
git add dashboard/src
git commit -m "refactor(dashboard): registry dispatch everywhere; unknown views render not-found"
```

**Gate:** largest dashboard source file < 500 lines; 0 page-level data hooks; 0 `tab ===` chains; 0 fetch stubs; unknown view → not-found on every page.

---

## Verification summary

| Check | Command | Expected |
| --- | --- | --- |
| Dashboard unit/integration tests | `npm run test --workspace sidechannel-dashboard` | PASS, ≥ baseline + 20 |
| Dashboard types | `npm run check --workspace sidechannel-dashboard` | exit 0 |
| Dashboard lint | `npm run lint --workspace sidechannel-dashboard` | exit 0 |
| Repo lint + boundaries | `npm run lint` | exit 0 |
| Repo types | `npm run check` | exit 0 |
| Repo tests | `npm test` | PASS |
| Build | `npm run build` | PASS |
| Compiled evidence | `node scripts/verify-compiled.mjs` | PASS |
| Migration equivalence | `node scripts/verify-migration-equivalence.mjs` | PASS |
| Dashboard smoke | `npm run smoke:dashboard` | PASS |
| Largest file | `node -e "…"` (Step 9.4) | < 500 lines |
| Page hooks | `git grep -nE "function use[A-Z]" -- "dashboard/src/pages/*.tsx"` | 0 |
| Tab chains | `git grep -n "tab ===" -- dashboard/src/pages` | 0 |
| Fetch stubs | `git grep -c "stubGlobal('fetch'" dashboard/src` | 0 |
| Reviewer key | `git grep -c "sidechannel-reviewer" -- dashboard/src` | 1 file |
| App cycle | `git grep -n "from \"../App\"" -- dashboard/src` | 0 |

## Rollback

Every task is one commit and reverts with `git revert <commit>`; there are no migrations, no dependency changes and no server edits. Ordering constraints for a partial revert:

- Reverting T6.0 requires reverting every later task (they import its seam). Revert in reverse order: T6.9 → T6.1.
- Reverting a single page task (T6.1–T6.6) is safe: the deleted original block lives in that commit, and the page returns to its pre-split form. Its tests revert with it.
- T6.7 requires T6.2/T6.3/T6.5 (it edits their new files); revert T6.7 before any of those.
- T6.8 is independent of T6.2–T6.7 file-wise except for the import lines it adds; revert it first if the WS4 endpoints regress.
- If only the not-found behaviour is unwanted, revert the T6.9 commit alone; page registries keep working with their previous fallback only if that commit contained the fallback removal — it does, so reverting restores the else-chains. Prefer fixing forward.

## Out of scope (owned elsewhere)

- **WS5:** `lib/transport.ts`, `lib/api.ts` (`useApi`), `lib/paging.ts` (`usePage`/`useOffsetPage`), `lib/adapters/jev.ts` translation and session cache, `lib/types.ts`, `lib/analysis-types.ts`, `ReviewInput` split, `arrayOf` deletion.
- **WS7:** `lib/status.ts` vocabulary tables, `Badge({ tone })`, `eventMeta`, fabricated statuses (`oversized → failed` at `Runs`, `Analysis`, `Oversight` preview tables), `SUMMARY_OMIT`. WS6 keeps `<Badge status={…}>` call sites untouched.
- **WS4:** `ProviderProfile`/`ScenarioDescriptor` domain registries and the `/api/providers` + `/api/scenarios` endpoints. WS6 only consumes them.
- **WS3:** `api/src/routes/oversight.ts` handler fusion (F3's server half), route splitting, body-reader unification.
- **Not features:** no new tabs, no copy changes, no layout redesign, no routing changes (`App.tsx` navigation stays byte-identical apart from the `RunTable` removal), no `ui.tsx` edits, no test-runner or dependency changes.
- `pages/Overview.tsx` gets only the `RunTable` import and `arrayOf` removal; `HealthcareResults`, `RecordedEventContent`, `ArtifactView`, `ProseListEditor` keep their current APIs.

## Self-review

**Finding coverage.** F1 → T6.1 (six render paths, six components, `useExperimentDraft`/`useExperimentValidation`/`buildLaunchPayload`, single server validity owner). F2 → T6.2 (`useAnalysisJob`/`useAnalysisWindows`/`useReviewBatches`, six registered views, per-call-site stale filtering removed). F3 (dashboard half) → T6.3 (four tabs each owning their fetches; server half explicitly deferred to WS3). F4 → T6.4 (`useAnalysisDraft`/`useCodebookPicker`/`usePreview`; generation counter deleted). F5 → T6.5 (`useRunRecord`/`useRunProgress`/`useRunEvidence`; seven plus one registered panels; polling isolated). F6 → T6.6 (`useCodebookDraft`, one `validateCodebook`, shared pagers). F7 → T6.9 (registry dispatch + `NotFoundView`). F14 (dashboard half) → T6.8. F17 → T6.7 (`components/run-table.tsx`, cycle removed). F18 → T6.7 (`useClaimedReviewer`, `CancelJobButton`, `ReviewHistoryRow`). F19 → T6.7 (plain-data props on the new components, CSS ownership split).

**Placeholders.** No "TBD"/"similar to"; every code-changing step has either complete code or an exact `old:line-range → new:file` move map with the new export signature. Test code is complete for every red step.

**Type consistency.** `ViewRegistry`/`Page`/`OffsetPage` are imported from `lib/contracts.ts`, never redeclared. `useResource`/`useResourcePage`/`useResourceOffsetPage` result fields match conventions §3.4's `useApi`/`usePage`/`useOffsetPage` names exactly. Hook names are the ones mandated by the program plan's WS6 table. Client member names follow §3.4 for `runsClient`; the others are reconciled mechanically at P.4 (only `pages/*/use-*.ts` can change).

**Documented deviations from the conventions sheet.**

1. **`lib/clients/query.ts` and `lib/clients/experiments.ts` are new lib files created by WS6.** §3.4 fixes path-keyed read hooks and five clients, neither of which can be fed by fake clients; the WS6 mandate is fake-client fixture rendering. `query.ts` preserves §3.4's result shapes and is the single seam, so a future WS5 change is a re-export edit. The draft/config/dataset/pair surface is not covered by §3.4's five clients, so `experimentsClient` follows the same idiom rather than reintroducing path strings in components.
2. **`useMutation` is replaced by `components/use-command.ts`.** §3.4 does not list `useMutation`; WS6 must not depend on an unlisted export, and command state has to be inside the extracted hooks to be fixture-testable. Semantics and copy are identical.
3. **Line-span assignment beyond the task briefs.** The briefs cite `AnalysisDetail` 959–1511 and `AnalysisSetup` 205–932; this plan additionally assigns 85–204 (entry + collection) and 933–958 (`PreviewWindowInput`) to T6.4, and 1512–2524 (six view components) to T6.2, so the 2,524-line file is fully accounted for. `Runs`'s `RunList` and pair view and `Oversight`'s definition/evaluation views are assigned to their page tasks for the same reason.
4. **`lib/descriptors.ts` is created by WS6 (T6.8),** matching conventions §3.3 ("Dashboard consumes these in WS6") and §4 cross-plan rule 3, although the program plan's WS4 T4.3 file list also names it.
5. **`git mv` of page CSS** happens inside the owning page task (T6.1/T6.2) rather than in T6.7; T6.7 owns only the cross-page `runs-oversight.css` split.

**Behaviour-change statement.** Extraction itself changes no rendered output: copy, ARIA, table labels, URL parameters and data semantics are moved verbatim and asserted by the rewritten suites. Three intentional changes are declared, each with evidence: (a) unknown `?view=` renders not-found (T6.9 test + F7); (b) preview staleness is decided by settings identity instead of a hand-rolled counter (T6.4 test; same discard behaviour); (c) unknown providers/scenarios render generic descriptors instead of ad-hoc branches (T6.8 test).

**Risks.** (i) WS5's `ApiClientProvider` prop name and client member names may differ from P.4 — bounded to `test/clients.tsx` and `pages/*/use-*.ts`, caught by `npm run check`. (ii) Large moved blocks can drift during hand-editing — mitigated by move maps, byte-level copy assertions, and one page per PR. (iii) The rewritten `Analysis.test.tsx` is the highest-risk suite (13 behaviours); it is split so each test's assertions survive verbatim, and T6.2/T6.4 each keep the suite green before commit.
