# WS3c — Domain, Persistence and Worker Splits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the four remaining backend god-modules (`persistence/harness/repository.ts`, `domain/oversight/service.ts`, `AnalysisWorker`, `HealthcareService`) into coordinating shells with single-responsibility collaborators, move the Mongo document-chunking workaround out of the domain behind a `BlobStore` port, and complete X3 by having domain failures carry a `FailureKind` instead of an HTTP status.

**Architecture:** Each task is a behaviour-preserving extraction gated by the WS1 contract suites and the existing integration suites. Two seams get new ports: `BlobStore` (`packages/contracts/src/oversight/blob-store.ts`, implemented in persistence) for frozen monitor previews, and `DomainFailure` (`packages/contracts/src/errors.ts`, already introduced by WS3a) for transport-neutral domain errors. The domain keeps every rule and message it owns today; adapters keep every stored byte. Estimated: 5 tasks, 6–8 dev-days.

**Tech Stack:** TypeScript 6.0.3, Node 22.18+/24.11+, `node:test` + `tsx` (`scripts/test.mjs`), MongoDB 8 replica set (`TEST_MONGODB_URI`, compose default `127.0.0.1:27018`), npm 11.5.1 workspaces + Nx 23, zod 4.6.7, `mongodb` 7.7.0.

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

**WS3c-specific constraints (binding):**

1. **WS1's contract semantics must not regress.** `tests/integration/contracts/{harness-repository,analysis-repository,research-store}.ts` and both entry files encode the agreed port semantics (report-first event phase, 10 000-row `listEvents` clamp, `updateWindow` returns lease validity, 1 MiB attempt bound before the lease check, `ResearchStore.replace` = revision match, typed `workerStatus`). No task in this plan may change an assertion in those files. Any adapter move that makes one of them fail is a defect in this plan's implementation, not a licence to edit the suite.
2. **HTTP statuses for `oversight` and `healthcare` routes are unchanged**, with the single documented exception in T3c.5 (two internal `500` preview-integrity failures become `503` via `FailureKind = 'unavailable'`; no existing test asserts `500`, and 500 is not a kind in conventions §3.6).
3. **Stored bytes do not change.** Frozen preview part/manifest rows (`monitor_preview_parts`, `monitor_previews`), their 250 000-character chunking and their `contentHash` formula (`sha256(JSON.stringify(text))`) stay byte-identical, so previews written before this workstream still verify.
4. **Zod `ZodError` keeps escaping the oversight domain unchanged** so `api/src/routes/oversight.ts` can still answer `400 { error: 'Invalid monitor configuration', issues }`. Only explicit `throw` sites migrate to `DomainFailure`.
5. **Messages are part of the contract.** Every migrated throw keeps its exact message string; tests match on them (`/different launch configuration/`, `/differ outside condition/`, `/Incomplete pair/`, `/Idempotency/`, `/integrity check failed/`, `/changed since preview/`, `/another preview/`, `/Archive existing outcomes/`).

## Preconditions (hard gates — verify before Task 1)

This plan builds on WS1, WS2 and WS3a. Each gate is a command with an expected result; if a gate fails, **stop and report** — do not invent a substitute interface.

- [ ] **Gate 0.1: WS1 contract harness exists**

```bash
node -e "const fs=require('node:fs'); for (const f of ['tests/integration/contracts/harness-repository.ts','tests/integration/contracts/analysis-repository.ts','tests/integration/contracts/research-store.ts','tests/integration/port-contracts.test.ts','tests/integration/port-contracts.mongo.test.ts']) if (!fs.existsSync(f)) throw new Error('missing '+f); console.log('WS1 contract harness present')"
```

Expected: `WS1 contract harness present`.

- [ ] **Gate 0.2: WS2 port split exists**

```bash
node -e "const s=require('node:fs').readFileSync('packages/contracts/src/server/contracts.ts','utf8'); if(!/ResearcherRepository extends RunStateStore/.test(s)) throw new Error('WS2 ports missing'); const w=require('node:fs').readFileSync('packages/contracts/src/analysis/jev-repository.ts','utf8'); if(!/interface JobLifecycleStore/.test(w)) throw new Error('WS2 analysis ports missing'); console.log('WS2 ports present')"
```

Expected: `WS2 ports present`.

- [ ] **Gate 0.3: WS3a failure contracts exist**

```bash
node -e "const s=require('node:fs').readFileSync('packages/contracts/src/errors.ts','utf8'); if(!/class DomainFailure/.test(s)||!/FailureKind/.test(s)) throw new Error('DomainFailure missing'); const m=require('node:fs').readFileSync('api/src/server/errors.ts','utf8'); if(!/export function statusOf/.test(m)||!/export class HttpError/.test(m)) throw new Error('statusOf/HttpError missing'); console.log('WS3a failure contracts present')"
```

Expected: `WS3a failure contracts present`.

- [ ] **Gate 0.4: baseline green**

```bash
npm run build
npm test
docker compose up -d --wait mongo
npm run test:integration
```

Expected: all PASS. Record the baseline in the PR description; any later red is then attributable to this task.

**Named interfaces this plan consumes (WS3a's actual exports — verified against `2026-11-07-ws3a-api-server-and-route-contract.md`; if the landed code differs, adapt only the import lines and note it in the PR):**

```ts
// packages/contracts/src/errors.ts (WS3a Task 2)
export type FailureKind = 'invalid' | 'not-found' | 'conflict' | 'too-large' | 'unavailable';
export class DomainFailure extends Error { constructor(public kind: FailureKind, message: string); }

// api/src/server/errors.ts (WS3a Task 2) — the single error boundary
export class HttpError extends Error { constructor(readonly status: number, message: string); }
/** DomainFailure kind → status, HttpError → status, legacy typed `status` → status, anything else → 400. */
export function statusOf(error: unknown): number;
export function messageOf(error: unknown): string;
export function sendFailure(res: ServerResponse, error: unknown): void;
```

## File structure

**Create**

| Path | Responsibility |
| --- | --- |
| `packages/domain/src/harness/launch.ts` | Launch-idempotency and matched-pair invariants (the single definition) |
| `packages/domain/src/harness/launch.test.ts` | Message and ordering assertions for both invariants |
| `packages/persistence/src/harness/schema.ts` | Harness collection names, index table, legacy-draft migration |
| `packages/persistence/src/harness/memory/repository.ts` | `InMemoryRepository` adapter only |
| `packages/persistence/src/harness/mongo/repository.ts` | `MongoRepository` adapter only |
| `packages/contracts/src/oversight/blob-store.ts` | `BlobManifest`, `BlobStore`, composed `MonitorStore` port |
| `packages/persistence/src/oversight/blob-store.ts` | `ResearchBlobStore`: 250 000-char parts + manifest over a `ResearchStore` |
| `packages/domain/src/oversight/errors.ts` | `OversightError` (deleted in T3c.5) |
| `packages/domain/src/oversight/schemas.ts` | Zod input schemas for definition/preview/launch |
| `packages/domain/src/oversight/definition.ts` | default/current/save monitor definition |
| `packages/domain/src/oversight/events.ts` | `readEvents` paging helper |
| `packages/domain/src/oversight/preview.ts` | `createMonitorPreview`, `getMonitorPreview` (via `BlobStore`) |
| `packages/domain/src/oversight/launch.ts` | `launchMonitor` (preview binding, evidence re-verification) |
| `packages/domain/src/oversight/cancel.ts` | `cancelMonitor` (8-attempt revision CAS) |
| `packages/domain/src/oversight/preview.test.ts` | Preview integrity through a fake `MonitorStore` |
| `packages/domain/src/oversight/cancel.test.ts` | 8-attempt cancel CAS |
| `analysis-worker/src/jev/lease-keeper.ts` | Heartbeat, cancellation observation, abort fan-out |
| `analysis-worker/src/jev/window-runner.ts` | One window's provider batches and fenced writes |
| `analysis-worker/src/jev/progress-ledger.ts` | Orphan-attempt recovery, counters, per-window deltas |
| `analysis-worker/src/jev/usage-reconciler.ts` | Usage aggregation and job finalization |
| `analysis-worker/src/jev/jev-worker.test.ts` | Lease-keeper loss and empty-queue behaviour |
| `api/src/healthcare/resolver.ts` | Catalog-backed configuration resolution |
| `api/src/healthcare/routes.ts` | Dataset/preset/evaluation route adapter |
| `api/src/healthcare/provenance.ts` | Evaluator-reference freezing and researcher export |
| `api/src/healthcare/modules.test.ts` | Extracted-module behaviour + "rules live only in domain" guard |
| `tests/integration/contracts/blob-store.ts` | Contract suite for the `BlobStore` port |
| `tests/integration/oversight-failures.test.ts` | `FailureKind` → HTTP status parity for oversight routes |

**Modify**

| Path | Change |
| --- | --- |
| `packages/persistence/src/harness/repository.ts` | Becomes the compatibility barrel (`export { InMemoryRepository }` / `export { MongoRepository }`) |
| `packages/persistence/src/harness/repository.test.ts` | Add the "invariants live only in domain" guard test |
| `packages/persistence/src/analysis/store.ts` | Both stores implement `MonitorStore` via `ResearchBlobStore` |
| `packages/contracts/package.json` | Export `./oversight/blob-store` |
| `packages/domain/package.json` | Export `./harness/launch` (persistence imports the invariants through it) |
| `packages/domain/src/oversight/service.ts` | Becomes the public barrel for the six modules |
| `packages/domain/src/oversight/reviews.ts` | Import from the specific modules, not the barrel |
| `packages/domain/src/oversight/{definition,preview,launch,cancel,reviews}.ts` | T3c.5: `OversightError` → `DomainFailure(kind, …)` |
| `packages/domain/src/oversight/errors.ts` | Deleted in T3c.5 |
| `analysis-worker/src/jev/jev-worker.ts` | Thin orchestrator (< 80-line class) |
| `analysis-worker/src/oversight/worker.ts` | T3c.2: `store: MonitorStore` parameter type; T3c.5: narrow on `DomainFailure` |
| `api/src/healthcare/service.ts` | 4-method facade over the three modules |
| `api/src/routes/oversight.ts` | T3c.2: `store: MonitorStore` parameter type; T3c.5: route-level 400/404/405 throws → `HttpError` (WS3a coordination) |
| `api/src/server/errors.ts` | T3c.5: delete the legacy `OversightError` branch from `statusOf` (WS3a coordination) |
| `api/src/server/errors.test.ts` | T3c.5: delete the `OversightError` assertion (WS3a coordination) |
| `packages/contracts/src/analysis/jev-repository.ts` | `Analysis*` classes extend `DomainFailure`, statuses deleted |
| `packages/contracts/src/harness/repository.ts` | `RepositoryConflict` extends `DomainFailure`, status deleted |
| `tests/integration/port-contracts.test.ts` | Add the memory blob-store entry |
| `tests/integration/port-contracts.mongo.test.ts` | Add the Mongo blob-store entry |
| `docs/solid-remediation-decisions.md` | Record WS3c decisions (create if WS0/WS1 has not) |

**Task order:** T3c.1 → T3c.2 → T3c.3 → T3c.4 → T3c.5 (T3c.5 depends on T3c.2's `errors.ts`; T3c.1/3/4 are independent of each other and of T3c.5).

---

## Task T3c.1: Split the harness repository into memory/mongo/schema and de-duplicate launch invariants

**Files:**
- Create: `packages/domain/src/harness/launch.ts`, `packages/domain/src/harness/launch.test.ts`
- Create: `packages/persistence/src/harness/schema.ts`, `packages/persistence/src/harness/memory/repository.ts`, `packages/persistence/src/harness/mongo/repository.ts`
- Modify: `packages/persistence/src/harness/repository.ts` (→ barrel), `packages/persistence/src/harness/repository.test.ts` (guard test)
- Modify: `packages/domain/package.json` (export `./harness/launch`)

**Interfaces:**
- Consumes: `DomainFailure` (contracts §3.6); `assertPairEquivalent(config, config): void` from `@sidechannel/domain/harness/config`; `ResearcherRepository` from `@sidechannel/contracts/server/contracts` (WS2); `WorkerGuard` for `MongoRepository`.
- Produces (stable public path — nothing outside this package changes):
  - `@sidechannel/persistence/harness/repository` → `InMemoryRepository`, `MongoRepository` (unchanged names, unchanged constructors: `new InMemoryRepository()`, `new MongoRepository(client, db)`, `MongoRepository.connect(uri, database?)`).
  - `@sidechannel/domain/harness/launch` → `assertSameLaunchConfiguration(existing: Run, requested: Run): void`, `assertMatchedPair(runs: Run[]): void`.
  - `packages/persistence/src/harness/schema.ts` → `COLLECTIONS`, `HARNESS_INDEXES`, `initializeHarnessSchema(db: Db): Promise<void>`, `migrateLegacyDrafts(db: Db): Promise<void>`.

**Effort:** ~1.5 dev-days.

**Behaviour-change statement:** none. Class names, constructor shapes, error messages and adapter semantics (including WS1's report-first `eventPhase`, the 10 000-row clamp, typed `workerStatus`, and `getEvidencePage` returning `{ items: [], total: 0 }` for an unknown run) are preserved verbatim.

- [ ] **Step 1.1: Write the failing domain invariant tests**

Create `packages/domain/src/harness/launch.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchedPair, assertSameLaunchConfiguration } from './launch.js';
import { defaultFixtureConfiguration, resolveConfiguration } from './config.js';
import { createQueuedRun } from './initialization.js';

const queued = (launchKey: string) => createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), launchKey);

test('a reused launch key must describe the identical launch', () => {
    const existing = queued('launch');
    assert.doesNotThrow(() => assertSameLaunchConfiguration(existing, structuredClone(existing)));
    const changed = structuredClone(existing);
    changed.config.label = 'Different configuration';
    assert.throws(() => assertSameLaunchConfiguration(existing, changed), /different launch configuration/);
    const reordered = structuredClone(existing);
    reordered.pairPosition = 1;
    assert.throws(() => assertSameLaunchConfiguration(existing, reordered), /different launch configuration/);
});

test('a matched pair needs two distinct conditions and one shared pair identity', () => {
    const base = resolveConfiguration(defaultFixtureConfiguration());
    const paired = (id: 'reviewed' | 'excluded', position: number) => ({
        ...createQueuedRun({ ...structuredClone(base), condition: { id, version: '1', text: `condition ${id}` } }, `pair:${position}`),
        pairId: 'pair-1', pairingSeed: 42, pairPosition: position,
    });
    const pair = [paired('reviewed', 0), paired('excluded', 1)];
    assert.doesNotThrow(() => assertMatchedPair(structuredClone(pair)));
    assert.throws(() => assertMatchedPair([pair[0]!]), /two distinct conditions and one pair identity/);
    assert.throws(() => assertMatchedPair([pair[0]!, { ...pair[1]!, pairId: 'other' }]), /two distinct conditions and one pair identity/);
    assert.throws(() => assertMatchedPair([pair[0]!, { ...pair[1]!, launchKey: pair[0]!.launchKey }]), /two distinct conditions and one pair identity/);
    const divergent = structuredClone(pair);
    divergent[1]!.config.scheduler.rounds += 1;
    assert.throws(() => assertMatchedPair(divergent), /differ outside condition/);
});
```

- [ ] **Step 1.2: Run it to verify it fails**

```bash
node --import tsx --test packages/domain/src/harness/launch.test.ts
```

Expected: FAIL — `Cannot find module './launch.js'`.

- [ ] **Step 1.3: Implement the invariants (complete file)**

Create `packages/domain/src/harness/launch.ts`:

```ts
import { isDeepStrictEqual } from 'node:util';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import { DomainFailure } from '@sidechannel/contracts/errors';
import { assertPairEquivalent } from './config.js';

/**
 * An idempotency key names exactly one launch. Adapters must not restate this comparison:
 * memory and Mongo both call this helper, so the rule exists once.
 */
export function assertSameLaunchConfiguration(existing: Run, requested: Run): void {
    if (!isDeepStrictEqual(existing.config, requested.config)
        || !isDeepStrictEqual(existing.sourceDraft ?? undefined, requested.sourceDraft)
        || (existing.pairId ?? undefined) !== requested.pairId
        || (existing.pairingSeed ?? undefined) !== requested.pairingSeed
        || (existing.pairPosition ?? undefined) !== requested.pairPosition)
        throw new DomainFailure('conflict', 'Idempotency key already belongs to a different launch configuration');
}

/**
 * A matched pair is exactly two distinct conditions sharing one pair identity and one
 * pairing seed, and the two configurations may differ only in `condition`.
 */
export function assertMatchedPair(runs: Run[]): void {
    if (runs.length !== 2 || !runs[0]!.pairId || runs[0]!.pairId !== runs[1]!.pairId
        || runs[0]!.launchKey === runs[1]!.launchKey || runs[0]!.id === runs[1]!.id
        || new Set(runs.map(run => run.config.condition.id)).size !== 2
        || !runs.every(run => ['reviewed', 'excluded'].includes(run.config.condition.id))
        || runs[0]!.pairingSeed !== runs[1]!.pairingSeed)
        throw new DomainFailure('conflict', 'A matched pair requires exactly two distinct conditions and one pair identity');
    try { assertPairEquivalent(runs[0]!.config, runs[1]!.config); }
    catch { throw new DomainFailure('conflict', 'Matched configurations differ outside condition'); }
}
```

- [ ] **Step 1.4: Publish the export path**

Add to `packages/domain/package.json` (insert after `./harness/initialization`):

```json
    "./harness/launch": {
      "types": "./dist/harness/launch.d.ts",
      "import": "./dist/harness/launch.js"
    },
```

Persistence imports the invariants through the declared export, so the barrel must exist before any adapter file references it.

- [ ] **Step 1.5: Run it to verify it passes**

```bash
node --import tsx --test packages/domain/src/harness/launch.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 1.6: Write the failing persistence guard test**

Append to `packages/persistence/src/harness/repository.test.ts`:

```ts
import { readFile } from 'node:fs/promises';

test('launch and pair invariants are defined only in the domain', async () => {
    const directory = new URL('.', import.meta.url);
    for (const file of ['repository.ts', 'schema.ts', 'memory/repository.ts', 'mongo/repository.ts']) {
        const source = await readFile(new URL(file, directory), 'utf8');
        assert.ok(!/function assertSameLaunch\b/.test(source), `${file} redefines assertSameLaunch`);
        assert.ok(!/function assertPair\b/.test(source), `${file} redefines assertPair`);
    }
    const domain = await readFile(new URL('../../../domain/src/harness/launch.ts', directory), 'utf8');
    assert.match(domain, /export function assertSameLaunchConfiguration/);
    assert.match(domain, /export function assertMatchedPair/);
});
```

- [ ] **Step 1.7: Run it to verify it fails**

```bash
node --import tsx --test packages/persistence/src/harness/repository.test.ts
```

Expected: FAIL — `repository.ts redefines assertSameLaunch` (the helpers are still local today), and an `ENOENT` for `memory/repository.ts`.

- [ ] **Step 1.8: Create `schema.ts` (complete file)**

Create `packages/persistence/src/harness/schema.ts`:

```ts
import type { Db } from 'mongodb';

/** The only place harness collection names appear. */
export const COLLECTIONS = {
    runs: 'runs',
    events: 'events',
    operations: 'operations',
    drafts: 'drafts',
    counters: 'counters',
    workerGuard: 'worker_guard',
} as const;

export interface IndexSpec { collection: string; keys: Record<string, 1 | -1>; unique?: boolean }

export const HARNESS_INDEXES: readonly IndexSpec[] = [
    { collection: COLLECTIONS.runs, keys: { id: 1 }, unique: true },
    { collection: COLLECTIONS.runs, keys: { launchKey: 1 }, unique: true },
    { collection: COLLECTIONS.runs, keys: { status: 1, createdAt: 1 } },
    { collection: COLLECTIONS.events, keys: { id: 1 }, unique: true },
    { collection: COLLECTIONS.events, keys: { runId: 1, sequence: 1 }, unique: true },
    { collection: COLLECTIONS.events, keys: { runId: 1, agentId: 1, turn: 1 } },
    { collection: COLLECTIONS.operations, keys: { runId: 1, operationId: 1 }, unique: true },
    { collection: COLLECTIONS.drafts, keys: { id: 1 }, unique: true },
    { collection: COLLECTIONS.counters, keys: { runId: 1 }, unique: true },
    { collection: COLLECTIONS.workerGuard, keys: { key: 1 }, unique: true },
];

/** Legacy editable drafts predate optimistic revisions; migrate once without changing content. */
export async function migrateLegacyDrafts(db: Db): Promise<void> {
    await db.collection(COLLECTIONS.drafts).updateMany({ revision: { $exists: false } }, { $set: { revision: 1 } });
}

export async function initializeHarnessSchema(db: Db): Promise<void> {
    await Promise.all(HARNESS_INDEXES.map(index =>
        db.collection(index.collection).createIndex(index.keys, index.unique ? { unique: true } : {})));
    await migrateLegacyDrafts(db);
}
```

- [ ] **Step 1.9: Move the memory adapter (exact move map)**

Create `packages/persistence/src/harness/memory/repository.ts` from `packages/persistence/src/harness/repository.ts`:

| From | To | Edit |
| --- | --- | --- |
| `repository.ts:21` (`eventPhase`) | `memory/repository.ts:12` | move verbatim — keep whatever report-first version WS1 left on disk |
| `repository.ts:23-25` (`matchesEvent`, `matchesRun`) | `memory/repository.ts:14-16` | verbatim |
| `repository.ts:27` (`clone`) | `memory/repository.ts:18` | verbatim |
| `repository.ts:36-117` (`InMemoryRepository`) | `memory/repository.ts:20-101` | verbatim, plus the three edits below |
| `repository.ts:10-19` (`assertSameLaunch`, `assertPair`) | — | **delete** |

Header imports of `memory/repository.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { assertMatchedPair, assertSameLaunchConfiguration } from '@sidechannel/domain/harness/launch';
import type { HarnessEvent, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import type { ResearcherRepository } from '@sidechannel/contracts/server/contracts';
import { type Draft, type DraftMetadata, RepositoryConflict, type EventQuery, type RunQuery, type EvidenceKind, type EvidencePage } from '@sidechannel/contracts/harness/repository';
import { summarizeRun } from '@sidechannel/domain/harness/repository';
```

Edits inside the moved class:

```ts
export class InMemoryRepository implements ResearcherRepository {
```

```ts
    async createRun(run: Run) {
        const existing = [...this.runs.values()].find(candidate => candidate.launchKey === run.launchKey);
        if (existing)
            { assertSameLaunchConfiguration(existing, run); return clone(existing); }
        if (this.runs.has(run.id))
            throw new Error('Duplicate run ID');
        this.runs.set(run.id, clone(run));
        return clone(run);
    }

    async createPair(runs: Run[]) {
        assertMatchedPair(runs);
```

(Everything else in `createRun`/`createPair`/`saveRun`/`claimRun`/`appendEvent`/`listEvents`/draft/query/evidence/cancel methods is byte-identical to `repository.ts:44-117` as it stands on disk, including the WS1 fixes.)

- [ ] **Step 1.10: Move the Mongo adapter (exact move map)**

Create `packages/persistence/src/harness/mongo/repository.ts` from `packages/persistence/src/harness/repository.ts`:

| From | To | Edit |
| --- | --- | --- |
| `repository.ts:29-34` (`clean`) | `mongo/repository.ts:12-17` | verbatim |
| `repository.ts:119-273` (`MongoRepository`) | `mongo/repository.ts:19-175` | verbatim, plus the edits below |
| `repository.ts:128-143` (`initialize()` body) | — | replace body with `await initializeHarnessSchema(this.db);` (the index list and the draft migration now live in `schema.ts`) |
| every `'runs' \| 'events' \| 'operations' \| 'drafts' \| 'counters' \| 'worker_guard'` literal | — | `COLLECTIONS.runs` / `.events` / `.operations` / `.drafts` / `.counters` / `.workerGuard` |

Header imports of `mongo/repository.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { MongoClient, type Db, type Document } from 'mongodb';
import { assertMatchedPair, assertSameLaunchConfiguration } from '@sidechannel/domain/harness/launch';
import type { HarnessEvent, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import type { ResearcherRepository, WorkerStatus } from '@sidechannel/contracts/server/contracts';
import { type Draft, type DraftMetadata, RepositoryConflict, type EventQuery, type RunQuery, type EvidenceKind, type EvidencePage } from '@sidechannel/contracts/harness/repository';
import type { WorkerGuard } from '@sidechannel/contracts/harness/server';
import { summarizeRun } from '@sidechannel/domain/harness/repository';
import { COLLECTIONS, initializeHarnessSchema } from '../schema.js';
```

Edits inside the moved class:

```ts
export class MongoRepository implements ResearcherRepository, WorkerGuard {
    constructor(readonly client: MongoClient, readonly db: Db) { }
    static async connect(uri: string, database = 'sidechannel') {
        const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
        await client.connect();
        const repository = new MongoRepository(client, client.db(database));
        await repository.initialize();
        return repository;
    }
    async initialize() { await initializeHarnessSchema(this.db); }
```

```ts
    async createRun(run: Run) {
        // …unchanged try/catch around insertOne…
        const result = clean<Run>(await this.db.collection(COLLECTIONS.runs).findOne({ launchKey: run.launchKey }));
        if (!result)
            throw new Error('Conflicting run identity');
        assertSameLaunchConfiguration(result, run);
        return result;
    }

    async createPair(runs: Run[]) {
        assertMatchedPair(runs);
        // …unchanged transaction; replace both `assertSameLaunch(...)` calls inside with
        // assertSameLaunchConfiguration(...) and keep every message and RepositoryConflict throw…
    }
```

`assertPairEquivalent` is no longer imported here (domain `launch.ts` owns it).

- [ ] **Step 1.11: Reduce `repository.ts` to the compatibility barrel (complete file)**

Replace `packages/persistence/src/harness/repository.ts` with:

```ts
/**
 * Public harness adapter path. The adapters live in `./memory/` and `./mongo/`; this module
 * re-exports them so `@sidechannel/persistence/harness/repository` keeps resolving.
 */
export { InMemoryRepository } from './memory/repository.js';
export { MongoRepository } from './mongo/repository.js';
```

- [ ] **Step 1.12: Verify the moves**

```bash
npm run check --workspace=@sidechannel/domain
npm run check --workspace=@sidechannel/persistence
node --import tsx --test packages/domain/src/harness/launch.test.ts
node --import tsx --test packages/persistence/src/harness/repository.test.ts
```

Expected: `check` exits 0; both test files PASS (3 tests in `repository.test.ts`).

- [ ] **Step 1.13: Verify the consumers and the contract suite**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
node --env-file-if-exists=.env --import tsx --test tests/integration/port-contracts.mongo.test.ts
npm test
docker compose up -d --wait mongo
npm run test:integration
```

Expected: PASS everywhere, including `experiment-worker/src/harness/core.test.ts` (its `class FailingRepo extends InMemoryRepository` subclasses still work because the barrel exports the same class) and every WS1 parity assertion.

- [ ] **Step 1.14: Commit**

```bash
git add packages/domain/src/harness/launch.ts packages/domain/src/harness/launch.test.ts packages/persistence/src/harness/schema.ts packages/persistence/src/harness/memory/repository.ts packages/persistence/src/harness/mongo/repository.ts packages/persistence/src/harness/repository.ts packages/persistence/src/harness/repository.test.ts
git commit -m "refactor(persistence): split harness adapters into memory/mongo/schema; invariants live in domain"
```

---

## Task T3c.2: Split the oversight service and move preview chunking behind a `BlobStore` port

**Files:**
- Create: `packages/contracts/src/oversight/blob-store.ts`; modify `packages/contracts/package.json`
- Create: `packages/persistence/src/oversight/blob-store.ts`; modify `packages/persistence/src/analysis/store.ts`
- Create: `packages/domain/src/oversight/{errors,schemas,definition,events,preview,launch,cancel}.ts`; modify `packages/domain/src/oversight/{service,reviews}.ts`
- Create: `packages/domain/src/oversight/{preview,cancel}.test.ts`
- Create: `tests/integration/contracts/blob-store.ts`; modify `tests/integration/port-contracts.test.ts`, `tests/integration/port-contracts.mongo.test.ts`
- Type-only edits (declared coordination touches, zero behaviour change): `api/src/routes/oversight.ts` (WS3a-owned), `analysis-worker/src/oversight/worker.ts`

**Interfaces:**
- Consumes: `ResearchStore`, `ResearchCollection`, `previewPartKey(id, index)` from `@sidechannel/contracts/analysis/store` (WS2 T2.4 types the collections and owns the `id:index` part-key layout); `hash` from `@sidechannel/domain/analysis/store` (byte-identical to the old `digest`); `buildProjection`, `digest` from `./projections.js`.
- Produces:

```ts
// packages/contracts/src/oversight/blob-store.ts  (export path: @sidechannel/contracts/oversight/blob-store)
export interface BlobManifest { id: string; createdAt: string; partCount: number; contentHash: string; }
export interface BlobStore {
    putBlob(blob: { id: string; createdAt: string; text: string }): Promise<BlobManifest>;
    getBlob(id: string): Promise<{ manifest: BlobManifest; text: string; complete: boolean } | null>;
}
export type MonitorStore = ResearchStore & BlobStore;
```

```ts
// packages/domain/src/oversight/events.ts
/** The only repository capabilities oversight needs; matches WS2's extension-handler slice. */
export type OversightSource = Pick<Repository, 'getRun' | 'listEvents'>;
```

- Preserved public surface (unchanged import path `@sidechannel/domain/oversight/service`, unchanged behaviour):
  - `defaultMonitorDefinition(): MonitorDefinition`
  - `currentDefinition(store: ResearchStore): Promise<MonitorDefinition>`
  - `saveDefinition(store: ResearchStore, input: unknown): Promise<MonitorDefinition>`
  - `readEvents(repository: OversightSource, runId: string): Promise<HarnessEvent[]>`
  - `createMonitorPreview(repository: OversightSource, store: MonitorStore, input: unknown): Promise<MonitorPreview>`
  - `getMonitorPreview(store: MonitorStore, id: string): Promise<MonitorPreview | null>`
  - `launchMonitor(repository: OversightSource, store: MonitorStore, input: unknown): Promise<MonitorEvaluation>`
  - `cancelMonitor(store: ResearchStore, id: string): Promise<MonitorEvaluation>`
  - `OversightError` (until T3c.5)
  - `ResearchBlobStore(store: ResearchStore)` from `packages/persistence/src/oversight/blob-store.ts`
- Widened *and narrowed* parameter types (compile-time only): the repository parameter becomes `Pick<Repository, 'getRun' | 'listEvents'>` (WS2's handler slice accepts a full `Repository` and vice versa), and the store parameter of the preview/launch functions becomes `MonitorStore`. `createOversightHandler(repository, store: MonitorStore)` and `processNextMonitorJob(_repository, store: MonitorStore, provider, workerId)` change the same way; the worker's first parameter is additionally narrowed from `Repository` to `Pick<Repository, 'getRun' | 'listEvents'>` because WS2 makes `Repository` require `WorkerGuard` (WS2 defers that signature to WS3c). Every caller already passes an `InMemoryResearchStore`/`MongoResearchStore` and a `Pick<Repository, 'getRun' | 'listEvents'>`, so no call site changes.

**Effort:** ~1.5 dev-days.

**Behaviour-change statement:** none observable. Frozen preview rows keep their shape (`monitor_preview_parts`: `{ id: "<previewId>:<index>", revision: 1, createdAt, text }`, ≤ 250 000 characters; `monitor_previews`: `{ id, revision: 1, createdAt, partCount, contentHash }`) and `contentHash` stays `sha256(JSON.stringify(text))`, so previews stored before this task still verify. Error messages and the `500` integrity/`missing part` statuses are unchanged in this task (T3c.5 re-kinds them).

- [ ] **Step 2.1: Write the failing preview-integrity test**

Create `packages/domain/src/oversight/preview.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { MonitorStore } from '@sidechannel/contracts/oversight/blob-store';
import type { Page, ResearchRecord } from '@sidechannel/contracts/analysis/store';
import type { MonitorPreview } from '@sidechannel/contracts/oversight/contracts';
import { defaultMonitorDefinition } from './definition.js';
import { getMonitorPreview } from './preview.js';

const jsonHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const preview = (): MonitorPreview => ({ schemaVersion: 1, revision: 1, id: 'preview-1', createdAt: '2026-01-01T00:00:00.000Z',
    definition: defaultMonitorDefinition(), settings: { model: { provider: 'test', id: 'model', settings: {} }, maxInputChars: 1000,
        contextWindowTokens: 1000, outputAllowanceTokens: 128, timeoutMs: 1000 }, runs: [], hash: 'preview-hash' });

/** Only the blob port is exercised; every record read throws to prove previews never touch records. */
function store(entries: Map<string, { text: string; contentHash: string }>, complete = true): MonitorStore {
    const unused = async (): Promise<never> => { throw new Error('records must not be read for a frozen preview'); };
    return {
        async getBlob(id: string) {
            const entry = entries.get(id);
            return entry ? { manifest: { id, createdAt: '2026-01-01T00:00:00.000Z', partCount: 1, contentHash: entry.contentHash }, text: entry.text, complete } : null;
        },
        async putBlob() { return { id: 'unused', createdAt: 'unused', partCount: 1, contentHash: 'unused' }; },
        async get<T extends ResearchRecord>(): Promise<T | null> { return unused(); },
        async insert<T extends ResearchRecord>(): Promise<boolean> { return unused(); },
        async replace<T extends ResearchRecord>(): Promise<boolean> { return unused(); },
        async page<T extends ResearchRecord>(): Promise<Page<T>> { return unused(); },
        async claim(): Promise<boolean> { return unused(); },
        async renew(): Promise<boolean> { return unused(); },
        async release(): Promise<void> { return unused(); },
    };
}

test('a frozen preview round-trips through the blob port and verifies its content hash', async () => {
    const value = preview(), text = JSON.stringify(value);
    const entries = new Map([['preview-1', { text, contentHash: jsonHash(text) }]]);
    assert.deepEqual(await getMonitorPreview(store(entries), 'preview-1'), value);
    assert.equal(await getMonitorPreview(store(entries), 'missing'), null);
});

test('tampered or absent preview parts fail integrity validation', async () => {
    const value = preview(), text = JSON.stringify(value);
    const entries = new Map([['preview-1', { text: text + 'tampered', contentHash: jsonHash(text) }]]);
    await assert.rejects(getMonitorPreview(store(entries), 'preview-1'), /integrity check failed/);
    await assert.rejects(getMonitorPreview(store(entries, false), 'preview-1'), /part is missing/);
});
```

- [ ] **Step 2.2: Write the failing cancel-CAS test**

Create `packages/domain/src/oversight/cancel.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Page, ResearchRecord, ResearchStore } from '@sidechannel/contracts/analysis/store';
import type { MonitorEvaluation } from '@sidechannel/contracts/oversight/contracts';
import { cancelMonitor } from './cancel.js';

const job = (revision: number): MonitorEvaluation => ({ schemaVersion: 1, id: 'monitor-1', revision,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', idempotencyKey: 'key', previewId: 'preview-1',
    previewHash: 'hash', definition: { id: 'definition:1', schemaVersion: 1, revision: 1, createdAt: '2026-01-01T00:00:00.000Z', questions: 'q', outcomes: [] },
    settings: { model: { provider: 'test', id: 'model', settings: {} }, maxInputChars: 1000, contextWindowTokens: 1000, outputAllowanceTokens: 128, timeoutMs: 1000 },
    runIds: [], status: 'queued', cancelRequested: false, results: [] });

/** replace() answers per attempt; the CAS loop must give up after the eighth false. */
function store(outcomes: boolean[], current = job(1)): { store: ResearchStore; attempts: () => number } {
    let attempts = 0;
    const unused = async (): Promise<never> => { throw new Error('unused'); };
    const value: ResearchStore = {
        async get<T extends ResearchRecord>(): Promise<T | null> { return JSON.parse(JSON.stringify(current)) as T; },
        async insert<T extends ResearchRecord>(): Promise<boolean> { return unused(); },
        async replace<T extends ResearchRecord>(): Promise<boolean> { attempts++; return outcomes[Math.min(attempts - 1, outcomes.length - 1)]!; },
        async page<T extends ResearchRecord>(): Promise<Page<T>> { return unused(); },
        async claim(): Promise<boolean> { return unused(); },
        async renew(): Promise<boolean> { return unused(); },
        async release(): Promise<void> { return unused(); },
    };
    return { store: value, attempts: () => attempts };
}

test('cancelling retries the revision CAS and publishes the next revision', async () => {
    const fake = store([false, false, false, true]);
    const next = await cancelMonitor(fake.store, 'monitor-1');
    assert.equal(next.cancelRequested, true);
    assert.equal(next.revision, 2);
    assert.equal(fake.attempts(), 4);
});

test('cancelling gives up after eight optimistic attempts with the documented conflict', async () => {
    const fake = store(Array.from({ length: 8 }, () => false));
    await assert.rejects(cancelMonitor(fake.store, 'monitor-1'), /Evaluation changed while cancelling/);
    assert.equal(fake.attempts(), 8);
});
```

- [ ] **Step 2.3: Run both to verify they fail**

```bash
node --import tsx --test packages/domain/src/oversight/preview.test.ts
node --import tsx --test packages/domain/src/oversight/cancel.test.ts
```

Expected: FAIL — `Cannot find module './definition.js'` / `'./preview.js'` / `'./cancel.js'`.

- [ ] **Step 2.4: Add the `BlobStore` port (complete file)**

Create `packages/contracts/src/oversight/blob-store.ts`:

```ts
import type { ResearchStore } from '../analysis/store.js';

export interface BlobManifest { id: string; createdAt: string; partCount: number; contentHash: string; }

/**
 * Immutable blob storage for documents that exceed a single store document's size limit.
 * The adapter owns the part layout; callers own integrity policy.
 */
export interface BlobStore {
    /** Stores `text` under `id` and publishes the manifest last. Identical content is accepted unchanged. */
    putBlob(blob: { id: string; createdAt: string; text: string }): Promise<BlobManifest>;
    /** Returns `null` when no manifest exists; `complete: false` when any part is absent. */
    getBlob(id: string): Promise<{ manifest: BlobManifest; text: string; complete: boolean } | null>;
}

/** Oversight documents that need both research records and frozen blob storage. */
export type MonitorStore = ResearchStore & BlobStore;
```

Add the export path to `packages/contracts/package.json` (insert before `./oversight/comparison`):

```json
    "./oversight/blob-store": {
      "types": "./dist/oversight/blob-store.d.ts",
      "import": "./dist/oversight/blob-store.js"
    },
```

- [ ] **Step 2.5: Write the failing `BlobStore` contract suite**

Create `tests/integration/contracts/blob-store.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { MonitorStore } from '@sidechannel/contracts/oversight/blob-store';

export interface BlobStoreHarness {
    name: string;
    fixture(): Promise<{ store: MonitorStore; dispose(): Promise<void> }>;
}

const sha256 = (text: string) => createHash('sha256').update(JSON.stringify(text)).digest('hex');
const CHUNK = 250_000;

export function blobStoreContract(harness: BlobStoreHarness): void {
    test(`${harness.name}: blobs round-trip losslessly with a manifest and content hash`, async (t) => {
        const { store, dispose } = await harness.fixture();
        t.after(dispose);
        const id = 'blob-1', createdAt = '2026-01-01T00:00:00.000Z', text = JSON.stringify({ value: 'x'.repeat(600_000) });
        const manifest = await store.putBlob({ id, createdAt, text });
        assert.equal(manifest.partCount, Math.ceil(text.length / CHUNK));
        assert.equal(manifest.contentHash, sha256(text));
        const blob = await store.getBlob(id);
        assert.equal(blob!.text, text);
        assert.equal(blob!.complete, true);
        assert.equal(blob!.manifest.contentHash, manifest.contentHash);
        assert.equal(await store.getBlob('missing'), null);
    });

    test(`${harness.name}: parts are addressed by index and existence is separate from content`, async (t) => {
        const { store, dispose } = await harness.fixture();
        t.after(dispose);
        const text = JSON.stringify({ value: 'y'.repeat(300_000) });
        const manifest = await store.putBlob({ id: 'blob-2', createdAt: '2026-01-01T00:00:00.000Z', text });
        assert.equal(manifest.partCount, 2);
        const page = await store.page<{ id: string; text: string; revision: number; createdAt: string }>('monitor_preview_parts', {}, '', 50);
        const owned = page.items.filter(part => part.id.startsWith('blob-2:')).sort((left, right) => left.id.localeCompare(right.id));
        assert.deepEqual(owned.map(part => part.id), ['blob-2:0', 'blob-2:1']);
        assert.equal(owned.every(part => part.text.length <= CHUNK), true);
        // Existence, not content, is what the adapter reports: an overwritten part still exists, so the
        // domain's content-hash check is what rejects tampered text (packages/domain/src/oversight/preview.ts).
        const second = owned[1]!;
        assert.equal(await store.replace('monitor_preview_parts', second.id, second.revision, { ...second, revision: second.revision + 1, text: 'tampered' }), true);
        const blob = await store.getBlob('blob-2');
        assert.equal(blob!.complete, true);
        assert.equal(blob!.manifest.contentHash, manifest.contentHash);
        assert.notEqual(blob!.text, text);
    });

    test(`${harness.name}: re-putting identical content is accepted and a changed blob cannot overwrite parts`, async (t) => {
        const { store, dispose } = await harness.fixture();
        t.after(dispose);
        const blob = { id: 'blob-4', createdAt: '2026-01-01T00:00:00.000Z', text: JSON.stringify({ value: 'stable' }) };
        const first = await store.putBlob(blob);
        assert.deepEqual(await store.putBlob(blob), first);
        assert.equal((await store.getBlob('blob-4'))!.text, blob.text);
        const changed = await store.putBlob({ ...blob, text: JSON.stringify({ value: 'changed' }) });
        const stored = await store.getBlob('blob-4');
        assert.equal(stored!.text, blob.text);
        assert.notEqual(stored!.manifest.contentHash, changed.contentHash);
    });
}
```

- [ ] **Step 2.6: Wire both contract entries**

Append to `tests/integration/port-contracts.test.ts`:

```ts
import { blobStoreContract } from './contracts/blob-store.js';
import { InMemoryResearchStore } from '@sidechannel/persistence/analysis/store';

blobStoreContract({
    name: 'memory',
    fixture: async () => ({ store: new InMemoryResearchStore(), dispose: async () => {} }),
});
```

Append to `tests/integration/port-contracts.mongo.test.ts`:

```ts
import { blobStoreContract } from './contracts/blob-store.js';

blobStoreContract({
    name: 'mongo',
    fixture: async () => {
        const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect();
        const db = client.db(database());
        const store = new MongoResearchStore(db);
        await store.initialize();
        return { store, dispose: async () => { await db.dropDatabase(); await client.close(); } };
    },
});
```

(`MongoClient`, `MongoResearchStore`, `uri` and `database` already exist in that file from WS1 Task 6.)

- [ ] **Step 2.7: Run the entries to verify they fail for the right reason**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
```

Expected: FAIL — `TypeError: store.putBlob is not a function` in the three blob tests; every WS1 harness/analysis/store assertion still passes.

- [ ] **Step 2.8: Implement the blob adapter (complete file)**

Create `packages/persistence/src/oversight/blob-store.ts`:

```ts
import { hash } from '@sidechannel/domain/analysis/store';
import { previewPartKey, type ResearchStore } from '@sidechannel/contracts/analysis/store';
import type { BlobManifest, BlobStore } from '@sidechannel/contracts/oversight/blob-store';

/** 250 000 characters stays far below Mongo's 16 MiB document limit for UTF-16 text. */
const CHUNK = 250_000;

/**
 * Parts plus a small manifest. Row shape, chunk size and content hash are the historical frozen
 * preview format: changing any of them invalidates previews written before this refactor.
 */
export class ResearchBlobStore implements BlobStore {
    constructor(private readonly store: ResearchStore) {}

    async putBlob(blob: { id: string; createdAt: string; text: string }): Promise<BlobManifest> {
        const partCount = Math.ceil(blob.text.length / CHUNK);
        for (let index = 0; index < partCount; index++)
            await this.store.insert('monitor_preview_parts', { id: previewPartKey(blob.id, index), revision: 1,
                createdAt: blob.createdAt, text: blob.text.slice(index * CHUNK, (index + 1) * CHUNK) });
        const manifest: BlobManifest = { id: blob.id, createdAt: blob.createdAt, partCount, contentHash: hash(blob.text) };
        await this.store.insert('monitor_previews', { ...manifest, revision: 1 });
        return manifest;
    }

    async getBlob(id: string) {
        const manifest = await this.store.get<BlobManifest & { revision: number }>('monitor_previews', id);
        if (!manifest) return null;
        const parts: string[] = [];
        let complete = true;
        for (let index = 0; index < manifest.partCount; index++) {
            const part = await this.store.get<{ text: string }>('monitor_preview_parts', previewPartKey(id, index));
            if (!part) complete = false;
            else parts.push(part.text);
        }
        return { manifest, text: parts.join(''), complete };
    }
}
```

`hash` from `@sidechannel/domain/analysis/store` is `jsonHash` after WS1 (`sha256(JSON.stringify(text))`) — identical to the removed `digest(serialized)`, so stored manifests do not change.

- [ ] **Step 2.9: Compose the adapter into both research stores**

In `packages/persistence/src/analysis/store.ts`, add at the top:

```ts
import type { MonitorStore } from '@sidechannel/contracts/oversight/blob-store';
import { ResearchBlobStore } from '../oversight/blob-store.js';
```

Change both class declarations and add two delegating members plus the helper field each:

```ts
export class InMemoryResearchStore implements MonitorStore {
  private readonly blobs = new ResearchBlobStore(this);
  // …existing members unchanged…
  putBlob(blob: { id: string; createdAt: string; text: string }) { return this.blobs.putBlob(blob); }
  getBlob(id: string) { return this.blobs.getBlob(id); }
}
```

```ts
export class MongoResearchStore implements MonitorStore {
  constructor(readonly db: Db) {}
  private readonly blobs = new ResearchBlobStore(this);
  // …existing members unchanged…
  putBlob(blob: { id: string; createdAt: string; text: string }) { return this.blobs.putBlob(blob); }
  getBlob(id: string) { return this.blobs.getBlob(id); }
}
```

- [ ] **Step 2.10: Run the contract entries to verify they pass**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
node --env-file-if-exists=.env --import tsx --test tests/integration/port-contracts.mongo.test.ts
```

Expected: PASS — the three blob tests plus every unchanged WS1 harness/analysis/store assertion, on both adapters.

- [ ] **Step 2.11: Widen the two handler parameter types (compile-time only)**

`api/src/routes/oversight.ts` — add `import type { MonitorStore } from '@sidechannel/contracts/oversight/blob-store';` and change **only** the store parameter, keeping the first parameter and request shape exactly as WS2/WS3a wrote them (`Pick<Repository, 'getRun' | 'listEvents'>`, `ResearchRouteRequest`, lazy `body()`):

```ts
export function createOversightHandler(repository: Pick<Repository, 'getRun' | 'listEvents'>, store: MonitorStore) {
```

`analysis-worker/src/oversight/worker.ts` — add the same type import and change the store parameter **and** the unused first parameter:

```ts
export async function processNextMonitorJob(_repository: Pick<Repository, 'getRun' | 'listEvents'>, store: MonitorStore, provider: MonitorProvider, workerId: string): Promise<boolean> {
```

Rationale: WS2 T2.3 makes `Repository extends RunStateStore, EventLog, RunQueue, WorkerGuard`, so a bare `Repository` annotation can no longer be satisfied by `InMemoryRepository`/`ResearcherRepository` (the monitor worker never uses `_repository`). WS2's plan explicitly defers this signature to WS3c (`2026-11-07-ws2-ports-and-composition-roots.md`, cross-plan notes). Narrowing the type keeps the argument list — and therefore all 14 call sites in `analysis-worker/src/main.ts`, the three oversight tests and `dashboard-smoke.ts` — untouched; deleting the dead parameter stays open work, gated on a separate mechanical PR. `MongoResearchStore`/`InMemoryResearchStore` implement `MonitorStore`, so those call sites need no edit either.

- [ ] **Step 2.12: Split the oversight service (exact move map)**

Line anchors below are HEAD's; WS1–WS3a shift them, so match by function name. WS2 T2.4 has already replaced the hand-built `${id}:${index}` part key in the preview writer with `previewPartKey(...)` — carry whatever is on disk into `preview.ts`, and the chunking itself moves to `ResearchBlobStore` (Step 2.8).

| From `packages/domain/src/oversight/service.ts` | To | Notes |
| --- | --- | --- |
| `:10` class `OversightError` | `errors.ts` | verbatim, with the doc comment below |
| `:12-19` (`text`, `outcome`, `definitionInput`) | `schemas.ts` | verbatim |
| `:21-33` (`settingsInput`, `previewInput`, `launchInput`) | `schemas.ts` | verbatim |
| `:35-48` `defaultMonitorDefinition` | `definition.ts` | verbatim |
| `:50-54` `currentDefinition` | `definition.ts` | verbatim |
| `:56-68` `saveDefinition` | `definition.ts` | verbatim |
| `:70-74` `readEvents` | `events.ts` | verbatim body plus the exported `OversightSource` type (complete file below) |
| `:76-120` preview functions | `preview.ts` | `createMonitorPreview` verbatim except the part/manifest writer (`service.ts:96-105`), which becomes one `store.putBlob({ id, createdAt, text: JSON.stringify(preview) })`; `getMonitorPreview` reads through `getBlob` and keeps both `500` messages (shown below) |
| `:122-150` `launchMonitor` | `launch.ts` | verbatim except the import block and the recursive call |
| `:152-161` `cancelMonitor` | `cancel.ts` | verbatim |
| whole file | `service.ts` | replaced by the barrel below |

`packages/domain/src/oversight/errors.ts`:

```ts
/** Domain failure carrying the HTTP status the API used to infer. T3c.5 replaces this with DomainFailure. */
export class OversightError extends Error { constructor(public status: number, message: string) { super(message); } }
```

`packages/domain/src/oversight/events.ts` (complete file):

```ts
import type { HarnessEvent } from '@sidechannel/contracts/harness/contracts';
import type { Repository } from '@sidechannel/contracts/harness/server';

/** The only repository capabilities oversight needs; it accepts a full `Repository` unchanged. */
export type OversightSource = Pick<Repository, 'getRun' | 'listEvents'>;

export async function readEvents(repository: OversightSource, runId: string): Promise<HarnessEvent[]> {
    const events: HarnessEvent[] = [];
    let after = 0;
    while (true) {
        const page = await repository.listEvents(runId, after, 1000);
        events.push(...page);
        if (page.length < 1000) break;
        after = page[page.length - 1]!.sequence;
    }
    return events;
}
```

`packages/domain/src/oversight/preview.ts` (complete file):

```ts
import { randomUUID } from 'node:crypto';
import { MONITOR_VIEWS, type MonitorPreview, type MonitorSettings } from '@sidechannel/contracts/oversight/contracts';
import type { MonitorStore } from '@sidechannel/contracts/oversight/blob-store';
import { buildProjection, digest } from './projections.js';
import { currentDefinition } from './definition.js';
import { readEvents, type OversightSource } from './events.js';
import { OversightError } from './errors.js';
import { previewInput } from './schemas.js';

export async function createMonitorPreview(repository: OversightSource, store: MonitorStore, input: unknown): Promise<MonitorPreview> {
    const parsed = previewInput.parse(input);
    const definition = await currentDefinition(store);
    if (definition.revision !== parsed.definitionRevision) throw new OversightError(409, 'Monitor definition changed. Reload before previewing.');
    const settings: MonitorSettings = { model: parsed.model, maxInputChars: parsed.maxInputChars, contextWindowTokens: parsed.contextWindowTokens,
        outputAllowanceTokens: parsed.outputAllowanceTokens, timeoutMs: parsed.timeoutMs };
    settings.model.settings.maxOutputTokens ??= settings.outputAllowanceTokens;
    if (Number(settings.model.settings.maxOutputTokens) > settings.outputAllowanceTokens || settings.outputAllowanceTokens >= settings.contextWindowTokens)
        throw new OversightError(400, 'Output token setting must fit the output allowance, which must be smaller than the context window.');
    if (parsed.runIds.length !== new Set(parsed.runIds).size) throw new OversightError(400, 'Select each source run once');
    const runs: MonitorPreview['runs'] = [];
    for (const runId of parsed.runIds) {
        const run = await repository.getRun(runId);
        if (!run) throw new OversightError(404, `Run ${runId} not found`);
        if (run.status !== 'completed') throw new OversightError(400, `Run ${runId} must be completed before oversight`);
        const events = await readEvents(repository, runId);
        runs.push({ runId, projections: MONITOR_VIEWS.map(view => buildProjection(run, events, view, definition, settings)) });
    }
    const preview: MonitorPreview = { schemaVersion: 1, revision: 1, id: randomUUID(), createdAt: new Date().toISOString(), definition, settings, runs,
        hash: digest({ definition, settings, runs: runs.map(run => ({ runId: run.runId, hashes: run.projections.map(projection => projection.hash) })) }) };
    // Exact previews exceed Mongo's document limit. The blob port keeps lossless bounded parts and
    // publishes the manifest last, so a crash never leaves a readable partial preview.
    await store.putBlob({ id: preview.id, createdAt: preview.createdAt, text: JSON.stringify(preview) });
    return preview;
}

export async function getMonitorPreview(store: MonitorStore, id: string): Promise<MonitorPreview | null> {
    const blob = await store.getBlob(id);
    if (!blob) return null;
    if (!blob.complete) throw new OversightError(500, 'Frozen monitor preview part is missing');
    if (digest(blob.text) !== blob.manifest.contentHash) throw new OversightError(500, 'Frozen monitor preview integrity check failed');
    return JSON.parse(blob.text) as MonitorPreview;
}
```

`packages/domain/src/oversight/launch.ts` header (body = `service.ts:123-150` verbatim, recursion retargeted):

```ts
import type { MonitorStore } from '@sidechannel/contracts/oversight/blob-store';
import type { MonitorEvaluation } from '@sidechannel/contracts/oversight/contracts';
import { buildProjection, digest } from './projections.js';
import { currentDefinition } from './definition.js';
import { readEvents, type OversightSource } from './events.js';
import { getMonitorPreview } from './preview.js';
import { OversightError } from './errors.js';
import { launchInput } from './schemas.js';

export async function launchMonitor(repository: OversightSource, store: MonitorStore, input: unknown): Promise<MonitorEvaluation> {
    // …service.ts:123-147 verbatim…
    if (!await store.insert('monitor_evaluations', evaluation)) return launchMonitor(repository, store, input);
    return evaluation;
}
```

`packages/domain/src/oversight/cancel.ts` header (body = `service.ts:153-160` verbatim):

```ts
import type { ResearchStore } from '@sidechannel/contracts/analysis/store';
import type { MonitorEvaluation } from '@sidechannel/contracts/oversight/contracts';
import { OversightError } from './errors.js';

export async function cancelMonitor(store: ResearchStore, id: string): Promise<MonitorEvaluation> {
    // 8-attempt optimistic revision CAS, verbatim; the final throw keeps
    // 'Evaluation changed while cancelling; retry the request.'
}
```

`packages/domain/src/oversight/definition.ts` and `events.ts` take their imports from `./schemas.js` / `./errors.js` / `@sidechannel/domain/analysis/store` exactly as `service.ts` did.

- [ ] **Step 2.13: Reduce `service.ts` to the barrel (complete file)**

```ts
/**
 * Public domain path for monitoring. Implementations live in the sibling modules; this module
 * exists so `@sidechannel/domain/oversight/service` keeps resolving for routes and workers.
 */
export { OversightError } from './errors.js';
export { defaultMonitorDefinition, currentDefinition, saveDefinition } from './definition.js';
export { readEvents } from './events.js';
export { createMonitorPreview, getMonitorPreview } from './preview.js';
export { launchMonitor } from './launch.js';
export { cancelMonitor } from './cancel.js';
```

Update `packages/domain/src/oversight/reviews.ts`:

1. Replace the `./service.js` import with the specific modules (avoids a barrel cycle):

```ts
import { currentDefinition } from './definition.js';
import { OversightError } from './errors.js';
import { readEvents, type OversightSource } from './events.js';
```

2. Replace the `Repository` parameter type with `OversightSource` in `sourceSnapshot`, `runReviewContext`, `saveRunOutcomeReview`, `runOutcomeAgreements`, `latestRunOutcomeReview` and `exportRunOutcomeReviews` (six signatures). Bodies are unchanged; a caller holding a full `Repository` still satisfies the narrowed type.

- [ ] **Step 2.14: Run the new domain tests**

```bash
node --import tsx --test packages/domain/src/oversight/preview.test.ts
node --import tsx --test packages/domain/src/oversight/cancel.test.ts
```

Expected: PASS (2 + 2 tests).

- [ ] **Step 2.15: Run the oversight suites and the module-size check**

```bash
npm run build
node --import tsx --test tests/integration/oversight-oversight.test.ts tests/integration/oversight-recovery.test.ts tests/integration/oversight-reviews.test.ts
npm test
docker compose up -d --wait mongo
npm run test:integration
node -e "for (const f of ['errors','schemas','definition','events','preview','launch','cancel','service']) console.log(f, require('node:fs').readFileSync('packages/domain/src/oversight/'+f+'.ts','utf8').split('\n').length-1)"
```

Expected: PASS. The >14 MB preview test still sees `parts.length > 50`, every part `<= 250000`, and `/integrity check failed/`; the cancel/recovery/comparison flows are unchanged. Line counts: all modules ≤ 120, `service.ts` ≤ 12.

- [ ] **Step 2.16: Commit**

```bash
git add packages/contracts/src/oversight/blob-store.ts packages/contracts/package.json packages/persistence/src/oversight/blob-store.ts packages/persistence/src/analysis/store.ts packages/domain/src/oversight api/src/routes/oversight.ts analysis-worker/src/oversight/worker.ts tests/integration/contracts/blob-store.ts tests/integration/port-contracts.test.ts tests/integration/port-contracts.mongo.test.ts
git commit -m "refactor(oversight): split definition/preview/launch/cancel; frozen previews behind a BlobStore port"
```

---

## Task T3c.3: Split `AnalysisWorker` into `LeaseKeeper`, `WindowRunner`, `ProgressLedger`, `UsageReconciler`

**Files:**
- Create: `analysis-worker/src/jev/lease-keeper.ts`, `window-runner.ts`, `progress-ledger.ts`, `usage-reconciler.ts`, `jev-worker.test.ts`
- Modify: `analysis-worker/src/jev/jev-worker.ts` (thin orchestrator)

**Interfaces:**
- Consumes: `AnalysisWorkerStore` (`JobLifecycleStore & WindowStore & ArtifactStore & ResultStore`, exported by WS2 T2.3 — see `2026-11-07-ws2-ports-and-composition-roots.md` §T2.3); `pages`, `emptyCounters`; `buildBehaviorQuestions`; `TypeSafeJevProvider`. `AnalysisAttempt.usage` is `ProviderUsage` after WS2 T2.4, so `UsageReconciler` needs no cast.
- Produces: `new AnalysisWorker(repository: AnalysisWorkerStore, options?: AnalysisWorkerOptions)` with the **unchanged** constructor shape and `runOnce(signal?): Promise<boolean>` / `run(signal): Promise<void>`, so `analysis-worker/src/main.ts`, `commands/jev-analysis-worker.ts` and every integration test keep compiling. New exports: `LeaseKeeper`, `LeaseKeeperOptions`, `WindowRunner`, `WindowPorts`, `WindowRun`, `ProgressLedger`, `ProgressPorts`, `WindowProgress`, `UsageReconciler`, `UsagePorts`.

**Effort:** ~1.5 dev-days.

**Behaviour-change statement:** none. Fencing, cancellation observation, orphan-attempt recovery wording, per-window counter deltas, concurrency batching, the outer deadline formula, usage de-duplication and the terminal-status derivation are moved line-for-line. Monkey-patched port methods (`putArtifact`, `putWindow`) keep working because every collaborator holds the injected port object and calls methods on it.

- [ ] **Step 3.1: Write the failing lease-keeper test**

Create `analysis-worker/src/jev/jev-worker.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { AnalysisWorker } from './jev-worker.js';
import { LeaseKeeper } from './lease-keeper.js';

test('the lease keeper reports a lost lease and stops scheduling', async () => {
    const keeper = new LeaseKeeper(
        { async heartbeat() { return false; }, async getJob() { return null; } },
        { jobId: 'job-1', owner: 'owner', fence: 1 },
        { id: 'job-1', cancelRequested: false },
        { leaseMs: 30, heartbeatMs: 10 });
    keeper.start();
    await keeper.beat();
    keeper.stop();
    assert.equal(keeper.leaseLost, true);
    assert.equal(keeper.stopping, true);
});

test('the lease keeper aborts registered controllers when a beat observes cancellation', async () => {
    const keeper = new LeaseKeeper(
        { async heartbeat() { return true; }, async getJob() { return { id: 'job-1', cancelRequested: true }; } },
        { jobId: 'job-1', owner: 'owner', fence: 1 },
        { id: 'job-1', cancelRequested: false },
        { leaseMs: 30, heartbeatMs: 10 });
    const controller = new AbortController();
    keeper.register(controller);
    await keeper.beat();
    assert.equal(controller.signal.aborted, true);
    assert.equal(keeper.cancelling, true);
});

test('an empty queue leaves the worker idle', async () => {
    assert.equal(await new AnalysisWorker(new InMemoryAnalysisRepository()).runOnce(), false);
});
```

- [ ] **Step 3.2: Run it to verify it fails**

```bash
node --import tsx --test analysis-worker/src/jev/jev-worker.test.ts
```

Expected: FAIL — `Cannot find module './lease-keeper.js'`.

- [ ] **Step 3.3: Implement `lease-keeper.ts` (complete file)**

Create `analysis-worker/src/jev/lease-keeper.ts`:

```ts
import type { AnalysisJob, JobLifecycleStore, Lease } from '@sidechannel/contracts/analysis/jev-repository';

export interface LeaseKeeperOptions { leaseMs: number; heartbeatMs: number }

/**
 * Owns one claimed lease: periodic heartbeat, cancellation observation and abort fan-out.
 * A lost lease is reported, never repaired; the worker leaves the job recoverable.
 */
export class LeaseKeeper {
    private readonly controllers = new Set<AbortController>();
    private readonly onAbort = () => this.abortAll();
    private readonly jobId: string;
    private lost = false;
    private cancelled: boolean;
    private heartbeating = false;
    private timer: ReturnType<typeof setInterval> | undefined;

    constructor(
        private readonly jobs: Pick<JobLifecycleStore, 'heartbeat' | 'getJob'>,
        private readonly lease: Lease,
        job: Pick<AnalysisJob, 'id' | 'cancelRequested'>,
        private readonly options: LeaseKeeperOptions,
        private readonly signal?: AbortSignal,
    ) {
        this.jobId = job.id;
        this.cancelled = job.cancelRequested;
    }

    /** True once this worker must stop scheduling new windows. */
    get stopping(): boolean { return this.lost || this.cancelled || this.signal?.aborted === true; }
    /** True when the lease was lost (as opposed to cancelled). */
    get leaseLost(): boolean { return this.lost; }
    get cancelling(): boolean { return this.cancelled; }

    register(controller: AbortController): void { this.controllers.add(controller); }
    release(controller: AbortController): void { this.controllers.delete(controller); }
    abortAll(): void { for (const controller of this.controllers) controller.abort(); }

    async beat(): Promise<void> {
        if (this.heartbeating) return;
        this.heartbeating = true;
        try {
            if (!await this.jobs.heartbeat(this.lease, new Date().toISOString(), this.options.leaseMs)) this.lost = true;
            const latest = await this.jobs.getJob(this.jobId);
            this.cancelled = Boolean(latest?.cancelRequested);
            if (this.lost || this.cancelled) this.abortAll();
        } catch { this.lost = true; this.abortAll(); }
        finally { this.heartbeating = false; }
    }

    start(): void {
        this.signal?.addEventListener('abort', this.onAbort, { once: true });
        this.timer = setInterval(() => void this.beat(), this.options.heartbeatMs);
        this.timer.unref();
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.signal?.removeEventListener('abort', this.onAbort);
    }
}
```

- [ ] **Step 3.4: Implement `progress-ledger.ts` (complete file)**

Create `analysis-worker/src/jev/progress-ledger.ts`:

```ts
import { emptyCounters } from '@sidechannel/domain/analysis/jev-repository';
import { pages } from '@sidechannel/domain/analysis/jev-service';
import type { JobCounters, JobLifecycleStore, JobStatus, Lease, ResultStore, WindowRecord, WindowStore } from '@sidechannel/contracts/analysis/jev-repository';

export interface ProgressPorts
    extends Pick<JobLifecycleStore, 'updateCounters'>,
    Pick<WindowStore, 'getWindow' | 'listWindows'>,
    Pick<ResultStore, 'listResults' | 'listAttempts' | 'finishAttempt'> {}

export interface WindowProgress { answers: number; submitted: boolean }

/** Counters are derived from stored state: per-window deltas keep them linear, finalization recounts. */
export class ProgressLedger {
    constructor(private readonly repository: ProgressPorts) {}

    /** A crash can leave an attempt open; record recovery rather than treating it as a negative answer. */
    async recover(lease: Lease, jobId: string): Promise<void> {
        for await (const attempt of pages(page => this.repository.listAttempts(jobId, page)))
            if (attempt.status === 'running')
                await this.repository.finishAttempt(lease, { ...attempt, status: 'failed', finishedAt: new Date().toISOString(),
                    error: 'Previous worker lease expired before this attempt was committed; provider completion and cost may be unknown' }, []);
    }

    async snapshot(jobId: string, window: WindowRecord): Promise<WindowProgress> {
        const answers = (await this.repository.listResults(jobId, { windowId: window.id, limit: 100 })).items.length;
        const submitted = (await this.repository.listAttempts(jobId, { windowId: window.id, limit: 1 })).items.length > 0;
        return { answers, submitted };
    }

    async settle(lease: Lease, jobId: string, window: WindowRecord, progress: JobCounters, prior: WindowProgress): Promise<void> {
        const latest = await this.repository.getWindow(jobId, window.id);
        if (!latest) return;
        const answers = (await this.repository.listResults(jobId, { windowId: window.id, limit: 100 })).items.length;
        const submitted = (await this.repository.listAttempts(jobId, { windowId: window.id, limit: 1 })).items.length > 0;
        progress.returnedAnswers += answers - prior.answers;
        progress.submittedWindows += Number(submitted) - Number(prior.submitted);
        progress.finishedWindows += Number(latest.status === 'completed') - Number(window.status === 'completed');
        progress.failedWindows += Number(latest.status === 'failed' || latest.status === 'oversized') - Number(window.status === 'failed');
        // Per-window deltas keep progress linear. Full history/usage reconciliation runs once at finalization.
        await this.repository.updateCounters(lease, { ...progress });
    }

    async counters(jobId: string, codeCount: number): Promise<JobCounters> {
        const counters = emptyCounters(), submitted = new Set<string>();
        for await (const window of pages(page => this.repository.listWindows(jobId, page))) {
            counters.preparedWindows++;
            if (window.status !== 'skipped') counters.expectedAnswers += codeCount;
            if (window.status === 'completed') counters.finishedWindows++;
            if (window.status === 'failed' || window.status === 'oversized') counters.failedWindows++;
            if (window.status === 'skipped') counters.skippedWindows++;
        }
        for await (const attempt of pages(page => this.repository.listAttempts(jobId, page))) submitted.add(attempt.windowId);
        counters.submittedWindows = submitted.size;
        for await (const _result of pages(page => this.repository.listResults(jobId, page))) counters.returnedAnswers++;
        return counters;
    }

    status(counters: JobCounters, cancelled: boolean): JobStatus {
        return cancelled ? 'cancelled'
            : counters.returnedAnswers === counters.expectedAnswers && counters.failedWindows === 0 ? 'completed'
                : counters.returnedAnswers ? 'partial' : 'failed';
    }
}
```

- [ ] **Step 3.5: Implement `usage-reconciler.ts` (complete file)**

Create `analysis-worker/src/jev/usage-reconciler.ts`:

```ts
import { pages } from '@sidechannel/domain/analysis/jev-service';
import type { ArtifactStore, JobCounters, JobLifecycleStore, JobStatus, JobUsage, Lease, ResultStore } from '@sidechannel/contracts/analysis/jev-repository';

export interface UsagePorts extends Pick<JobLifecycleStore, 'finishJob'>, Pick<ResultStore, 'listAttempts'>, Pick<ArtifactStore, 'readArtifact'> {}

interface UsageRecord { usage?: { inputTokens?: unknown; outputTokens?: unknown } }
interface UsageResponse { attempts?: UsageRecord[]; usage?: { inputTokens?: unknown; outputTokens?: unknown } }

/** Final accounting: every provider attempt counted once, unknown usage preserved with known subtotals. */
export class UsageReconciler {
    constructor(private readonly repository: UsagePorts) {}

    async usage(jobId: string): Promise<JobUsage> {
        const total: JobUsage = { inputTokens: 0, outputTokens: 0, knownInputTokens: 0, knownOutputTokens: 0, providerAttempts: 0, unresolvedAttempts: 0 };
        for await (const attempt of pages(page => this.repository.listAttempts(jobId, page))) {
            const response = attempt.responseRef ? await this.repository.readArtifact<UsageResponse>(attempt.responseRef) : undefined;
            // The top-level usage repeats the final internal attempt. Count internal records exclusively when supplied.
            const records = response?.attempts?.length ? response.attempts : [{ usage: response?.usage ?? attempt.usage }];
            for (const record of records) {
                total.providerAttempts++;
                const input = record.usage?.inputTokens, output = record.usage?.outputTokens;
                const knownInput = typeof input === 'number' && Number.isFinite(input) && input >= 0;
                const knownOutput = typeof output === 'number' && Number.isFinite(output) && output >= 0;
                if (knownInput) { total.knownInputTokens += input; if (total.inputTokens !== null) total.inputTokens += input; } else total.inputTokens = null;
                if (knownOutput) { total.knownOutputTokens += output; if (total.outputTokens !== null) total.outputTokens += output; } else total.outputTokens = null;
                if (!knownInput || !knownOutput) total.unresolvedAttempts++;
            }
        }
        return total;
    }

    async finish(lease: Lease, status: JobStatus, counters: JobCounters): Promise<boolean> {
        return this.repository.finishJob(lease, status, counters, undefined, await this.usage(lease.jobId));
    }

    async fail(lease: Lease, counters: () => Promise<JobCounters>, error: unknown): Promise<boolean> {
        const counted = await counters();
        return this.repository.finishJob(lease, counted.returnedAnswers ? 'partial' : 'failed', counted,
            error instanceof Error ? error.message : 'Analysis worker failed', await this.usage(lease.jobId));
    }
}
```

- [ ] **Step 3.6: Implement `window-runner.ts` (complete file)**

Create `analysis-worker/src/jev/window-runner.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { SerializedWindow } from '@sidechannel/contracts/analysis/evidence-contracts';
import { buildSystemOnePayload } from '@sidechannel/domain/analysis/jev-questions';
import { JevProviderError, type JevProvider, type JevQuestion, type JsonValue } from '@sidechannel/contracts/analysis/jev-provider';
import type { AnalysisAttempt, AnalysisJob, AnalysisResult, ArtifactStore, Lease, ResultStore, WindowRecord, WindowStore } from '@sidechannel/contracts/analysis/jev-repository';
import type { LeaseKeeper } from './lease-keeper.js';

export interface WindowPorts extends WindowStore, ResultStore, ArtifactStore {}

export interface WindowRun { job: AnalysisJob; lease: Lease; questions: JevQuestion[]; expected: string[]; provider: JevProvider; keeper: LeaseKeeper }

/** One window's provider batches: fenced attempts, immutable request/response artifacts, partial answers preserved. */
export class WindowRunner {
    constructor(private readonly repository: WindowPorts) {}

    async run(window: WindowRecord, run: WindowRun): Promise<void> {
        const { job, lease, questions, expected, provider, keeper } = run;
        const existing = await this.repository.listResults(job.id, { windowId: window.id, limit: 100 });
        const completed = new Set(existing.items.map(result => result.codeId));
        if (expected.every(id => completed.has(id))) { await this.repository.updateWindow(lease, window.id, { status: 'completed' }); return; }
        if (keeper.stopping) return;
        if (!await this.repository.updateWindow(lease, window.id, { status: 'running' })) return;
        const serialized = await this.repository.readArtifact<SerializedWindow>(window.inputRef);
        const batches = window.batches.length ? window.batches : [expected];
        const failures: string[] = [];
        let contextRejected = false;
        for (const batch of batches) {
            let failure = '';
            if (keeper.stopping) break;
            const wanted = questions.filter(question => batch.includes(question.codeId) && !completed.has(question.codeId));
            if (!wanted.length) continue;
            const controller = new AbortController();
            keeper.register(controller);
            const id = randomUUID(), requestRef = job.id + ':request:' + id;
            const request = { state: serialized.state as JsonValue, model: job.manifest.settings.model, questions: wanted };
            await this.repository.putArtifact(requestRef, { ...request, systemOne: buildSystemOnePayload(request) });
            const attempt: AnalysisAttempt = { id, jobId: job.id, windowId: window.id, codeIds: wanted.map(question => question.codeId),
                requestRef, startedAt: new Date().toISOString(), status: 'running', requestedModel: request.model };
            if (!await this.repository.startAttempt(lease, attempt)) { keeper.release(controller); return; }
            // Provider owns the finite retry budget. This outer deadline bounds faulty injected transports too.
            const settings = job.manifest.settings;
            const totalDeadline = settings.timeoutMs * settings.maxAttempts + settings.retryBaseMs * (2 ** settings.maxAttempts);
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const response = await Promise.race([
                    provider.classify({ ...request, signal: controller.signal }),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Provider request exceeded the frozen retry/timeout budget')); }, totalDeadline); }),
                ]);
                const responseRef = job.id + ':response:' + id;
                await this.repository.putArtifact(responseRef, response);
                const results: AnalysisResult[] = [], seen = new Set<string>();
                let badKeys = false;
                for (const answer of response.answers) {
                    if (!wanted.some(question => question.codeId === answer.codeId) || seen.has(answer.codeId)) { failure = 'Unexpected or duplicate provider response key'; badKeys = true; continue; }
                    seen.add(answer.codeId);
                    if (typeof answer.probability !== 'number' || !Number.isFinite(answer.probability) || answer.probability < 0 || answer.probability > 1) { failure = answer.error?.message ?? 'Missing or malformed answer'; continue; }
                    results.push({ id: randomUUID(), jobId: job.id, windowId: window.id, codeId: answer.codeId, probability: answer.probability, attemptId: id, createdAt: new Date().toISOString() });
                }
                if (seen.size !== wanted.length) failure = 'Provider omitted one or more requested answers';
                if (badKeys) results.length = 0;
                const finished = { ...attempt, status: results.length === wanted.length ? 'succeeded' as const : 'failed' as const,
                    finishedAt: new Date().toISOString(), responseRef, returnedModel: response.returnedModel, usage: response.usage, ...(failure ? { error: failure } : {}) };
                if (await this.repository.finishAttempt(lease, finished, results)) for (const result of results) completed.add(result.codeId);
            } catch (error) {
                failure = error instanceof Error ? error.message : 'Provider failed';
                const responseRef = job.id + ':response:' + id;
                contextRejected = error instanceof JevProviderError && error.failure.kind === 'context';
                await this.repository.putArtifact(responseRef, error instanceof JevProviderError ? { failure: error.failure, attempts: error.attempts } : { error: failure });
                await this.repository.finishAttempt(lease, { ...attempt, status: 'failed', finishedAt: new Date().toISOString(), responseRef, error: failure }, []);
            } finally { if (timer) clearTimeout(timer); keeper.release(controller); if (failure) failures.push(failure); }
            if (contextRejected) break;
        }
        await this.repository.updateWindow(lease, window.id, { status: expected.every(id => completed.has(id)) ? 'completed' : contextRejected ? 'oversized' : 'failed',
            diagnostics: [...window.diagnostics, ...failures] });
    }
}
```

- [ ] **Step 3.7: Replace the worker with the orchestrator (complete file)**

Replace `analysis-worker/src/jev/jev-worker.ts` with:

```ts
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AnalysisConfiguration } from '@sidechannel/contracts/analysis/evidence-contracts';
import { buildBehaviorQuestions } from '@sidechannel/domain/analysis/jev-questions';
import type { JevProvider } from '@sidechannel/contracts/analysis/jev-provider';
import type { AnalysisWorkerStore } from '@sidechannel/contracts/analysis/jev-repository';
import { pages } from '@sidechannel/domain/analysis/jev-service';
import { TypeSafeJevProvider } from './jev-provider.js';
import { LeaseKeeper } from './lease-keeper.js';
import { WindowRunner } from './window-runner.js';
import { ProgressLedger } from './progress-ledger.js';
import { UsageReconciler } from './usage-reconciler.js';

export interface AnalysisWorkerOptions { owner?: string; leaseMs?: number; heartbeatMs?: number; provider?: JevProvider; providerFactory?: (settings: AnalysisConfiguration) => JevProvider; }

/** Owns analysis leases only. Never invokes or mutates the experiment scheduler. */
export class AnalysisWorker {
    private readonly owner: string; private readonly leaseMs: number; private readonly heartbeatMs: number;
    private readonly windows: WindowRunner; private readonly progress: ProgressLedger; private readonly usage: UsageReconciler;

    constructor(private readonly repository: AnalysisWorkerStore, private readonly options: AnalysisWorkerOptions = {}) {
        this.owner = options.owner ?? randomUUID();
        this.leaseMs = options.leaseMs ?? 30_000;
        this.heartbeatMs = options.heartbeatMs ?? Math.floor(this.leaseMs / 3);
        if (this.leaseMs < 100 || this.heartbeatMs < 10 || this.heartbeatMs >= this.leaseMs) throw new Error('Heartbeat must be shorter than a positive lease');
        this.windows = new WindowRunner(repository);
        this.progress = new ProgressLedger(repository);
        this.usage = new UsageReconciler(repository);
    }

    async run(signal: AbortSignal) { while (!signal.aborted) { if (!await this.runOnce(signal)) try { await delay(500, undefined, { signal }); } catch {} } }

    async runOnce(signal?: AbortSignal): Promise<boolean> {
        const claimed = await this.repository.claim(this.owner, new Date().toISOString(), this.leaseMs);
        if (!claimed) return false;
        const { job, lease } = claimed;
        const keeper = new LeaseKeeper(this.repository, lease, job, { leaseMs: this.leaseMs, heartbeatMs: this.heartbeatMs }, signal);
        let provider: JevProvider | undefined;
        let pending: Promise<void>[] = [];
        keeper.start();
        try {
            if (!job.cancelRequested)
                provider = this.options.provider ?? this.options.providerFactory?.(job.manifest.settings) ?? new TypeSafeJevProvider({ timeoutMs: job.manifest.settings.timeoutMs, maxAttempts: job.manifest.settings.maxAttempts, retryBaseMs: job.manifest.settings.retryBaseMs });
            await this.progress.recover(lease, job.id);
            const questions = buildBehaviorQuestions(job.manifest.codebook.definitions), allIds = questions.map(question => question.codeId);
            const progress = await this.progress.counters(job.id, allIds.length);
            for await (const window of pages(page => this.repository.listWindows(job.id, page))) {
                if (keeper.stopping) break;
                if (window.status === 'skipped' || window.status === 'oversized') continue;
                const prior = await this.progress.snapshot(job.id, window);
                const task = this.windows.run(window, { job, lease, questions, expected: allIds, provider: provider!, keeper })
                    .catch(async error => {
                        await this.repository.updateWindow(lease, window.id, { status: 'failed', diagnostics: [...window.diagnostics, error instanceof Error ? error.message : 'Window failed'] });
                        throw error;
                    })
                    .finally(() => this.progress.settle(lease, job.id, window, progress, prior));
                // A fast failure can occur while the next page/read is awaited; attach a handler
                // immediately while retaining the original rejection for the batch drain below.
                void task.catch(() => {});
                pending.push(task);
                if (pending.length >= job.manifest.settings.concurrency) { await Promise.all(pending); pending = []; await keeper.beat(); }
            }
            await Promise.all(pending);
            if (keeper.leaseLost || signal?.aborted) return true; // Leave the lease recoverable after shutdown or loss.
            const counters = await this.progress.counters(job.id, allIds.length);
            await this.usage.finish(lease, this.progress.status(counters, keeper.cancelling), counters);
        } catch (error) {
            keeper.abortAll();
            await Promise.allSettled(pending);
            if (!keeper.leaseLost && !signal?.aborted)
                await this.usage.fail(lease, () => this.progress.counters(job.id, job.manifest.codebook.definitions.filter(definition => definition.enabled && !definition.archived).length), error);
        } finally { keeper.stop(); }
        return true;
    }
}
```

- [ ] **Step 3.8: Run the worker tests and the class-size check**

```bash
npm run check --workspace=@sidechannel/analysis-worker
node --import tsx --test analysis-worker/src/jev/jev-worker.test.ts
node -e "const s=require('node:fs').readFileSync('analysis-worker/src/jev/jev-worker.ts','utf8').split('\n'); const start=s.findIndex(l=>l.startsWith('export class AnalysisWorker')); let depth=0,end=start; for(let i=start;i<s.length;i++){depth+=(s[i].match(/{/g)||[]).length-(s[i].match(/}/g)||[]).length; if(depth===0&&i>start){end=i;break;}} console.log('class lines', end-start+1)"
```

Expected: `check` exits 0; the test file PASSES (3 tests); `class lines` ≤ 80.

- [ ] **Step 3.9: Run the Jev gate (existing tests are the gate — do not edit them)**

```bash
npm run build
node --import tsx --test tests/integration/analysis-jev-backend.test.ts
node --import tsx --test tests/integration/analysis-jev-api.test.ts tests/integration/analysis-evidence.test.ts
npm test --workspace=@sidechannel/analysis-worker
npm test
docker compose up -d --wait mongo
npm run test:integration
```

Expected: PASS, including: `partial answers survive retry`, `aggregate usage counts internal provider attempts once`, `out-of-order windows stay bounded` (max concurrency 2, exact counter object), `repository failure drains sibling responses`, `worker finalizes cancelled reclaimed lease without credentials`, `provider initialization failure is recorded`, `recovery records abandoned attempts`, `lease fences reject stale writes`, and `integration-jev.mongo.test.ts`.

- [ ] **Step 3.10: Commit**

```bash
git add analysis-worker/src/jev/lease-keeper.ts analysis-worker/src/jev/window-runner.ts analysis-worker/src/jev/progress-ledger.ts analysis-worker/src/jev/usage-reconciler.ts analysis-worker/src/jev/jev-worker.ts analysis-worker/src/jev/jev-worker.test.ts
git commit -m "refactor(analysis-worker): extract LeaseKeeper, WindowRunner, ProgressLedger and UsageReconciler"
```

---

## Task T3c.4: Split `HealthcareService` into resolver, provenance recorder and route adapter

**Files:**
- Create: `api/src/healthcare/resolver.ts`, `api/src/healthcare/routes.ts`, `api/src/healthcare/provenance.ts`, `api/src/healthcare/modules.test.ts`
- Modify: `api/src/healthcare/service.ts` (facade only)

**Interfaces:**
- Consumes: `HealthcareCatalog`; `createHealthcarePreset`; `evaluateHealthcareRun`, `HEALTHCARE_EVALUATOR_VERSION`; `ResearchRouteHandler`, `ResearcherRepository`.
- Produces (all consumed by the facade, which keeps `api/src/server/index.ts` untouched):
  - `resolveHealthcareConfiguration(catalog: HealthcareCatalog, input: unknown): Promise<unknown>`
  - `freezeHealthcareReference(catalog: HealthcareCatalog, run: Run): Promise<void>`
  - `healthcareResearcherExport(catalog: HealthcareCatalog, repository: ResearcherRepository, run: Run): Promise<{ scope: 'researcher-only'; evaluatorReference: unknown; evaluation: unknown } | undefined>`
  - `healthcareRouteHandler(catalog: HealthcareCatalog, repository: ResearcherRepository): ResearchRouteHandler`
  - unchanged: `class HealthcareService { constructor(readonly catalog: HealthcareCatalog); resolveConfiguration(input); freezeRunReference(run); researcherExport(run, repository); routes(repository); }`

**Effort:** ~1 dev-day.

**Behaviour-change statement:** none. Every route path, status code, body and error string (`datasets`, `…/preset`, `…/provenance`, `…/evaluation`, `404 Dataset not registered or incomplete`, `404 Run not found`, the `pending`/`unavailable`/`failed` evaluation envelopes) is preserved verbatim. **Validator rules are not moved and not re-stated:** they already exist exactly once, in `packages/domain/src/harness/config.ts:128-138` (five-role check, artifact schema, healthcare tool list, scripted-driver id, provider allowlist, asset validation). This task adds the guard test that keeps the API layer free of them.

- [ ] **Step 4.1: Confirm the current duplication state (record the evidence in the PR)**

```bash
git grep -n "HEALTHCARE_ROLES\|five canonical roles\|read_legacy_archive\|rank_cases\|HealthCare supports" -- api/src packages/domain/src
```

Expected: only `packages/domain/src/harness/config.ts:129,131,133,135` (plus `contracts`/`preset` implementations that own the role and tool vocabularies). `api/src/healthcare/service.ts` has **no** role/artifact/tool-list/provider rule — the deletion half of S3 is already true on disk; the plan records that with this command's output instead of inventing a change.

- [ ] **Step 4.2: Write the failing module tests**

Create `api/src/healthcare/modules.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { InMemoryHealthcareCatalog } from '@sidechannel/persistence/healthcare/catalog';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { createHealthcarePreset } from '@sidechannel/domain/healthcare/preset';
import { resolveHealthcareConfiguration } from './resolver.js';
import { healthcareRouteHandler } from './routes.js';
import { freezeHealthcareReference } from './provenance.js';
import { loadHealthcarePackage } from './bootstrap.js';

const fixturePath = fileURLToPath(new URL('../../data/healthcare/points-out/fixture10-s101-points/', import.meta.url));

async function catalog() {
    const store = new InMemoryHealthcareCatalog();
    const fixture = await loadHealthcarePackage(fixturePath);
    const item = await store.register(fixture);
    return { store, fixture, item };
}

const presetFor = (fixture: Awaited<ReturnType<typeof catalog>>['fixture'], item: Awaited<ReturnType<typeof catalog>>['item']) =>
    createHealthcarePreset(fixture.assets, { datasetId: item.datasetId, datasetVersion: item.datasetVersion, datasetSeed: 101 });

test('the resolver replaces untrusted assets and seed from the registered dataset', async () => {
    const { store, fixture, item } = await catalog();
    const config = presetFor(fixture, item);
    config.scenario.assets = { untrusted: true };
    config.scenario.datasetSeed = -1;
    const resolved = await resolveHealthcareConfiguration(store, config) as ExperimentConfig;
    assert.deepEqual(resolved.scenario.assets, fixture.assets);
    assert.equal(resolved.scenario.datasetSeed, 101);
    assert.equal(await resolveHealthcareConfiguration(store, 'not-an-object'), 'not-an-object');
});

test('unknown datasets fail with the documented field message', async () => {
    const { store, fixture, item } = await catalog();
    const config = presetFor(fixture, item);
    await assert.rejects(resolveHealthcareConfiguration(store, { ...config, scenario: { ...config.scenario, datasetId: 'missing' } }),
        /scenario.datasetId: Select a fully registered healthcare dataset/);
});

test('the route adapter answers datasets, preset and provenance without any rules', async () => {
    const { store, fixture, item } = await catalog();
    const handler = healthcareRouteHandler(store, new InMemoryRepository());
    const list = await handler({ method: 'GET', path: '/datasets', query: new URLSearchParams(), body: {} });
    assert.equal(list!.status, 200);
    const preset = await handler({ method: 'GET', path: `/datasets/${item.datasetId}/preset`, query: new URLSearchParams({ version: item.datasetVersion }), body: {} });
    assert.equal(preset!.status, 200);
    const provenance = await handler({ method: 'GET', path: `/datasets/${item.datasetId}/provenance`, query: new URLSearchParams({ version: item.datasetVersion }), body: {} });
    assert.deepEqual(provenance!.data, (await store.runtime(item.datasetId, item.datasetVersion))!.manifest);
    assert.equal((await handler({ method: 'GET', path: '/datasets/missing/preset', query: new URLSearchParams(), body: {} }))!.status, 404);
    assert.equal((await handler({ method: 'GET', path: '/runs/missing/evaluation', query: new URLSearchParams(), body: {} }))!.status, 404);
    assert.equal(fixture.packageHash.length, 64);
});

test('freezing records the dataset identity for healthcare runs and skips other scenarios', async () => {
    const { store, fixture, item } = await catalog();
    const run = createQueuedRun(presetFor(fixture, item), 'run-1');
    await freezeHealthcareReference(store, run);
    assert.equal((await store.getReference(run.id))!.truthHash, fixture.truthHash);
    const fixtureRun = createQueuedRun(defaultFixtureConfiguration(), 'run-2');
    await freezeHealthcareReference(store, fixtureRun);
    assert.equal(await store.getReference('run-2'), null);
});

test('healthcare rules live only in the domain configuration validator', async () => {
    const directory = new URL('.', import.meta.url);
    for (const file of ['service.ts', 'resolver.ts', 'routes.ts', 'provenance.ts', 'bootstrap.ts']) {
        const source = await readFile(new URL(file, directory), 'utf8');
        for (const rule of ['HEALTHCARE_ROLES', 'five canonical roles', 'read_legacy_archive', 'rank_cases', 'request_access', 'artifactSchemaVersion:'])
            assert.ok(!source.includes(rule), `${file} restates the healthcare rule ${rule}`);
    }
    const domain = await readFile(new URL('../../../packages/domain/src/harness/config.ts', directory), 'utf8');
    assert.match(domain, /roles: Healthcare requires exactly the five canonical roles/);
    assert.match(domain, /artifactSchemaVersion: Unsupported healthcare artifact schema/);
    assert.match(domain, /model.provider: Healthcare supports scripted development or Adaption/);
});
```

- [ ] **Step 4.3: Run it to verify it fails**

```bash
node --import tsx --test api/src/healthcare/modules.test.ts
```

Expected: FAIL — `Cannot find module './resolver.js'` (and `'./routes.js'`, `'./provenance.js'`).

Note on the guard test: it encodes "the rules have exactly one definition site, and it is not the API layer". WS3c runs before WS4 T4.2, so that site is `packages/domain/src/harness/config.ts`. If WS4 has already moved the healthcare checks into the scenario registry, repoint the three `assert.match` targets at the registry file — do not delete the guard or relax it.

- [ ] **Step 4.4: Implement `resolver.ts` (complete file)**

Create `api/src/healthcare/resolver.ts`:

```ts
import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import { HEALTHCARE_SCENARIO_VERSION } from '@sidechannel/contracts/healthcare/contracts';
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';

/** Ignore browser assets, seed and hashes; identity is resolved from immutable backend content. */
export async function resolveHealthcareConfiguration(catalog: HealthcareCatalog, input: unknown): Promise<unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
    const config = structuredClone(input) as ExperimentConfig;
    if (config.scenario?.version !== HEALTHCARE_SCENARIO_VERSION) return config;
    const dataset = await catalog.runtime(config.scenario.datasetId, config.scenario.datasetVersion);
    if (!dataset) throw new Error('scenario.datasetId: Select a fully registered healthcare dataset');
    if (!dataset.item.runtimeSupported) throw new Error('scenario.version: Dataset runtime is not installed');
    config.scenario.assets = dataset.assets as unknown as ExperimentConfig['scenario']['assets'];
    config.scenario.datasetSeed = dataset.manifest.provenance.seed;
    return config;
}
```

- [ ] **Step 4.5: Implement `routes.ts` (complete file)**

Create `api/src/healthcare/routes.ts` (body is `api/src/healthcare/service.ts:34-57` verbatim, `this.catalog` → `catalog`):

```ts
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { createHealthcarePreset } from '@sidechannel/domain/healthcare/preset';
import { evaluateHealthcareRun } from '@sidechannel/domain/healthcare/evaluation';

/** Dataset, preset, provenance and researcher-evaluation routes. Readiness policy only; no configuration rules. */
export function healthcareRouteHandler(catalog: HealthcareCatalog, repository: ResearcherRepository): ResearchRouteHandler {
    return async ({ method, path, query }) => {
        if (method === 'GET' && path === '/datasets') return { status: 200, data: await catalog.list() };
        const datasetMatch = path.match(/^\/datasets\/([^/]+)\/(preset|provenance)$/);
        if (method === 'GET' && datasetMatch) {
            const dataset = await catalog.runtime(decodeURIComponent(datasetMatch[1]!), query.get('version') ?? '0.3');
            if (!dataset) return { status: 404, data: { error: 'Dataset not registered or incomplete' } };
            return { status: 200, data: datasetMatch[2] === 'provenance' ? dataset.manifest
                : createHealthcarePreset(dataset.assets, { datasetId: dataset.item.datasetId, datasetVersion: dataset.item.datasetVersion, datasetSeed: dataset.manifest.provenance.seed }) };
        }
        const match = path.match(/^\/runs\/([^/]+)\/evaluation$/);
        if (method === 'GET' && match) {
            const run = await repository.getRun(decodeURIComponent(match[1]!));
            if (!run) return { status: 404, data: { error: 'Run not found' } };
            const reference = await catalog.getReference(run.id);
            if (!reference) return { status: 200, data: { status: 'unavailable', reason: 'No healthcare evaluator reference' } };
            const artifact = run.artifacts.at(-1);
            if (!artifact?.frozen) return { status: 200, data: { status: 'pending', reason: 'Artifact has not been frozen' } };
            if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) return { status: 200, data: { status: 'pending', reason: 'Waiting for execution and reports to finish' } };
            try {
                const previous = await catalog.getEvaluation(run.id, artifact.version, reference.evaluatorVersion);
                if (previous) return { status: 200, data: previous };
                const dataset = await catalog.runtime(reference.datasetId, reference.datasetVersion);
                if (!dataset) throw new Error('Frozen dataset unavailable');
                const truth = await catalog.evaluatorTruth(reference);
                return { status: 200, data: await catalog.saveEvaluation(evaluateHealthcareRun(run, dataset.assets, truth, reference)) };
            } catch (error) { return { status: 200, data: { status: 'failed', reason: error instanceof Error ? error.message : 'Evaluator failed' } }; }
        }
        return null;
    };
}
```

- [ ] **Step 4.6: Implement `provenance.ts` (complete file)**

Create `api/src/healthcare/provenance.ts`:

```ts
import type { Run } from '@sidechannel/contracts/harness/contracts';
import { HEALTHCARE_SCENARIO_VERSION } from '@sidechannel/contracts/healthcare/contracts';
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';
import type { ResearcherRepository } from '@sidechannel/contracts/server/contracts';
import { HEALTHCARE_EVALUATOR_VERSION } from '@sidechannel/domain/healthcare/evaluation';
import { healthcareRouteHandler } from './routes.js';

/** Freeze the dataset identity a run was launched against, before the run is queued. */
export async function freezeHealthcareReference(catalog: HealthcareCatalog, run: Run): Promise<void> {
    if (run.config.scenario.version !== HEALTHCARE_SCENARIO_VERSION) return;
    const dataset = await catalog.runtime(run.config.scenario.datasetId, run.config.scenario.datasetVersion);
    if (!dataset) throw new Error('Healthcare dataset unavailable');
    await catalog.freezeReference({ runId: run.id, datasetId: dataset.item.datasetId, datasetVersion: dataset.item.datasetVersion,
        packageHash: dataset.item.packageHash, assetsHash: dataset.item.assetsHash, truthHash: dataset.truthHash,
        scoringVersion: dataset.assets.public.scoring_version, evaluatorVersion: HEALTHCARE_EVALUATOR_VERSION });
}

/** Researcher-only export envelope; the evaluation itself is served by the same route handler. */
export async function healthcareResearcherExport(catalog: HealthcareCatalog, repository: ResearcherRepository, run: Run) {
    if (run.config.scenario.version !== HEALTHCARE_SCENARIO_VERSION) return undefined;
    const response = await healthcareRouteHandler(catalog, repository)({ method: 'GET', path: `/runs/${encodeURIComponent(run.id)}/evaluation`, query: new URLSearchParams(), body: {} });
    return { scope: 'researcher-only', evaluatorReference: await catalog.getReference(run.id),
        evaluation: response?.data ?? { status: 'unavailable', reason: 'No evaluation available' } };
}
```

- [ ] **Step 4.7: Reduce `service.ts` to the facade (complete file)**

Replace `api/src/healthcare/service.ts` with:

```ts
import type { Run } from '@sidechannel/contracts/harness/contracts';
import type { HealthcareCatalog } from '@sidechannel/contracts/healthcare/repository';
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { resolveHealthcareConfiguration } from './resolver.js';
import { healthcareRouteHandler } from './routes.js';
import { freezeHealthcareReference, healthcareResearcherExport } from './provenance.js';

/** Facade kept for `createResearcherServer`; each method delegates to one responsibility module. */
export class HealthcareService {
    constructor(readonly catalog: HealthcareCatalog) { }
    resolveConfiguration(input: unknown): Promise<unknown> { return resolveHealthcareConfiguration(this.catalog, input); }
    freezeRunReference(run: Run): Promise<void> { return freezeHealthcareReference(this.catalog, run); }
    researcherExport(run: Run, repository: ResearcherRepository) { return healthcareResearcherExport(this.catalog, repository, run); }
    routes(repository: ResearcherRepository): ResearchRouteHandler { return healthcareRouteHandler(this.catalog, repository); }
}
```

- [ ] **Step 4.8: Run the module tests, then the characterization gate**

```bash
node --import tsx --test api/src/healthcare/modules.test.ts
npm test --workspace=@sidechannel/api
npm run build
docker compose up -d --wait mongo
npm run test:integration
```

Expected: `modules.test.ts` PASS (5 tests). `api` package tests PASS, including the unchanged `api/src/healthcare/healthcare.test.ts` (four tests: registration/provenance, catalog-backed launch + pair equality + frozen references, field-error failures through `/config/validate` and `/runs`, and the pending→completed evaluation with export) and `api/src/server/server.test.ts`. `npm run test:integration` PASS, including `tests/integration/healthcare.mongo.test.ts`.

- [ ] **Step 4.9: Run the healthcare smoke (Mongo + experiment worker)**

```bash
npm run build
docker compose up -d --wait mongo
npm run smoke:healthcare
```

Expected: PASS — `evaluation.structuralCompleteness === true`, `approved.exactOrderingMatch === true`, five reports per run, `researcherEvaluation.evaluatorReference.truthHash` unchanged.

- [ ] **Step 4.10: Commit**

```bash
git add api/src/healthcare/resolver.ts api/src/healthcare/routes.ts api/src/healthcare/provenance.ts api/src/healthcare/service.ts api/src/healthcare/modules.test.ts
git commit -m "refactor(healthcare): resolver, route adapter and provenance modules; rules stay in domain config"
```

---

## Task T3c.5: Domain failure producers carry `FailureKind` (X3 completion)

**Files:**
- Modify: `packages/contracts/src/analysis/jev-repository.ts` (`Analysis*` classes), `packages/contracts/src/harness/repository.ts` (`RepositoryConflict`)
- Delete: `packages/domain/src/oversight/errors.ts`; modify `{definition,preview,launch,cancel,reviews,service}.ts`
- Modify: `analysis-worker/src/oversight/worker.ts` (import plus the `instanceof` narrowing)
- Modify: `api/src/routes/oversight.ts` (four route-level throws → `HttpError`), `api/src/server/errors.ts` (delete the legacy `OversightError` branch), `api/src/server/errors.test.ts` (delete the `OversightError` case)
- Create: `tests/integration/oversight-failures.test.ts`

**Interfaces:**
- Consumes: `DomainFailure`, `FailureKind` (`@sidechannel/contracts/errors`); `statusOf`, `messageOf`, `HttpError`, `sendFailure` (`api/src/server/errors.ts`, WS3a).
- Produces: kinded error classes that keep their names and constructor arity so existing `instanceof` assertions keep working:

```ts
export class AnalysisConflict extends DomainFailure { constructor(message: string) { super('conflict', message); } }
export class AnalysisNotFound extends DomainFailure { constructor(message: string) { super('not-found', message); } }
export class AnalysisValidation extends DomainFailure { constructor(message: string) { super('invalid', message); } }
export class AnalysisPayloadTooLarge extends DomainFailure { constructor(message: string) { super('too-large', message); } }
export class RepositoryConflict extends DomainFailure { constructor(message: string) { super('conflict', message); } }
```

- Removes: `OversightError` and every `readonly status` in the domain/contracts error surface.

**Effort:** ~1.5 dev-days.

**Behaviour-change statement:** exactly one intentional change — the two `OversightError(500, …)` preview failures in `getMonitorPreview` become `DomainFailure('unavailable', …)` and map to **503** instead of 500 (500 is not a `FailureKind`; the two triggers are "a stored part is missing" and "content hash mismatch", both genuinely unavailable). Evidence: `git grep -n "status, 500"` under `tests/` returns nothing; `tests/integration/oversight-recovery.test.ts` asserts the message (`/integrity check failed/`) and the worker-recorded text, not the status. Every other status is unchanged: `invalid→400`, `not-found→404`, `conflict→409`, `too-large→413`, and the oversight route keeps its own `400` `ZodError` payload and its `405` method rejection.

- [ ] **Step 5.1: Precondition check (WS3a landed)**

```bash
node -e "const s=require('node:fs').readFileSync('api/src/server/errors.ts','utf8'); console.log(/export function statusOf/.test(s) && /class HttpError/.test(s) && /OversightError/.test(s) ? 'ready' : 'BLOCKED: WS3a Task 2 must land first')"
```

Expected: `ready` (WS3a's boundary exists and still carries the `OversightError` fallback this task removes).

- [ ] **Step 5.2: Write the failing failure-mapping test**

Create `tests/integration/oversight-failures.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryResearchStore } from '@sidechannel/persistence/analysis/store';
import { DomainFailure } from '@sidechannel/contracts/errors';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { createMonitorPreview, currentDefinition, getMonitorPreview, saveDefinition } from '@sidechannel/domain/oversight/service';
import { createOversightHandler } from '../../api/src/routes/oversight.js';
import { createResearcherServer } from '../../api/src/server/index.js';

const settings = { model: { provider: 'test', id: 'monitor-only', settings: {} }, maxInputChars: 1_000_000, contextWindowTokens: 1_000_000, outputAllowanceTokens: 2048, timeoutMs: 1000 };

async function fixture() {
    const repository = new InMemoryRepository(), store = new InMemoryResearchStore();
    const run = createQueuedRun(defaultFixtureConfiguration(), 'failure-source');
    run.status = 'completed';
    run.reports = [{ agentId: 'alpha', raw: 'I contributed my fragment.', parsed: null }];
    run.artifacts = [{ version: 1, previousVersion: 0, authorId: 'alpha', operationId: 'freeze', frozen: true, value: { submitted: 'fragment' } }];
    await repository.createRun(run);
    await repository.appendEvent({ runId: run.id, agentId: 'alpha', type: 'report_submitted', data: { raw: run.reports[0]!.raw } });
    return { repository, store, run };
}

test('domain producers report a failure kind instead of an HTTP status', async () => {
    const { repository, store } = await fixture();
    await assert.rejects(createMonitorPreview(repository, store, { ...settings, runIds: ['missing'], definitionRevision: 1 }),
        (error: unknown) => error instanceof DomainFailure && error.kind === 'not-found' && /not found/.test(error.message));
    const definition = await currentDefinition(store);
    await assert.rejects(saveDefinition(store, { expectedRevision: definition.revision + 5, questions: 'q', outcomes: definition.outcomes }),
        (error: unknown) => error instanceof DomainFailure && error.kind === 'conflict');
    await assert.rejects(createMonitorPreview(repository, store, { ...settings, runIds: ['a', 'a'], definitionRevision: definition.revision }),
        (error: unknown) => error instanceof DomainFailure && error.kind === 'invalid');
});

test('oversight routes keep their statuses; integrity failures are 503', async () => {
    const { repository, store, run } = await fixture();
    const server = createResearcherServer(repository, { extensionHandlers: [createOversightHandler(repository, store)] });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert(address && typeof address !== 'string');
    const call = async (method: string, path: string, body?: unknown) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method,
            ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
        return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    try {
        const definition = await currentDefinition(store);
        assert.equal((await call('POST', '/monitor/preview', { ...settings, runIds: ['missing'], definitionRevision: definition.revision })).status, 404);
        assert.equal((await call('POST', '/monitor/preview', { ...settings, runIds: ['a', 'a'], definitionRevision: definition.revision })).status, 400);
        assert.equal((await call('POST', '/monitor-definitions', { expectedRevision: 99, questions: 'q', outcomes: definition.outcomes })).status, 409);
        assert.equal((await call('PUT', '/monitor-evaluations/anything')).status, 405);
        const created = await call('POST', '/monitor/preview', { ...settings, runIds: [run.id], definitionRevision: definition.revision });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        const previewId = String(created.body.id);
        const parts = await store.page<{ id: string; text: string; revision: number; createdAt: string }>('monitor_preview_parts', {}, '', 10);
        const part = parts.items.find(item => item.id.startsWith(previewId + ':'))!;
        await store.replace('monitor_preview_parts', part.id, part.revision, { ...part, revision: part.revision + 1, text: part.text + 'tampered' });
        await assert.rejects(getMonitorPreview(store, previewId), /integrity check failed/);
        assert.equal((await call('POST', '/monitor-evaluations', { previewId, previewHash: String(created.body.hash), idempotencyKey: 'integrity' })).status, 503);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
```

- [ ] **Step 5.3: Run it to verify it fails**

```bash
npm run build
node --import tsx --test tests/integration/oversight-failures.test.ts
```

Expected: FAIL — before this task `OversightError` is not a `DomainFailure` (first test), and the tampered-preview launch answers `500` instead of `503` (second test).

- [ ] **Step 5.4: Make the exception classes kinded**

`packages/contracts/src/analysis/jev-repository.ts` — add the import and replace lines 41-47:

```ts
import { DomainFailure } from '../errors.js';
```

```ts
export class AnalysisConflict extends DomainFailure { constructor(message: string) { super('conflict', message); } }

export class AnalysisNotFound extends DomainFailure { constructor(message: string) { super('not-found', message); } }

export class AnalysisValidation extends DomainFailure { constructor(message: string) { super('invalid', message); } }

export class AnalysisPayloadTooLarge extends DomainFailure { constructor(message: string) { super('too-large', message); } }
```

`packages/contracts/src/harness/repository.ts:16`:

```ts
export class RepositoryConflict extends DomainFailure { constructor(message: string) { super('conflict', message); } }
```

with `import { DomainFailure } from '../errors.js';` added next to the existing type import.

- [ ] **Step 5.5: Migrate the oversight producers (exact kind map)**

Delete `packages/domain/src/oversight/errors.ts`. In every oversight module, import `{ DomainFailure }` from `@sidechannel/contracts/errors` and apply this map — **messages unchanged character for character**:

| File | Old | New |
| --- | --- | --- |
| `definition.ts` (`saveDefinition`) | `OversightError(400, 'Outcome IDs must be unique')`<br>`(400, 'Enable at least one outcome')`<br>`(400, 'Archive existing outcomes instead of removing their stable IDs.')` | `DomainFailure('invalid', …)` ×3 |
| `definition.ts` | `(409, 'Monitor definition changed. Reload and reconcile your edits.')`<br>`(409, 'A teammate saved this revision first. Reload and reconcile your edits.')` | `DomainFailure('conflict', …)` ×2 |
| `preview.ts` | `(409, 'Monitor definition changed. Reload before previewing.')` | `('conflict', …)` |
| `preview.ts` | `(400, 'Output token setting must fit the output allowance, which must be smaller than the context window.')`<br>`(400, 'Select each source run once')`<br>`(400, \`Run ${runId} must be completed before oversight\`)` | `('invalid', …)` ×3 |
| `preview.ts` | `(404, \`Run ${runId} not found\`)` | `('not-found', …)` |
| `preview.ts` | `(500, 'Frozen monitor preview part is missing')`<br>`(500, 'Frozen monitor preview integrity check failed')` | `('unavailable', …)` ×2 — the documented 500→503 change |
| `launch.ts` | `(409, 'Launch key is already bound to another preview')`<br>`(409, 'Preview hash mismatch')`<br>`(409, 'Monitor definition changed since preview. Preview again.')`<br>`(409, \`Source run ${source.runId} is no longer completed\`)`<br>`(409, \`Evidence changed for ${source.runId}. Preview again.\`)` | `('conflict', …)` ×5 |
| `launch.ts` | `(404, 'Preview not found')` | `('not-found', …)` |
| `cancel.ts` | `(404, 'Monitor evaluation not found')`<br>`(409, 'Evaluation changed while cancelling; retry the request.')` | `('not-found', …)` / `('conflict', …)` |
| `reviews.ts` | `(404, 'Run not found')`, `(404, 'Monitor definition revision not found')` | `('not-found', …)` ×2 |
| `reviews.ts` | `(409, 'Run outcome review requires a terminal source run')`, `(409, 'Source evidence changed; reload review context before judging')`, `(409, 'Supply supersedesId for your latest review revision')`, `(409, 'Superseded review does not match this reviewer and outcome')`, `(409, 'A concurrent review was saved; reload history and retry')` | `('conflict', …)` ×5 |
| `reviews.ts` | `(400, 'Outcome must be enabled in the named immutable definition revision')`, `(400, 'Citations must be unique event IDs from this source run')`, `(400, 'A present outcome requires supporting source event citations')`, `(400, 'Unknown outcome in this definition revision')` | `('invalid', …)` ×4 |

Then update `service.ts`'s barrel: delete the `export { OversightError } from './errors.js';` line.

- [ ] **Step 5.6: Update the two consumers outside the domain**

`analysis-worker/src/oversight/worker.ts` — replace the `OversightError` import and the narrowing:

```ts
import { getMonitorPreview } from '@sidechannel/domain/oversight/service';
import { DomainFailure } from '@sidechannel/contracts/errors';
```

```ts
            catch (error) {
                if (!(error instanceof DomainFailure)) throw error;
```

`api/src/routes/oversight.ts` — WS3a Task 4 already deleted the `if (error instanceof OversightError) …` catch branch and kept only the `ZodError` branch, but the route still throws `OversightError` in four places (they relied on `statusOf`'s legacy typed-status branch). Confirm the current shape first:

```bash
git grep -n "OversightError" -- api/src/routes/oversight.ts
```

Expected: the import plus four throws (`limit`, `reviews/latest`, two `405`s). Replace them with the transport-layer error — 400/405 are API concerns, not domain kinds — and delete the import:

```ts
import { HttpError } from '../server/errors.js';
```

```ts
function limit(query: URLSearchParams) {
    const value = Number(query.get('limit') ?? 50);
    if (!Number.isSafeInteger(value) || value < 1 || value > 200) throw new HttpError(400, 'limit must be an integer from 1 to 200');
    return value;
}
```

```ts
                    if (!reviewer || !outcomeId || !definitionRevisionId) throw new HttpError(400, 'reviewer, outcomeId and definitionRevisionId are required');
```

```ts
                throw new HttpError(405, 'Method not allowed');
```

```ts
                if (method !== 'GET') throw new HttpError(405, 'Method not allowed');
                const evaluation = await store.get<MonitorEvaluation>('monitor_evaluations', id);
                if (!evaluation) throw new HttpError(404, 'Monitor evaluation not found');
```

The catch block now only handles `ZodError`; leave it exactly as WS3a wrote it (`400 { error: 'Invalid monitor configuration', issues }`), and do not add a general mapper branch — the shared boundary in `api/src/server/errors.ts` owns that.

`api/src/server/errors.ts` — delete the legacy typed-`status` fallback that exists only for this now-deleted class: remove `import { OversightError } from '@sidechannel/domain/oversight/service';` and the `if (error instanceof OversightError) return error.status;` line inside `statusOf`. Keep the `DomainFailure`, `HttpError`, `Analysis*`, `RepositoryConflict` and unknown → 400 branches. Verify with:

```bash
git grep -n "OversightError" -- api/src/server/errors.ts api/src/server/errors.test.ts
```

`api/src/server/errors.test.ts` — delete the `OversightError` assertion (`assert.equal(statusOf(new OversightError(404, 'x')), 404);`) and its import; keep the `AnalysisConflict`/`AnalysisNotFound`/`AnalysisValidation`/`AnalysisPayloadTooLarge`/`RepositoryConflict` assertions and the unknown → 400 cases untouched.

- [ ] **Step 5.7: Verify no status literals remain in the domain error surface**

```bash
git grep -n "readonly status = \|OversightError" -- packages/domain packages/contracts api/src analysis-worker/src
```

Expected: no matches for `readonly status = ` in `packages/domain`/`packages/contracts`, and no `OversightError` anywhere. (Route-level `HttpError(405, …)` is the transport layer; 405 is not a domain kind.)

- [ ] **Step 5.8: Run the failure test, then every affected suite**

```bash
npm run build
node --import tsx --test tests/integration/oversight-failures.test.ts
npm run check
node --import tsx --test tests/integration/analysis-jev-backend.test.ts tests/integration/analysis-jev-api.test.ts tests/integration/analysis-review-filtering.test.ts tests/integration/analysis-reviews.test.ts
node --import tsx --test tests/integration/oversight-oversight.test.ts tests/integration/oversight-recovery.test.ts tests/integration/oversight-reviews.test.ts
npm test
docker compose up -d --wait mongo
npm run test:integration
```

Expected: PASS everywhere. In particular `analysis-jev-backend.test.ts` still passes `AnalysisConflict`/`AnalysisValidation` as `assert.rejects` matchers (the classes are still those classes, now `DomainFailure` subclasses), `oversight-reviews.test.ts:127` still sees `400`, and no WS1 contract assertion changed.

- [ ] **Step 5.9: Record the decision**

Append to `docs/solid-remediation-decisions.md` (create it if WS0/WS1 has not):

```markdown
## WS3c — Domain, persistence and worker splits (2026-11-07)

- Frozen monitor previews are stored through `BlobStore` (`packages/contracts/src/oversight/blob-store.ts`), implemented by `ResearchBlobStore` in persistence. Part rows, the 250 000-character chunk size and the `contentHash` formula are unchanged, so previews written before the refactor still verify.
- Launch-idempotency and matched-pair invariants live in `packages/domain/src/harness/launch.ts`; adapters call them and throw nothing of their own for those rules.
- `AnalysisWorker` composes `LeaseKeeper`, `WindowRunner`, `ProgressLedger` and `UsageReconciler`; its constructor and `runOnce` contract are unchanged.
- `HealthcareService` is a four-method facade over resolver/route/provenance modules. Healthcare configuration rules exist only in `packages/domain/src/harness/config.ts`.
- X3: domain failures carry `FailureKind`. `OversightError` and every `readonly status` are deleted; `AnalysisConflict`/`AnalysisNotFound`/`AnalysisValidation`/`AnalysisPayloadTooLarge`/`RepositoryConflict` extend `DomainFailure` and keep their names and messages.
- Approved status change: the two frozen-preview integrity failures now map to 503 (`unavailable`) instead of 500. No test asserted 500; 500 is not a failure kind.
- Deferred: `ReviewService`'s plain `Error` throws are typed by WS3a Task 5 (with the `review-routes.ts` regex mapper removed in the same task); WS3c does not touch them.
```

- [ ] **Step 5.10: Commit**

```bash
git add packages/contracts/src/analysis/jev-repository.ts packages/contracts/src/harness/repository.ts packages/domain/src/oversight analysis-worker/src/oversight/worker.ts api/src/routes/oversight.ts api/src/server/errors.ts tests/integration/oversight-failures.test.ts docs/solid-remediation-decisions.md
git commit -m "refactor(domain): DomainFailure carries failure kinds; oversight statuses preserved"
```

---

## Verification summary

| Check | Command | Expected |
| --- | --- | --- |
| Lint + boundaries | `npm run lint && node scripts/verify-boundaries.mjs` | exit 0 (no new layering imports; domain never imports persistence) |
| Types | `npm run check` | exit 0 |
| Unit + memory contracts | `npm test` | PASS, including `port-contracts.test.ts` with the blob-store entry |
| Mongo parity | `npm run test:integration` | PASS, including `port-contracts.mongo.test.ts` and `integration-jev.mongo.test.ts` |
| Build / compiled | `npm run build && node scripts/verify-compiled.mjs` | PASS |
| Migration equivalence | `node scripts/verify-migration-equivalence.mjs` | PASS (no schema or payload change) |
| WS1 parity not regressed | `git diff --stat tests/integration/contracts` after T3c.1–T3c.5 | only `contracts/blob-store.ts` added; the three WS1 suites untouched |
| Oversight integration | `node --import tsx --test tests/integration/oversight-*.test.ts` | PASS (preview >14 MB, cancel, recovery, comparisons) |
| Jev integration | `node --import tsx --test tests/integration/analysis-*.test.ts` | PASS (`analysis-jev-backend`, `analysis-jev-api`, `analysis-evidence`, `analysis-reviews`, `analysis-review-filtering`) |
| Healthcare unit + smoke | `npm test --workspace=@sidechannel/api` and `npm run smoke:healthcare` | PASS |
| Module budgets | `node -e` line counts from Steps 2.15 and 3.8, plus `wc -l packages/persistence/src/harness/{schema.ts,memory/repository.ts,mongo/repository.ts}` | oversight modules ≤ 120, `oversight/service.ts` ≤ 12, `AnalysisWorker` class ≤ 80, persistence adapters ≤ 300 |
| Status parity | `node --import tsx --test tests/integration/oversight-failures.test.ts` | 400/404/405/409 unchanged; 503 only for preview integrity |

## Rollback

Each task is one commit; `git revert <commit>` restores the previous tree. No database migration is involved, and no collection, field, index or stored blob changes shape, so a revert needs no data action on existing Mongo databases.

- **T3c.1** reverts to the single-file adapters. Frozen previews are unaffected; contract suites keep their WS1 state.
- **T3c.2** reverts the `BlobStore` port and re-inlines preview chunking in `domain/oversight/service.ts`. Previews written during the task remain valid after revert (same rows, same hash), so no orphan cleanup is needed.
- **T3c.3** reverts to the monolithic `AnalysisWorker`. Job documents are untouched (the same `updateCounters`/`finishJob` calls were issued), so an in-flight job is resumed by the reverted worker through the ordinary lease-expiry path.
- **T3c.4** reverts the facade split; the route surface and statuses were never changed.
- **T3c.5** reverts to `OversightError`/typed `status`; the WS3a mapper's legacy branch must be restored in the same revert (it is deleted in the same commit).

Rollback order is reverse task order (T3c.5 → T3c.1); reverting T3c.2 before T3c.5 would leave `preview.ts` importing a deleted `errors.ts`.

## Out of scope (owned elsewhere)

- `ReviewService`'s plain `Error` throws and `api/src/routes/review-routes.ts` message-regex status mapping → WS3a Task 5 (it types those throws and deletes the regex mapper). WS3c deliberately leaves `domain/analysis/jev-reviews.ts` untouched.
- Scenario-version literals, including the hardcoded `'healthcare-points-v0.3'` check at `api/src/server/index.ts:69`, and healthcare tool semantics in `experiment-worker/src/harness/healthcare-scenario.ts` → WS4 T4.2 (scenario registry).
- Provider-settings policy and the byte-identical `inference-provider.ts` copy → WS4 T4.1.
- `HarnessScheduler` decomposition and the scheduler characterization suite → WS3b.
- `packages/contracts/src/errors.ts`, `api/src/server/errors.ts` authoring (only the legacy-branch deletion is touched here) → WS3a.
- Composition roots (`api/src/main.ts`, `analysis-worker/src/main.ts` object construction) → WS2 T2.4. This plan assumes `MongoResearchStore`/`MongoAnalysisRepository` are still constructed there and adds no wiring.
- `SUMMARY_OMIT`/`toRunSummary` duplication, `EVIDENCE_KINDS` dispatch tables, `MONITOR_VIEW_BUILDERS` → WS7 T7.2/T7.3 (WS7 also owns `domain/oversight/projections.ts`; this plan only imports `digest`/`buildProjection`).
- Deleting `processNextMonitorJob`'s dead `_repository` parameter (14 call sites in tests, smokes and `analysis-worker/src/main.ts`) → deferred as a separate mechanical PR; T3c.2 only narrows its type so the WS2 port change compiles.
- Canonical (sorted-key) hashing migration → WS7 T7.4.
- Dashboard changes of any kind → WS5/WS6.

## Self-review

- **Finding coverage.** P1: `domain/oversight/service.ts` (161 lines, ten responsibilities incl. Mongo chunking) → eight modules, each ≤ 120 lines, chunking behind `BlobStore` (T3c.2). P2: `persistence/harness/repository.ts` (273 lines, twelve responsibilities, restated invariants) → `memory/`, `mongo/`, `schema.ts` plus domain `launch.ts` (T3c.1). S9: `AnalysisWorker` (131 lines: lease lifecycle + scheduling + budget + accounting) → four collaborators, orchestrator class < 80 lines, Jev integration tests unchanged as the gate (T3c.3). S3: `HealthcareService` (four responsibilities) → resolver/routes/provenance + facade, rules provably only in `domain/harness/config.ts` (T3c.4). X3 completion: `OversightError` and all typed `status` properties deleted; `DomainFailure` kinds drive the API mapper (T3c.5).
- **Placeholders.** None. Every code-changing step shows either the complete file or an exact `file:line-range` → `new/file:line` move map with the new signature, plus the exact edits inside the moved block.
- **Type consistency.** `assertSameLaunchConfiguration`/`assertMatchedPair` are named once and called from both adapters. `BlobStore`/`BlobManifest`/`MonitorStore` keep the names used in `preview.ts`, `ResearchBlobStore`, the store classes and the contract suite. `MonitorStore` is a composition (`ResearchStore & BlobStore`), matching the WS2 precedent of composed ports and keeping `createMonitorPreview`/`launchMonitor` positional signatures so no call site churns. `LeaseKeeper`/`WindowRunner`/`ProgressLedger`/`UsageReconciler` names match conventions §3.2, and `AnalysisWorker`'s constructor consumes WS2's `AnalysisWorkerStore` verbatim (no locally invented alias). Oversight functions take `OversightSource` (`Pick<Repository, 'getRun' | 'listEvents'>`), which WS2's `createOversightHandler` slice provides and a full `Repository` still satisfies; `MonitorStore` is the composed `ResearchStore & BlobStore` consumed by preview/launch.
- **Deviations from the source and from the task text (trust the source):**
  1. `api/src/healthcare/service.ts` does **not** contain duplicated five-role/artifact/tool-list/provider rules at HEAD; they already exist only in `packages/domain/src/harness/config.ts:128-138`. The task's "delete the duplicate" is recorded as already-true with a verification command, and T3c.4 replaces it with the guard test that prevents re-duplication. The only remaining healthcare literal outside the domain is `'healthcare-points-v0.3'` at `api/src/server/index.ts:69`, which is a scenario literal owned by WS4 T4.2.
  2. The adapters are exported as `InMemoryRepository` (not `MemoryRepository`); the name is kept because every test, worker and API import site plus three `extends InMemoryRepository` test subclasses depend on it. The public path `@sidechannel/persistence/harness/repository` is preserved by the barrel.
  3. `BlobStore` is composed into the research store (`MonitorStore`) instead of being threaded as a fifth parameter through `processNextMonitorJob`, `analysis-worker/src/main.ts`, `api/src/routes/oversight.ts` and four test files. Rationale: every preview reader already holds the `ResearchStore`, the composed-port pattern is the one WS2 uses for `AnalysisRepository`/`ResearcherRepository`, and it keeps every call site's argument list stable (only two parameter *type annotations* widen). A smaller, safer diff for the same dependency inversion.
  4. Files outside conventions §4's literal WS3c list are declared here for the reviewer: `analysis-worker/src/oversight/worker.ts` (parameter type in T3c.2, `DomainFailure` narrowing in T3c.5), `api/src/routes/oversight.ts` (parameter type in T3c.2, `HttpError` throws in T3c.5), `api/src/server/errors.ts` and `api/src/server/errors.test.ts` (legacy `OversightError` branch and assertion removed in T3c.5), and `api/src/healthcare/modules.test.ts` is new but lives in WS3c's own `api/src/healthcare/**` area. Two package manifests gain an export path: `packages/contracts` (`./oversight/blob-store`) and `packages/domain` (`./harness/launch`); contract additions are owned by the workstream that introduces them.
  5. `ResearchBlobStore` hashes with `hash` from `@sidechannel/domain/analysis/store` (which WS1 makes an alias of `jsonHash`) rather than importing `@sidechannel/domain/hashing`, because WS1 adds `packages/domain/src/hashing.ts` without a package export path. The value is byte-identical (`sha256(JSON.stringify(text))`), which keeps stored manifests valid; if WS1 does add the `./hashing` export, importing `jsonHash` directly is equivalent.
  6. At plan-authoring time `tests/integration/contracts/` and `docs/solid-remediation-decisions.md` do not exist yet — they are WS1/WS0 deliverables, hence the hard precondition gates instead of assumed paths.
  7. WS2 exports `AnalysisWorkerStore` (`2026-11-07-ws2-ports-and-composition-roots.md` §T2.3) and `AnalysisWorker`'s constructor already takes it; this plan consumes that name unchanged instead of inventing an alias.
- **Behaviour-change statement.** One documented change only: two internal frozen-preview integrity failures answer 503 instead of 500. Everything else — event ordering, counters, usage numbers, stored hashes, blob rows, oversight/healthcare statuses for 400/404/405/409/413, and every WS1 contract assertion — is unchanged.
