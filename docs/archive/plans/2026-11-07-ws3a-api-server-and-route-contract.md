# WS3A — API Server and Route-Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `api/src/server/index.ts` (247 lines, twelve responsibilities) into transport, auth, error, static and per-resource router modules; unify the three route-handler contracts into one transport-neutral `ResearchRouteHandler` with one body reader and per-route byte limits; replace duck-typed/message-regex error mapping with typed failure mapping; and de-duplicate the API's page-collection loops — with a committed route-contract snapshot proving no payload change.

**Architecture:** Task 1 records a characterization snapshot of every core route through `createResearcherServer` + `InMemoryRepository` + the in-memory healthcare catalog (the routes in scope need no oversight store); it must stay byte-identical for the rest of the workstream. Tasks 2–3 then move responsibilities out of `index.ts` into `http.ts`, `auth.ts`, `errors.ts`, `static.ts`, `configuration.ts`, `launch.ts` and `routers/{workspace,config,drafts,runs,pairs,overview}.ts`, leaving `index.ts` as wiring plus one `try/catch`. Task 4 flips the shared request shape from an eagerly parsed body to a lazy per-route-limit reader, deleting the synthetic `IncomingMessage` adapter in `jev-extension.ts`. Task 5 removes the last message-regex status inference (`review-routes.ts`) by typing the review-domain throws. Task 6 adds `packages/domain/src/pagination.ts` and replaces the four API/domain page loops. `packages/domain/src/oversight/**` is untouched (WS3c). Estimated: 6 tasks, 5–7 dev-days.

**Tech Stack:** TypeScript 6.0.3, Node 22.18+/24.11+, `node:http`, `node:test` via `scripts/test.mjs` + `tsx`, npm workspaces + Nx 23, MongoDB 8 (integration only). No dependency changes.

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

**WS3a-specific constraints**

- **Prerequisites:** WS1 (typed `WorkerStatus`, contract suites) and WS2 (port split, `api/src/main.ts` composition root) must be merged first; WS3a edits `packages/contracts/src/server/contracts.ts` and `api/src/routes/jev-extension.ts` *after* WS2, sequentially, never concurrently (conventions §4 ordering rule 1).
- **Line anchors** below were verified against the pre-WS1 tree (audit commit `20bc219`). WS1/WS2 shift lines in `packages/contracts/src/server/contracts.ts`, `packages/contracts/src/harness/repository.ts` and `api/src/routes/jev-extension.ts`; trust the source and match on the quoted code, not the number.
- **The committed snapshot `api/src/server/route-contract.snapshot.json` may only change in Task 1.** If any later task makes it change, the refactor changed behaviour: revert the task, do not re-record.
- **Not the same as WS3 T3.5's "unify 1 MB/2 MB to one documented value".** WS3a keeps both limits (2 MB core/Jev, 1 MB review) and only unifies the *reader*; the parent task list is authoritative.
- **No new runtime dependency, no new HTTP route, no change to any URL on the wire** (the `/api/jev/*` wire prefix is preserved).

---

## File structure

**Create**

| Path | Responsibility |
| --- | --- |
| `packages/contracts/src/errors.ts` | `FailureKind`, `DomainFailure` (conventions §3.6); transport-neutral |
| `api/src/server/http.ts` | Security headers, JSON/NDJSON `send`, one lazy body reader with a `limit`, cursor/idempotency/metadata helpers |
| `api/src/server/auth.ts` | Timing-safe bearer token check and same-origin write check |
| `api/src/server/errors.ts` | `HttpError`, `statusOf` (typed mapping), `messageOf`, `sendFailure` (the single error boundary) |
| `api/src/server/static.ts` | SPA asset serving, traversal defence, MIME map |
| `api/src/server/configuration.ts` | `withBuild` + `prepare`/`validate` (healthcare resolution, adaption-model check, field errors) |
| `api/src/server/launch.ts` | `sourceDraft` freeze and `freezeReference` (idempotency) shared by runs/pairs |
| `api/src/server/routers/workspace.ts` | `GET /workspace` |
| `api/src/server/routers/config.ts` | `GET /config/default`, `GET /config/schema`, `POST /config/validate` |
| `api/src/server/routers/drafts.ts` | `/drafts` CRUD plus `/drafts|runs|pairs/:id/duplicate` |
| `api/src/server/routers/runs.ts` | `/runs` listing/launch, `/runs/:id/*` operations, event/evidence links, export |
| `api/src/server/routers/pairs.ts` | `POST /pairs`, `GET /pairs/:id` (comparison) |
| `api/src/server/routers/overview.ts` | `GET /overview` |
| `api/src/server/errors.test.ts` | Unit tests for typed status mapping (X3) |
| `api/src/server/failures.test.ts` | API-level 400/404/409/413/503 boundary tests (X3) |
| `api/src/server/route-contract-cases.ts` | Test-only recorder for the route-contract snapshot (not imported by production code) |
| `api/src/server/route-contract.test.ts` | Characterization test: snapshot must be identical before/after the refactor |
| `api/src/server/route-contract.snapshot.json` | Committed golden record of status codes, payload keys/values and NDJSON framing |
| `api/src/routes/review-routes.body.test.ts` | Review body cap (1 MB → 413) and typed review failures |
| `tests/integration/api-routes.mongo.test.ts` | Mongo-backed route status/shape coverage for every router (`*.mongo.test.ts`) |
| `packages/domain/src/pagination.ts` | `iteratePages`, `collectPages` (X5) |
| `packages/domain/src/pagination.test.ts` | Cursor-page iteration tests |

**Modify**

| Path | Change |
| --- | --- |
| `api/src/server/index.ts` | Becomes wiring + one `try/catch` (< 80 lines) |
| `api/src/server/server.test.ts` | Only if a status/message assertion changes (expected: none) |
| `api/src/server/adaption-models.ts` | Untouched (WS4 owns it); the route is mounted unchanged |
| `api/src/routes/jev-routes.ts` | `ResearchRouteHandler` signature; paths relative to `/api`; `data` instead of `body`; shared body reader |
| `api/src/routes/review-routes.ts` | Same signature change; `REVIEW_BODY_LIMIT`; Task 5 removes message-regex mapping; Task 6 uses `iteratePages` |
| `api/src/routes/jev-extension.ts` | Delete the synthetic `IncomingMessage`/`Readable` adapter and local `try/catch` |
| `api/src/routes/oversight.ts` | Request shape from contracts; `await request.body()`; keep the `ZodError` shape |
| `api/src/healthcare/service.ts` | One line: `body: {}` → `body: async () => ({})` (ownership note in Self-review) |
| `packages/contracts/src/server/contracts.ts` | `ResearchRouteRequest.body` becomes a lazy reader; result renames `body`→`data` |
| `packages/contracts/package.json` | Add the `./errors` export |
| `packages/domain/package.json` | Add the `./pagination` export |
| `packages/domain/src/analysis/jev-service.ts` | `pages()` becomes a one-line delegation to `iteratePages` (its export and 100-item page size are preserved for the analysis worker) |
| `packages/domain/src/analysis/jev-reviews.ts` | Replace bare `Error` throws with the typed `Analysis*` classes (messages unchanged) |
| `tests/integration/analysis-jev-backend.test.ts` | Call the route handler with the new request shape; `body`→`data` |
| `tests/integration/analysis-review-filtering.test.ts` | Call the review handler with the new request shape |
| `tests/integration/oversight-reviews.test.ts` | Two `call` helpers and three direct calls: `body: {}` → `body: async () => ({})` |

**Do not touch:** `packages/domain/src/oversight/**` (WS3c), `packages/persistence/**` (WS1/WS2/WS3c), `dashboard/**` (WS5/WS6), `experiment-worker/**` (WS3b), `api/src/healthcare/bootstrap.ts` (no change required — verified: it is a dataset CLI, not route registration).

---

## Environment setup

- [ ] **Step 0.1: Confirm the tree is green before Task 1**

```bash
npm run check
npm test
```

Expected: both exit 0. If not, stop and record the baseline.

- [ ] **Step 0.2: Start the local Mongo replica set (needed only by Task 3's Mongo test)**

```bash
docker compose up -d --wait mongo
```

Expected: `sidechannel-harness-mongo` healthy on `127.0.0.1:27018`.

---

## Task 1: Route-contract characterization snapshot (T3a.1)

**Files:**
- Create: `api/src/server/route-contract-cases.ts`
- Create: `api/src/server/route-contract.test.ts`
- Create: `api/src/server/route-contract.snapshot.json` (generated, then committed)

**Interfaces:**
- Produces: `recordRouteContract(): Promise<RouteContractSnapshot>` and `RouteRecord` from `api/src/server/route-contract-cases.js` (test-only).
- Consumes: `createResearcherServer(repository, options)` (`api/src/server/index.ts:61`), `InMemoryRepository`, `InMemoryHealthcareCatalog`, `loadHealthcarePackage`, `defaultFixtureConfiguration`, `createQueuedRun`.
- Runs without Mongo.
- **Effort:** ~1 dev-day. **Rollback:** `git revert` (see Rollback §Task 1).

- [ ] **Step 1.1: Write the failing characterization test**

Create `api/src/server/route-contract.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { recordRouteContract } from './route-contract-cases.js';

const snapshotPath = fileURLToPath(new URL('./route-contract.snapshot.json', import.meta.url));

test('API route contract snapshot is unchanged', async () => {
    const actual = await recordRouteContract();
    if (process.env.UPDATE_ROUTE_CONTRACT === '1') {
        await writeFile(snapshotPath, JSON.stringify(actual, null, 2) + '\n');
        return;
    }
    const committed: unknown = JSON.parse(await readFile(snapshotPath, 'utf8'));
    assert.deepEqual(actual, committed, 'Route contract changed: review the diff, then re-record with UPDATE_ROUTE_CONTRACT=1 only if the change is intended.');
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

```bash
node --import tsx --test api/src/server/route-contract.test.ts
```

Expected: FAIL — `Cannot find module './route-contract-cases.js'`.

- [ ] **Step 1.3: Write the recorder**

Create `api/src/server/route-contract-cases.ts`:

```ts
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryHealthcareCatalog } from '@sidechannel/persistence/healthcare/catalog';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { HarnessEvent } from '@sidechannel/contracts/harness/contracts';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { createResearcherServer, type ResearcherServerOptions } from './index.js';
import { loadHealthcarePackage } from '../healthcare/bootstrap.js';

export interface RouteRecord {
    readonly case: string;
    readonly status: number;
    readonly contentType: string | null;
    /** Parsed JSON body, normalized; absent for NDJSON responses. */
    readonly body?: unknown;
    /** Parsed NDJSON records, normalized; absent for JSON responses. */
    readonly lines?: unknown[];
}

export interface RouteContractSnapshot {
    readonly research: RouteRecord[];
    readonly demo: RouteRecord[];
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

/** Volatile identities and clocks are placeholders; object keys are sorted so key order is not asserted. */
function normalize(value: unknown): unknown {
    if (typeof value === 'string') return value.replace(UUID, '<uuid>').replace(TIMESTAMP, '<timestamp>');
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .map(([key, child]) => [key, normalize(child)] as const)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return value;
}

const healthcareFixture = fileURLToPath(new URL('../../../data/healthcare/points-out/fixture10-s101-points/', import.meta.url));

/**
 * Queue ordering breaks `createdAt` ties by `id` (a random UUID), so runs that must appear
 * in a stable order in `GET /overview` are created at least 2 ms apart.
 */
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 2));

/** An extension stream proves the NDJSON framing and the extension dispatch order. */
const contractExtensions: ResearchRouteHandler = async request => {
    if (request.method !== 'GET') return null;
    if (request.path === '/contract/echo') return { status: 200, data: { method: request.method, value: request.query.get('value') } };
    if (request.path === '/contract/stream') {
        async function* records() { yield { type: 'manifest', data: { schemaVersion: 1 } }; yield { type: 'window', data: { id: 'window-1' } }; }
        return { status: 200, data: records() };
    }
    return null;
};

async function createApp(options: ResearcherServerOptions) {
    const repository = new InMemoryRepository();
    const directory = await mkdtemp(join(tmpdir(), 'route-contract-'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>Research workspace</title><main id="root"></main>');
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'assets', 'main.js'), 'document.title="Research workspace"');
    const catalog = new InMemoryHealthcareCatalog();
    await catalog.register(await loadHealthcarePackage(healthcareFixture));
    const server = createResearcherServer(repository, { dashboardDirectory: directory, healthcareCatalog: catalog, extensionHandlers: [contractExtensions], ...options });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;
    const send = async (label: string, path: string, init?: RequestInit): Promise<RouteRecord> => {
        const response = await fetch(base + path, init);
        const contentType = response.headers.get('content-type');
        const text = await response.text();
        const ndjson = /ndjson/.test(contentType ?? '');
        return {
            case: label, status: response.status, contentType,
            ...(ndjson
                ? { lines: text.trim() ? text.trim().split('\n').map(line => normalize(JSON.parse(line) as unknown)) : [] }
                : { body: text ? normalize(JSON.parse(text) as unknown) : null }),
        };
    };
    const get = (label: string, path: string, headers?: Record<string, string>) => send(label, '/api' + path, headers ? { headers } : undefined);
    const post = (label: string, path: string, payload: unknown, headers?: Record<string, string>) => send(label, '/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
    const close = async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(directory, { recursive: true, force: true }); };
    return { repository, get, post, close };
}

async function recordResearchMode(): Promise<RouteRecord[]> {
    const app = await createApp({});
    const records: RouteRecord[] = [];
    try {
        const config = defaultFixtureConfiguration();
        records.push(await app.get('workspace', '/workspace'));
        records.push(await app.get('config/default', '/config/default'));
        records.push(await app.get('config/schema', '/config/schema'));
        records.push(await app.post('config/validate invalid', '/config/validate', { config: { roles: [null] } }));
        records.push(await app.post('config/validate fixture', '/config/validate', { config }));
        records.push(await app.get('datasets', '/datasets'));
        records.push(await app.get('drafts empty', '/drafts'));
        records.push(await app.post('drafts create invalid', '/drafts', { id: 'draft-1', config: { label: 'unfinished' }, name: 'Pilot', notes: 'Keep my edits' }));
        records.push(await app.post('drafts update', '/drafts', { id: 'draft-1', config, revision: 1 }));
        records.push(await app.post('drafts update stale', '/drafts', { id: 'draft-1', config, revision: 1 }));
        records.push(await app.get('drafts read', '/drafts/draft-1'));
        records.push(await app.get('drafts read missing', '/drafts/missing'));
        records.push(await app.post('drafts duplicate', '/drafts/draft-1/duplicate', { name: 'Second model', notes: 'Pilot' }));
        const run = await app.repository.createRun(createQueuedRun(config, 'seed-run'));
        await pause();
        records.push(await app.post('runs launch', '/runs', { config, idempotencyKey: 'launch-1' }));
        records.push(await app.post('runs launch repeat', '/runs', { config, idempotencyKey: 'launch-1' }));
        const changed = defaultFixtureConfiguration(); changed.label = 'edited';
        records.push(await app.post('runs launch conflict', '/runs', { config: changed, idempotencyKey: 'launch-1' }));
        records.push(await app.post('runs launch no key', '/runs', { config }));
        records.push(await app.post('runs launch invalid config', '/runs', { config: { roles: [null] }, idempotencyKey: 'launch-2' }));
        records.push(await app.post('runs duplicate', '/runs/' + run.id + '/duplicate', { name: 'Copy' }));
        await pause();
        const pair = await app.post('pairs launch', '/pairs', { config, idempotencyKey: 'pair-1', pairingSeed: 7 });
        records.push(pair);
        records.push(await app.get('pairs compare', '/pairs/pair-pair-1'));
        records.push(await app.get('pairs compare missing', '/pairs/pair-missing'));
        records.push(await app.post('pairs duplicate', '/pairs/pair-pair-1/duplicate', { name: 'Pair copy' }));
        const appended: HarnessEvent[] = [];
        for (const [index, type] of ['turn_started', 'model_response', 'memory_updated'].entries()) appended.push(await app.repository.appendEvent({ runId: run.id, type, agentId: index % 2 ? 'beta' : 'alpha', data: { index } }));
        records.push(await app.get('runs list all', '/runs'));
        records.push(await app.get('runs list page', '/runs?limit=1&offset=0'));
        records.push(await app.get('runs list cursor invalid', '/runs?limit=0'));
        records.push(await app.get('runs read', '/runs/' + run.id));
        records.push(await app.get('runs read missing', '/runs/missing'));
        records.push(await app.get('runs progress', '/runs/' + run.id + '/progress'));
        records.push(await app.get('runs events page', '/runs/' + run.id + '/events?limit=2'));
        records.push(await app.get('runs events phase invalid', '/runs/' + run.id + '/events?phase=nope'));
        records.push(await app.get('runs event item', '/runs/' + run.id + '/events/' + appended[0]!.id));
        records.push(await app.get('runs event item missing', '/runs/' + run.id + '/events/missing'));
        records.push(await app.get('runs event item other run', '/runs/other-run/events/' + appended[0]!.id));
        records.push(await app.get('runs memory page', '/runs/' + run.id + '/memory?limit=1'));
        records.push(await app.get('runs artifacts page', '/runs/' + run.id + '/artifacts?limit=1'));
        records.push(await app.get('runs artifact item', '/runs/' + run.id + '/artifacts/0'));
        records.push(await app.get('runs artifact missing', '/runs/' + run.id + '/artifacts/99'));
        records.push(await app.get('runs board page', '/runs/' + run.id + '/board?limit=1'));
        records.push(await app.get('runs export', '/runs/' + run.id + '/export'));
        records.push(await app.get('runs unknown op falls back to export shape', '/runs/' + run.id + '/cancel'));
        records.push(await app.post('runs cancel', '/runs/' + run.id + '/cancel', {}));
        records.push(await app.get('overview', '/overview'));
        records.push(await app.get('unknown api route', '/nope'));
        records.push(await app.post('cross origin write', '/runs', { config, idempotencyKey: 'cross-origin' }, { Origin: 'https://elsewhere.example' }));
        records.push(await app.get('extension echo', '/contract/echo?value=connected'));
        records.push(await app.get('extension stream', '/contract/stream'));
    } finally { await app.close(); }
    return records;
}

async function recordDemoMode(): Promise<RouteRecord[]> {
    const app = await createApp({ demoMode: true });
    try { return [await app.get('workspace demo', '/workspace')]; } finally { await app.close(); }
}

export async function recordRouteContract(): Promise<RouteContractSnapshot> {
    return { research: await recordResearchMode(), demo: await recordDemoMode() };
}
```

- [ ] **Step 1.4: Run the recorder to generate the snapshot**

PowerShell:

```powershell
$env:UPDATE_ROUTE_CONTRACT='1'; node --import tsx --test api/src/server/route-contract.test.ts; Remove-Item Env:UPDATE_ROUTE_CONTRACT
```

bash:

```bash
UPDATE_ROUTE_CONTRACT=1 node --import tsx --test api/src/server/route-contract.test.ts
```

Expected: PASS (records the golden file). Inspect `api/src/server/route-contract.snapshot.json`: `<uuid>`/`<timestamp>` placeholders only, no real ids or clocks.

- [ ] **Step 1.5: Run the test to verify it passes against the committed snapshot**

```bash
node --import tsx --test api/src/server/route-contract.test.ts
```

Expected: PASS (1 test). Run it twice to prove determinism.

- [ ] **Step 1.6: Commit**

```bash
git add api/src/server/route-contract-cases.ts api/src/server/route-contract.test.ts api/src/server/route-contract.snapshot.json
git commit -m "test(api): record route-contract snapshot before server decomposition"
```

---

## Task 2: Extract `http.ts`, `auth.ts`, `errors.ts`, `static.ts`, `configuration.ts` (T3a.2)

**Files:**
- Create: `packages/contracts/src/errors.ts`, `api/src/server/http.ts`, `api/src/server/auth.ts`, `api/src/server/errors.ts`, `api/src/server/static.ts`, `api/src/server/configuration.ts`
- Create: `api/src/server/errors.test.ts`
- Modify: `packages/contracts/package.json` (export `./errors`)
- Modify: `api/src/server/index.ts` (edit map below)

**Interfaces:**
- Produces:
  - `@sidechannel/contracts/errors`: `FailureKind = 'invalid' | 'not-found' | 'conflict' | 'too-large' | 'unavailable'`; `class DomainFailure extends Error { constructor(public kind: FailureKind, message: string) }`.
  - `api/src/server/http.js`: `DEFAULT_BODY_LIMIT = 2_000_000`, `applySecurityHeaders(res)`, `send(res, status, data, headers?)`, `requestBody(req): (limit?: number) => Promise<Record<string, unknown>>`, `cursor(value, fallback, max?)`, `positiveLimit(limit)`, `idempotencyKey(value)`, `draftMetadata(value)`.
  - `api/src/server/auth.js`: `requireToken(req, token?)`, `requireSameOrigin(req)`.
  - `api/src/server/errors.js`: `HttpError`, `statusOf(error)`, `messageOf(error)`, `sendFailure(res, error)`.
  - `api/src/server/static.js`: `serveDashboard(req, res, pathname, directory)`.
  - `api/src/server/configuration.js`: `createConfigurationPipeline({ buildMetadata, healthcare })` → `{ prepare(input), validate(input) }`, type `ConfigurationPipeline`.
- Consumes: `validateConfiguration`/`fieldErrors` (`@sidechannel/contracts/server/config-schema`), `validateAdaptionModelSelection` (`./adaption-models.js`), `OversightError` (`@sidechannel/domain/oversight/service`), `Analysis*` (`@sidechannel/contracts/analysis/jev-repository`), `RepositoryConflict` (`@sidechannel/contracts/harness/repository`).
- Runs without Mongo.
- **Effort:** ~1.5 dev-days. **Rollback:** `git revert` (see Rollback §Task 2).

- [ ] **Step 2.1: Write the failing mapping test**

Create `api/src/server/errors.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisConflict, AnalysisNotFound, AnalysisPayloadTooLarge, AnalysisValidation } from '@sidechannel/contracts/analysis/jev-repository';
import { DomainFailure } from '@sidechannel/contracts/errors';
import { RepositoryConflict } from '@sidechannel/contracts/harness/repository';
import { OversightError } from '@sidechannel/domain/oversight/service';
import { HttpError, statusOf } from './errors.js';

test('domain failure kinds map to the conventions §3.6 status codes', () => {
    assert.deepEqual(
        (['invalid', 'not-found', 'conflict', 'too-large', 'unavailable'] as const).map(kind => statusOf(new DomainFailure(kind, 'x'))),
        [400, 404, 409, 413, 503],
    );
});

test('legacy typed error classes keep their own status', () => {
    assert.equal(statusOf(new HttpError(401, 'x')), 401);
    assert.equal(statusOf(new AnalysisConflict('x')), 409);
    assert.equal(statusOf(new AnalysisNotFound('x')), 404);
    assert.equal(statusOf(new AnalysisValidation('x')), 400);
    assert.equal(statusOf(new AnalysisPayloadTooLarge('x')), 413);
    assert.equal(statusOf(new RepositoryConflict('x')), 409);
    assert.equal(statusOf(new OversightError(404, 'x')), 404);
});

test('untyped errors are 400 and message text is never inspected', () => {
    assert.equal(statusOf(new Error('conflict: stale and not found')), 400);
    assert.equal(statusOf('conflict'), 400);
    assert.equal(statusOf(undefined), 400);
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

```bash
node --import tsx --test api/src/server/errors.test.ts
```

Expected: FAIL — `Cannot find module './errors.js'` and `@sidechannel/contracts/errors` is not an export.

- [ ] **Step 2.3: Add the contracts error vocabulary and its export**

Create `packages/contracts/src/errors.ts`:

```ts
/** Transport-neutral failure vocabulary. Producers throw these; each transport decides status codes. */
export type FailureKind = 'invalid' | 'not-found' | 'conflict' | 'too-large' | 'unavailable';

export class DomainFailure extends Error {
    constructor(public kind: FailureKind, message: string) {
        super(message);
        this.name = 'DomainFailure';
    }
}
```

In `packages/contracts/package.json`, add to `exports` (keep keys alphabetical, before `./harness/contracts`):

```json
    "./errors": {
      "types": "./dist/errors.d.ts",
      "import": "./dist/errors.js"
    },
```

- [ ] **Step 2.4: Write `api/src/server/errors.ts`**

```ts
import type { ServerResponse } from 'node:http';
import { AnalysisConflict, AnalysisNotFound, AnalysisPayloadTooLarge, AnalysisValidation } from '@sidechannel/contracts/analysis/jev-repository';
import { DomainFailure, type FailureKind } from '@sidechannel/contracts/errors';
import { RepositoryConflict } from '@sidechannel/contracts/harness/repository';
import { OversightError } from '@sidechannel/domain/oversight/service';

/** Transport-level failure: only the HTTP layer throws this. */
export class HttpError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
}

/** Conventions §3.6 mapping. Unknown failures keep the historical 400 default. */
const STATUS_BY_KIND: Record<FailureKind, number> = { invalid: 400, 'not-found': 404, conflict: 409, 'too-large': 413, unavailable: 503 };

/** Typed mapping only: no `'status' in error` duck typing and no message inspection. */
export function statusOf(error: unknown): number {
    if (error instanceof HttpError) return error.status;
    if (error instanceof DomainFailure) return STATUS_BY_KIND[error.kind];
    if (error instanceof AnalysisConflict || error instanceof AnalysisNotFound || error instanceof AnalysisValidation || error instanceof AnalysisPayloadTooLarge) return error.status;
    if (error instanceof RepositoryConflict) return error.status;
    if (error instanceof OversightError) return error.status;
    return 400;
}

export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : 'Request failed';
}

/** The single error boundary: JSON for normal responses, one trailing NDJSON record for streams. */
export async function sendFailure(res: ServerResponse, error: unknown): Promise<void> {
    if (res.headersSent) {
        if (!res.destroyed) res.end(JSON.stringify({ type: 'export_error', error: messageOf(error), complete: false }) + '\n');
        return;
    }
    res.writeHead(statusOf(error), { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: messageOf(error) }));
}
```

- [ ] **Step 2.5: Write `api/src/server/http.ts`**

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DraftMetadata } from '@sidechannel/contracts/harness/repository';
import { HttpError } from './errors.js';

/** Core and Jev request cap. Review routes pass their own, smaller limit. */
export const DEFAULT_BODY_LIMIT = 2_000_000;

export function applySecurityHeaders(res: ServerResponse): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

async function sendNdjson(res: ServerResponse, status: number, records: AsyncIterable<unknown>, headers: Record<string, string>): Promise<void> {
    res.writeHead(status, { 'Content-Type': 'application/x-ndjson; charset=utf-8', ...headers });
    async function* lines() { for await (const record of records) yield JSON.stringify(record) + '\n'; }
    await pipeline(Readable.from(lines()), res);
}

/** JSON, or NDJSON when `data` is async iterable. */
export async function send(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}): Promise<void> {
    if (isAsyncIterable(data)) return sendNdjson(res, status, data, headers);
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function limitLabel(limit: number): string {
    return limit % 1_000_000 === 0 ? `${limit / 1_000_000} MB` : `${Math.round(limit / 1000)} KB`;
}

/** One body reader for every route: reads lazily, caches the parsed object, enforces `limit` bytes. */
export function requestBody(req: IncomingMessage): (limit?: number) => Promise<Record<string, unknown>> {
    let parsed: Promise<Record<string, unknown>> | undefined;
    return (limit = DEFAULT_BODY_LIMIT) => parsed ??= readJsonObject(req, limit);
}

async function readJsonObject(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of req) { const value = Buffer.from(chunk); bytes += value.length; if (bytes > limit) throw new HttpError(413, `Request exceeds ${limitLabel(limit)}`); chunks.push(value); }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) return {};
    try {
        const value: unknown = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        return value as Record<string, unknown>;
    } catch { throw new HttpError(400, 'Expected a JSON object'); }
}

export function cursor(value: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
    const n = value === null ? fallback : Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new HttpError(400, 'Invalid pagination cursor or limit');
    return n;
}

export function positiveLimit(limit: number): number {
    if (!limit) throw new HttpError(400, 'limit must be positive');
    return limit;
}

export function idempotencyKey(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new HttpError(400, 'A nonempty idempotencyKey (maximum 160 characters) is required');
    return value;
}

export function draftMetadata(value: Record<string, unknown>): DraftMetadata {
    const result: DraftMetadata = {};
    for (const key of ['name', 'notes', 'groupId'] as const) if (value[key] !== undefined) {
        if (typeof value[key] !== 'string' || value[key].length > 20000) throw new HttpError(400, `Invalid ${key}`);
        result[key] = value[key] as string;
    }
    return result;
}
```

- [ ] **Step 2.6: Write `api/src/server/auth.ts`**

```ts
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { HttpError } from './errors.js';

/** Optional bearer token; comparison is length-checked then timing-safe. */
export function requireToken(req: IncomingMessage, token?: string): void {
    if (!token) return;
    const actual = Buffer.from(req.headers.authorization || ''), expected = Buffer.from('Bearer ' + token);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(401, 'Researcher access token required');
}

/** Writes from another origin are rejected; same-host http and https are accepted. */
export function requireSameOrigin(req: IncomingMessage): void {
    const method = req.method ?? 'GET';
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return;
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) throw new HttpError(403, 'Cross-origin writes are forbidden');
}
```

- [ ] **Step 2.7: Write `api/src/server/static.ts`**

```ts
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, extname, isAbsolute } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './errors.js';

const MIME_TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

/** Serves the built dashboard: traversal defence, SPA deep-link fallback and MIME map. */
export async function serveDashboard(req: IncomingMessage, res: ServerResponse, pathname: string, directory: string): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'Invalid path encoding'); }
    if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part === '..' || part.startsWith('.'))) throw new HttpError(404, 'Not found');
    const root = await realpath(directory), requested = resolve(root, '.' + decoded), rel = relative(root, requested);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new HttpError(404, 'Not found');
    let asset = requested;
    try { if (!(await stat(asset)).isFile()) throw new Error(); }
    catch { if (extname(decoded)) throw new HttpError(404, 'Asset not found'); asset = resolve(root, 'index.html'); }
    const actual = await realpath(asset), assetRelative = relative(root, actual);
    if (assetRelative.startsWith('..') || isAbsolute(assetRelative)) throw new HttpError(404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(asset)] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(asset));
}
```

- [ ] **Step 2.8: Write `api/src/server/configuration.ts`**

```ts
import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import { validateConfiguration } from '@sidechannel/domain/harness/config';
import { fieldErrors } from '@sidechannel/contracts/server/config-schema';
import type { HealthcareService } from '../healthcare/service.js';
import { validateAdaptionModelSelection } from './adaption-models.js';

export interface ConfigurationPipelineOptions {
    buildMetadata?: ExperimentConfig['build'];
    healthcare?: HealthcareService;
}

/** Build-metadata stamping, healthcare dataset resolution, schema validation and adaption-model admission. */
export function createConfigurationPipeline({ buildMetadata, healthcare }: ConfigurationPipelineOptions) {
    const withBuild = (input: unknown): unknown => input && typeof input === 'object' && !Array.isArray(input) ? { ...input, ...(buildMetadata ? { build: buildMetadata } : {}) } : input;
    function validate(input: unknown) {
        const validation = validateConfiguration(input), fieldIssues = fieldErrors(validation.errors);
        return { ...validation, fieldErrors: Object.fromEntries(fieldIssues.filter(issue => issue.path).map(issue => [issue.path, issue.message])), fieldIssues };
    }
    async function prepare(input: unknown) {
        let config = withBuild(input);
        try {
            if (healthcare) config = await healthcare.resolveConfiguration(config);
            else if ((config as ExperimentConfig)?.scenario?.version === 'healthcare-points-v0.3') throw new Error('scenario.datasetId: Healthcare catalog is unavailable; bootstrap the datasets');
        } catch (error) { const message = error instanceof Error ? error.message : 'Dataset resolution failed'; return { config, validation: { valid: false, errors: [message], fieldErrors: { 'scenario.datasetId': message }, fieldIssues: [{ path: 'scenario.datasetId', message }] } }; }
        const base = validate(config);
        const additional = base.valid ? await validateAdaptionModelSelection(config as ExperimentConfig) : [];
        if (!additional.length) return { config, validation: base };
        const issues = additional.map(message => ({ path: message.includes(':') ? message.split(':')[0]! : message.startsWith('model.') ? message.split(' ')[0]! : 'model.id', message }));
        return { config, validation: { ...base, valid: false, errors: [...base.errors, ...additional], fieldIssues: [...base.fieldIssues, ...issues], fieldErrors: { ...base.fieldErrors, ...Object.fromEntries(issues.map(issue => [issue.path, issue.message])) } } };
    }
    return { prepare, validate };
}

export type ConfigurationPipeline = ReturnType<typeof createConfigurationPipeline>;
```

- [ ] **Step 2.9: Rewire `api/src/server/index.ts` onto the new modules**

Apply exactly these edits (the request handler body keeps its current structure until Task 3):

1. Replace lines 1–17 (imports) with:

```ts
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ExperimentConfig, Run } from '@sidechannel/contracts/harness/contracts';
import type { EventQuery, EvidenceKind } from '@sidechannel/contracts/harness/repository';
import { defaultFixtureConfiguration, resolveConfiguration, resolvePair, seededOrder } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { configurationSchema } from '@sidechannel/contracts/server/config-schema';
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';
import { HealthcareService } from '../healthcare/service.js';
import { adaptionModelRoute } from './adaption-models.js';
import { requireSameOrigin, requireToken } from './auth.js';
import { createConfigurationPipeline } from './configuration.js';
import { HttpError, sendFailure } from './errors.js';
import { applySecurityHeaders, cursor, DEFAULT_BODY_LIMIT, draftMetadata, idempotencyKey, positiveLimit, requestBody, send } from './http.js';
import { serveDashboard } from './static.js';

export type { Draft } from '@sidechannel/contracts/harness/repository';
```

(`Readable`/`pipeline` stay because the extension NDJSON branch still uses them until Task 3 deletes that branch.)

2. Delete the local `class HttpError` (line 32) — imported now.
3. Delete the local `body`, `idempotency`, `cursor`, `metadata` functions (lines 34–51) — imported as `requestBody`, `idempotencyKey`, `cursor`, `draftMetadata`; rename their call sites:
   - `idempotency(b.idempotencyKey)` → `idempotencyKey(b.idempotencyKey)`
   - every `metadata(...)` → `draftMetadata(...)`
   - `if (!limit) throw new HttpError(400, 'limit must be positive');` → `positiveLimit(limit)` used inline: `const limit = positiveLimit(cursor(query.get('limit'), 50, 1000)), offset = cursor(query.get('offset'), 0);` (three sites: `/runs` listing, `events|memory`, `artifacts|reports|board`).
4. Delete the local `validate` (line 53) and `withBuild`/`prepare` (lines 64–76). Inside `createResearcherServer` add, immediately after the `healthcare` line:

```ts
    const pipeline = createConfigurationPipeline({ buildMetadata: options.buildMetadata, healthcare });
```

   and replace `await prepare(` with `await pipeline.prepare(` (2 sites: `/config/validate`, runs/pairs launch) and `validate(` with `pipeline.validate(` (3 sites: draft save, draft read, duplicate).
5. Replace lines 80–83 with `applySecurityHeaders(res);`.
6. Delete lines 84–92 (`send`); immediately after `applySecurityHeaders(res);` add:

```ts
            const reply = (status: number, data: unknown, headers?: Record<string, string>) => send(res, status, data, headers);
```

   and rename every remaining `send(` call in this function to `reply(`.
7. Replace the token block (lines 96–99) with `requireToken(req, options.token);`.
8. Replace the origin check (lines 100–101) with `const method = req.method ?? 'GET'; requireSameOrigin(req);`.
9. Replace lines 104–105 (`let parsed…` + `const input = …`) with:

```ts
                const input = requestBody(req);
```

10. Leave the extension dispatch (lines 216–228) unchanged; replace `body: ['GET','HEAD'].includes(method) ? {} : await input()` with `body: ['GET','HEAD'].includes(method) ? {} : await input(DEFAULT_BODY_LIMIT)`.
11. Replace the static block (lines 231–243) with:

```ts
            await serveDashboard(req, res, url.pathname, dashboardDirectory);
```

12. Replace the `catch` body (line 245) with:

```ts
        catch (error) { await sendFailure(res, error); }
```

- [ ] **Step 2.10: Run the tests to verify the extraction is behaviour-neutral**

```bash
node --import tsx --test api/src/server/errors.test.ts
node --import tsx --test api/src/server/route-contract.test.ts
npm run test --workspace @sidechannel/api
npm run check --workspace @sidechannel/api
npm run check --workspace @sidechannel/contracts
node scripts/verify-boundaries.mjs
```

Expected: PASS. `route-contract.test.ts` must pass **without** `UPDATE_ROUTE_CONTRACT`; any diff means the move changed behaviour.

- [ ] **Step 2.11: Commit**

```bash
git add packages/contracts/src/errors.ts packages/contracts/package.json api/src/server/http.ts api/src/server/auth.ts api/src/server/errors.ts api/src/server/static.ts api/src/server/configuration.ts api/src/server/errors.test.ts api/src/server/index.ts
git commit -m "refactor(api): extract http, auth, errors, static and configuration from the server module"
```

---

## Task 3: Per-resource routers; `index.ts` becomes wiring (T3a.3)

**Files:**
- Create: `api/src/server/launch.ts`, `api/src/server/routers/{workspace,config,drafts,runs,pairs,overview}.ts`
- Create: `tests/integration/api-routes.mongo.test.ts`
- Modify: `api/src/server/index.ts` (full rewrite, printed below)

**Interfaces:**
- Produces: `createLaunchService({ repository, pipeline, healthcare })` → `{ sourceDraft(input, runLaunchKey, config), freezeReference(run) }`; `createWorkspaceRouter({ demoMode })`, `createConfigRouter(pipeline)`, `createDraftsRouter({ repository, pipeline })`, `createRunsRouter({ repository, pipeline, launch, healthcare })`, `createPairsRouter({ repository, pipeline, launch })`, `createOverviewRouter(repository)` — all `ResearchRouteHandler`.
- Consumes: Task 2 modules; `RepositoryConflict`; `ResearcherRepository` (must expose `createPair`, `createRun`, `requestCancel`, `getRunByLaunchKey`, `listRuns`, `queryRuns`, `queryEvents`, `getEvent`, `getEvidencePage`, `getEvidenceItem`, `getRunSummary`, `getRun`, `saveDraft`, `listDrafts`, `getDraft`, `workerStatus`).
- Runs without Mongo (snapshot + api unit tests); `api-routes.mongo.test.ts` requires Mongo.
- **Effort:** ~1.5 dev-days. **Rollback:** `git revert` (see Rollback §Task 3).

- [ ] **Step 3.1: Write the failing Mongo-backed route test**

Create `tests/integration/api-routes.mongo.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createResearcherServer } from '../../api/src/server/index.js';

test('every resource router keeps its status codes and payload keys over Mongo', async () => {
    const uri = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';
    const repository = await MongoRepository.connect(uri, 'sidechannel_api_routes_' + randomUUID().replaceAll('-', ''));
    const server = createResearcherServer(repository);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const call = (path: string, init?: RequestInit) => fetch(base + path, init);
    const json = async (path: string, init?: RequestInit) => { const response = await call(path, init); return { status: response.status, body: await response.json() as Record<string, any> }; };
    const post = (path: string, body: unknown) => json(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
        const config = defaultFixtureConfiguration();
        assert.equal((await json('/workspace')).body.mode, 'research');
        assert.equal((await json('/config/default')).status, 200);
        assert.equal((await json('/config/schema')).status, 200);
        assert.equal((await post('/config/validate', { config })).body.valid, true);
        const draft = await post('/drafts', { id: 'draft-1', config, name: 'Pilot' });
        assert.equal(draft.status, 200);
        assert.equal((await post('/drafts', { id: 'draft-1', config, revision: 0 })).status, 409);
        assert.equal((await post('/drafts/draft-1/duplicate', {})).status, 201);
        assert.equal((await json('/drafts/draft-1')).status, 200);
        assert.equal((await json('/drafts/missing')).status, 404);
        assert.equal((await post('/runs', { config })).status, 400);
        const launched = await post('/runs', { config, idempotencyKey: 'mongo-route' });
        assert.equal(launched.status, 202);
        assert.equal((await post('/runs', { config, idempotencyKey: 'mongo-route' })).body.id, launched.body.id);
        const changed = defaultFixtureConfiguration(); changed.label = 'edited';
        assert.equal((await post('/runs', { config: changed, idempotencyKey: 'mongo-route' })).status, 409);
        const listing = await json('/runs?limit=1&offset=0');
        assert.deepEqual(Object.keys(listing.body).sort(), ['items', 'nextOffset', 'total']);
        assert.equal((await json('/runs?limit=0')).status, 400);
        assert.equal((await json('/runs/' + launched.body.id)).body.status, 'queued');
        assert.equal((await json('/runs/' + launched.body.id + '/progress')).body.rounds, 3);
        assert.deepEqual(Object.keys((await json('/runs/' + launched.body.id + '/events?limit=2')).body).sort(), ['events', 'hasMore', 'items', 'nextCursor']);
        assert.equal((await json('/runs/' + launched.body.id + '/artifacts/0')).status, 200);
        assert.equal((await json('/runs/' + launched.body.id + '/artifacts/99')).status, 404);
        assert.equal((await json('/runs/missing')).status, 404);
        await repository.appendEvent({ runId: launched.body.id, type: 'memory_updated', data: { note: 'one' } });
        const exported = await json('/runs/' + launched.body.id + '/export');
        assert.equal(exported.body.scope, 'complete-source-evidence');
        assert.deepEqual(exported.body.events.map((event: { type: string; sequence: number }) => [event.type, event.sequence]), [['memory_updated', 1]]);
        const pairs = await post('/pairs', { config, idempotencyKey: 'mongo-pair', pairingSeed: 7 });
        assert.equal(pairs.status, 202);
        assert.equal((await json('/pairs/pair-mongo-pair')).body.matched, true);
        assert.equal((await json('/pairs/pair-missing')).status, 404);
        const overview = await json('/overview');
        assert.deepEqual(Object.keys(overview.body).sort(), ['activity', 'attention', 'counts', 'observedAt', 'queue', 'queueTotal', 'recent', 'worker']);
        assert.equal((await call('/nope')).status, 404);
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await repository.db.dropDatabase();
        await repository.close();
    }
});
```

- [ ] **Step 3.2: Run it now to record the pre-refactor baseline**

```bash
docker compose up -d --wait mongo
npm run build
node --env-file-if-exists=.env --import tsx --test tests/integration/api-routes.mongo.test.ts
```

Expected: PASS against the *current* `index.ts`. This test cannot be red-green — the refactor is behaviour-preserving, so it is a characterization/regression gate rather than a TDD red. Record the pass; the identical command must still pass after Step 3.4, which is the evidence that the router extraction changed nothing over Mongo.

- [ ] **Step 3.3: Create the launch service**

Create `api/src/server/launch.ts`:

```ts
import { isDeepStrictEqual } from 'node:util';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import type { ResearcherRepository } from '@sidechannel/contracts/server/contracts';
import { resolveConfiguration } from '@sidechannel/domain/harness/config';
import type { HealthcareService } from '../healthcare/service.js';
import type { ConfigurationPipeline } from './configuration.js';
import { HttpError } from './errors.js';

export interface LaunchDependencies {
    repository: Pick<ResearcherRepository, 'getRunByLaunchKey' | 'getDraft' | 'createPair'>;
    pipeline: ConfigurationPipeline;
    healthcare?: HealthcareService;
}

/** Launch-time invariants shared by `/runs` and `/pairs`: draft freezing and idempotency identity. */
export function createLaunchService({ repository, pipeline, healthcare }: LaunchDependencies) {
    async function sourceDraft(input: Record<string, unknown>, runLaunchKey: string, config: unknown): Promise<Run['sourceDraft']> {
        if (input.sourceDraftId === undefined && input.sourceDraftRevision === undefined) return undefined;
        if (typeof input.sourceDraftId !== 'string' || !Number.isSafeInteger(input.sourceDraftRevision) || Number(input.sourceDraftRevision) < 1) throw new HttpError(400, 'Saved draft launches require sourceDraftId and sourceDraftRevision');
        const existing = await repository.getRunByLaunchKey(runLaunchKey);
        if (existing?.sourceDraft?.id === input.sourceDraftId && existing.sourceDraft.revision === input.sourceDraftRevision) return existing.sourceDraft;
        const draft = await repository.getDraft(input.sourceDraftId);
        if (!draft || draft.revision !== input.sourceDraftRevision) throw new HttpError(409, 'Source draft changed; reload and review its current revision');
        const preparedDraft = await pipeline.prepare(draft.config);
        if (!preparedDraft.validation.valid || !isDeepStrictEqual(resolveConfiguration(preparedDraft.config), resolveConfiguration(config))) throw new HttpError(409, 'Launch configuration differs from the selected saved draft');
        const { config: ignored, updatedAt, ...snapshot } = draft;
        return snapshot;
    }
    async function freezeReference(run: Run): Promise<Run> {
        const existing = await repository.getRunByLaunchKey(run.launchKey);
        if (existing) { if (existing.configHash !== run.configHash) throw new HttpError(409, 'Idempotency key conflicts with a different configuration'); run.id = existing.id; }
        await healthcare?.freezeRunReference(run);
        return run;
    }
    return { sourceDraft, freezeReference };
}
```

- [ ] **Step 3.4: Create the six routers and rewrite `index.ts`**

Create `api/src/server/routers/workspace.ts`:

```ts
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';

export function createWorkspaceRouter(options: { demoMode?: boolean }): ResearchRouteHandler {
    return async ({ method, path }) => method === 'GET' && path === '/workspace' ? { status: 200, data: { mode: options.demoMode ? 'demo' : 'research' } } : null;
}
```

Create `api/src/server/routers/config.ts`:

```ts
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { configurationSchema } from '@sidechannel/contracts/server/config-schema';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import type { ConfigurationPipeline } from '../configuration.js';

export function createConfigRouter(pipeline: ConfigurationPipeline): ResearchRouteHandler {
    return async request => {
        const { method, path } = request;
        if (method === 'GET' && path === '/config/default') return { status: 200, data: defaultFixtureConfiguration() };
        if (method === 'GET' && path === '/config/schema') return { status: 200, data: configurationSchema };
        if (method === 'POST' && path === '/config/validate') {
            const { config, validation } = await pipeline.prepare((await request.body()).config);
            return { status: 200, data: { ...validation, ...(validation.valid ? { config: resolveConfiguration(config) } : {}) } };
        }
        return null;
    };
}
```

Create `api/src/server/routers/drafts.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Draft } from '@sidechannel/contracts/harness/repository';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { HttpError } from '../errors.js';
import { draftMetadata } from '../http.js';
import type { ConfigurationPipeline } from '../configuration.js';

export interface DraftRoutesContext {
    repository: Pick<ResearcherRepository, 'listDrafts' | 'saveDraft' | 'getDraft' | 'getRun' | 'listRuns'>;
    pipeline: ConfigurationPipeline;
}

const DUPLICATE = /^\/(drafts|runs|pairs)\/([^/]+)\/duplicate$/;

/** Draft CRUD plus the cross-resource duplication endpoint (it always produces a draft). */
export function createDraftsRouter({ repository, pipeline }: DraftRoutesContext): ResearchRouteHandler {
    return async request => {
        const { method, path } = request;
        if (path === '/drafts' && method === 'GET') return { status: 200, data: await repository.listDrafts() };
        if (path === '/drafts' && method === 'POST') {
            const input = await request.body();
            if (input.config === undefined) throw new HttpError(400, 'config is required');
            const id = typeof input.id === 'string' && input.id.trim() ? input.id : randomUUID();
            if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0)) throw new HttpError(400, 'revision must be a nonnegative integer');
            const draft = await repository.saveDraft(id, input.config, input.revision as number | undefined, draftMetadata(input));
            return { status: 200, data: { ...draft, validation: pipeline.validate(draft.config) } };
        }
        const duplicate = path.match(DUPLICATE);
        if (duplicate && method === 'POST') {
            const input = await request.body(), sourceType = duplicate[1]!.slice(0, -1) as 'draft' | 'run' | 'pair', sourceId = decodeURIComponent(duplicate[2]!);
            const source = sourceType === 'draft' ? await repository.getDraft(sourceId) : sourceType === 'run' ? await repository.getRun(sourceId) : (await repository.listRuns()).find(run => run.pairId === sourceId);
            if (!source) throw new HttpError(404, 'Duplication source not found');
            const inherited = 'revision' in source ? draftMetadata(source as unknown as Record<string, unknown>) : source.sourceDraft ? draftMetadata(source.sourceDraft as unknown as Record<string, unknown>) : {};
            const draft = await repository.saveDraft(randomUUID(), (source as Draft | Run).config, undefined, { ...inherited, ...draftMetadata(input), lineage: { sourceType, sourceId, ...('revision' in source ? { sourceRevision: source.revision } : {}) } });
            return { status: 201, data: { ...draft, validation: pipeline.validate(draft.config) } };
        }
        if (path.startsWith('/drafts/') && method === 'GET') {
            const draft = await repository.getDraft(decodeURIComponent(path.slice(8)));
            if (!draft) throw new HttpError(404, 'Draft not found');
            return { status: 200, data: { ...draft, validation: pipeline.validate(draft.config) } };
        }
        return null;
    };
}
```

Create `api/src/server/routers/pairs.ts`:

```ts
import { isDeepStrictEqual } from 'node:util';
import { resolvePair, seededOrder } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import type { ConfigurationPipeline } from '../configuration.js';
import type { createLaunchService } from '../launch.js';
import { HttpError } from '../errors.js';
import { cursor, idempotencyKey } from '../http.js';

export interface PairRoutesContext {
    repository: Pick<ResearcherRepository, 'listRuns' | 'getRunSummary' | 'createPair'>;
    pipeline: ConfigurationPipeline;
    launch: ReturnType<typeof createLaunchService>;
}

const PAIR = /^\/pairs\/([^/]+)$/;

/** Deep key-path differences; the pair comparison reports them and refuses to call them matched. */
export function differences(left: unknown, right: unknown, path = ''): string[] {
    if (isDeepStrictEqual(left, right)) return [];
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) return [path];
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => differences((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
}

export function createPairsRouter({ repository, pipeline, launch }: PairRoutesContext): ResearchRouteHandler {
    return async request => {
        const { method, path } = request;
        if (path === '/pairs' && method === 'POST') {
            const input = await request.body(), key = idempotencyKey(input.idempotencyKey), { config, validation } = await pipeline.prepare(input.config);
            if (!validation.valid) return { status: 400, data: { error: validation.errors.join('; '), ...validation } };
            const sourceDraft = await launch.sourceDraft(input, key + ':0', config), source = sourceDraft ? { sourceDraft } : {};
            const configs = resolvePair(config), pairingSeed = cursor(String(input.pairingSeed ?? 42), 42), pairId = 'pair-' + key;
            const runs = seededOrder(['0', '1'], pairingSeed).map((index, pairPosition) => ({ ...createQueuedRun(configs[Number(index)]!, key + ':' + index, pairId), pairingSeed, pairPosition, ...source }));
            return { status: 202, data: await repository.createPair(await Promise.all(runs.map(run => launch.freezeReference(run)))) };
        }
        const pair = path.match(PAIR);
        if (!pair || method !== 'GET') return null;
        const pairId = decodeURIComponent(pair[1]!), runs = (await repository.listRuns()).filter(run => run.pairId === pairId);
        if (!runs.length) throw new HttpError(404, 'Pair not found');
        const configurationDifferences = runs.length === 2 ? differences(runs[0]!.config, runs[1]!.config) : [];
        return { status: 200, data: { pairId, runs: await Promise.all(runs.map(run => repository.getRunSummary(run.id))), configurationDifferences, matched: runs.length === 2 && configurationDifferences.every(path => path.startsWith('condition.')) } };
    };
}
```

Create `api/src/server/routers/overview.ts`:

```ts
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';

const RUN_STATUSES = ['queued', 'running', 'reporting', 'stopping', 'completed', 'cancelled', 'failed', 'interrupted'];

export function createOverviewRouter(repository: Pick<ResearcherRepository, 'queryRuns' | 'workerStatus'>): ResearchRouteHandler {
    return async ({ method, path }) => {
        if (method !== 'GET' || path !== '/overview') return null;
        const [activity, recent, attention, counts, worker, queue] = await Promise.all([
            repository.queryRuns({ status: 'queued,running,reporting,stopping', offset: 0, limit: 20 }),
            repository.queryRuns({ status: 'completed,cancelled', offset: 0, limit: 10 }),
            repository.queryRuns({ status: 'failed,interrupted', offset: 0, limit: 10 }),
            Promise.all(RUN_STATUSES.map(async status => [status, (await repository.queryRuns({ status, offset: 0, limit: 1 })).total] as const)),
            repository.workerStatus(),
            repository.queryRuns({ status: 'queued', order: 'queue', offset: 0, limit: 20 }),
        ]);
        return { status: 200, data: { observedAt: new Date().toISOString(), activity: activity.items, recent: recent.items, attention: attention.items, counts: Object.fromEntries(counts), worker, queue: queue.items, queueTotal: queue.total } };
    };
}
```

Create `api/src/server/routers/runs.ts`:

```ts
import { resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { EventQuery, EvidenceKind } from '@sidechannel/contracts/harness/repository';
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import type { HealthcareService } from '../../healthcare/service.js';
import type { ConfigurationPipeline } from '../configuration.js';
import { HttpError } from '../errors.js';
import { cursor, idempotencyKey, positiveLimit } from '../http.js';
import type { createLaunchService } from '../launch.js';

export interface RunRoutesContext {
    repository: ResearcherRepository;
    pipeline: ConfigurationPipeline;
    launch: ReturnType<typeof createLaunchService>;
    healthcare?: HealthcareService;
}

const RUN = /^\/runs\/([^/]+)(?:\/(progress|events|export|cancel|board|memory|artifacts|reports))?$/;
const RUN_EVENT = /^\/runs\/([^/]+)\/events\/([^/]+)$/;
const RUN_EVIDENCE = /^\/runs\/([^/]+)\/(board|artifacts|reports)\/([^/]+)$/;

/** Run collection, launch, inspection operations, evidence links and the complete-source export. */
export function createRunsRouter({ repository, pipeline, launch, healthcare }: RunRoutesContext): ResearchRouteHandler {
    return async request => {
        const { method, path, query } = request;
        if (path === '/runs' && method === 'GET') {
            if (!query.size) return { status: 200, data: await repository.listRuns() };
            const limit = positiveLimit(cursor(query.get('limit'), 50, 1000)), offset = cursor(query.get('offset'), 0);
            const filter = Object.fromEntries(['status', 'model', 'condition', 'scenario', 'designation'].filter(key => query.has(key)).map(key => [key, query.get(key)!]));
            const result = await repository.queryRuns({ ...filter, limit, offset });
            return { status: 200, data: { ...result, nextOffset: offset + limit < result.total ? offset + limit : null } };
        }
        if (path === '/runs' && method === 'POST') {
            const input = await request.body(), key = idempotencyKey(input.idempotencyKey), { config, validation } = await pipeline.prepare(input.config);
            if (!validation.valid) return { status: 400, data: { error: validation.errors.join('; '), ...validation } };
            const sourceDraft = await launch.sourceDraft(input, key, config), source = sourceDraft ? { sourceDraft } : {};
            return { status: 202, data: await repository.createRun(await launch.freezeReference({ ...createQueuedRun(resolveConfiguration(config), key), ...source })) };
        }
        const eventLink = path.match(RUN_EVENT);
        if (eventLink && method === 'GET') {
            const event = await repository.getEvent(decodeURIComponent(eventLink[1]!), decodeURIComponent(eventLink[2]!));
            if (!event) throw new HttpError(404, 'Event not found in this run');
            return { status: 200, data: event };
        }
        const evidenceLink = path.match(RUN_EVIDENCE);
        if (evidenceLink && method === 'GET') {
            const item = await repository.getEvidenceItem(decodeURIComponent(evidenceLink[1]!), evidenceLink[2]! as EvidenceKind, decodeURIComponent(evidenceLink[3]!));
            if (!item) throw new HttpError(404, 'Evidence not found in this run');
            return { status: 200, data: item };
        }
        const match = path.match(RUN);
        if (!match) return null;
        const id = decodeURIComponent(match[1]!), op = match[2];
        const summary = await repository.getRunSummary(id);
        if (!summary) throw new HttpError(404, 'Run not found');
        if (method === 'POST' && op === 'cancel') return { status: 202, data: await repository.requestCancel(id) };
        if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
        if (op === 'progress') return { status: 200, data: { ...summary, observedAt: new Date().toISOString(), executionPhase: summary.status === 'reporting' ? 'report' : 'action', rounds: summary.config.scheduler.rounds } };
        if (op === 'events' || op === 'memory') {
            const after = cursor(query.get('after'), 0), limit = positiveLimit(cursor(query.get('limit'), 200, 1000));
            if (query.has('phase') && !['action', 'report'].includes(query.get('phase')!)) throw new HttpError(400, 'phase must be action or report');
            const filter: EventQuery = { after, limit: limit + 1, ...(query.get('actor') ? { actor: query.get('actor')! } : {}), ...(query.get('phase') ? { phase: query.get('phase')! } : {}), ...(query.get('type') ? { type: query.get('type')! } : {}), ...(query.has('from') ? { from: cursor(query.get('from'), 0) } : {}), ...(query.has('to') ? { to: cursor(query.get('to'), 0) } : {}) };
            if (op === 'memory') { filter.type = query.get('type') ?? 'memory_updated'; filter.offset = cursor(query.get('offset'), 0); }
            const rows = await repository.queryEvents(id, filter), events = rows.slice(0, limit);
            return { status: 200, data: { events, items: events, nextCursor: events.at(-1)?.sequence ?? after, hasMore: rows.length > limit, ...(op === 'memory' ? { nextOffset: rows.length > limit ? (filter.offset ?? 0) + limit : null } : {}) } };
        }
        if (op === 'artifacts' || op === 'reports' || op === 'board') {
            const offset = cursor(query.get('offset'), 0), limit = positiveLimit(cursor(query.get('limit'), 100, 1000));
            const result = await repository.getEvidencePage(id, op, offset, limit), paginated = { ...result, nextOffset: offset + limit < result.total ? offset + limit : null };
            if (op !== 'board') return { status: 200, data: paginated };
            const deliveries = await repository.queryEvents(id, { type: 'board_delivery', after: cursor(query.get('afterDelivery'), 0), limit: 1000 });
            return { status: 200, data: { ...paginated, posts: result.items, deliveries, nextDeliveryCursor: deliveries.at(-1)?.sequence ?? cursor(query.get('afterDelivery'), 0), deliveriesMayHaveMore: deliveries.length === 1000 } };
        }
        const run = (await repository.getRun(id))!;
        if (!op) return { status: 200, data: run };
        const events = []; let after = 0;
        while (true) { const rows = await repository.listEvents(id, after, 1000); events.push(...rows); if (rows.length < 1000) break; after = rows.at(-1)!.sequence; }
        const researcherEvaluation = await healthcare?.researcherExport(run, repository);
        return { status: 200, data: { schemaVersion: 1, scope: 'complete-source-evidence', exportedAt: new Date().toISOString(), run, events, ...(researcherEvaluation ? { researcherEvaluation } : {}) } };
    };
}
```

Replace `api/src/server/index.ts` with:

```ts
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { HealthcareService } from '../healthcare/service.js';
import { adaptionModelRoute } from './adaption-models.js';
import { requireSameOrigin, requireToken } from './auth.js';
import { createConfigurationPipeline } from './configuration.js';
import { HttpError, sendFailure } from './errors.js';
import { applySecurityHeaders, requestBody, send } from './http.js';
import { createLaunchService } from './launch.js';
import { createConfigRouter } from './routers/config.js';
import { createDraftsRouter } from './routers/drafts.js';
import { createOverviewRouter } from './routers/overview.js';
import { createPairsRouter } from './routers/pairs.js';
import { createRunsRouter } from './routers/runs.js';
import { createWorkspaceRouter } from './routers/workspace.js';
import { serveDashboard } from './static.js';

export type { Draft } from '@sidechannel/contracts/harness/repository';

export interface ResearcherServerOptions {
    /** Explicitly identifies the simulated, reset-on-restart acceptance workspace. */
    demoMode?: boolean;
    token?: string;
    host?: string;
    buildMetadata?: ExperimentConfig['build'];
    extensionHandlers?: ResearchRouteHandler[];
    dashboardDirectory?: string;
    healthcareCatalog?: HealthcareCatalog;
}

export function createResearcherServer(repository: ResearcherRepository, options: ResearcherServerOptions = {}): Server {
    const healthcare = options.healthcareCatalog ? new HealthcareService(options.healthcareCatalog) : undefined;
    const pipeline = createConfigurationPipeline({ buildMetadata: options.buildMetadata, healthcare });
    const launch = createLaunchService({ repository, pipeline, healthcare });
    const routers: ResearchRouteHandler[] = [
        createWorkspaceRouter({ demoMode: options.demoMode }),
        createConfigRouter(pipeline),
        createDraftsRouter({ repository, pipeline }),
        createRunsRouter({ repository, pipeline, launch, healthcare }),
        createPairsRouter({ repository, pipeline, launch }),
        createOverviewRouter(repository),
        adaptionModelRoute,
        ...(healthcare ? [healthcare.routes(repository)] : []),
        ...(options.extensionHandlers ?? []),
    ];
    const dashboardDirectory = options.dashboardDirectory ?? process.env.DASHBOARD_DIST_DIR ?? fileURLToPath(new URL('../../../dashboard/dist/', import.meta.url));
    return createServer(async (req, res) => {
        try {
            applySecurityHeaders(res);
            const url = new URL(req.url || '/', 'http://localhost');
            if (!url.pathname.startsWith('/api/')) return await serveDashboard(req, res, url.pathname, dashboardDirectory);
            requireToken(req, options.token);
            requireSameOrigin(req);
            const request = { method: req.method ?? 'GET', path: url.pathname.slice(4), query: url.searchParams, body: requestBody(req) };
            for (const router of routers) { const result = await router(request); if (result) return await send(res, result.status, result.data, result.headers); }
            throw new HttpError(404, 'API route not found');
        } catch (error) { await sendFailure(res, error); }
    });
}
```

- [ ] **Step 3.5: Run the tests to verify routers are behaviour-neutral**

```bash
node --import tsx --test api/src/server/route-contract.test.ts
node --import tsx --test api/src/server/server.test.ts
node --import tsx --test api/src/server/adaption-models.test.ts
node --import tsx --test api/src/healthcare/healthcare.test.ts
npm run test --workspace @sidechannel/api
npm run check --workspace @sidechannel/api
wc -l api/src/server/index.ts
```

Expected: PASS everywhere; `wc -l` reports fewer than 80 lines for `index.ts`. The snapshot must pass without re-recording.

- [ ] **Step 3.6: Run the Mongo route test**

```bash
npm run build
node --env-file-if-exists=.env --import tsx --test tests/integration/api-routes.mongo.test.ts
```

Expected: PASS (1 test). This is the only WS3a test that needs Mongo.

- [ ] **Step 3.7: Commit**

```bash
git add api/src/server/launch.ts api/src/server/routers api/src/server/index.ts tests/integration/api-routes.mongo.test.ts
git commit -m "refactor(api): per-resource routers; index.ts is wiring plus one error boundary"
```

---

## Task 4: One route-handler contract, one body reader, no synthetic `IncomingMessage` (T3a.4)

**Files:**
- Modify: `packages/contracts/src/server/contracts.ts`
- Modify: `api/src/routes/jev-routes.ts`, `api/src/routes/review-routes.ts`, `api/src/routes/jev-extension.ts`, `api/src/routes/oversight.ts`
- Modify: `api/src/healthcare/service.ts` (one line, ownership note in Self-review)
- Modify: `tests/integration/analysis-jev-backend.test.ts`, `tests/integration/analysis-review-filtering.test.ts`, `tests/integration/oversight-reviews.test.ts`

**Interfaces:**
- Produces in `@sidechannel/contracts/server/contracts`:

```ts
export interface ResearchRouteRequest {
    method: string;
    /** Path below `/api`, e.g. `/runs/:id/export`; never includes the `/api` prefix. */
    path: string;
    query: URLSearchParams;
    /** Reads and parses the JSON object body once, enforcing `limit` bytes (default 2 MB). The first limit wins. */
    body(limit?: number): Promise<Record<string, unknown>>;
}
export interface ResearchRouteResult { status: number; data: unknown; headers?: Record<string, string> }
export type ResearchRouteHandler = (request: ResearchRouteRequest) => Promise<ResearchRouteResult | null>;
```

- Produces: `REVIEW_BODY_LIMIT = 1_000_000` from `api/src/routes/review-routes.js`; `createAnalysisRouteHandler(service): ResearchRouteHandler`; `createReviewRouteHandler(service, repository: Pick<AnalysisRepository, 'getJob'>): ResearchRouteHandler`.
- Consumes: `DEFAULT_BODY_LIMIT` / `HttpError` from `api/src/server/http.js` / `errors.js` (services may import their own modules).
- Runs without Mongo.
- **Effort:** ~1 dev-day. **Rollback:** `git revert` (see Rollback §Task 4).

- [ ] **Step 4.1: Write the failing body-limit test**

Create `api/src/routes/review-routes.body.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { MemoryReviewStore } from '@sidechannel/persistence/analysis/review-repository';
import { AnalysisService } from '@sidechannel/domain/analysis/jev-service';
import { createResearcherServer } from '../server/index.js';
import { createJevRouteExtension } from './jev-extension.js';
import { createReviewService } from './review-routes.js';

test('review bodies are capped at 1 MB while core and Jev bodies keep 2 MB', async () => {
    const source = new InMemoryRepository(), repository = new InMemoryAnalysisRepository();
    const service = new AnalysisService(repository, source), reviews = createReviewService(repository, new MemoryReviewStore());
    const server = createResearcherServer(source, { extensionHandlers: [createJevRouteExtension(service, reviews)] });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const post = (path: string, body: string) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    try {
        const review = await post('/jev/analyses/missing/reviews', JSON.stringify({ note: 'x'.repeat(1_100_000) }));
        assert.equal(review.status, 413);
        assert.match(await review.text(), /exceeds 1 MB/);
        const core = await post('/drafts', JSON.stringify({ id: 'd', config: { note: 'x'.repeat(2_100_000) } }));
        assert.equal(core.status, 413);
        assert.match(await core.text(), /exceeds 2 MB/);
        const jev = await post('/jev/codebooks', JSON.stringify({ name: 'x'.repeat(2_100_000) }));
        assert.equal(jev.status, 413);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
```

- [ ] **Step 4.2: Run it to verify it fails**

```bash
node --import tsx --test api/src/routes/review-routes.body.test.ts
```

Expected: FAIL — the review POST returns 400 (`Review request exceeds 1 MB` reaches the message-regex mapper as a plain `Error`), and `createJevRouteExtension` still builds a synthetic `IncomingMessage`. This test pins the one documented status correction (400 → 413 for review bodies above 1 MB).

- [ ] **Step 4.3: Replace the contracts request/result types**

In `packages/contracts/src/server/contracts.ts`, delete lines 21–25 (`ResearchRouteRequest`, `ResearchRouteResult`, `ResearchRouteHandler`) and append:

```ts
export interface ResearchRouteRequest {
    method: string;
    /** Path below `/api`, e.g. `/runs/:id/export`; never includes the `/api` prefix. */
    path: string;
    query: URLSearchParams;
    /** Reads and parses the JSON object body once, enforcing `limit` bytes (default 2 MB). The first limit wins. */
    body(limit?: number): Promise<Record<string, unknown>>;
}

export interface ResearchRouteResult { status: number; data: unknown; headers?: Record<string, string> }

export type ResearchRouteHandler = (request: ResearchRouteRequest) => Promise<ResearchRouteResult | null>;
```

- [ ] **Step 4.4: Rewrite `api/src/routes/jev-routes.ts`**

Replace the file with:

```ts
import type { BehaviorDefinition } from '@sidechannel/contracts/analysis/evidence-contracts';
import { AnalysisNotFound, AnalysisValidation, type PageOptions } from '@sidechannel/contracts/analysis/jev-repository';
import { AnalysisService } from '@sidechannel/domain/analysis/jev-service';
import type { LaunchInput, PreviewInput } from '@sidechannel/contracts/analysis/jev-service';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';

function page(query: URLSearchParams): PageOptions {
    const v = query.get('limit'), limit = v === null ? 100 : Number(v);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new AnalysisValidation('Limit must be an integer from 1 to 500');
    return { limit, ...(query.get('after') ? { after: query.get('after')! } : {}) };
}

function decode(value: string): string {
    try { const id = decodeURIComponent(value); if (!id || id.length > 200) throw new Error(); return id; }
    catch { throw new AnalysisValidation('Invalid encoded resource ID'); }
}

/** Composes with the researcher API's authentication, origin checks and single error boundary. */
export function createAnalysisRouteHandler(service: AnalysisService): ResearchRouteHandler {
    return async request => {
        const { method, path, query } = request, repo = service.repository, json = () => request.body();
        if (path === '/analyses' && method === 'GET') return { status: 200, data: await repo.listAllJobs(page(query)) };
        if (path === '/codebooks') {
            if (method === 'GET') return { status: 200, data: await repo.listCodebooks(page(query)) };
            if (method === 'POST') return { status: 201, data: await service.createCodebook(await json() as unknown as { name: string; creator: string; definitions: BehaviorDefinition[] }) };
        }
        const revisions = path.match(/^\/codebooks\/([^/]+)\/revisions$/);
        if (revisions && method === 'GET') { const id = decode(revisions[1]!); if (!await repo.getCodebook(id)) throw new AnalysisNotFound('Codebook not found'); return { status: 200, data: await repo.listRevisions(id, page(query)) }; }
        const codebook = path.match(/^\/codebooks\/([^/]+)(?:\/revisions\/([^/]+))?$/);
        if (codebook) {
            const id = decode(codebook[1]!);
            if (method === 'GET') { const found = codebook[2] ? await repo.getRevision(id, decode(codebook[2])) : await repo.getCodebook(id); if (!found) throw new AnalysisNotFound('Codebook or revision not found'); return { status: 200, data: found }; }
            if (method === 'PATCH' && !codebook[2]) return { status: 200, data: await service.reviseCodebook(id, await json() as unknown as Parameters<AnalysisService['reviseCodebook']>[1]) };
        }
        const preview = path.match(/^\/runs\/([^/]+)\/analyses\/preview\/windows\/([^/]+)$/);
        if (preview && method === 'POST') return { status: 200, data: await service.previewWindow(decode(preview[1]!), decode(preview[2]!), await json() as unknown as PreviewInput & { previewHash: string }) };
        const run = path.match(/^\/runs\/([^/]+)\/analyses(?:\/(preview))?$/);
        if (run) {
            const id = decode(run[1]!);
            if (method === 'GET' && !run[2]) return { status: 200, data: await repo.listJobs(id, page(query)) };
            if (method === 'POST') { const input = await json(); return run[2] ? { status: 200, data: await service.preview(id, input as unknown as PreviewInput) } : { status: 202, data: await service.launch(id, input as unknown as LaunchInput) }; }
        }
        const job = path.match(/^\/analyses\/([^/]+)(?:\/(windows|results|attempts|cancel|retry|export)(?:\/([^/]+))?)?$/);
        if (!job) return null; const id = decode(job[1]!), op = job[2]; if (job[3] && op !== 'windows') return null;
        await service.getJob(id);
        if (method === 'GET' && !op) return { status: 200, data: await service.getJob(id) };
        if (method === 'GET' && op === 'windows') {
            if (job[3]) return { status: 200, data: await service.getWindow(id, decode(job[3])) };
            const withResults = query.get('withResults'); if (withResults !== null && withResults !== 'true' && withResults !== 'false') throw new AnalysisValidation('withResults must be true or false');
            const windows = await repo.listWindows(id, page(query)); if (withResults !== 'true') return { status: 200, data: windows };
            const results = await repo.resultsForWindows(id, windows.items.map(w => w.id));
            return { status: 200, data: { ...windows, items: windows.items.map(w => ({ ...w, results: results.filter(r => r.windowId === w.id) })) } };
        }
        if (method === 'GET' && op === 'results') return { status: 200, data: await repo.listResults(id, { ...page(query), ...(query.get('windowId') ? { windowId: query.get('windowId')! } : {}) }) };
        if (method === 'GET' && op === 'attempts') return { status: 200, data: await repo.listAttempts(id, page(query)) };
        if (method === 'POST' && op === 'cancel') return { status: 202, data: await service.cancel(id) };
        if (method === 'POST' && op === 'retry') return { status: 202, data: await service.retry(id) };
        if (method === 'GET' && op === 'export') return { status: 200, headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': `attachment; filename="${id.replace(/[^a-zA-Z0-9_-]/g, '')}.ndjson"` }, data: service.exportAnalysis(id) };
        return null;
    };
}
```

- [ ] **Step 4.5: Rewrite `api/src/routes/review-routes.ts` (contract only; keep the current error mapping until Task 5)**

Replace the file with:

```ts
import type { AnalysisRepository } from '@sidechannel/contracts/analysis/jev-repository';
import { ReviewService } from '@sidechannel/domain/analysis/jev-reviews';
import type { ReviewContext, ReviewListFilter, ReviewQueueFilter } from '@sidechannel/contracts/analysis/jev-reviews';
import type { ReviewStore } from '@sidechannel/contracts/analysis/review-repository';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';

/** Review bodies stay bounded at 1 MB; core and Jev routes keep the 2 MB default. */
export const REVIEW_BODY_LIMIT = 1_000_000;

export async function reviewContext(repository: AnalysisRepository, analysisId: string): Promise<ReviewContext> {
    const job = await repository.getJob(analysisId);
    if (!job) throw new Error('Analysis not found');
    const windows: ReviewContext['windows'] = [];
    let after: string | undefined;
    do {
        const page = await repository.listWindows(analysisId, { after, limit: 500 });
        windows.push(...page.items.map(w => ({ id: w.id, eventIds: w.eventIds, stepIds: w.stepIds, probabilities: {} })));
        if (windows.length > 100000) throw new Error('Review selection supports at most 100000 windows; narrow the analysis range');
        after = page.nextCursor ?? undefined;
    } while (after);
    const byId = new Map(windows.map(w => [w.id, w]));
    after = undefined;
    do {
        const page = await repository.listResults(analysisId, { after, limit: 500 });
        for (const result of page.items) { const window = byId.get(result.windowId); if (window) window.probabilities[result.codeId] = result.probability; }
        after = page.nextCursor ?? undefined;
    } while (after);
    return { analysisId, runId: job.runId, definitionRevision: job.manifest.codebook.id, evidenceRevision: job.manifest.source.evidenceHash, codeIds: job.manifest.codebook.definitions.filter(d => d.enabled && !d.archived).map(d => d.id), windows };
}

export function createReviewService(repository: AnalysisRepository, store: ReviewStore) {
    return new ReviewService(store, (id: string) => reviewContext(repository, id), async (analysisId: string, windowId: string) => {
        const window = await repository.getWindow(analysisId, windowId);
        return window ? { id: window.id, eventIds: window.eventIds, stepIds: window.stepIds, probabilities: {} } : null;
    });
}

export function createReviewRouteHandler(service: ReviewService, repository: Pick<AnalysisRepository, 'getJob'>): ResearchRouteHandler {
    return async request => {
        const { method, path, query } = request;
        const match = path.match(/^\/analyses\/([^/]+)\/(reviews|review-batches)(?:\/([^/]+))?$/);
        if (!match) return null;
        // Before this refactor every non-GET body was parsed before routing, so size and syntax
        // errors outrank existence errors. Read the body first to keep that precedence.
        const payload = method === 'POST' ? await request.body(REVIEW_BODY_LIMIT) : undefined;
        try {
            const id = decodeURIComponent(match[1]!), op = match[2]!, batchId = match[3] && decodeURIComponent(match[3]);
            if (!await repository.getJob(id)) return { status: 404, data: { error: 'Analysis not found' } };
            const after = query.get('after') ?? undefined, limit = Number(query.get('limit') ?? 100);
            if (op === 'reviews' && !batchId) {
                if (method === 'GET') {
                    const filter: ReviewListFilter = {};
                    for (const key of ['windowId', 'reviewer', 'subjectId', 'codeId'] as const) if (query.has(key)) filter[key] = query.get(key)!;
                    if (query.has('scope')) filter.scope = query.get('scope') as ReviewListFilter['scope'];
                    if (query.has('latest')) { const value = query.get('latest'); if (value !== 'true' && value !== 'false') throw new Error('latest must be true or false'); filter.latest = value === 'true'; }
                    return { status: 200, data: await service.list(id, after, limit, filter) };
                }
                if (method === 'POST') return { status: 201, data: await service.save(id, payload!) };
            }
            if (op === 'review-batches') {
                if (method === 'GET') return { status: 200, data: batchId ? await service.getBatch(id, batchId, { after, limit, reviewer: query.get('reviewer') || undefined, filter: (query.get('filter') ?? 'all') as ReviewQueueFilter }) : await service.listBatches(id, after, limit) };
                if (method === 'POST' && !batchId) return { status: 201, data: await service.createBatch(id, payload!) };
            }
            return { status: 405, data: { error: 'Method not allowed' } };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Review request failed';
            return { status: /conflict|stale/.test(message) ? 409 : /not found/.test(message) ? 404 : 400, data: { error: message } };
        }
    };
}
```

- [ ] **Step 4.6: Rewrite `createJevRouteExtension` in `api/src/routes/jev-extension.ts`**

Delete the `Readable` / `IncomingMessage` imports and the synthetic stream; replace the handler with (keep `createJevExtension`'s post-WS2 constructor wiring exactly as WS2 left it):

```ts
export function createJevRouteExtension(service: AnalysisService, reviews: ReturnType<typeof createReviewService>): ResearchRouteHandler {
    const analysisHandler = createAnalysisRouteHandler(service), reviewHandler = createReviewRouteHandler(reviews, service.repository);
    return async request => {
        if (!request.path.startsWith('/jev/')) return null;
        const forwarded = { ...request, path: request.path.slice('/jev'.length) };
        if (forwarded.path === '/codebooks' && request.method === 'GET') await service.seedCodebook();
        const exported = forwarded.path.match(/^\/analyses\/([^/]+)\/export$/);
        if (exported && request.method === 'GET') {
            const id = decodeURIComponent(exported[1]!); await service.getJob(id);
            async function* records() { yield* service.exportAnalysis(id); yield* reviews.export(id); }
            return { status: 200, data: records() };
        }
        return await reviewHandler(forwarded) ?? await analysisHandler(forwarded) ?? { status: 404, data: { error: 'Jev route not found' } };
    };
}
```

- [ ] **Step 4.7: Adapt `api/src/routes/oversight.ts` and `api/src/healthcare/service.ts`**

In `api/src/routes/oversight.ts`:

1. Delete `interface Request { … }` (line 10) and import `type { ResearchRouteRequest, ResearchRouteResult } from '@sidechannel/contracts/server/contracts';`.
2. Change the handler signature line to:

```ts
export function createOversightHandler(repository: Repository, store: ResearchStore) {
    return async (request: ResearchRouteRequest): Promise<ResearchRouteResult | null> => {
        const { method, path, query } = request;
        const body = () => request.body();
```

3. Replace the four body uses: `saveRunOutcomeReview(repository, store, runId, body)` → `saveRunOutcomeReview(repository, store, runId, await body())`; `saveDefinition(store, body)` → `saveDefinition(store, await body())`; `createMonitorPreview(repository, store, body)` → `createMonitorPreview(repository, store, await body())`; `launchMonitor(repository, store, body)` → `launchMonitor(repository, store, await body())`.
4. Delete the `if (error instanceof OversightError) return …` branch (line 69); the shared boundary maps `OversightError` by its typed status with the identical `{ error }` payload. Keep the `ZodError` branch unchanged (it returns `{ error, issues }`).

In `api/src/healthcare/service.ts`, line 24 (`researcherExport`), replace `body: {}` with `body: async () => ({})`.

- [ ] **Step 4.8: Update the three integration tests to the new request shape**

`tests/integration/analysis-jev-backend.test.ts` — replace the block from `const f = await fixture(), handler = createAnalysisRouteHandler(f.service);` through the end of that test with:

```ts
    const f = await fixture(), handler = createAnalysisRouteHandler(f.service);
    const call = (path: string, method = 'GET', value?: unknown) => handler({ method, path, query: new URL('http://localhost' + path).searchParams, body: async () => value as Record<string, unknown> ?? {} });
    await assert.rejects(f.service.preview(f.run.id, { codebookId: f.codebook.id, settings: { window: { size: 0 } } }), AnalysisValidation);
    await assert.rejects(call(`/analyses/${f.job.id}/windows?limit=0`), AnalysisValidation);
    const windows = await call(`/analyses/${f.job.id}/windows?limit=1`); assert.equal(windows!.status, 200);
    const exported = await call(`/analyses/${f.job.id}/export`); assert.equal(exported!.headers!['Content-Type'], 'application/x-ndjson; charset=utf-8');
    const overview = await call('/analyses?limit=1'); assert.equal((overview!.data as { items: unknown[] }).items.length, 1);
    const revisions = await call(`/codebooks/${f.codebook.id}/revisions`); assert.equal((revisions!.data as { items: unknown[] }).items.length, 1);
    const window = (await f.repository.listWindows(f.job.id)).items[0]!;
    const previewed = await call(`/runs/${f.run.id}/analyses/preview/windows/${window.id}`, 'POST', { codebookId: f.codebook.id, previewHash: f.preview.previewHash });
    assert.equal((previewed!.data as { input: { hash: string } }).input.hash, window.inputHash);
    await assert.rejects(f.service.previewWindow(f.run.id, window.id, { codebookId: f.codebook.id, previewHash: 'stale' }), AnalysisConflict);
    assert.equal(await call(`/analyses/${f.job.id}/cancel/extra`, 'POST'), null);
    await assert.rejects(call('/analyses/%ZZ'), AnalysisValidation);
    await new AnalysisWorker(f.repository, { provider: { classify: async r => response(r) } }).runOnce();
    const joined = await call(`/analyses/${f.job.id}/windows?withResults=true&limit=1`);
    const item = (joined!.data as { items: { results: unknown[]; input?: unknown }[] }).items[0]!; assert.equal(item.results.length, 2); assert.equal(item.input, undefined);
```

and delete the now-unused `Readable`/`IncomingMessage` imports at the top of that file.

`tests/integration/analysis-review-filtering.test.ts` — replace the `const get = …` line with:

```ts
    const get = (path: string) => handler({ method: 'GET', path: `/analyses/${context.analysisId}/${path}`, query: new URL(`http://local/api/analyses/${context.analysisId}/${path}`).searchParams, body: async () => ({}) });
```

and change the three `.body` assertions in that test to `.data`; delete the now-unused `import type { IncomingMessage } from 'node:http';` line at the top of the file.

`tests/integration/oversight-reviews.test.ts` — replace the first `call` helper (line 125) with:

```ts
    const call = (method: string, suffix: string, payload: unknown = {}, query = new URLSearchParams()) => handler({ method, path: prefix + suffix, body: async () => payload as Record<string, unknown>, query });
```

replace the second `call` helper (line 167) with:

```ts
    const call = (suffix: string, query: Record<string, string> = {}) => handler({ method: 'GET', path: `/runs/${f.run.id}/reviews${suffix}`, body: async () => ({}), query: new URLSearchParams(query) });
```

and at the three remaining direct calls (lines 136, 152 and 200) pass `body: async () => ({})` instead of `body: {}`.

- [ ] **Step 4.9: Run the tests to verify the unified contract**

```bash
node --import tsx --test api/src/routes/review-routes.body.test.ts
node --import tsx --test api/src/server/route-contract.test.ts
node --import tsx --test api/src/server/server.test.ts
npm run test --workspace @sidechannel/api
npm run build
node --import tsx --test tests/integration/analysis-jev-api.test.ts
node --import tsx --test tests/integration/analysis-jev-backend.test.ts
node --import tsx --test tests/integration/analysis-review-filtering.test.ts
node --import tsx --test tests/integration/oversight-reviews.test.ts
npm run check
npm run lint
```

Expected: PASS. `review-routes.body.test.ts` passes now that the review cap returns 413; the snapshot is unchanged (wire paths and payloads identical).

- [ ] **Step 4.10: Commit**

```bash
git add packages/contracts/src/server/contracts.ts api/src/routes api/src/healthcare/service.ts tests/integration/analysis-jev-backend.test.ts tests/integration/analysis-review-filtering.test.ts tests/integration/oversight-reviews.test.ts
git commit -m "refactor(api): one route-handler contract and one body reader with per-route limits"
```

---

## Task 5: Close X3 — typed failures, no message inference (T3a.5)

**Files:**
- Modify: `packages/domain/src/analysis/jev-reviews.ts` (ownership note in Self-review)
- Modify: `api/src/routes/review-routes.ts`
- Create: `api/src/server/failures.test.ts`
- Modify: `tests/integration/analysis-review-filtering.test.ts` (one added assertion)

**Interfaces:**
- Produces: review-domain throws are `AnalysisValidation` (400), `AnalysisNotFound` (404) or `AnalysisConflict` (409) — all from `@sidechannel/contracts/analysis/jev-repository`, messages unchanged.
- Consumes: `statusOf`/`sendFailure` (Task 2), `DomainFailure` (Task 2).
- Runs without Mongo.
- **Effort:** ~1 dev-day. **Rollback:** `git revert` (see Rollback §Task 5 — revert both halves together).

- [ ] **Step 5.1: Write the failing API-level status tests**

Create `api/src/server/failures.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { DomainFailure, type FailureKind } from '@sidechannel/contracts/errors';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { createResearcherServer } from './index.js';

const failing: ResearchRouteHandler = async request => {
    if (!request.path.startsWith('/fail/')) return null;
    const kind = request.path.slice('/fail/'.length);
    if (kind === 'untyped') throw new Error('conflict: stale and not found');
    throw new DomainFailure(kind as FailureKind, `failure: ${kind}`);
};

async function setup() {
    const server = createResearcherServer(new InMemoryRepository(), { extensionHandlers: [failing] });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { base, post, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}

test('the error boundary returns 400/404/409/413/503 for domain failure kinds', async () => {
    const app = await setup();
    try {
        for (const [kind, status] of [['invalid', 400], ['not-found', 404], ['conflict', 409], ['too-large', 413], ['unavailable', 503]] as const) {
            const response = await fetch(`${app.base}/fail/${kind}`);
            assert.equal(response.status, status, kind);
            assert.deepEqual(await response.json(), { error: `failure: ${kind}` });
        }
    } finally { await app.close(); }
});

test('route failures keep their documented status codes', async () => {
    const app = await setup();
    try {
        const config = defaultFixtureConfiguration();
        assert.equal((await app.post('/runs', { config })).status, 400);
        assert.equal((await fetch(`${app.base}/runs/missing`)).status, 404);
        assert.equal((await app.post('/drafts', { id: 'stale', config, revision: 5 })).status, 409);
        assert.equal((await app.post('/runs', { config, idempotencyKey: 'x'.repeat(2_000_001) })).status, 413);
    } finally { await app.close(); }
});

test('untyped errors are 400: message text never selects a status', async () => {
    const app = await setup();
    try {
        const response = await fetch(`${app.base}/fail/untyped`);
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: 'conflict: stale and not found' });
    } finally { await app.close(); }
});
```

Append to `tests/integration/analysis-review-filtering.test.ts` (and add `import { AnalysisNotFound, AnalysisValidation } from '@sidechannel/contracts/analysis/jev-repository';` to its imports):

```ts
test('review route failures are typed, not message-matched', async () => {
    const service = fixture();
    const repository = { getJob: async () => ({ id: context.analysisId }) } as unknown as AnalysisRepository;
    const handler = createReviewRouteHandler(service, repository);
    const call = (path: string) => handler({ method: 'GET', path: `/analyses/${context.analysisId}/${path}`, query: new URLSearchParams(), body: async () => ({}) });
    await assert.rejects(call('review-batches/missing'), AnalysisNotFound);
    await assert.rejects(call('reviews?latest=unexpected'), AnalysisValidation);
    await assert.rejects(call('reviews?scope=unexpected'), AnalysisValidation);
});
```

- [ ] **Step 5.2: Run the tests to see the decisive red**

```bash
node --import tsx --test api/src/server/failures.test.ts
node --import tsx --test tests/integration/analysis-review-filtering.test.ts
```

Expected: `failures.test.ts` **passes** — it is a guard over statuses that are already correct today (the boundary was typed in Task 2), so it cannot be red. The decisive failure is the new review test: `assert.rejects(call('review-batches/missing'), AnalysisNotFound)` fails because the review route still *returns* `{ status: 404 }` from its message-regex `catch` instead of throwing a typed error. Record that failure.

- [ ] **Step 5.3: Type the review-domain throws**

In `packages/domain/src/analysis/jev-reviews.ts`, add the import and replace every bare `throw new Error(...)` with the class listed below — **messages stay byte-identical**:

```ts
import { AnalysisConflict, AnalysisNotFound, AnalysisValidation } from '@sidechannel/contracts/analysis/jev-repository';
```

| Line (current) | Message | Replace with |
| --- | --- | --- |
| 7 | `` `Invalid ${name}` `` | `AnalysisValidation` |
| 9 | `` `Invalid ${name}` `` | `AnalysisValidation` |
| 18 | `Analysis reviews support window or event scope; run outcomes require independent definition revisions` | `AnalysisValidation` |
| 20 | `Code is not in the frozen codebook` | `AnalysisValidation` |
| 22 | `Review subject is outside the analysis` | `AnalysisValidation` |
| 26 | `Outcome is not in the frozen monitor definition` | `AnalysisValidation` |
| 30 | `Review evidence or definition revision is stale` | `AnalysisConflict` |
| 32 | `Invalid review decision` | `AnalysisValidation` |
| 34 | `Evidence reference is outside the review subject` | `AnalysisValidation` |
| 35 | `predictionsVisible must be recorded` | `AnalysisValidation` |
| 36 | `Invalid expectedRevision` | `AnalysisValidation` |
| 38 | `Review revision conflict` | `AnalysisConflict` |
| 43 | `limit must be between 1 and 500` | `AnalysisValidation` |
| 46 | `Invalid scope filter` | `AnalysisValidation` |
| 47 | `Invalid latest filter` | `AnalysisValidation` |
| 50 | `Review window not found` | `AnalysisNotFound` |
| 57 | `limit must be between 1 and 500` | `AnalysisValidation` |
| 62 | `randomSize must fit the eligible population` | `AnalysisValidation` |
| 63 | `Invalid threshold` | `AnalysisValidation` |
| 65 | `Unknown code or window` | `AnalysisValidation` |
| 66 | `Invalid review mode` | `AnalysisValidation` |
| 80 | `Review batch not found` | `AnalysisNotFound` |
| 82 | `Invalid review queue filter` | `AnalysisValidation` |
| 84 | `A reviewer is required for the unreviewed queue` | `AnalysisValidation` |

Mechanical form: `throw new Error(X)` → `throw new AnalysisValidation(X)` etc. Every mapped status equals today's regex outcome (`/conflict|stale/` → 409, `/not found/` → 404, otherwise 400), so no status changes.

- [ ] **Step 5.4: Remove the message-regex mapping from `api/src/routes/review-routes.ts`**

1. Add imports: `import { AnalysisNotFound, AnalysisValidation } from '@sidechannel/contracts/analysis/jev-repository';` and `import { HttpError } from '../server/errors.js';`.
2. In `reviewContext`, replace `throw new Error('Analysis not found')` with `throw new AnalysisNotFound('Analysis not found')` and `throw new Error('Review selection supports at most 100000 windows; narrow the analysis range')` with `throw new AnalysisValidation('Review selection supports at most 100000 windows; narrow the analysis range')`.
3. Delete the whole `try { … } catch (error) { … }` wrapper in `createReviewRouteHandler` and de-indent its body one level. The `const payload = method === 'POST' ? await request.body(REVIEW_BODY_LIMIT) : undefined;` line stays **outside** the removed `try`, above the `const id = …` line, so body size/syntax errors keep outranking existence errors.
4. Replace `if (!await repository.getJob(id)) return { status: 404, data: { error: 'Analysis not found' } };` with `if (!await repository.getJob(id)) throw new AnalysisNotFound('Analysis not found');`.
5. Replace `throw new Error('latest must be true or false')` with `throw new AnalysisValidation('latest must be true or false')`.
6. Replace `return { status: 405, data: { error: 'Method not allowed' } };` with `throw new HttpError(405, 'Method not allowed');`.
7. Keep the `payload!` assertions in the two POST branches: `payload` is defined for every POST that reaches them.

- [ ] **Step 5.4b: Land dependency D5.1 — enforce the one-source-event review rule server-side**

WS5 Task 5.4 deletes the dashboard's client-side admission rule (`jev-transport.ts`), so the API must own it to keep the same refusal with the same message. In `packages/domain/src/analysis/jev-reviews.ts` (`ReviewService.save`, immediately after the scope validation and before the subject lookup), add:

```ts
if (scope === 'event' && (Array.isArray(input.eventIds) ? input.eventIds.length : 0) !== 1)
    throw new AnalysisValidation('Event annotations require exactly one source event. Save separate annotations for additional events.');
```

Add the regression test to `tests/integration/analysis-review-filtering.test.ts`:

```ts
test('event-scope reviews require exactly one source event', async () => {
    // ...existing fixture setup: a review context and analysis id...
    await assert.rejects(
        service.save(analysisId, { scope: 'event', subjectId: context.windows[0]!.eventIds[0]!, codeId: context.codeIds[0]!, reviewer: 'reviewer-a', decision: 'uncertain', rationale: 'test', eventIds: [context.windows[0]!.eventIds[0]!, context.windows[0]!.eventIds[1]], stepIds: [], predictionsVisible: true, definitionRevision: context.definitionRevision, evidenceRevision: context.evidenceRevision }),
        /exactly one source event/,
    );
});
```

Run:

```bash
node --import tsx --test tests/integration/analysis-review-filtering.test.ts
```

Expected: PASS; the message is byte-identical to the removed dashboard rule, so the WS5 characterization of the refusal stays valid.

- [ ] **Step 5.5: Run the tests to verify the typed mapping is green**

```bash
node --import tsx --test tests/integration/analysis-review-filtering.test.ts
node --import tsx --test api/src/server/failures.test.ts
```

Expected: PASS — the new typed review test now sees `AnalysisNotFound`/`AnalysisValidation` thrown; `failures.test.ts` still passes.

- [ ] **Step 5.6: Run the tests to verify X3 is closed**

```bash
node --import tsx --test api/src/server/failures.test.ts
node --import tsx --test api/src/routes/review-routes.body.test.ts
node --import tsx --test api/src/server/route-contract.test.ts
node --import tsx --test tests/integration/analysis-review-filtering.test.ts
node --import tsx --test api/src/server/errors.test.ts
npm run test --workspace @sidechannel/api
npm run test --workspace @sidechannel/domain
npm run check
```

Expected: PASS (5 tests in `analysis-review-filtering.test.ts`). Confirm the two removals:

```bash
git grep -n "conflict|stale" -- api packages
git grep -n "'status' in error" -- api packages
```

Expected: no matches for either command (duck typing removed in Task 2, regex removed here).

- [ ] **Step 5.7: Commit**

```bash
git add packages/domain/src/analysis/jev-reviews.ts api/src/routes/review-routes.ts api/src/server/failures.test.ts tests/integration/analysis-review-filtering.test.ts
git commit -m "fix(api): type review failures and drop message-regex status inference (X3)"
```

---

## Task 6: Pagination helpers and the four page loops (T3a.6)

**Files:**
- Create: `packages/domain/src/pagination.ts`, `packages/domain/src/pagination.test.ts`
- Modify: `packages/domain/package.json` (export `./pagination`)
- Modify: `packages/domain/src/analysis/jev-service.ts`, `api/src/routes/review-routes.ts`, `api/src/server/routers/runs.ts`

**Interfaces:**
- Produces from `@sidechannel/domain/pagination`:

```ts
export type PageFetcher<T> = (options: PageOptions) => Promise<Page<T>>;
export function iteratePages<T>(fetch: PageFetcher<T>, limit?: number): AsyncGenerator<T>;
export function collectPages<T>(fetch: PageFetcher<T>, limit?: number): Promise<T[]>;
```

- Preserves `pages<T>(fetch): AsyncGenerator<T>` from `@sidechannel/domain/analysis/jev-service` (same name, same 100-item default) so `analysis-worker/src/jev/jev-worker.ts` compiles unchanged.

- Consumes: `Page`, `PageOptions` (`@sidechannel/contracts/analysis/jev-repository`).
- Runs without Mongo.
- **Effort:** ~0.5 dev-day. **Rollback:** `git revert` (see Rollback §Task 6).

- [ ] **Step 6.1: Write the failing pagination test**

Create `packages/domain/src/pagination.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPages, iteratePages } from './pagination.js';

/** A deterministic cursor store: `after` is the last id already returned. */
const store = (total: number) => async ({ after, limit = 2 }: { after?: string; limit?: number }) => {
    const start = after === undefined ? 0 : Number(after);
    const items = Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, index) => start + index);
    return { items, nextCursor: start + items.length >= total ? null : String(start + items.length) };
};

test('iteratePages follows nextCursor until a page reports none', async () => {
    const seen: number[] = [];
    for await (const item of iteratePages(store(5), 2)) seen.push(item);
    assert.deepEqual(seen, [0, 1, 2, 3, 4]);
});

test('collectPages returns the same order and handles empty and exactly-full collections', async () => {
    assert.deepEqual(await collectPages(store(5), 2), [0, 1, 2, 3, 4]);
    assert.deepEqual(await collectPages(store(4), 2), [0, 1, 2, 3]);
    assert.deepEqual(await collectPages(store(0), 2), []);
});

test('collectPages uses one shared limit for every page', async () => {
    const limits: (number | undefined)[] = [];
    await collectPages(async ({ after, limit }) => { limits.push(limit); return store(4)({ after, limit }); }, 2);
    assert.deepEqual(limits, [2, 2, 2]);
});
```

- [ ] **Step 6.2: Run the test to verify it fails**

```bash
node --import tsx --test packages/domain/src/pagination.test.ts
```

Expected: FAIL — `Cannot find module './pagination.js'`.

- [ ] **Step 6.3: Implement the helpers**

Create `packages/domain/src/pagination.ts`:

```ts
import type { Page, PageOptions } from '@sidechannel/contracts/analysis/jev-repository';

export type PageFetcher<T> = (options: PageOptions) => Promise<Page<T>>;

/** Follows `nextCursor` until a page reports none; yields items in server order. */
export async function* iteratePages<T>(fetch: PageFetcher<T>, limit = 500): AsyncGenerator<T> {
    let after: string | undefined;
    for (;;) {
        const page = await fetch({ limit, ...(after === undefined ? {} : { after }) });
        for (const item of page.items) yield item;
        if (page.nextCursor === null) return;
        after = page.nextCursor;
    }
}

export async function collectPages<T>(fetch: PageFetcher<T>, limit = 500): Promise<T[]> {
    const items: T[] = [];
    for await (const item of iteratePages(fetch, limit)) items.push(item);
    return items;
}
```

Add to `packages/domain/package.json` `exports` (keep the alphabetical order used there):

```json
    "./pagination": {
      "types": "./dist/pagination.d.ts",
      "import": "./dist/pagination.js"
    },
```

- [ ] **Step 6.4: Run the test to verify it passes**

```bash
node --import tsx --test packages/domain/src/pagination.test.ts
npm run check --workspace @sidechannel/domain
```

Expected: PASS (3 tests).

- [ ] **Step 6.5: Replace the Jev export loop**

In `packages/domain/src/analysis/jev-service.ts`:

1. Replace line 18 (`export async function* pages<T>(…) { … }`) with a delegating compatibility wrapper — `pages` stays exported because `analysis-worker/src/jev/jev-worker.ts:9,33,36,110-117` still imports it (WS3c removes that last use), and its historical default `{ limit: 100 }` is preserved exactly:

```ts
/** Compatibility wrapper for the analysis worker; one cursor loop implementation for the whole codebase. */
export function pages<T>(fetch: PageFetcher<T>): AsyncGenerator<T> { return iteratePages(fetch, 100); }
```

2. Add the import next to the other domain imports:

```ts
import { iteratePages, type PageFetcher } from '../pagination.js';
```

3. `exportAnalysis` (lines 88–90) keeps its three `pages(...)` calls unchanged; they now reach `iteratePages(fetch, 100)` — identical page size, identical lazy start (the wrapper returns the generator without awaiting anything, exactly like the old generator function).

- [ ] **Step 6.6: Replace the two review-context loops**

In `api/src/routes/review-routes.ts`, add `import { iteratePages } from '@sidechannel/domain/pagination';` and replace the two `do { … } while (after)` blocks in `reviewContext` with:

```ts
    for await (const window of iteratePages(options => repository.listWindows(analysisId, options), 500)) {
        windows.push({ id: window.id, eventIds: window.eventIds, stepIds: window.stepIds, probabilities: {} });
        if (windows.length > 100000) throw new AnalysisValidation('Review selection supports at most 100000 windows; narrow the analysis range');
    }
    const byId = new Map(windows.map(window => [window.id, window]));
    for await (const result of iteratePages(options => repository.listResults(analysisId, options), 500)) { const window = byId.get(result.windowId); if (window) window.probabilities[result.codeId] = result.probability; }
```

and delete the now-unused `let after: string | undefined;` declarations in that function.

- [ ] **Step 6.7: Replace the export event loop**

In `api/src/server/routers/runs.ts`, import `collectPages` from `@sidechannel/domain/pagination` and replace:

```ts
        const events = []; let after = 0;
        while (true) { const rows = await repository.listEvents(id, after, 1000); events.push(...rows); if (rows.length < 1000) break; after = rows.at(-1)!.sequence; }
```

with:

```ts
        const events = await collectPages(async ({ after, limit = 1000 }) => {
            const rows = await repository.listEvents(id, Number(after ?? 0), limit);
            return { items: rows, nextCursor: rows.length === limit ? String(rows.at(-1)!.sequence) : null };
        }, 1000);
```

Equivalent: identical page size (1000), identical stop condition (a short page), identical event order.

- [ ] **Step 6.8: Run the tests to verify the loops are behaviour-neutral**

```bash
node --import tsx --test packages/domain/src/pagination.test.ts
node --import tsx --test api/src/server/route-contract.test.ts
node --import tsx --test tests/integration/analysis-jev-api.test.ts
node --import tsx --test tests/integration/analysis-jev-backend.test.ts
node --import tsx --test tests/integration/analysis-review-filtering.test.ts
npm run test --workspace @sidechannel/api
npm run test --workspace @sidechannel/domain
npm run test --workspace @sidechannel/analysis-worker
npm run check
```

Expected: PASS; the snapshot is unchanged.

- [ ] **Step 6.9: Commit**

```bash
git add packages/domain/src/pagination.ts packages/domain/src/pagination.test.ts packages/domain/package.json packages/domain/src/analysis/jev-service.ts api/src/routes/review-routes.ts api/src/server/routers/runs.ts
git commit -m "refactor(domain): cursor pagination helpers replace four page-collection loops (X5)"
```

---

## Verification summary

| Check | Command | Expected |
| --- | --- | --- |
| Route-contract snapshot | `node --import tsx --test api/src/server/route-contract.test.ts` | PASS, unchanged since Task 1 |
| Typed error mapping | `node --import tsx --test api/src/server/errors.test.ts api/src/server/failures.test.ts` | PASS |
| Review body cap | `node --import tsx --test api/src/routes/review-routes.body.test.ts` | PASS (413 for >1 MB review bodies) |
| Pagination | `node --import tsx --test packages/domain/src/pagination.test.ts` | PASS (3 tests) |
| API unit suite | `npm run test --workspace @sidechannel/api` | PASS |
| Domain unit suite | `npm run test --workspace @sidechannel/domain` | PASS |
| Whole unit suite | `npm test` | PASS |
| Mongo route suite | `docker compose up -d --wait mongo` then `npm run build` then `node --env-file-if-exists=.env --import tsx --test tests/integration/api-routes.mongo.test.ts` | PASS (1 test) |
| Full integration | `npm run test:integration` | PASS |
| Types | `npm run check` | exit 0 |
| Lint + boundaries | `npm run lint && node scripts/verify-boundaries.mjs` | exit 0 |
| Build + compiled smoke | `npm run build && node scripts/verify-compiled.mjs` | PASS |
| Migration equivalence | `node scripts/verify-migration-equivalence.mjs` | PASS |
| Boundary-regression guards | `git grep -n "conflict\|stale" -- api packages` and `git grep -n "'status' in error" -- api packages` | no matches |
| index size | `wc -l api/src/server/index.ts` | < 80 |
| No synthetic request | `git grep -n "JSON.stringify(request.body)" -- api` | no matches |

**Tests that run without Mongo:** `api/src/server/route-contract.test.ts`, `api/src/server/errors.test.ts`, `api/src/server/failures.test.ts`, `api/src/routes/review-routes.body.test.ts`, `api/src/server/server.test.ts`, `api/src/server/adaption-models.test.ts`, `api/src/healthcare/healthcare.test.ts`, `packages/domain/src/pagination.test.ts`, `tests/integration/analysis-jev-api.test.ts`, `tests/integration/analysis-jev-backend.test.ts`, `tests/integration/analysis-review-filtering.test.ts`, `tests/integration/oversight-{oversight,reviews,recovery}.test.ts`, `tests/integration/dashboard-smoke.test.ts`.
**Tests that need Mongo:** `tests/integration/api-routes.mongo.test.ts` (new), plus the pre-existing `*.mongo.test.ts` suites.

## Rollback

Each task is one commit; `git revert <commit>` is sufficient. No schema, migration or data change is involved anywhere in WS3a, and no route URL changes, so a revert cannot strand clients.

- Task 1 revert removes the snapshot test and golden file; nothing else depends on them at runtime.
- Task 2 revert restores the inlined helpers in `index.ts`; `errors.ts`/`http.ts`/`auth.ts`/`static.ts`/`configuration.ts` and the `DomainFailure` contract become unused and are removed by the same revert.
- Task 3 revert restores the inline route chain in `index.ts` (as it stood after Task 2); `launch.ts` and `routers/**` become unused and go with it. The Mongo route test is reverted in the same commit — it is a wire-behaviour test, so it would still pass, but it belongs to this task's diff.
- Task 4 revert restores the synthetic `IncomingMessage`, the three body readers, the eager request body and the `body`-named results; revert the four test edits and the `healthcare/service.ts` one-liner in the same commit (they are in it).
- Task 5 revert restores bare `Error` throws in `jev-reviews.ts` **and** the regex mapper in `review-routes.ts`. Do not split these two halves: a typed throw without the typed mapper (or the reverse) changes review statuses to 400. The `OversightError` catch branch removed in Task 4 stays removed (the boundary maps it).
- Task 6 revert restores the four loops; `iteratePages`/`collectPages` become unused and go with it, and `pages()` returns to its original body.

Order matters only in the reverse direction: 6 → 5 → 4 → 3 → 2 → 1. Task 5's domain edit is the only cross-ownership change; if WS4 objects, revert Task 5 as a unit and record the 400-vs-409 status change in the decision log rather than keeping a half-typed mapping.

## Out of scope

- **Domain `DomainFailure` producers.** WS3c migrates `packages/domain/src/oversight/**` throws; WS3a only maps both vocabularies.
- **`packages/domain/src/oversight/**` page loops** (`allRecords` and friends) — WS3c, per the parent task list.
- **`packages/domain/src/analysis/jev-reviews.ts` page loops** (`allReviews`, `getBatch`, `export`) — not in the parent's four-loop list; WS3c/WS4 territory. Only its *throws* change here.
- **Pair/draft equality moved to `packages/domain/src/harness/launch.ts`**: delegated to WS3c T3c.1, which owns `packages/domain/src/harness/launch.ts` and moves `assertSameLaunch`/`assertPair` there. WS3a keeps only `differences()` in `api/src/server/routers/pairs.ts` (single caller) and must not duplicate the invariants.
- **`adaption-models.ts`** (provider policy, `GET /models/adaption`) — WS4; the route is mounted unchanged.
- **`api/src/healthcare/{service,resolver,provenance}.ts` redesign** — WS3c (one compatibility line only here).
- **`api/src/healthcare/bootstrap.ts`** — verified to be a dataset CLI, not route registration; no change.
- **Dashboard transport/clients** — WS5 (it starts only after WS3a because the routes are now stable).
- **`GET /api/providers`, `GET /api/scenarios`** — WS4 T4.3 adds them to the router list.
- **Status vocabulary tables** (`overview`'s `RUN_STATUSES` literal) — WS7.
- **Route-shape changes of any kind, new endpoints, or unified 1 MB/2 MB limits** — explicitly not done.

## Self-review

- **Finding coverage.** S1 (index.ts 247 lines → < 80, twelve responsibilities → six routers plus five collaborators) is closed by Tasks 2–3. X4 (three handler contracts, three body parsers, synthetic `IncomingMessage`) by Task 4. X3 (HTTP status codes inferred from message text) by Tasks 2 and 5: the mapper is typed in Task 2 and the last message-regex plus the untyped producers are removed in Task 5. X5 (page-collection loops) by Task 6 for the four loops the parent names.
- **Deviations from the brief.** (1) `api/src/routes/jev-routes.ts` contains **no** page-collection loop — verified: it only parses `limit` for single pages; the Jev loop is `pages()` in `packages/domain/src/analysis/jev-service.ts:18` (used by `exportAnalysis:88-90` and by `analysis-worker/src/jev/jev-worker.ts`), so Task 6 replaces that loop body with a delegation to `iteratePages(fetch, 100)` and leaves all call sites byte-identical. (2) `packages/domain/src/analysis/jev-reviews.ts` is listed under WS4 in conventions §4; Task 5 needs its 24 throw sites typed to remove the regex without changing status codes, and every mapped class reproduces today's regex outcome exactly. Coordinate the Task 5 commit with WS4 or get Lead sign-off before starting it. (3) The program plan's T3.4 mention of moving pair/draft equality into `packages/domain/src/harness/launch.ts` is deferred (ownership + no behaviour need); noted in Out of scope. (4) `api/src/healthcare/service.ts` needs a one-line `body: async () => ({})` compatibility edit (WS3c owns that file). (5) `packages/contracts/src/server/contracts.ts`, `packages/contracts/package.json`, `packages/domain/package.json` and `api/src/routes/jev-extension.ts` are edited after WS2 sequentially, never concurrently (conventions §4 rule 1).
- **Behaviour-change statement.** Two deltas, both pinned by tests: (a) a review `POST` body between 1 MB and 2 MB now returns **413** instead of 400 (the old plain `Error` from the 1 MB re-reader was regex-mapped to 400); the 1 MB and 2 MB caps themselves are unchanged. (b) Request bodies are parsed lazily, so a malformed JSON body on a non-GET route that never reads it now yields that route's own status instead of 400 — no test or client depends on the old behaviour. Message text for the 2 MB case is unified to `Request exceeds 2 MB` (previously `Request body exceeds 2 MB` on the Jev path); no test asserts either string. One internal granularity note: the 100,000-window review guard still throws the identical `AnalysisValidation` message, but it now fires on the first window past the cap instead of the first page past it — same observable rejection. Everything else is byte-identical, which `route-contract.snapshot.json` proves for workspace/config/drafts/runs/pairs/overview/export and NDJSON framing.
- **Placeholder scan.** Every code-changing step carries complete code or an exact replacement map (Task 2 Step 2.9 and Task 5 Step 5.3 are line-anchored maps with the full replacement text). No "TBD", no "similar to Task N".
- **Type consistency.** `ResearchRouteRequest`/`ResearchRouteResult`/`ResearchRouteHandler` names come from conventions §3.1/§3.6 and are used unchanged by all six routers, `oversight.ts`, `healthcare.routes`, `adaptionModelRoute` and `jev-extension.ts`. `DomainFailure`/`FailureKind` match conventions §3.6 literally (`constructor(public kind: FailureKind, message: string)`). `iteratePages`/`collectPages` names match the parent task list; the exported `PageFetcher` is additive. Router factories are named `create<Resource>Router` consistently. `sourceDraft(input, runLaunchKey, config)` is called only from the runs/pairs routers (2 call sites) and `freezeReference(run)` from 2.
- **Test-first ordering.** Task 1 records behaviour before any move. Tasks 2, 4, 5 and 6 are red-green (typed-mapping unit test, body-cap test, typed-review test, pagination test). Task 3 cannot be red-green — it is a pure structural move whose gate is the Task 1 snapshot plus the new Mongo wire test recorded as a pre-refactor baseline (Step 3.2), both of which must pass unchanged afterwards. Every task ends with the snapshot unchanged and the suite green.
