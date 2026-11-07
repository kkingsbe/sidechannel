# WS1 — Adapter Contract Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the in-memory and Mongo persistence adapters provably interchangeable for the harness repository, analysis repository and research store, and de-duplicate five JSON-hash helpers without changing a single stored hash value.

**Architecture:** Add one shared contract suite per port under `tests/integration/contracts/`, executed by a fast memory-only entry (`npm test`) and a Mongo parity entry (`npm run test:integration`). Fix the behaviours where the adapters disagree, guided by the failing contract tests, then keep the suite as the permanent source of truth for port semantics. Hashing is de-duplicated into two explicitly named functions whose output is byte-identical to today's helpers; canonical (sorted-key) hashing is deliberately deferred to WS7 with a versioning migration.

**Tech Stack:** TypeScript 6.0.3, Node 22.18+/24.11+, `node:test` (via `scripts/test.mjs` + `tsx`), MongoDB 8 single-node replica set, npm workspaces + Nx.

## Global Constraints

- **No behavioural change** outside the port semantics fixed here. Event types, statuses, hash values, API payloads and fixture evidence must stay identical.
- **Verification (from repo root):** `npm run lint`, `node scripts/verify-boundaries.mjs`, `npm run check`, `npm test`, `npm run build`; with Mongo: `docker compose up -d --wait mongo` then `npm run test:integration`.
- **Mongo URI:** `TEST_MONGODB_URI` env var, default `mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0` (compose file). CI uses `27017`; always read the env var, never hardcode.
- **Test discovery:** `scripts/test.mjs <dir>` collects `*.test.ts` (unit) and, with `--mongo`, `*.mongo.test.ts` only. Suite helper files must NOT end in `.test.ts`.
- **Boundary rules:** no new runtime imports from `tests/` into packages; suites live in `tests/integration/` and import adapters via declared package exports. No test helper is exported from a production package.
- **Error messages are part of the contract** where tests assert them: keep the existing `RepositoryConflict` / `AnalysisConflict` / `AnalysisValidation` messages used below.
- **No destructive database migrations.** This plan only changes in-memory logic and two Mongo query/return-value behaviours; no schema changes.

---

## File structure

**Create**

| Path | Responsibility |
| --- | --- |
| `packages/domain/src/hashing.ts` | `jsonHash` (byte-compatible insertion-order) and `canonicalHash` (sorted keys, used by existing snapshot hashing); single implementation for all JSON hashing |
| `packages/domain/src/hashing.test.ts` | Byte-compatibility and determinism tests |
| `tests/integration/contracts/harness-repository.ts` | Contract suite for `ResearcherRepository` (run/event/draft/evidence/worker) |
| `tests/integration/contracts/analysis-repository.ts` | Contract suite for `AnalysisRepository` (codebooks/jobs/windows/artifacts/leases/results) |
| `tests/integration/contracts/research-store.ts` | Contract suite for `ResearchStore` (records/pages/leases) |
| `tests/integration/contracts/fixtures.ts` | Shared typed fixtures (config/run/job/window/attempt/codebook) |
| `tests/integration/port-contracts.test.ts` | Fast entry: runs all three suites against in-memory adapters (`npm test`) |
| `tests/integration/port-contracts.mongo.test.ts` | Parity entry: runs all three suites against Mongo adapters (`npm run test:integration`) |

**Modify**

| Path | Change |
| --- | --- |
| `packages/domain/src/analysis/store.ts` | Delegate `hash` to `jsonHash` |
| `packages/domain/src/oversight/projections.ts` | Delegate `digest` to `jsonHash` |
| `packages/domain/src/analysis/jev-reviews.ts` | Delegate local `hash` to `jsonHash` |
| `packages/domain/src/harness/initialization.ts` | Use `jsonHash(config)` for `configHash` |
| `packages/domain/src/analysis/configuration.ts` | Delegate `stableStringify`/`snapshotHash` to `canonicalJson`/`canonicalHash` |
| `packages/contracts/src/server/contracts.ts` | Add typed `WorkerStatus`, use it in `ResearcherRepository` |
| `packages/persistence/src/harness/repository.ts` | Missing-run evidence page, report-phase predicate, event clamp, typed `workerStatus` |
| `packages/persistence/src/analysis/jev-repository.ts` | `readyJob` no-op, `updateWindow` no-op, `finishAttempt` bound, `resultsForWindows` cap, bound-first ordering |
| `packages/persistence/src/analysis/store.ts` | Mongo `replace` returns matched (not modified) semantics |
| `docs/solid-remediation-decisions.md` | Record the agreed port semantics and the staged-hashing decision (create if WS0 has not) |

**Do not touch in this workstream:** ports (WS2), route handlers (WS3), dashboard (WS5), canonical hash ordering (WS7).

---

## Environment setup

- [ ] **Step 0.1: Install and build**

```bash
npm ci
npm run build
```

Expected: builds all packages; no errors.

- [ ] **Step 0.2: Start the local MongoDB replica set (needed from Task 2 onward)**

```bash
docker compose up -d --wait mongo
```

Expected: `sidechannel-harness-mongo` healthy on `127.0.0.1:27018`.

- [ ] **Step 0.3: Confirm the current suites are green before changing anything**

```bash
npm test
npm run test:integration
```

Expected: PASS for both. If not, stop and record the baseline.

---

## Task 1: Single JSON-hashing implementation (no value change)

**Files:**
- Create: `packages/domain/src/hashing.ts`
- Create: `packages/domain/src/hashing.test.ts`
- Modify: `packages/domain/src/analysis/store.ts:4`
- Modify: `packages/domain/src/oversight/projections.ts:1-5`
- Modify: `packages/domain/src/analysis/jev-reviews.ts:1-5`
- Modify: `packages/domain/src/harness/initialization.ts:1,6`
- Modify: `packages/domain/src/analysis/configuration.ts:1-14`

**Interfaces:**
- Produces: `jsonHash(value: unknown): string`, `canonicalJson(value: unknown): string`, `canonicalHash(value: unknown): string` from `@sidechannel/domain/hashing`.
- Preserves: `hash` (analysis store), `digest` (oversight projections), local `hash` (jev reviews), `stableStringify`/`snapshotHash` (analysis configuration), and `Run.configHash` output — all byte-identical.

- [ ] **Step 1.1: Write the failing tests**

Create `packages/domain/src/hashing.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalHash, canonicalJson, jsonHash } from './hashing.js';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

test('jsonHash is byte-compatible with the legacy JSON hash', () => {
    const value = { b: 1, a: [2, { d: undefined, c: 3 }] };
    assert.equal(jsonHash(value), sha256(JSON.stringify(value)));
});

test('canonicalHash is byte-compatible with the legacy snapshot hash', () => {
    const value = { b: 1, a: [{ d: 2 }] };
    assert.equal(canonicalHash(value), sha256('{"a":[{"d":2}],"b":1}'));
});

test('canonicalJson sorts keys, drops undefined members and preserves array order', () => {
    assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] }), '{"a":[{"d":2}],"b":1}');
});

test('canonicalHash ignores insertion order while jsonHash does not', () => {
    assert.equal(canonicalHash({ a: 1, b: 2 }), canonicalHash({ b: 2, a: 1 }));
    assert.notEqual(jsonHash({ a: 1, b: 2 }), jsonHash({ b: 2, a: 1 }));
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

```bash
node --import tsx --test packages/domain/src/hashing.test.ts
```

Expected: FAIL — `Cannot find module './hashing.js'` (file does not exist yet).

- [ ] **Step 1.3: Implement the module**

Create `packages/domain/src/hashing.ts`:

```ts
import { createHash } from 'node:crypto';

/**
 * Insertion-order JSON hash. Byte-compatible with the helpers that were previously
 * duplicated in analysis/store, analysis/jev-reviews, oversight/projections and
 * harness/initialization. Persisted identities (configHash, review keys, projections)
 * depend on this exact output; do not change it without a versioned migration.
 */
export function jsonHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Deterministic JSON: object keys sorted, `undefined` members dropped, array order preserved. */
export function canonicalJson(value: unknown): string {
    const normalize = (input: unknown): unknown => {
        if (Array.isArray(input)) return input.map(normalize);
        if (input && typeof input === 'object') {
            return Object.fromEntries(Object.entries(input as Record<string, unknown>)
                .filter(([, child]) => child !== undefined)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([key, child]) => [key, normalize(child)]));
        }
        return input;
    };
    return JSON.stringify(normalize(value));
}

/**
 * Sorted-key JSON hash. Byte-compatible with the previous `snapshotHash`; used for
 * analysis launch/preview/settings hashes.
 */
export function canonicalHash(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
```

- [ ] **Step 1.4: Run the test to verify it passes**

```bash
node --import tsx --test packages/domain/src/hashing.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 1.5: Delegate the five existing call sites**

`packages/domain/src/analysis/store.ts` — replace line 1 and line 4:

```ts
import { jsonHash } from '../hashing.js';
export const hash = jsonHash;
```

`packages/domain/src/oversight/projections.ts` — replace line 1 with `import { jsonHash } from '../hashing.js';` and line 5 with:

```ts
export const digest = jsonHash;
```

`packages/domain/src/analysis/jev-reviews.ts` — replace `import { createHash, randomUUID } from 'node:crypto';` with `import { randomUUID } from 'node:crypto';`, add `import { jsonHash } from '../hashing.js';`, and replace line 5 with:

```ts
const hash = jsonHash;
```

`packages/domain/src/harness/initialization.ts` — replace `import { createHash, randomUUID } from 'node:crypto';` with `import { randomUUID } from 'node:crypto';`, add `import { jsonHash } from './hashing.js';`, and replace the `configHash` expression with:

```ts
configHash: jsonHash(config),
```

`packages/domain/src/analysis/configuration.ts` — replace line 1 with `import { randomUUID } from 'node:crypto';`, add `import { canonicalHash, canonicalJson } from '../hashing.js';`, and replace lines 5-14 with:

```ts
export const stableStringify = canonicalJson;
export const snapshotHash = canonicalHash;
```

- [ ] **Step 1.6: Prove the persisted values are unchanged**

Run the domain tests and compare a fixture hash before/after:

```bash
npm run test --workspace @sidechannel/domain
npm test
```

Expected: PASS. Additional check — the fixture evidence export hash must match:

```bash
npm run build
node --import tsx -e "import('./packages/domain/dist/harness/initialization.js').then(async m => { const { defaultFixtureConfiguration, resolveConfiguration } = await import('./packages/domain/dist/harness/config.js'); console.log(m.createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'x').configHash); })"
```

Expected: the same hash on the pre-change commit (`git stash` + rerun) and after.

- [ ] **Step 1.7: Commit**

```bash
git add packages/domain/src/hashing.ts packages/domain/src/hashing.test.ts packages/domain/src/analysis/store.ts packages/domain/src/analysis/jev-reviews.ts packages/domain/src/analysis/configuration.ts packages/domain/src/oversight/projections.ts packages/domain/src/harness/initialization.ts
git commit -m "refactor(domain): single JSON hashing implementation, byte-identical output"
```

---

## Task 2: Contract harness + missing-run parity (harness repository)

**Files:**
- Create: `tests/integration/contracts/fixtures.ts`
- Create: `tests/integration/contracts/harness-repository.ts`
- Create: `tests/integration/port-contracts.test.ts`
- Modify: `packages/persistence/src/harness/repository.ts` (`getEvidencePage`)

**Interfaces:**
- Produces: `harnessRepositoryContract(harness: RepositoryHarness): void` where

```ts
export interface RepositoryHarness {
    name: string;
    fixture(): Promise<{ repository: ResearcherRepository; dispose(): Promise<void> }>;
}
```

- Consumes: `ResearcherRepository` from `@sidechannel/contracts/server/contracts`.

- [ ] **Step 2.1: Write the shared fixtures**

Create `tests/integration/contracts/fixtures.ts`:

```ts
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { Run } from '@sidechannel/contracts/harness/contracts';

export const fixtureConfig = () => resolveConfiguration(defaultFixtureConfiguration());

/** A queued run with a deterministic createdAt so queue ordering is testable. */
export function queuedRun(launchKey: string, overrides: Partial<Run> = {}): Run {
    return { ...createQueuedRun(fixtureConfig(), launchKey), ...overrides };
}
```

- [ ] **Step 2.2: Write the failing contract test for missing-run reads**

Create `tests/integration/contracts/harness-repository.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResearcherRepository } from '@sidechannel/contracts/server/contracts';
import { queuedRun } from './fixtures.js';

export interface RepositoryHarness {
    name: string;
    fixture(): Promise<{ repository: ResearcherRepository; dispose(): Promise<void> }>;
}

export function harnessRepositoryContract(harness: RepositoryHarness): void {
    test(`${harness.name}: unknown runs yield empty evidence, null items and null summaries`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);

        assert.deepEqual(await repository.getEvidencePage('missing', 'board', 0, 10), { items: [], total: 0 });
        assert.equal(await repository.getEvidenceItem('missing', 'board', 'message-1'), null);
        assert.equal(await repository.getRun('missing'), null);
        assert.equal(await repository.getRunSummary('missing'), null);
        assert.deepEqual(await repository.listEvents('missing'), []);
    });

    test(`${harness.name}: duplicate launch returns the original run`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);

        const run = queuedRun('launch');
        const created = await repository.createRun(run);
        assert.equal((await repository.createRun(queuedRun('launch'))).id, created.id);

        const changed = structuredClone(run);
        changed.config.label = 'Different configuration';
        await assert.rejects(repository.createRun(changed), /different launch configuration/);
    });
}
```

Create `tests/integration/port-contracts.test.ts`:

```ts
import { harnessRepositoryContract } from './contracts/harness-repository.js';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';

harnessRepositoryContract({
    name: 'memory',
    fixture: async () => ({ repository: new InMemoryRepository(), dispose: async () => {} }),
});
```

- [ ] **Step 2.3: Run the test to verify it fails**

The integration test resolves adapters through package exports (`dist/`), so rebuild before running:

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
```

Expected: FAIL on `unknown runs yield empty evidence…` with a `TypeError` from `getEvidencePage` (the in-memory adapter dereferences a missing run).

- [ ] **Step 2.4: Fix the in-memory adapter**

In `packages/persistence/src/harness/repository.ts`, replace `InMemoryRepository.getEvidencePage` (search for `async getEvidencePage`) with:

```ts
async getEvidencePage(id: string, kind: EvidenceKind, offset: number, limit: number): Promise<EvidencePage> {
    const run = this.runs.get(id);
    if (!run)
        return { items: [], total: 0 };
    return clone({ items: run[kind].slice(offset, offset + limit), total: run[kind].length,
        ...(kind === 'reports' ? { reporting: { instructions: run.config.reportInstructions, schemaVersion: run.config.reportSchemaVersion } } : {}) });
}
```

- [ ] **Step 2.5: Run the test to verify it passes**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 2.6: Commit**

```bash
git add tests/integration/contracts/fixtures.ts tests/integration/contracts/harness-repository.ts tests/integration/port-contracts.test.ts packages/persistence/src/harness/repository.ts
git commit -m "test(persistence): contract harness for researcher repository; fix missing-run evidence page"
```

---

## Task 3: Harness repository behavioural parity

**Files:**
- Modify: `tests/integration/contracts/harness-repository.ts` (add tests)
- Modify: `packages/contracts/src/server/contracts.ts` (typed `WorkerStatus`)
- Modify: `packages/persistence/src/harness/repository.ts` (phase predicate, clamp, `workerStatus`)

**Interfaces:**
- Produces: `WorkerStatus` in `@sidechannel/contracts/server/contracts`:

```ts
export interface WorkerStatus {
    capacity: number;
    available: null;
    status: 'registered' | 'unknown';
    startedAt?: string;
    note?: string;
}
```

- `ResearcherRepository.workerStatus(): Promise<WorkerStatus>`.

- [ ] **Step 3.1: Add the failing parity tests**

Append inside `harnessRepositoryContract` (before the closing brace):

```ts
    test(`${harness.name}: claim is exclusive and visible as running`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        const run = await repository.createRun(queuedRun('claim'));
        assert.deepEqual(await Promise.all([repository.claimRun(run.id, 'one'), repository.claimRun(run.id, 'two')]), [true, false]);
        assert.equal((await repository.getRun(run.id))!.status, 'running');
        assert.equal(await repository.claimRun('missing', 'one'), false);
    });

    test(`${harness.name}: saveRun preserves immutable fields and cancel write-through`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        const run = await repository.createRun(queuedRun('immutable'));
        const stale = (await repository.getRun(run.id))!;
        await repository.requestCancel(run.id);
        stale.config.label = 'illegal change';
        stale.status = 'completed';
        await repository.saveRun(stale);
        const saved = (await repository.getRun(run.id))!;
        assert.equal(saved.config.label, run.config.label);
        assert.equal(saved.cancelRequested, true);
        assert.equal(saved.status, 'stopping');
    });

    test(`${harness.name}: events get monotonic sequences and phase classification is report-first`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        const run = await repository.createRun(queuedRun('events'));
        const turn = await repository.appendEvent({ runId: run.id, type: 'turn_started', data: { phase: 'action' } });
        const report = await repository.appendEvent({ runId: run.id, type: 'report_submitted', data: { phase: 'action' } });
        const board = await repository.appendEvent({ runId: run.id, type: 'board_post', data: {}, agentId: 'alpha' });
        assert.deepEqual([turn.sequence, report.sequence, board.sequence], [1, 2, 3]);
        assert.deepEqual((await repository.queryEvents(run.id, { phase: 'report' })).map(event => event.id), [report.id]);
        assert.deepEqual((await repository.queryEvents(run.id, { phase: 'action' })).map(event => event.id), [turn.id, board.id]);
        assert.deepEqual((await repository.queryEvents(run.id, { actor: 'alpha' })).map(event => event.id), [board.id]);
        assert.deepEqual((await repository.queryEvents(run.id, { type: 'report_submitted' })).map(event => event.id), [report.id]);
        assert.deepEqual((await repository.queryEvents(run.id, { from: 2, to: 2 })).map(event => event.id), [report.id]);
    });

    test(`${harness.name}: drafts use optimistic revisions`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        const first = await repository.saveDraft('draft-1', { label: 'first' });
        assert.equal(first.revision, 1);
        await assert.rejects(repository.saveDraft('draft-1', { label: 'stale' }, 0), /Draft changed/);
        const second = await repository.saveDraft('draft-1', { label: 'second' }, 1);
        assert.equal(second.revision, 2);
        assert.deepEqual((await repository.listDrafts()).map(draft => draft.id), ['draft-1']);
        assert.deepEqual((await repository.getDraft('draft-1'))!.config, { label: 'second' });
    });

    test(`${harness.name}: run queries apply status, designation and queue ordering`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        const later = await repository.createRun(queuedRun('queue-a', { createdAt: '2026-01-01T00:00:00.000Z', pairPosition: 1 }));
        const earlier = await repository.createRun(queuedRun('queue-b', { createdAt: '2026-01-01T00:00:00.000Z', pairPosition: 0 }));
        const queued = await repository.queryRuns({ order: 'queue', limit: 10, offset: 0 });
        assert.deepEqual(queued.items.map(run => run.id), [earlier.id, later.id]);
        assert.equal(queued.total, 2);
        assert.equal((await repository.queryRuns({ status: 'queued', limit: 10, offset: 0 })).total, 2);
        assert.equal((await repository.queryRuns({ status: 'completed', limit: 10, offset: 0 })).total, 0);
        assert.equal((await repository.queryRuns({ designation: 'fixture', limit: 10, offset: 0 })).total, 2);
    });

    test(`${harness.name}: worker status is the documented shape`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        const status = await repository.workerStatus();
        assert.equal(status.capacity, 1);
        assert.equal(status.available, null);
        assert.ok(status.status === 'registered' || status.status === 'unknown');
        if (status.startedAt !== undefined) assert.equal(typeof status.startedAt, 'string');
    });
```

Also update `port-contracts.test.ts` if it lacks the import (it already imports the suite).

- [ ] **Step 3.2: Run the tests to verify they fail for the right reasons**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
```

Expected failures:
- `phase classification` — report event with `data.phase: 'action'` is classified `action` in memory (should be report).
- `worker status` — memory returns an untyped object; the assertion passes, but `tsc` fails on the missing `WorkerStatus` type once Step 3.3 lands. (If everything passes except phase, continue.)

- [ ] **Step 3.3: Add the typed worker status**

In `packages/contracts/src/server/contracts.ts`, add above `ResearcherRepository`:

```ts
/** Single-worker registration is a guard, not a heartbeat; availability is always unknown. */
export interface WorkerStatus {
    capacity: number;
    available: null;
    status: 'registered' | 'unknown';
    startedAt?: string;
    note?: string;
}
```

Replace `workerStatus(): Promise<unknown>;` with `workerStatus(): Promise<WorkerStatus>;`.

- [ ] **Step 3.4: Fix the in-memory semantics**

In `packages/persistence/src/harness/repository.ts`:

1. Replace the `eventPhase` helper with the report-first predicate that matches the Mongo query:

```ts
function eventPhase(event: HarnessEvent): string {
    const declared = (event.data as { phase?: string } | null)?.phase;
    if (declared === 'report' || event.type.startsWith('report') || event.invocationId?.includes(':report:'))
        return 'report';
    return declared ?? 'action';
}
```

2. Clamp event reads exactly like Mongo (`Math.min(limit, 10_000)`):

```ts
async listEvents(id: string, afterSequence = 0, limit = 1000) { return clone(this.events.filter(e => e.runId === id && e.sequence > afterSequence).slice(0, Math.min(limit, 10_000))); }
```

3. Type the memory worker status (replace memory `workerStatus`):

```ts
async workerStatus(): Promise<WorkerStatus> { return { capacity: 1, available: null, status: 'unknown' }; }
```

4. Type the Mongo worker status (replace Mongo `workerStatus`). Add the type import next to the existing contracts imports at the top of `packages/persistence/src/harness/repository.ts`:

```ts
import type { WorkerStatus } from '@sidechannel/contracts/server/contracts';
```

```ts
async workerStatus(): Promise<WorkerStatus> {
    const guard = await this.db.collection('worker_guard').findOne({ key: 'single-worker' }, { projection: { _id: 0, startedAt: 1 } });
    return { capacity: 1, available: null, status: guard ? 'registered' : 'unknown', ...(guard ? { startedAt: String(guard.startedAt) } : {}),
        note: 'Worker registration has no heartbeat; current availability is unknown.' };
}
```

- [ ] **Step 3.5: Run the tests to verify they pass**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
npm run check --workspace=@sidechannel/persistence
npm run check --workspace=@sidechannel/contracts
```

Expected: PASS (8 tests).

- [ ] **Step 3.6: Commit**

```bash
git add tests/integration/contracts/harness-repository.ts packages/contracts/src/server/contracts.ts packages/persistence/src/harness/repository.ts
git commit -m "fix(persistence): harness repository behavioural parity (phase, clamp, typed worker status)"
```

---

## Task 4: Analysis repository parity

**Files:**
- Create: `tests/integration/contracts/analysis-repository.ts`
- Modify: `tests/integration/port-contracts.test.ts`
- Modify: `packages/persistence/src/analysis/jev-repository.ts` (memory adapter)

**Interfaces:**
- Produces: `analysisRepositoryContract(harness: AnalysisRepositoryHarness): void` where

```ts
export interface AnalysisRepositoryHarness {
    name: string;
    fixture(): Promise<{ repository: AnalysisRepository; dispose(): Promise<void> }>;
}
```

- Consumes: `AnalysisRepository`, `AnalysisJob`, `WindowRecord`, `AnalysisAttempt` from `@sidechannel/contracts/analysis/jev-repository`; `emptyCounters` from `@sidechannel/domain/analysis/jev-repository`.

- [ ] **Step 4.1: Add typed job fixture helpers**

Append to `tests/integration/contracts/fixtures.ts`:

```ts
import { EVIDENCE_CATEGORIES, type AnalysisConfiguration, type EvidenceSelection, type SourceSnapshot } from '@sidechannel/contracts/analysis/evidence-contracts';
import type { AnalysisAttempt, AnalysisJob, WindowRecord } from '@sidechannel/contracts/analysis/jev-repository';
import { emptyCounters } from '@sidechannel/domain/analysis/jev-repository';

const flags = (value: boolean): EvidenceSelection => Object.fromEntries(EVIDENCE_CATEGORIES.map(category => [category, value])) as EvidenceSelection;

const source = (): SourceSnapshot => ({ runId: 'run-1', configHash: 'config-hash', status: 'completed', sequenceBoundary: 2, eventCount: 2, eventIds: ['event-1', 'event-2'], evidenceHash: 'evidence-hash', normalizerVersion: 'normalizer-v1' });

const settings = (): AnalysisConfiguration => ({ version: 1, model: 'jev-test', window: { size: 2, stride: 1 }, selection: { phases: ['action', 'report'] }, evidence: flags(true), inputLimits: { singleQuestionTokens: 1000, combinedQuestionTokens: 2000, maxBodyBytes: 10000, headroomTokens: 10, estimatorVersion: 'utf8-v1' }, concurrency: 1, timeoutMs: 1000, maxAttempts: 1, retryBaseMs: 0, longContext: false });

export const analysisJob = (id: string): AnalysisJob => ({
    id, runId: 'run-1', idempotencyKey: id, launchHash: 'launch-' + id, createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', ready: true, cancelRequested: false, status: 'queued', fence: 0,
    counters: emptyCounters(),
    manifest: { version: 1, source: source(), sourceArtifact: id + ':source', settings: settings(), codebook: { id: 'revision-1', codebookId: 'codebook-1', revision: 1, createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'tester', definitions: [] }, settingsHash: 'settings-hash', staticContext: { version: 'task-policy-v1', hash: 'context-hash' }, normalizerVersion: 'normalizer-v1', serializationVersion: 'serialization-v1', questionTemplateVersion: 'question-v1', providerAdapterVersion: 'adapter-v1', sdkVersion: 'sdk-v1', diagnostics: [], availability: flags(true), creator: 'tester' },
});

export const analysisWindow = (jobId: string, id = 'window-1'): WindowRecord => ({ id, jobId, ordinal: 0, index: 0, startOrdinal: 0, endOrdinal: 1, stepIds: ['step-1'], eventIds: ['event-1'], partial: false, incomplete: false, status: 'pending', inputRef: jobId + ':input:' + id, inputHash: 'input-hash', inputBytes: 10, estimatedTokens: 10, diagnostics: [], batches: [['code-1']] });

export const analysisAttempt = (jobId: string, windowId = 'window-1'): AnalysisAttempt => ({ id: jobId + ':attempt-1', jobId, windowId, codeIds: ['code-1'], requestRef: jobId + ':request:1', startedAt: '2026-01-01T00:00:00.000Z', status: 'running', requestedModel: 'jev-test' });
```

- [ ] **Step 4.2: Write the failing contract tests**

Create `tests/integration/contracts/analysis-repository.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AnalysisRepository } from '@sidechannel/contracts/analysis/jev-repository';
import { analysisAttempt, analysisJob, analysisWindow } from './fixtures.js';

export interface AnalysisRepositoryHarness {
    name: string;
    fixture(): Promise<{ repository: AnalysisRepository; dispose(): Promise<void> }>;
}

/** Lease liveness is compared against the real clock, so tests must use real timestamps. */
const now = () => new Date().toISOString();

export function analysisRepositoryContract(harness: AnalysisRepositoryHarness): void {
    test(`${harness.name}: unknown analysis reads return null or empty pages`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        assert.equal(await repository.getJob('missing'), null);
        assert.equal(await repository.getWindow('missing', 'window-1'), null);
        assert.deepEqual((await repository.listWindows('missing')).items, []);
        assert.deepEqual(await repository.resultsForWindows('missing', ['window-1']), []);
        await repository.readyJob('missing');
    });

    test(`${harness.name}: job reservation is idempotent per launch key`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        assert.equal((await repository.reserveJob(analysisJob('job-1'))).created, true);
        assert.equal((await repository.reserveJob(analysisJob('job-1'))).created, false);
        await assert.rejects(repository.reserveJob({ ...analysisJob('job-1'), launchHash: 'other' }), /different configuration/);
    });

    test(`${harness.name}: fenced writes reject stale leases and tolerate missing windows`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        await repository.reserveJob(analysisJob('job-2'));
        await repository.putWindow(analysisWindow('job-2'));
        const claimed = await repository.claim('owner-a', now(), 30_000);
        assert.ok(claimed);
        const lease = claimed!.lease;
        assert.equal(await repository.heartbeat(lease, now(), 30_000), true);
        assert.equal(await repository.heartbeat({ ...lease, fence: lease.fence + 1 }, now(), 30_000), false);
        // A live lease may target a window that is absent: documented no-op, still true.
        assert.equal(await repository.updateWindow(lease, 'missing-window', { status: 'completed' }), true);
        assert.equal(await repository.updateWindow({ ...lease, fence: lease.fence + 1 }, 'window-1', { status: 'completed' }), false);
        assert.equal(await repository.updateWindow(lease, 'window-1', { status: 'running' }), true);
        assert.equal((await repository.getWindow('job-2', 'window-1'))!.status, 'running');
    });

    test(`${harness.name}: attempts enforce the 1 MiB metadata bound on start and finish`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        await repository.reserveJob(analysisJob('job-3'));
        const claimed = await repository.claim('owner-b', now(), 30_000);
        const lease = claimed!.lease;
        const oversized = { ...analysisAttempt('job-3'), usage: { blob: 'x'.repeat(1_048_577) } };
        await assert.rejects(repository.startAttempt(lease, oversized), /exceeds 1 MiB/);
        await assert.rejects(repository.finishAttempt(lease, oversized, []), /exceeds 1 MiB/);
        const small = analysisAttempt('job-3');
        assert.equal(await repository.startAttempt(lease, small), true);
        assert.equal(await repository.finishAttempt(lease, { ...small, status: 'succeeded' }, [{ id: 'result-1', jobId: 'job-3', windowId: 'window-1', codeId: 'code-1', probability: 0.5, attemptId: small.id, createdAt: now() }]), true);
    });

    test(`${harness.name}: artifacts are immutable and integrity-checked`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        await repository.putArtifact('artifact-1', { value: 1 });
        assert.deepEqual(await repository.readArtifact('artifact-1'), { value: 1 });
        await assert.rejects(repository.putArtifact('artifact-1', { value: 2 }), /immutable/);
        await assert.rejects(repository.readArtifact('artifact-missing'), /not found/i);
    });

    test(`${harness.name}: cancel and retry follow the job state machine`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        await repository.reserveJob(analysisJob('job-4'));
        const cancelled = await repository.cancel('job-4');
        assert.equal(cancelled!.status, 'cancelled');
        assert.equal(cancelled!.cancelRequested, true);
        const retried = await repository.retry('job-4');
        assert.equal(retried!.status, 'queued');
        assert.equal(retried!.cancelRequested, false);
        assert.equal(await repository.cancel('missing'), null);
    });
}
```

Wire it up in `tests/integration/port-contracts.test.ts`:

```ts
import { analysisRepositoryContract } from './contracts/analysis-repository.js';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';

analysisRepositoryContract({
    name: 'memory',
    fixture: async () => ({ repository: new InMemoryAnalysisRepository(), dispose: async () => {} }),
});
```

- [ ] **Step 4.3: Run the tests to verify they fail**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
```

Expected failures (in-memory adapter):
- `readyJob('missing')` throws `TypeError`.
- `updateWindow('missing-window')` throws `TypeError`.
- `finishAttempt(oversized)` resolves instead of rejecting.

- [ ] **Step 4.4: Fix the in-memory analysis adapter**

In `packages/persistence/src/analysis/jev-repository.ts` (`InMemoryAnalysisRepository`):

1. `readyJob` — no-op for unknown jobs:

```ts
async readyJob(id: string) { const job = this.jobs.get(id); if (job && !job.ready) { job.ready = true; job.status = job.cancelRequested ? 'cancelled' : 'queued'; } }
```

2. `updateWindow` — live-lease semantics, never throws for a missing window:

```ts
async updateWindow(l: Lease, id: string, patch: Partial<Pick<WindowRecord, 'status' | 'diagnostics'>>) { if (!live(this.jobs.get(l.jobId), l)) return false; const window = this.windows.get(l.jobId + ':' + id); if (window) Object.assign(window, copy(patch)); return true; }
```

3. Bound-first `startAttempt`/`finishAttempt` (match Mongo ordering: size is validated before the lease check):

```ts
async startAttempt(l: Lease, a: AnalysisAttempt) { bounded(a); if (!live(this.jobs.get(l.jobId), l)) return false; this.attempts.set(a.id, copy(a)); return true; }
async finishAttempt(l: Lease, a: AnalysisAttempt, results: AnalysisResult[]) { bounded(a); if (!live(this.jobs.get(l.jobId), l)) return false; this.attempts.set(a.id, copy(a)); for (const r of results) { const key = r.jobId + ':' + r.windowId + ':' + r.codeId; if (!this.results.has(key)) this.results.set(key, copy(r)); } return true; }
```

4. Cap `resultsForWindows` exactly like Mongo:

```ts
async resultsForWindows(jobId: string, ids: string[]) { if (ids.length > 500) throw new AnalysisValidation('Window result join is limited to 500 windows'); const selected = new Set(ids); return copy([...this.results.values()].filter(r => r.jobId === jobId && selected.has(r.windowId)).slice(0, 50_000)); }
```

- [ ] **Step 4.5: Run the tests to verify they pass**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
```

Expected: PASS (all memory contract tests). If `cancel('missing')` returns something other than `null` in memory, fix `cancel` to return `this.getJob(id)` (it already does; Mongo returns `getJob` too).

- [ ] **Step 4.6: Commit**

```bash
git add tests/integration/contracts/analysis-repository.ts tests/integration/contracts/fixtures.ts tests/integration/port-contracts.test.ts packages/persistence/src/analysis/jev-repository.ts
git commit -m "fix(persistence): analysis repository contract parity (readyJob, updateWindow, attempt bound)"
```

---

## Task 5: Research store parity

**Files:**
- Create: `tests/integration/contracts/research-store.ts`
- Create: `tests/integration/port-contracts.mongo.test.ts` (store suite only; extended in Task 6)
- Modify: `tests/integration/port-contracts.test.ts`
- Modify: `packages/persistence/src/analysis/store.ts` (Mongo `replace`)

**Interfaces:**
- Produces: `researchStoreContract(harness: ResearchStoreHarness): void` where

```ts
export interface ResearchStoreHarness {
    name: string;
    fixture(): Promise<{ store: ResearchStore; dispose(): Promise<void> }>;
}
```

- Consumes: `ResearchStore`, `ResearchRecord` from `@sidechannel/contracts/analysis/store`.

- [ ] **Step 5.1: Write the failing contract tests**

Create `tests/integration/contracts/research-store.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResearchRecord, ResearchStore } from '@sidechannel/contracts/analysis/store';

export interface ResearchStoreHarness {
    name: string;
    fixture(): Promise<{ store: ResearchStore; dispose(): Promise<void> }>;
}

const record = (id: string, revision = 1): ResearchRecord => ({ id, revision, createdAt: '2026-01-01T00:00:00.000Z' });

export function researchStoreContract(harness: ResearchStoreHarness): void {
    test(`${harness.name}: insert is unique and get returns the stored record`, async (t) => {
        const { store, dispose } = await harness.fixture();
        t.after(dispose);
        assert.equal(await store.insert('records', record('r1')), true);
        assert.equal(await store.insert('records', record('r1')), false);
        assert.deepEqual(await store.get('records', 'r1'), record('r1'));
        assert.equal(await store.get('records', 'missing'), null);
    });

    test(`${harness.name}: replace is a revision match, not a content change`, async (t) => {
        const { store, dispose } = await harness.fixture();
        t.after(dispose);
        await store.insert('records', record('r1'));
        assert.equal(await store.replace('records', 'r1', 1, record('r1')), true);
        assert.equal(await store.replace('records', 'r1', 0, record('r1', 2)), false);
        const next = { ...record('r1', 2), note: 'changed' } as ResearchRecord;
        assert.equal(await store.replace('records', 'r1', 1, next), true);
        assert.deepEqual(await store.get('records', 'r1'), next);
    });

    test(`${harness.name}: pages are ordered by id with an exclusive cursor`, async (t) => {
        const { store, dispose } = await harness.fixture();
        t.after(dispose);
        for (const id of ['r1', 'r2', 'r3', 'r4', 'r5'])
            await store.insert('records', { ...record(id), group: 'a' } as ResearchRecord);
        await store.insert('records', { ...record('r6'), group: 'b' } as ResearchRecord);
        const first = await store.page('records', { group: 'a' }, '', 2);
        assert.deepEqual(first.items.map(item => item.id), ['r1', 'r2']);
        assert.equal(first.nextCursor, 'r2');
        const second = await store.page('records', { group: 'a' }, first.nextCursor!, 10);
        assert.deepEqual(second.items.map(item => item.id), ['r3', 'r4', 'r5']);
        assert.equal(second.nextCursor, null);
    });

    test(`${harness.name}: leases are exclusive, renewable by owner and releasable`, async (t) => {
        const { store, dispose } = await harness.fixture();
        t.after(dispose);
        assert.equal(await store.claim('scope', 'job', 'owner-a', 30_000), true);
        assert.equal(await store.claim('scope', 'job', 'owner-b', 30_000), false);
        assert.equal(await store.renew('scope', 'job', 'owner-b', 30_000), false);
        assert.equal(await store.renew('scope', 'job', 'owner-a', 30_000), true);
        await store.release('scope', 'job', 'owner-b');
        assert.equal(await store.claim('scope', 'job', 'owner-b', 30_000), false);
        await store.release('scope', 'job', 'owner-a');
        assert.equal(await store.claim('scope', 'job', 'owner-b', 30_000), true);
    });
}
```

Wire it up in `tests/integration/port-contracts.test.ts`:

```ts
import { researchStoreContract } from './contracts/research-store.js';
import { InMemoryResearchStore } from '@sidechannel/persistence/analysis/store';

researchStoreContract({
    name: 'memory',
    fixture: async () => ({ store: new InMemoryResearchStore(), dispose: async () => {} }),
});
```

- [ ] **Step 5.2: Run the memory suite, then add a Mongo store-only entry to expose the real failure**

Memory side first (should pass — it already has matched semantics):

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
```

Expected: PASS for the memory store contract.

Now create `tests/integration/port-contracts.mongo.test.ts` with only the store suite (harness and analysis suites are added in Task 6):

```ts
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoResearchStore } from '@sidechannel/persistence/analysis/store';
import { researchStoreContract } from './contracts/research-store.js';

const uri = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';

researchStoreContract({
    name: 'mongo',
    fixture: async () => {
        const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect();
        const db = client.db('sidechannel_contract_' + randomUUID().replaceAll('-', ''));
        const store = new MongoResearchStore(db);
        await store.initialize();
        return { store, dispose: async () => { await db.dropDatabase(); await client.close(); } };
    },
});
```

Run it against Mongo (scoped to this file):

```bash
docker compose up -d --wait mongo
npm run build
node --env-file-if-exists=.env --import tsx --test tests/integration/port-contracts.mongo.test.ts
```

Expected: FAIL on `replace is a revision match, not a content change` — Mongo returns `false` for an unchanged document because it reports `modifiedCount`.

- [ ] **Step 5.3: Fix the Mongo `replace` semantics**

In `packages/persistence/src/analysis/store.ts` (`MongoResearchStore.replace`), replace `return result.modifiedCount === 1;` with:

```ts
return result.matchedCount === 1;
```

Rationale: the port promises an optimistic-revision CAS; returning `false` for a successful write of identical content makes `cancelMonitor` report a spurious 409 for a harmless retry.

- [ ] **Step 5.4: Run both entries to verify they pass**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
node --env-file-if-exists=.env --import tsx --test tests/integration/port-contracts.mongo.test.ts
```

Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add tests/integration/contracts/research-store.ts tests/integration/port-contracts.test.ts tests/integration/port-contracts.mongo.test.ts packages/persistence/src/analysis/store.ts
git commit -m "fix(persistence): research store replace uses revision match semantics"
```

---

## Task 6: Extend Mongo parity entry and wire into CI

**Files:**
- Modify: `tests/integration/port-contracts.mongo.test.ts` (add harness + analysis suites)
- Modify: `package.json` (convenience script)
- Modify: `docs/solid-remediation-decisions.md`

**Interfaces:**
- Consumes: all three suites; Mongo adapters via declared exports.

- [ ] **Step 6.1: Extend the Mongo entry with the two remaining suites**

Replace the contents of `tests/integration/port-contracts.mongo.test.ts` with:

```ts
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { MongoAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { MongoResearchStore } from '@sidechannel/persistence/analysis/store';
import { harnessRepositoryContract } from './contracts/harness-repository.js';
import { analysisRepositoryContract } from './contracts/analysis-repository.js';
import { researchStoreContract } from './contracts/research-store.js';

const uri = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';
const database = () => 'sidechannel_contract_' + randomUUID().replaceAll('-', '');

harnessRepositoryContract({
    name: 'mongo',
    fixture: async () => {
        const repository = await MongoRepository.connect(uri, database());
        return { repository, dispose: async () => { await repository.db.dropDatabase(); await repository.close(); } };
    },
});

analysisRepositoryContract({
    name: 'mongo',
    fixture: async () => {
        const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect();
        const db = client.db(database());
        const repository = new MongoAnalysisRepository(client, db);
        await repository.initialize();
        return { repository, dispose: async () => { await db.dropDatabase(); await client.close(); } };
    },
});

researchStoreContract({
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

- [ ] **Step 6.2: Run the full Mongo parity entry**

```bash
npm run build
npm run test:integration --workspace=@sidechannel/integration
```

Expected: PASS for `port-contracts.mongo.test.ts` and every pre-existing integration test. If a parity assertion fails, fix the adapter behaviour rather than the assertion, and record the agreed semantics in the decision log.

- [ ] **Step 6.3: Confirm the fast entry runs in the normal unit suite**

```bash
npm test
```

Expected: PASS; `port-contracts.test.ts` runs the memory suites without needing Mongo.

- [ ] **Step 6.4: Add a convenience script and document the suites**

In root `package.json`, add to `scripts`:

```json
"test:contracts": "node scripts/nx.mjs run @sidechannel/integration:test",
```

Append to `docs/solid-remediation-decisions.md` (create the file if WS0 has not):

```markdown
## WS1 — Port contract parity (2026-11-07)

- Contract suites live in `tests/integration/contracts/`; memory-only entry runs under `npm test`, Mongo parity entry runs under `npm run test:integration`.
- Agreed semantics:
  - Unknown run: evidence page is `{ items: [], total: 0 }`, item/summary/list reads return `null`/`[]`.
  - Event phase: report-first — `data.phase === 'report'`, `type` starting with `report`, or an invocation id containing `:report:` classifies the event as report phase.
  - `listEvents` clamps to 10,000 rows in every adapter.
  - `updateWindow` returns lease validity, not window existence; a live lease targeting a missing window is a no-op that returns `true`.
  - Attempt metadata is bounded to 1 MiB before the lease check in both adapters.
  - `ResearchStore.replace` returns whether the revision matched, not whether bytes changed.
  - `workerStatus` is typed (`WorkerStatus`); registration is a guard without a heartbeat, so `available` is always `null` and `status` is `registered` or `unknown`.
- Hashing is de-duplicated with byte-identical output. Canonical sorted-key hashing is deferred to WS7 behind a versioned migration because persisted identity keys (launch, review, preview) depend on current digests.
```

- [ ] **Step 6.5: Commit**

```bash
git add tests/integration/port-contracts.mongo.test.ts package.json docs/solid-remediation-decisions.md
git commit -m "test(persistence): mongo adapter parity suite wired into integration CI"
```

---

## Task 7: Close-out and guardrail hand-off

**Files:**
- Modify: `docs/superpowers/plans/2026-11-07-solid-remediation-program.md` (status note)
- Modify: `docs/solid-remediation-decisions.md` (final WS1 entry)

- [ ] **Step 7.1: Run the full verification matrix**

```bash
npm run lint
node scripts/verify-boundaries.mjs
npm run check
npm test
npm run build
node scripts/verify-compiled.mjs
docker compose up -d --wait mongo
npm run test:integration
```

Expected: all green.

- [ ] **Step 7.2: Prove the fixture evidence is unchanged**

```bash
npm run fixture
git diff --stat agent/examples/completed-fixture.json
```

Expected: no diff (or, if the fixture command rewrites timestamps, re-run and confirm event types/order/counts match the committed export; record the comparison in the decision log).

- [ ] **Step 7.3: Record the metric delta**

Run the architecture budget (WS0) if it exists; otherwise count manually:

```bash
git grep -c "createHash('sha256').update(JSON.stringify" -- packages/domain/src
```

Expected: 0 occurrences (previously 4) — all JSON hashing now lives in `hashing.ts`.

- [ ] **Step 7.4: Update the program plan status**

In `docs/superpowers/plans/2026-11-07-solid-remediation-program.md`, mark WS1 as complete in the workstream table and record the actual effort/date in the decision log.

- [ ] **Step 7.5: Commit**

```bash
git add docs/superpowers/plans/2026-11-07-solid-remediation-program.md docs/solid-remediation-decisions.md
git commit -m "docs: WS1 adapter contract parity complete"
```

---

## Verification summary

| Check | Command | Expected |
| --- | --- | --- |
| Lint + boundaries | `npm run lint && node scripts/verify-boundaries.mjs` | exit 0 |
| Types | `npm run check` | exit 0 |
| Unit + memory contracts | `npm test` | PASS, includes `port-contracts.test.ts` |
| Mongo parity | `npm run test:integration` | PASS, includes `port-contracts.mongo.test.ts` |
| Build / compiled | `npm run build && node scripts/verify-compiled.mjs` | PASS |
| Evidence unchanged | `npm run fixture` + fixture diff | no semantic diff |
| Hash de-duplication | `git grep` check | 0 legacy JSON-hash helpers outside `hashing.ts` |

## Rollback

Each task is an isolated commit. To roll back: `git revert <commit>` — no database schema changes and no destructive migrations are part of WS1. The only cross-task dependency is the contract suite asserting fixed semantics; reverting a fix while keeping its test will (correctly) fail, so revert both together (they are in the same commit).

## Out of scope (handled by later workstreams)

- Port splitting (`AnalysisRepository` 28 methods, `ResearcherRepository` 20, `Repository`) → WS2.
- Route-handler/body-parser unification → WS3 T3.5.
- HTTP status codes in domain errors → WS3 T3.4.
- Canonical (sorted-key) hashing migration → WS7 T7.4.
- Healthcare catalog byte-integrity parity → accepted difference (memory stores structured values); shared validation is unit-tested instead.
- `listEvents` clamp test with >10,000 rows (slow) → clamp is asserted by code review; add a property test only if a regression appears.

## Self-review

- **Finding coverage:** WS1 closes P5 (missing-run evidence), P6 (`workerStatus`), P7 (phase/clamp/claim), P8 (`readyJob`/`updateWindow`/attempt bound/results cap), P9 (`replace`), and the de-duplication half of X6. Allocation/`AnalysisRepository` shape and hash canonicalisation are explicitly deferred with rationale.
- **Placeholder scan:** every step has concrete code, commands, or assertions; no "TBD"/"similar to" steps.
- **Type consistency:** `RepositoryHarness`, `AnalysisRepositoryHarness`, `ResearchStoreHarness` names match their entry files; `WorkerStatus` is defined once and consumed by both adapters; `jsonHash`/`canonicalHash` signatures match the call-site edits; fixture helpers (`analysisJob`, `analysisWindow`, `analysisAttempt`, `queuedRun`) are used with the same parameter shapes in later tasks.
- **Behaviour-change statement:** the only observable changes are the five documented adapter semantics above; every stored hash value and all fixture evidence remain byte-identical.
