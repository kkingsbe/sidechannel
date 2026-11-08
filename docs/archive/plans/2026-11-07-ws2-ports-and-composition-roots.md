# WS2 — Ports and Composition Roots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Size every persistence/provider port to its actual consumer and move object construction back into composition roots, so substitution is cheap, adapter parity keeps holding, and boundary violations (concrete adapters, lazy imports, mutable module globals) become mechanically detectable.

**Architecture:** Six tasks. T2.1–T2.3 split three fat ports (`Repository`, `ResearcherRepository`, `AnalysisRepository`) into capability slices named in `2026-11-07-plan-conventions.md` §3 while keeping one class per adapter (`implements` the composed type). T2.4 removes stringly physical keys and the `row.value as unknown as …` downcasts from domain, and types analysis-attempt usage. T2.5 turns every construction site into an injection point (`api/src/main.ts` builds Mongo analysis/review repositories, `createMonitorProvider` requires an adapter, the Mastra registry becomes a `TraceRuntime` value created by `openRuntime()`). T2.6 pins the result with a static composition check. No scheduling, admission, budget, event, hash or payload semantics change: the characterization gates are the 103-event fixture sequence, the WS1 contract suites, and the existing integration assertions.

**Tech Stack:** TypeScript 6.0.3, Node 22.18+/24.11+, npm 11.5.1 workspaces + Nx 23, `node:test` via `scripts/test.mjs` + `tsx`, MongoDB 8 replica set (`127.0.0.1:27018`, `TEST_MONGODB_URI`), ESLint 9 (`workspace/imports` + `@nx/enforce-module-boundaries`), Mastra 1.82.0 (registry only; no Sdk API change).

**Estimated:** 6 tasks, 4–6 dev-days (5.5 nominal).

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

**Workstream-specific constraints**

- **WS1 must have landed.** Every task assumes: `WorkerStatus` is typed in `packages/contracts/src/server/contracts.ts`; `tests/integration/contracts/{harness-repository,analysis-repository,research-store}.ts` + `tests/integration/port-contracts{,.mongo}.test.ts` exist; `updateWindow` on a missing window returns `true`; `listEvents` clamps to 10 000; attempt metadata is bounded **before** the lease check. If `WorkerStatus` is missing, add exactly the WS1 definition as an extra step inside T2.2 (copy from `2026-11-07-ws1-adapter-contract-parity.md` §Task 3 Step 3.3) and record it in `docs/solid-remediation-decisions.md`.
- **Zero payload, event, hash and status changes.** The only intentional observable deltas are listed per task under *Behaviour-change statement*.
- **Composed ports survive.** `Repository` (`packages/contracts/src/harness/server.ts`), `ResearcherRepository` (`server/contracts.ts`) and `AnalysisRepository` (`analysis/jev-repository.ts`) stay as composed types for composition roots and contract suites; consumers that only need a slice must take a slice or a `Pick<…>`.
- **Type-only edits in other workstreams' files are allowed and listed.** `experiment-worker/src/harness/scheduler.ts` (WS3b), `packages/domain/src/oversight/**` (WS3c), `packages/domain/src/analysis/jev-service.ts` and `api/src/routes/review-routes.ts` (WS4/WS3a) are touched **only** at signature/parameter-type lines. WS2 precedes WS3b/WS3c/WS4 per conventions §4 ordering; WS3a rebases on this plan. Each task's Files block names every such file.

---

## Preconditions and baseline

- [ ] **Step 0.1: Confirm WS1 landed**

```bash
git log --oneline -12
ls tests/integration/contracts/
grep -n "WorkerStatus" packages/contracts/src/server/contracts.ts
```

Expected: the WS1 commits are on the branch, the three contract-suite files exist, and `WorkerStatus` is declared.

- [ ] **Step 0.2: Build and record the green baseline**

```bash
npm ci
npm run build
npm test
docker compose up -d --wait mongo
npm run test:integration
```

Expected: all PASS. Record the counts; every later task must leave them equal or higher.

- [ ] **Step 0.3: Pin the fixture evidence sequence (shared by T2.1, T2.6)**

```bash
node -e "const f=require('./agent/examples/completed-fixture.json');console.log(f.events.length);console.log(JSON.stringify(f.events.map(e=>e.type)))"
```

Expected: `103` events, starting `["run_started","turn_started","model_requested","model_response","tool_requested",…]` and ending `[…,"artifact_frozen","model_requested","model_response","report_submitted","model_requested","model_response","report_submitted","run_completed"]`. Keep the JSON on screen; T2.1 Step 1.3 turns it into an executable assertion.

---

## File structure

**Create**

| Path | Responsibility |
| --- | --- |
| `experiment-worker/src/worker.ts` | Worker loop over `RunQueue`/`WorkerGuard`/`RunStateStore`/`EventLog` only; no concrete adapter |
| `experiment-worker/src/main.ts` (rewritten) | Composition root invocation: `openRuntime()` then `runWorker(runtime)`; imports nothing concrete |
| `experiment-worker/src/harness/ports.characterization.test.ts` | Pins the fixture run's ordered event-type sequence against `agent/examples/completed-fixture.json` |
| `experiment-worker/src/harness/ports.test.ts` | Proves the four harness slices are independently constructible |
| `api/src/routes/jev-extension.test.ts` | Proves the JEV extension is composed from injected ports |
| `analysis-worker/src/oversight/provider.test.ts` | Proves the monitor adapter is required and used |
| `scripts/verify-composition.mjs` | Static gate: no concrete adapters in workers/routes, no lazy adapter import, no mutable Mastra global, one zod module in contracts |
| `packages/contracts/src/analysis/jev-reviews.ts` (additions) | `ReviewMember`, `ReviewQueueItem`, `ReviewReason` |

**Modify (by task)**

| Path | Task | Change |
| --- | --- | --- |
| `packages/contracts/src/harness/server.ts` | T2.1 | `RunStateStore`, `EventLog`, `RunQueue`, `WorkerGuard`; `Repository` composes them |
| `experiment-worker/src/harness/scheduler.ts` | T2.1 | `SchedulerOptions` + 6 call sites (WS3b file — signature lines only) |
| `packages/persistence/src/harness/repository.ts` | T2.1 | `implements Repository` via slices; memory `acquireWorker`/`releaseWorker`, guard-aware `workerStatus` |
| `packages/contracts/src/server/contracts.ts` | T2.2 | `RunQueries`, `DraftStore`, `EvidenceReader`, `WorkerSupervisor`, composed `ResearcherRepository` (inherits `createPair` from `RunQueue`) |
| `packages/domain/src/oversight/service.ts`, `…/reviews.ts` | T2.2 | repository parameters narrowed to `Pick<Repository, 'getRun' \| 'listEvents'>` (WS3c files — type-only) |
| `api/src/routes/oversight.ts`, `api/src/healthcare/service.ts`, `api/src/routes/review-routes.ts` | T2.2/T2.3 | handlers take only the slice they use |
| `packages/contracts/src/analysis/jev-repository.ts` | T2.3 | `CodebookStore`, `JobLifecycleStore`, `WindowStore`, `ArtifactStore`, `ResultStore`, `AnalysisWorkerStore`; `readyJob` deleted |
| `packages/persistence/src/analysis/jev-repository.ts` | T2.3 | delete both `readyJob`; `implements AnalysisRepository` (composed) |
| `analysis-worker/src/jev/jev-worker.ts` | T2.3 | constructor takes `AnalysisWorkerStore` |
| `packages/domain/src/analysis/jev-service.ts` | T2.3 | constructor documents the composed port; no signature change |
| `packages/contracts/src/analysis/store.ts`, `…/review-repository.ts` | T2.4 | typed collections, typed filters, `previewPartKey`, `reviewRevisionKey`, generic `ReviewStore` |
| `packages/persistence/src/analysis/{store,review-repository}.ts` | T2.4 | implement the typed ports (one class each) |
| `packages/domain/src/analysis/jev-reviews.ts`, `packages/domain/src/oversight/{service,reviews}.ts` | T2.4 | drop key building and downcasts |
| `analysis-worker/src/jev/jev-worker.ts` | T2.4 | `attempt.usage` read without a cast |
| `api/src/main.ts`, `api/src/routes/jev-extension.ts` | T2.5 | composition root builds Mongo analysis/review repositories synchronously |
| `analysis-worker/src/oversight/provider.ts`, `analysis-worker/src/main.ts` | T2.5 | `createMonitorProvider(adapter: ModelAdapter)` required; adapter constructed at startup |
| `experiment-worker/src/mastra/index.ts`, `experiment-worker/src/harness/{runtime,mastra-adapter}.ts` | T2.5 | `TraceRuntime` value; no `export let mastra` |
| `experiment-worker/src/commands/{fixture,recover,live-smoke}.ts` | T2.5 | consume the runtime slices; live-smoke uses a `TraceRuntime` |
| `scripts/verify-composition.mjs`, `package.json` | T2.6 | static guardrail + `verify:composition` script |
| `docs/solid-remediation-decisions.md` | all | decision log entries |

**Do not touch:** `dashboard/**` (WS5/WS6), `api/src/server/**` beyond the listed lines (WS3a), `packages/domain/src/oversight` bodies (WS3c), scheduler body beyond T2.1's six lines (WS3b), hashing (WS1/WS7), provider/scenario registries (WS4).

---

## T2.1 — Harness ports split (`RunStateStore`, `EventLog`, `RunQueue`, `WorkerGuard`)

**Files:**
- Modify: `packages/contracts/src/harness/server.ts:34-42`
- Modify: `packages/persistence/src/harness/repository.ts:36-117` (memory) and `:119` (class declaration)
- Modify: `experiment-worker/src/harness/scheduler.ts:1-2,8-13,18,30-31,36,42,52,60`
- Modify: `experiment-worker/src/harness/runtime.ts` (openRuntime shape) — completed in T2.5; T2.1 only passes the new options
- Modify (mechanical, 12 sites): `experiment-worker/src/harness/{core,token-budget,inference-provider,healthcare}.test.ts`, `tests/integration/{analysis-evidence.test.ts,integration-mongo.mongo.test.ts,dashboard-smoke.ts,jev-smoke.ts}`, `scripts/verify-compiled.mjs`
- Create: `experiment-worker/src/harness/ports.characterization.test.ts`
- Create: `experiment-worker/src/harness/ports.test.ts`

**Interfaces:**
- Consumes: nothing new (contracts only).
- Produces, in `@sidechannel/contracts/harness/server`:

```ts
export interface RunStateStore {
    getRun(id: string): Promise<Run | null>;
    saveRun(run: Run): Promise<void>;
    claimRun(runId: string, workerId: string): Promise<boolean>;
    /** Cooperative cancellation: the worker uses this on SIGINT/SIGTERM; the API on POST /cancel. */
    requestCancel(id: string): Promise<Run | null>;
}
export interface EventLog {
    appendEvent(event: NewEvent): Promise<HarnessEvent>;
    listEvents(runId: string, afterSequence?: number, limit?: number): Promise<HarnessEvent[]>;
}
export interface RunQueue {
    createRun(run: Run): Promise<Run>;
    createPair(runs: Run[]): Promise<Run[]>;
    listRuns(): Promise<Run[]>;
}
export interface WorkerGuard {
    acquireWorker(owner: string): Promise<boolean>;
    releaseWorker(owner: string): Promise<void>;
}
/** Composition of the harness slices used by the API, domain projections and contract tests. */
export interface Repository extends RunStateStore, EventLog, RunQueue, WorkerGuard {}
```

  and `export interface SchedulerOptions { runState: RunStateStore; events: EventLog; memory: PrivateMemory; adapter: ModelAdapter; scenario?: Scenario; }`.
- Produces (T2.5 consumes): `openRuntime()` returns an object whose `queue`/`guard`/`runState`/`events` fields are these slices (`requestCancel` is on `runState`).
- `createPair` lives on `RunQueue` (pair creation is run creation and both adapters already implement it); `ResearcherRepository` inherits it rather than redeclaring it.
- `WorkerSupervisor` therefore carries only `workerStatus()`; `requestCancel` moved onto `RunStateStore` because the worker shutdown path needs it too.

**Characterization gate:** `ports.characterization.test.ts` pins the ordered event-type sequence of a full scripted fixture run against the committed `agent/examples/completed-fixture.json` (103 events). It must be green **before** any T2.1 edit and **after** the last one, with no edit to the assertion array in between. `tests/integration/integration-mongo.mongo.test.ts` independently pins the Mongo side (`result.turn === 6`, two reports, frozen artifact, `turn_started` count 6, strictly increasing sequences).

**Behaviour-change statement:** none. `InMemoryRepository` gains `acquireWorker`/`releaseWorker` (previously absent, so no memory caller could observe them) and its `workerStatus()` now derives `status` from that guard to match Mongo; WS1's contract test accepts either `registered` or `unknown`, so no assertion changes. `HarnessScheduler` reads the same four repository operations through two narrower objects.

**Effort:** 1.0 dev-day.

- [ ] **Step 1.1: Write the characterization test**

Create `experiment-worker/src/harness/ports.characterization.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import type { MemorySnapshot } from '@sidechannel/contracts/harness/contracts';
import { HarnessScheduler } from './scheduler.js';
import { ScriptedAdapter, fixtureScript } from './scripted-adapter.js';

/**
 * The committed fixture export is the recorded baseline for a scripted fixture run.
 * Ports must be substitutable without moving a single event, so the ordered sequence
 * is pinned here and compared verbatim after every refactor in WS2/WS3.
 */
const recorded = JSON.parse(readFileSync(new URL('../../../agent/examples/completed-fixture.json', import.meta.url), 'utf8')) as { events: { type: string }[] };

class TestMemory {
    private rows = new Map<string, MemorySnapshot>();
    async load(runId: string, agentId: string) { return structuredClone(this.rows.get(`${runId}:${agentId}`) ?? { version: 0, notes: '', messages: [] }); }
    async save(runId: string, agentId: string, snapshot: MemorySnapshot) { this.rows.set(`${runId}:${agentId}`, structuredClone(snapshot)); }
}

test('fixture run emits the recorded event-type sequence in memory', async () => {
    const repository = new InMemoryRepository();
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'characterization');
    await repository.createRun(run);
    const completed = await new HarnessScheduler({ repository, memory: new TestMemory(), adapter: new ScriptedAdapter(fixtureScript) }).run(run.id);
    assert.equal(completed.status, 'completed', completed.failureReason ?? 'fixture must complete');
    const actual = (await repository.listEvents(run.id, 0, 10_000)).map(event => event.type);
    assert.deepEqual(actual, recorded.events.map(event => event.type));
});
```

- [ ] **Step 1.2: Run it on the unmodified tree (the recording step)**

```bash
npm run build
node --import tsx --test experiment-worker/src/harness/ports.characterization.test.ts
```

Expected: PASS (103 events; verified against the committed export on 2026-11-07). **If it fails**, the committed export and current code disagree — do NOT silently regenerate the committed evidence file. Instead:
1. Capture the mismatch (`git diff` after a scratch run, or the assertion diff) and record it in `docs/solid-remediation-decisions.md` as an evidence-drift finding.
2. Pin the **current-code** sequence in the characterization test (replace the `recorded` read with the observed type array, with a comment pointing at the drift entry).
3. Leave `agent/examples/completed-fixture.json` untouched unless a separate, explicit evidence-refresh task is approved (regenerating it changes a committed research artifact).

- [ ] **Step 1.3: Commit the baseline**

```bash
git add experiment-worker/src/harness/ports.characterization.test.ts
git commit -m "test(worker): pin fixture event-type sequence as port-split characterization baseline"
```

- [ ] **Step 1.4: Write the failing port-split test**

Create `experiment-worker/src/harness/ports.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { EventLog, RunQueue, RunStateStore, WorkerGuard } from '@sidechannel/contracts/harness/server';

test('the harness port slices are structurally independent', () => {
    const runState: RunStateStore = { getRun: async () => null, saveRun: async () => {}, claimRun: async () => false };
    const events: EventLog = { appendEvent: async event => ({ ...event, schemaVersion: 1, id: '1', timestamp: 'now', sequence: 1 }), listEvents: async () => [] };
    const queue: RunQueue = { createRun: async run => run, listRuns: async () => [] };
    const guard: WorkerGuard = { acquireWorker: async () => true, releaseWorker: async () => {} };
    assert.deepEqual(Object.keys(runState).sort(), ['claimRun', 'getRun', 'saveRun']);
    assert.deepEqual(Object.keys(events).sort(), ['appendEvent', 'listEvents']);
    assert.deepEqual(Object.keys(queue).sort(), ['createRun', 'listRuns']);
    assert.deepEqual(Object.keys(guard).sort(), ['acquireWorker', 'releaseWorker']);
});
```

- [ ] **Step 1.5: Run it to verify it fails**

```bash
node --import tsx --test experiment-worker/src/harness/ports.test.ts
```

Expected: FAIL — `Module '"@sidechannel/contracts/harness/server"' has no exported member 'RunStateStore'` (tsc/tsx resolution error), because the slices do not exist yet.

- [ ] **Step 1.6: Add the ports**

Replace `packages/contracts/src/harness/server.ts` lines 34-42 with:

```ts
/** Run state: the scheduler's read/write/cas surface. */
export interface RunStateStore {
    getRun(id: string): Promise<Run | null>;
    saveRun(run: Run): Promise<void>;
    claimRun(runId: string, workerId: string): Promise<boolean>;
}

/** Append-only evidence log. */
export interface EventLog {
    appendEvent(event: NewEvent): Promise<HarnessEvent>;
    listEvents(runId: string, afterSequence?: number, limit?: number): Promise<HarnessEvent[]>;
}

/** Work admission: enqueue and enumerate runs. */
export interface RunQueue {
    createRun(run: Run): Promise<Run>;
    listRuns(): Promise<Run[]>;
}

/** Single-worker registration. Registration is a guard, not a heartbeat. */
export interface WorkerGuard {
    acquireWorker(owner: string): Promise<boolean>;
    releaseWorker(owner: string): Promise<void>;
}

/** Composed harness port for composition roots, projections and contract suites. */
export interface Repository extends RunStateStore, EventLog, RunQueue, WorkerGuard {}
```

`WorkerGuard` keeps conventions §3.1's `Promise<boolean>` exactly: both shipped adapters already return `boolean`, and `false` means "someone else owns the worker".

- [ ] **Step 1.7: Run the port test to verify it passes**

```bash
npm run build
node --import tsx --test experiment-worker/src/harness/ports.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 1.8: Split `SchedulerOptions` and rewrite the scheduler's six repository reads**

In `experiment-worker/src/harness/scheduler.ts`:

1. Line 2 — replace `import type { Repository, PrivateMemory, ModelAdapter, Scenario, ModelInput } from '@sidechannel/contracts/harness/server';` with

```ts
import type { EventLog, RunStateStore, PrivateMemory, ModelAdapter, Scenario, ModelInput } from '@sidechannel/contracts/harness/server';
```

2. Lines 8-13 — replace the interface with

```ts
export interface SchedulerOptions {
    runState: RunStateStore;
    events: EventLog;
    memory: PrivateMemory;
    adapter: ModelAdapter;
    scenario?: Scenario;
}
```

3. Line 18 — `const { runState, events, adapter } = this.options;`
4. Line 30 — `if (!await runState.claimRun(runId, randomUUID())) {`
5. Line 31 — `const existing = await runState.getRun(runId);`
6. Line 36 — `const run = (await runState.getRun(runId))!;`
7. Line 42 — `return await events.appendEvent({ runId, type, data, agentId: run.activeAgentId, round: run.round, turn: run.turn, ...extra });`
8. Line 52 — `await runState.saveRun(run);`
9. Line 60 — `if ((await runState.getRun(runId))?.cancelRequested) {`

No other line in that file changes (WS3b owns the body).

- [ ] **Step 1.9: Give the memory adapter the worker guard**

In `packages/persistence/src/harness/repository.ts` (`InMemoryRepository`), add after the `claims` field (line 40):

```ts
    private workerGuard: string | undefined;
```

and after `requestCancel` (before the class closing brace at line 117):

```ts
    async acquireWorker(owner: string) {
        if (this.workerGuard)
            return false;
        this.workerGuard = owner;
        return true;
    }
    async releaseWorker(owner: string) { if (this.workerGuard === owner) this.workerGuard = undefined; }
```

and replace the memory `workerStatus` (line 107) with the Mongo-equivalent shape (the `WorkerStatus` import added by WS1 at the top of the file is reused):

```ts
    async workerStatus(): Promise<WorkerStatus> { return { capacity: 1, available: null, status: this.workerGuard ? 'registered' : 'unknown', ...(this.workerGuard ? { startedAt: this.workerGuard } : {}), note: 'Worker registration has no heartbeat; current availability is unknown.' }; }
```

`startedAt` carries the owner token exactly once, mirroring Mongo's guard document; nothing parses it.

- [ ] **Step 1.10: Update every scheduler construction site**

Mechanical move map — replace `repository: <expr>` with `runState: <expr>, events: <expr>` for the same expression in every site below (adapters satisfy both slices):

| File | Line | New option list |
| --- | --- | --- |
| `experiment-worker/src/harness/core.test.ts` | 25 | `new HarnessScheduler({ runState: repo, events: repo, memory, adapter })` |
| `experiment-worker/src/harness/core.test.ts` | 166 | `new HarnessScheduler({ runState: h.repo, events: h.repo, memory: h.memory, adapter: h.adapter, scenario })` |
| `experiment-worker/src/harness/token-budget.test.ts` | 31 | `new HarnessScheduler({ runState: repo, events: repo, memory, adapter })` |
| `experiment-worker/src/harness/inference-provider.test.ts` | 49, 73 | `new HarnessScheduler({ runState: repo, events: repo, memory, adapter: new MastraModelAdapter() })` |
| `experiment-worker/src/harness/healthcare.test.ts` | 35 | `new HarnessScheduler({ runState: repository, events: repository, memory, adapter, scenario: healthcareScenario })` |
| `tests/integration/analysis-evidence.test.ts` | 158 | `new HarnessScheduler({ runState: repository, events: repository, adapter: new ScriptedAdapter(fixtureScript), memory: { … } })` |
| `tests/integration/integration-mongo.mongo.test.ts` | 32 | `new HarnessScheduler({ runState: repo, events: repo, memory, adapter: new ScriptedAdapter(fixtureScript) })` |
| `tests/integration/dashboard-smoke.ts` | 61, 92 | `new HarnessScheduler({ runState: repository, events: repository, memory, adapter: new ScriptedAdapter(fixtureScript) })` |
| `tests/integration/jev-smoke.ts` | 23 | `new HarnessScheduler({ runState: source, events: source, adapter: new ScriptedAdapter(fixtureScript), memory: { … } })` |
| `scripts/verify-compiled.mjs` | 36 | `new HarnessScheduler({ runState: repository, events: repository, memory, adapter: new ScriptedAdapter(fixtureScript) })` |

`experiment-worker/src/harness/runtime.ts:27` is rewritten wholesale in T2.5; for this task change in place to

```ts
            return new HarnessScheduler({ runState: repository, events: repository,
                scenario: healthcare ? healthcareScenario : fixtureScenario,
                memory: new MastraPrivateMemory(memory.storage, run.config.memory.template),
                adapter: run.config.model.provider === 'scripted' ? new ScriptedAdapter(healthcare ? healthcareScript : fixtureScript) : new MastraModelAdapter(),
            });
```

- [ ] **Step 1.11: Prove the gate**

```bash
npm run build
npm run check --workspace=@sidechannel/contracts
npm run check --workspace=@sidechannel/persistence
npm run check --workspace=@sidechannel/experiment-worker
node --import tsx --test experiment-worker/src/harness/ports.test.ts experiment-worker/src/harness/ports.characterization.test.ts
npm test
node scripts/verify-compiled.mjs
```

Expected: PASS; `ports.characterization.test.ts` green **without** editing its assertion. Any diff in the sequence means the split changed scheduling — revert and re-derive.

- [ ] **Step 1.12: Commit**

```bash
git add packages/contracts/src/harness/server.ts packages/persistence/src/harness/repository.ts experiment-worker/src/harness/scheduler.ts experiment-worker/src/harness/runtime.ts experiment-worker/src/harness/ports.test.ts experiment-worker/src/harness/core.test.ts experiment-worker/src/harness/token-budget.test.ts experiment-worker/src/harness/inference-provider.test.ts experiment-worker/src/harness/healthcare.test.ts tests/integration/analysis-evidence.test.ts tests/integration/integration-mongo.mongo.test.ts tests/integration/dashboard-smoke.ts tests/integration/jev-smoke.ts scripts/verify-compiled.mjs
git commit -m "refactor(contracts): split harness repository into run state, event log, queue and worker guard ports"
```

---

## T2.2 — Researcher ports split and handler narrowing

**Files:**
- Modify: `packages/contracts/src/server/contracts.ts:5-19`
- Modify: `api/src/routes/oversight.ts:2,10,18`
- Modify: `api/src/healthcare/service.ts:4,22,33`
- Modify: `api/src/routes/review-routes.ts:7,28,41` (shared with T2.3 — one PR may carry both edits)
- Modify (type-only, WS3c files): `packages/domain/src/oversight/service.ts:4,70,76,122`, `packages/domain/src/oversight/reviews.ts:2,18,30,59,86,98,106`
- Modify: `tests/integration/analysis-review-filtering.test.ts:72`
- Modify: `tests/integration/port-contracts.test.ts` (append the slice test)
- Test: `api/src/server/server.test.ts` (existing coverage; no edit expected)

**Interfaces:**
- Consumes: `RunStateStore`, `EventLog`, `RunQueue`, `WorkerGuard` (T2.1); `WorkerStatus` (WS1).
- Produces, in `@sidechannel/contracts/server/contracts`:

```ts
export interface RunQueries {
    queryRuns(query: RunQuery): Promise<{ items: RunSummary[]; total: number }>;
    getRunSummary(id: string): Promise<RunSummary | null>;
    getRunByLaunchKey(launchKey: string): Promise<Run | null>;
}
export interface DraftStore {
    saveDraft(id: string, config: unknown, expectedRevision?: number, metadata?: DraftMetadata): Promise<Draft>;
    listDrafts(): Promise<Draft[]>;
    getDraft(id: string): Promise<Draft | null>;
}
export interface EvidenceReader {
    queryEvents(id: string, query: EventQuery): Promise<HarnessEvent[]>;
    getEvent(runId: string, eventId: string): Promise<HarnessEvent | null>;
    getRunSummary(id: string): Promise<RunSummary | null>;
    getEvidencePage(id: string, kind: EvidenceKind, offset: number, limit: number): Promise<EvidencePage>;
    getEvidenceItem(id: string, kind: EvidenceKind, key: string): Promise<unknown | null>;
}
export interface WorkerSupervisor {
    workerStatus(): Promise<WorkerStatus>;
}
export interface ResearcherRepository extends RunStateStore, EventLog, RunQueue, WorkerGuard, RunQueries, DraftStore, EvidenceReader, WorkerSupervisor {}
```

- Produces (narrowed handler signatures):

```ts
// api/src/routes/oversight.ts
export function createOversightHandler(repository: Pick<Repository, 'getRun' | 'listEvents'>, store: ResearchStore): ResearchRouteHandler;
// api/src/healthcare/service.ts
routes(repository: Pick<Repository, 'getRun'>): ResearchRouteHandler;
researcherExport(run: Run, repository: Pick<Repository, 'getRun'>): Promise<unknown>;
// api/src/server/adaption-models.ts
export const adaptionModelRoute: ResearchRouteHandler;            // unchanged: uses no port
```

**Characterization gate:** `tests/integration/port-contracts.test.ts` + `port-contracts.mongo.test.ts` (WS1 harness suite) stay green, `api/src/server/server.test.ts` green, `tests/integration/{oversight-oversight,oversight-reviews,oversight-recovery}.test.ts` green, `node scripts/verify-compiled.mjs` green.

**Behaviour-change statement:** none. Every handler receives strictly fewer capabilities; the process wiring keeps one object, so no call path changes. `getEvidencePage` on a missing run keeps WS1's documented `{ items: [], total: 0 }`.

**Effort:** 1.0 dev-day.

- [ ] **Step 2.1: Write the failing slice test**

Append to `tests/integration/port-contracts.test.ts` (import `InMemoryRepository` if not present):

```ts
import type { RunQueries, DraftStore, EvidenceReader, WorkerSupervisor } from '@sidechannel/contracts/server/contracts';

test('researcher capability slices are satisfied by one adapter instance independently', async () => {
    const repository = new InMemoryRepository();
    const run = await repository.createRun(queuedRun('slices'));
    const queries: Pick<RunQueries, 'getRunSummary'> = repository;
    const drafts: Pick<DraftStore, 'getDraft'> = repository;
    const evidence: Pick<EvidenceReader, 'getEvidencePage' | 'queryEvents'> = repository;
    const supervisor: Pick<WorkerSupervisor, 'workerStatus'> = repository;
    assert.equal((await queries.getRunSummary(run.id))!.id, run.id);
    assert.equal(await drafts.getDraft('missing'), null);
    assert.deepEqual(await evidence.getEvidencePage(run.id, 'board', 0, 10), { items: [], total: 0 });
    assert.deepEqual(await evidence.queryEvents(run.id, {}), []);
    assert.equal((await supervisor.workerStatus()).capacity, 1);
});
```

(`queuedRun` comes from `./contracts/fixtures.js` per WS1.)

- [ ] **Step 2.2: Run it to verify it fails**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
```

Expected: FAIL — `@sidechannel/contracts/server/contracts` has no exported members `RunQueries`, `DraftStore`, `EvidenceReader`, `WorkerSupervisor`.

- [ ] **Step 2.3: Replace the composite port**

Replace `packages/contracts/src/server/contracts.ts` lines 1-19 with the header plus the five slices from **Interfaces** above (keep the existing `ResearchRouteRequest`/`ResearchRouteResult`/`ResearchRouteHandler` declarations at lines 21-25 unchanged). Required imports:

```ts
import type { EventLog, Repository, RunQueue, RunStateStore, WorkerGuard } from '../harness/server.js';
import type { HarnessEvent, Run } from '../harness/contracts.js';
import type { Draft, DraftMetadata, EventQuery, EvidenceKind, EvidencePage, RunQuery, RunSummary } from '../harness/repository.js';
```

`createPair` lives on `RunQueue` (pair creation is run creation and both adapters already implement it); `ResearcherRepository` inherits it from the composed `RunQueue` and does not redeclare it.

- [ ] **Step 2.4: Run the slice test, then narrow the handlers**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
npm run check --workspace=@sidechannel/api
```

Expected: slice test PASS; `tsc` now fails wherever a consumer asks for more than it needs — the failures are the work list for the next three steps.

Apply these edits:

`api/src/routes/oversight.ts` line 2 → `import type { Repository } from '@sidechannel/contracts/harness/server';` (unchanged) and line 18 →

```ts
export function createOversightHandler(repository: Pick<Repository, 'getRun' | 'listEvents'>, store: ResearchStore) {
```

`api/src/healthcare/service.ts` line 4 → replace the `ResearcherRepository` import with `import type { Repository } from '@sidechannel/contracts/harness/server';`; line 22 → `async researcherExport(run: Run, repository: Pick<Repository, 'getRun'>) {`; line 33 → `routes(repository: Pick<Repository, 'getRun'>): ResearchRouteHandler {`.

`packages/domain/src/oversight/service.ts` and `packages/domain/src/oversight/reviews.ts`: replace **every** `repository: Repository` parameter with `repository: Pick<Repository, 'getRun' | 'listEvents'>` (3 sites in `service.ts` at lines 70/76/122, 5 sites in `reviews.ts` at lines 18/30/59/86/98/106 — 6 including `latestRunOutcomeReview`). Keep the `Repository` type import; it is now only used inside `Pick`.

- [ ] **Step 2.5: Verify the narrowing compiles end-to-end**

```bash
npm run build
node scripts/verify-boundaries.mjs
npm run check
node scripts/verify-compiled.mjs
npm run test:integration --workspace=@sidechannel/integration
```

Expected: PASS. `createResearcherServer(repository: ResearcherRepository, …)` in `api/src/server/index.ts` needs **no** change: it passes the composed object to handlers that accept slices, and the composite supplies `createPair`/`workerStatus`/`requestCancel`.

- [ ] **Step 2.6: Commit**

```bash
git add packages/contracts/src/server/contracts.ts api/src/routes/oversight.ts api/src/healthcare/service.ts packages/domain/src/oversight/service.ts packages/domain/src/oversight/reviews.ts tests/integration/port-contracts.test.ts
git commit -m "refactor(contracts): split researcher repository into capability slices and narrow extension handlers"
```

---

## T2.3 — Analysis ports split and `readyJob` deletion

**Files:**
- Modify: `packages/contracts/src/analysis/jev-repository.ts:51-80` (delete `readyJob` at line 58)
- Modify: `packages/persistence/src/analysis/jev-repository.ts:39` (memory `readyJob`), `:101` (Mongo `readyJob`)
- Modify: `analysis-worker/src/jev/jev-worker.ts:8,16`
- Modify: `tests/integration/port-contracts.test.ts` (append the worker-slice test)
- Modify: `packages/domain/src/analysis/jev-service.ts:10,21` (import + documentation only)
- Modify: `api/src/routes/review-routes.ts:2,7,28,41`
- Modify: `tests/integration/contracts/analysis-repository.ts` (WS1 file: drop the `readyJob` call)
- Modify: `tests/integration/analysis-review-filtering.test.ts:72-74`

**Interfaces:**
- Consumes: WS1's analysis contract suite and fixtures (`analysisJob`, `analysisWindow`, `analysisAttempt`).
- Produces, in `@sidechannel/contracts/analysis/jev-repository`:

```ts
export interface CodebookStore {
    listCodebooks(page?: PageOptions): Promise<Page<Codebook>>;
    getCodebook(id: string): Promise<Codebook | null>;
    getRevision(id: string, revisionId: string): Promise<CodebookRevision | null>;
    listRevisions(codebookId: string, page?: PageOptions): Promise<Page<CodebookRevision>>;
    saveCodebook(book: Codebook, revision: CodebookRevision, expectedRevision?: string): Promise<void>;
}
export interface JobLifecycleStore {
    reserveJob(job: AnalysisJob): Promise<{ job: AnalysisJob; created: boolean }>;
    getJob(id: string): Promise<AnalysisJob | null>;
    listJobs(runId: string, page?: PageOptions): Promise<Page<AnalysisJob>>;
    listAllJobs(page?: PageOptions): Promise<Page<AnalysisJob>>;
    claim(owner: string, now: string, leaseMs: number): Promise<{ job: AnalysisJob; lease: Lease } | null>;
    heartbeat(lease: Lease, now: string, leaseMs: number): Promise<boolean>;
    updateCounters(lease: Lease, counters: JobCounters, usage?: JobUsage): Promise<boolean>;
    finishJob(lease: Lease, status: JobStatus, counters: JobCounters, error?: string, usage?: JobUsage): Promise<boolean>;
    cancel(id: string): Promise<AnalysisJob | null>;
    retry(id: string): Promise<AnalysisJob | null>;
}
export interface WindowStore {
    putWindow(window: WindowRecord): Promise<void>;
    getWindow(jobId: string, windowId: string): Promise<WindowRecord | null>;
    listWindows(jobId: string, page?: PageOptions): Promise<Page<WindowRecord>>;
    updateWindow(lease: Lease, windowId: string, patch: Partial<Pick<WindowRecord, 'status' | 'diagnostics'>>): Promise<boolean>;
}
export interface ArtifactStore {
    putArtifact(id: string, value: unknown): Promise<void>;
    readArtifact<T = unknown>(id: string): Promise<T>;
    artifactChunks(id: string): AsyncIterable<{ index: number; text: string }>;
}
export interface ResultStore {
    startAttempt(lease: Lease, attempt: AnalysisAttempt): Promise<boolean>;
    finishAttempt(lease: Lease, attempt: AnalysisAttempt, results: AnalysisResult[]): Promise<boolean>;
    listResults(jobId: string, page?: PageOptions): Promise<Page<AnalysisResult>>;
    resultsForWindows(jobId: string, windowIds: string[]): Promise<AnalysisResult[]>;
    listAttempts(jobId: string, page?: PageOptions): Promise<Page<AnalysisAttempt>>;
}
/** Everything `AnalysisWorker` touches: leases, windows, artifacts, results. Never codebooks. */
export type AnalysisWorkerStore = JobLifecycleStore & WindowStore & ArtifactStore & ResultStore;
export interface AnalysisRepository extends CodebookStore, JobLifecycleStore, WindowStore, ArtifactStore, ResultStore {}
```

- Produces (consumers):

```ts
export class AnalysisWorker { constructor(repository: AnalysisWorkerStore, options?: AnalysisWorkerOptions); }
export class AnalysisService { constructor(repository: AnalysisRepository, source: Pick<Repository, 'getRun' | 'listEvents'>); }
export function createReviewService(repository: Pick<AnalysisRepository, 'getJob' | 'getWindow' | 'listWindows' | 'listResults'>, store: ReviewStore): ReviewService;
export function reviewContext(repository: Pick<AnalysisRepository, 'getJob' | 'listWindows' | 'listResults'>, analysisId: string): Promise<ReviewContext>;
export function createReviewRouteHandler(service: ReviewService, repository: Pick<AnalysisRepository, 'getJob'>): …;
```

**Characterization gate:** `tests/integration/port-contracts{,.mongo}.test.ts` (analysis suite), `tests/integration/analysis-jev-{backend,api}.test.ts`, `analysis-evidence.test.ts`, `tests/integration/analysis-review-filtering.test.ts`, `npm run smoke:jev`-equivalent worker path (`tests/integration/jev-smoke.ts`). Zero calls to `readyJob` remain (`git grep -n readyJob` → only docs).

**Behaviour-change statement:** one deletion — `readyJob` disappears from the contract and both adapters. It has zero production callers (verified: only implementations and the WS1 suite). No queue transition is affected because `AnalysisService.launch` sets `ready: true` at creation (`jev-service.ts:70`).

**Effort:** 1.0 dev-day.

- [ ] **Step 3.1: Write the failing test**

Append to `tests/integration/port-contracts.test.ts`:

```ts
test('the analysis worker port does not require codebook operations', async () => {
    const repository = new InMemoryAnalysisRepository();
    // Compile-time proof: a worker-shaped store is assembled from four slices only.
    const workerStore: AnalysisWorkerStore = {
        reserveJob: repository.reserveJob.bind(repository), getJob: repository.getJob.bind(repository),
        listJobs: repository.listJobs.bind(repository), listAllJobs: repository.listAllJobs.bind(repository),
        claim: repository.claim.bind(repository), heartbeat: repository.heartbeat.bind(repository),
        updateCounters: repository.updateCounters.bind(repository), finishJob: repository.finishJob.bind(repository),
        cancel: repository.cancel.bind(repository), retry: repository.retry.bind(repository),
        putWindow: repository.putWindow.bind(repository), getWindow: repository.getWindow.bind(repository),
        listWindows: repository.listWindows.bind(repository), updateWindow: repository.updateWindow.bind(repository),
        putArtifact: repository.putArtifact.bind(repository), readArtifact: repository.readArtifact.bind(repository),
        artifactChunks: repository.artifactChunks.bind(repository),
        startAttempt: repository.startAttempt.bind(repository), finishAttempt: repository.finishAttempt.bind(repository),
        listResults: repository.listResults.bind(repository), resultsForWindows: repository.resultsForWindows.bind(repository),
        listAttempts: repository.listAttempts.bind(repository),
    };
    await repository.reserveJob(analysisJob('slice-job'));
    assert.equal((await workerStore.getJob('slice-job'))!.id, 'slice-job');
    assert.ok(!('readyJob' in workerStore));
});
```

with `import type { AnalysisWorkerStore } from '@sidechannel/contracts/analysis/jev-repository';` and the WS1 fixture import already present.

- [ ] **Step 3.2: Run it to verify it fails**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
```

Expected: FAIL — `AnalysisWorkerStore` is not exported; the object literal also lacks `readyJob`/`listCodebooks` if the type is widened.

- [ ] **Step 3.3: Split the analysis contract**

In `packages/contracts/src/analysis/jev-repository.ts`, replace lines 51-80 with the Interfaces block above. Keep `PageOptions`, `Page`, `Lease` and the four error classes untouched; `updateWindow` moves from the fat interface into `WindowStore`; `readyJob` is not declared anywhere.

- [ ] **Step 3.4: Delete both `readyJob` implementations**

`packages/persistence/src/analysis/jev-repository.ts`: delete line 39 (`async readyJob(id: string) { … }` in `InMemoryAnalysisRepository`) and line 101 (`async readyJob(id: string) { … }` in `MongoAnalysisRepository`). Both classes keep `implements AnalysisRepository` and now structurally satisfy it.

- [ ] **Step 3.5: Delete the WS1 suite's `readyJob` call**

In `tests/integration/contracts/analysis-repository.ts`, inside `unknown analysis reads return null or empty pages`, delete the line

```ts
        await repository.readyJob('missing');
```

Leave the remaining four assertions unchanged; the test keeps its name.

- [ ] **Step 3.6: Re-point the workers and routes**

`analysis-worker/src/jev/jev-worker.ts`: line 8 → `import type { AnalysisAttempt, AnalysisJob, AnalysisWorkerStore, AnalysisResult, JobCounters, JobUsage, Lease, WindowRecord } from '@sidechannel/contracts/analysis/jev-repository';` and line 16 → `constructor(private readonly repository: AnalysisWorkerStore, private readonly options: AnalysisWorkerOptions = {}) {`.

`packages/domain/src/analysis/jev-service.ts`: line 10 keeps `AnalysisRepository` (composed) and line 21 gains the comment `/** Composed analysis port: this service is the codebook + job lifecycle entry point. */` above the constructor.

`api/src/routes/review-routes.ts`: line 2 keeps the `AnalysisRepository` import; line 7 → `export async function reviewContext(repository: Pick<AnalysisRepository, 'getJob' | 'listWindows' | 'listResults'>, analysisId: string): Promise<ReviewContext> {`; line 28 → `export function createReviewService(repository: Pick<AnalysisRepository, 'getJob' | 'getWindow' | 'listWindows' | 'listResults'>, store: ReviewStore) {`; line 41 → `export function createReviewRouteHandler(service: ReviewService, repository: Pick<AnalysisRepository, 'getJob'>) {`. Bodies unchanged.

`tests/integration/analysis-review-filtering.test.ts` lines 72-74 → replace the cast with a literal:

```ts
    const repository = { getJob: async () => analysisJob(context.analysisId) };
    const handler = createReviewRouteHandler(service, repository);
```

with `import { analysisJob } from './contracts/fixtures.js';` added at the top. No `as unknown as AnalysisRepository` remains in the file.

- [ ] **Step 3.7: Verify**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
npm run test:integration --workspace=@sidechannel/integration
git grep -n "readyJob" -- packages analysis-worker api tests
```

Expected: PASS; the `git grep` output is empty (only `docs/` and `research/` may mention it).

- [ ] **Step 3.8: Commit**

```bash
git add packages/contracts/src/analysis/jev-repository.ts packages/persistence/src/analysis/jev-repository.ts analysis-worker/src/jev/jev-worker.ts packages/domain/src/analysis/jev-service.ts api/src/routes/review-routes.ts tests/integration/contracts/analysis-repository.ts tests/integration/analysis-review-filtering.test.ts tests/integration/port-contracts.test.ts
git commit -m "refactor(contracts): split analysis repository into codebook, job, window, artifact and result ports; delete readyJob"
```

---

## T2.4 — Store-port typing (research + review) and attempt usage typing

**Files:**
- Modify: `packages/contracts/src/analysis/store.ts` (whole file, 18 lines)
- Modify: `packages/contracts/src/analysis/review-repository.ts` (whole file, 15 lines)
- Modify: `packages/contracts/src/analysis/jev-reviews.ts:15-22` (add `ReviewReason`, `ReviewMember`, `ReviewQueueItem`)
- Modify: `packages/contracts/src/analysis/jev-repository.ts:34` (`usage?: ProviderUsage`)
- Modify: `packages/persistence/src/analysis/store.ts:4-31`
- Modify: `packages/persistence/src/analysis/review-repository.ts` (whole file)
- Modify: `packages/domain/src/analysis/jev-reviews.ts` (store interactions only)
- Modify: `packages/domain/src/oversight/service.ts:96-119` (preview part keys), `packages/domain/src/oversight/reviews.ts` (no key building; filter typing only)
- Modify: `api/src/routes/oversight.ts:36-38` (filter typing)
- Modify: `analysis-worker/src/jev/jev-worker.ts:120` (drop the usage cast)

**Interfaces:**
- Produces, in `@sidechannel/contracts/analysis/store`:

```ts
export interface ResearchRecord { id: string; revision: number; createdAt: string }
export interface Page<T> { items: T[]; nextCursor: string | null }
/** Every collection the research store serves. Adapters reject anything outside this union at compile time. */
export type ResearchCollection = 'monitor_definitions' | 'monitor_previews' | 'monitor_preview_parts' | 'monitor_evaluations' | 'run_outcome_reviews';
export type ResearchFilter = Record<string, string | number | boolean | undefined>;
export interface ResearchStore {
    get<T extends ResearchRecord>(collection: ResearchCollection, id: string): Promise<T | null>;
    insert<T extends ResearchRecord>(collection: ResearchCollection, record: T): Promise<boolean>;
    replace<T extends ResearchRecord>(collection: ResearchCollection, id: string, expectedRevision: number, record: T): Promise<boolean>;
    page<T extends ResearchRecord>(collection: ResearchCollection, filter?: ResearchFilter, after?: string, limit?: number): Promise<Page<T>>;
    claim(scope: string, id: string, owner: string, ttlMs: number): Promise<boolean>;
    renew(scope: string, id: string, owner: string, ttlMs: number): Promise<boolean>;
    release(scope: string, id: string, owner: string): Promise<void>;
}
/** Physical key layout for chunked blobs belongs to the store contract, not to domain code. */
export function previewPartKey(id: string, index: number): string;
```

- Produces, in `@sidechannel/contracts/analysis/review-repository`:

```ts
export type ReviewKind = 'reviews' | 'batches' | 'members';
export interface ReviewDocument<V = unknown> { id: string; collection: ReviewKind; partition: string; key: string; value: V }
export interface ReviewRow<T> { key: string; value: T }
export interface ReviewQuery { /* unchanged */ }
export interface MemberQuery { /* unchanged */ }
export interface ReviewStore {
    insert<T>(kind: ReviewKind, partition: string, key: string, value: T): Promise<void>;
    get<T>(kind: ReviewKind, partition: string, key: string): Promise<ReviewRow<T> | null>;
    page<T>(kind: ReviewKind, partition: string, after?: string, limit?: number, selectedOnly?: boolean, members?: MemberQuery): Promise<{ items: ReviewRow<T>[]; nextCursor: string | null }>;
    queryReviews<T>(partition: string, query: ReviewQuery, after?: string, limit?: number): Promise<{ items: ReviewRow<T>[]; nextCursor: string | null }>;
}
/** The `:`-suffixed zero-padded revision segment is store layout; domain must never build it. */
export function reviewRevisionKey(identity: string, revision: number): string;
```

- Produces, in `@sidechannel/contracts/analysis/jev-reviews`: `ReviewReason = 'flagged' | 'random' | 'manual'`, `ReviewMember = { windowId; eligible; selected; reasons: ReviewReason[]; order }`, `ReviewQueueItem = { windowId: string; selected: boolean; eligible?: boolean; reasons?: ReviewReason[]; order?: string }`.
- Produces: `AnalysisAttempt.usage?: ProviderUsage` (`ProviderUsage` from `./jev-provider.js`).

**Characterization gate:** `tests/integration/analysis-reviews.test.ts`, `analysis-review-filtering.test.ts`, `tests/integration/review-filtering.mongo.test.ts`, `oversight-{oversight,reviews,recovery}.test.ts` and the WS1 `research-store` suite all stay green; `git grep "as unknown as Review" packages/domain/src` is empty; `node scripts/verify-compiled.mjs` green.

**Behaviour-change statement:** none. Review documents keep the same stored fields (adapters now mint the `id` UUID that domain used to mint), preview parts keep the same `id`/`text` layout, filter objects keep their values. `usage` gains a type only.

**Effort:** 1.5 dev-days.

**Assessment — zod runtime dependency in `packages/contracts` (D13 partial), decided here:** `packages/contracts/src/healthcare/contracts.ts:1` is the only runtime zod import (`git grep "from 'zod'" packages/contracts/src` → 1 file). Importers of that module are `packages/domain/src/healthcare/{package,artifact,preset,scoring,evaluation}.ts`, `packages/domain/src/harness/{config,scenario-initialization}.ts`, `experiment-worker/src/harness/{healthcare-scenario,healthcare-script,runtime}.ts` + its test, `packages/persistence/src/healthcare/catalog.ts` (type-only), `api/src/healthcare/service.ts`, `tests/integration/healthcare-smoke.ts`, and the type-only re-export in `packages/contracts/src/browser.ts:8`. Moving the five schemas into domain forces `contracts` to hand-write `HealthcareAssets`/`HealthcareArtifact`/`HealthcareManifest`/`HealthcareTruth` (today all `z.infer<>`) because the layer direction forbids contracts→domain; that is a drift risk on the exact types the evidence pipeline validates, plus 6 consumer files and the browser DTO surface — it exceeds this task's budget. **Accepted deviation:** schemas stay in `packages/contracts`; WS2 adds the static guardrail in T2.6 (`zod` imported by exactly one file in `packages/contracts/src`) so the dependency cannot spread, and conventions §5 allocates the actual move to WS4 (`packages/domain/src/healthcare/**` owner). Recorded in `docs/solid-remediation-decisions.md`.

- [ ] **Step 4.1: Write the failing typing test**

Create `tests/integration/contracts/typed-store.ts` (helper, not a `.test.ts` file):

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReviewMember, ReviewBatch } from '@sidechannel/contracts/analysis/jev-reviews';
import { previewPartKey, type ResearchStore } from '@sidechannel/contracts/analysis/store';
import { reviewRevisionKey, type ReviewStore } from '@sidechannel/contracts/analysis/review-repository';
import type { MonitorEvaluation } from '@sidechannel/contracts/oversight/contracts';

/** Compile-time: the value type is chosen by the caller, so domain code never downcasts. */
export async function assertTypedStores(store: ResearchStore, reviews: ReviewStore): Promise<void> {
    const job: MonitorEvaluation | null = await store.get<MonitorEvaluation>('monitor_evaluations', 'missing');
    assert.equal(job, null);
    const batch: ReviewBatch | null = (await reviews.get<ReviewBatch>('batches', 'partition', 'missing'))?.value ?? null;
    assert.equal(batch, null);
    const members = await reviews.page<ReviewMember>('members', 'partition', '', 5);
    assert.deepEqual(members.items, []);
    assert.equal(previewPartKey('preview-1', 2), 'preview-1:2');
    assert.equal(reviewRevisionKey('identity', 3), 'identity:0000000003');
}
```

and append to `tests/integration/port-contracts.test.ts`:

```ts
import { assertTypedStores } from './contracts/typed-store.js';

test('memory stores are usable through the typed ports', async () => {
    await assertTypedStores(new InMemoryResearchStore(), new MemoryReviewStore());
});
```

- [ ] **Step 4.2: Run it to verify it fails**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
```

Expected: FAIL — `previewPartKey`/`reviewRevisionKey` are not exported; `ReviewRow`/generic `get` do not exist; `insert` still takes a `ReviewDocument`.

- [ ] **Step 4.3: Rewrite the two store contracts**

Write `packages/contracts/src/analysis/store.ts` as the Interfaces block above plus:

```ts
export const previewPartKey = (id: string, index: number): string => `${id}:${index}`;
```

Write `packages/contracts/src/analysis/review-repository.ts` as the Interfaces block above plus:

```ts
export const reviewRevisionKey = (identity: string, revision: number): string => `${identity}:${String(revision).padStart(10, '0')}`;
```

`ReviewQuery`/`MemberQuery` bodies are copied verbatim from the current lines 6 and 8.

- [ ] **Step 4.4: Add the member types and type attempt usage**

`packages/contracts/src/analysis/jev-reviews.ts` — append:

```ts
export type ReviewReason = 'flagged' | 'random' | 'manual';

export interface ReviewMember { windowId: string; eligible: boolean; selected: boolean; reasons: ReviewReason[]; order: string }

/** Blind queues deliberately omit `reasons`/`order`; assisted queues return full members. */
export interface ReviewQueueItem { windowId: string; selected: boolean; eligible?: boolean; reasons?: ReviewReason[]; order?: string }
```

`packages/contracts/src/analysis/jev-repository.ts` — line 1 import gains `ProviderUsage`:

```ts
import type { ProviderUsage } from './jev-provider.js';
```

and line 34 of `AnalysisAttempt` becomes `providedModel`-adjacent: replace `usage?: unknown;` with `usage?: ProviderUsage;`.

- [ ] **Step 4.5: Implement the typed ports in both adapters**

`packages/persistence/src/analysis/store.ts`: change the two classes to use `ResearchCollection` instead of `string` in `rows`, `collection`, and every method signature; keep all bodies. Mongo's collection-name regex guard stays (`private collection(name: ResearchCollection)`).

`packages/persistence/src/analysis/review-repository.ts` — the four methods become generic. Memory:

```ts
import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import type { ReviewDocument, ReviewQuery, MemberQuery, ReviewKind, ReviewRow, ReviewStore } from '@sidechannel/contracts/analysis/review-repository';

export class MemoryReviewStore implements ReviewStore {
    private rows = new Map<string, ReviewDocument>();
    private identity(kind: ReviewKind, partition: string, key: string) { return JSON.stringify([kind, partition, key]); }
    async insert<T>(kind: ReviewKind, partition: string, key: string, value: T) {
        const identity = this.identity(kind, partition, key);
        if (this.rows.has(identity)) throw new Error('Review revision conflict');
        this.rows.set(identity, structuredClone({ id: randomUUID(), collection: kind, partition, key, value }));
    }
    async get<T>(kind: ReviewKind, partition: string, key: string) { return structuredClone(this.rows.get(this.identity(kind, partition, key)) ?? null) as ReviewRow<T> | null; }
    async page<T>(kind: ReviewKind, partition: string, after = '', limit = 100, selectedOnly = false, members: MemberQuery = {}) {
        const rows = [...this.rows.values()].filter(r => r.collection === kind && r.partition === partition && r.key > after && (!selectedOnly || (r.value as { selected?: boolean }).selected === true)
            && (!members.includeWindowIds || members.includeWindowIds.includes(String((r.value as { windowId?: string }).windowId)))
            && (!members.excludeWindowIds || !members.excludeWindowIds.includes(String((r.value as { windowId?: string }).windowId)))).sort((a, b) => a.key < b.key ? -1 : 1).slice(0, limit + 1);
        return { items: structuredClone(rows.slice(0, limit)) as ReviewRow<T>[], nextCursor: rows.length > limit ? rows[limit - 1]!.key : null };
    }
    async queryReviews<T>(partition: string, query: ReviewQuery, after = '', limit = 100) { /* body of the current method, with `row.value[key]` accesses cast once via `(row.value as Record<string, unknown>)` and the return typed as ReviewRow<T>[] */ }
}
```

`MongoReviewStore`: same four signatures; `insert` builds `{ id: randomUUID(), collection: kind, partition, key, value }` **before** the 1 MB bound check so the bound still measures the same document; `private collection(kind: ReviewKind)`; `get`/`page`/`queryReviews` return the projected documents cast once to `ReviewRow<T>`.

- [ ] **Step 4.6: Remove key building and downcasts from domain**

`packages/domain/src/analysis/jev-reviews.ts`:

- Line 2 → `import { reviewRevisionKey, type MemberQuery, type ReviewKind, type ReviewQuery, type ReviewRow, type ReviewStore } from '@sidechannel/contracts/analysis/review-repository';`
- Line 3 import gains `type ReviewMember, type ReviewQueueItem`.
- Delete the `record` helper (line 11).
- Line 38 → `if (Number(expected) > 0 && !await this.store.get<Review>('reviews', ctx.analysisId, reviewRevisionKey(subject, Number(expected)))) throw new Error('Review revision conflict');`
- Line 40 → `await this.store.insert('reviews', ctx.analysisId, reviewRevisionKey(subject, review.revision), review); return review;`
- Lines 52-53 → `const page = await this.store.queryReviews<Review>(analysisId, query, after, limit); return { items: page.items.map(row => row.value), nextCursor: page.nextCursor };`
- Line 56-58 (private `page`) → generic:

```ts
    private async page<T>(kind: ReviewKind, partition: string, after = '', limit = 100, selectedOnly = false, members?: MemberQuery) {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be between 1 and 500');
        const page = await this.store.page<T>(kind, partition, after, limit, selectedOnly, members); return { items: page.items.map(row => row.value), nextCursor: page.nextCursor };
    }
```

- `createBatch` lines 69-77 → `const members: ReviewMember[] = population.map(window => { … });` then `for (const member of members) await this.store.insert('members', batch.id, member.order + ':' + member.windowId, member); await this.store.insert('batches', analysisId, batch.id, batch); return batch;`
- `getBatch` lines 80-117 → `const stored = await this.store.get<ReviewBatch>('batches', analysisId, batchId); if (!stored) throw new Error('Review batch not found'); const batch = stored.value;`; line 91 → `const reviews = await this.store.queryReviews<Review>(analysisId, { latest: true, definitionRevision: batch.definitionRevision, evidenceRevision: batch.evidenceRevision }, after, 500);`; line 93 → `const review = row.value;`; line 113 → `const page = await this.page<ReviewMember>('members', batchId, options.after, options.limit, true, members);`; the `items` map becomes `const items: ReviewQueueItem[] = …`.
- `allReviews` line 121 → `do { const page = await this.page<Review>('reviews', analysisId, after, 500); all.push(...page.items); after = page.nextCursor ?? undefined; } while (after); return all;`
- `export` lines 124-135 → `page<Review>('reviews', …)`, `page<ReviewBatch>('batches', …)`, `page<ReviewMember>('members', String(row.value.id), …)`.

`packages/domain/src/oversight/service.ts`: line 100-103 → `await store.insert('monitor_preview_parts', { id: previewPartKey(preview.id, index), revision: 1, createdAt: preview.createdAt, text: serialized.slice(index * chunkSize, (index + 1) * chunkSize) });` and line 113 → `const part = await store.get<{ id: string; revision: number; createdAt: string; text: string }>('monitor_preview_parts', previewPartKey(id, index));` with `import { previewPartKey } from '@sidechannel/contracts/analysis/store';` added at line 6.

`api/src/routes/oversight.ts` line 36 → `const filter: Record<string, string> = { runId };`.

`analysis-worker/src/jev/jev-worker.ts` line 120 → `const records = response?.attempts?.length ? response.attempts : [{ usage: response?.usage ?? attempt.usage }];`.

- [ ] **Step 4.7: Verify**

```bash
npm run build
node --import tsx --test tests/integration/port-contracts.test.ts
npm run test:integration --workspace=@sidechannel/integration
git grep -n "as unknown as Review" -- packages/domain/src
git grep -n "padStart(10" -- packages/domain/src
```

Expected: PASS; both greps empty (the key layout and casts exist only in `packages/contracts` and `packages/persistence`).

- [ ] **Step 4.8: Commit**

```bash
git add packages/contracts/src/analysis/store.ts packages/contracts/src/analysis/review-repository.ts packages/contracts/src/analysis/jev-reviews.ts packages/contracts/src/analysis/jev-repository.ts packages/persistence/src/analysis/store.ts packages/persistence/src/analysis/review-repository.ts packages/domain/src/analysis/jev-reviews.ts packages/domain/src/oversight/service.ts api/src/routes/oversight.ts analysis-worker/src/jev/jev-worker.ts tests/integration/contracts/typed-store.ts tests/integration/port-contracts.test.ts
git commit -m "refactor(contracts): type research and review store ports; move key layout and usage typing out of domain"
```

---

## T2.5 — Composition roots

**Files:**
- Modify: `api/src/main.ts` (whole file, 29 lines)
- Modify: `api/src/routes/jev-extension.ts:1-16`
- Modify: `analysis-worker/src/oversight/provider.ts:6`
- Modify: `analysis-worker/src/main.ts:22`
- Modify: `experiment-worker/src/mastra/index.ts` (whole file, 62 lines)
- Modify: `experiment-worker/src/harness/mastra-adapter.ts:37-67` (constructor + two calls)
- Modify: `experiment-worker/src/harness/runtime.ts` (whole file, 36 lines)
- Modify: `experiment-worker/src/main.ts` (whole file) + create `experiment-worker/src/worker.ts`
- Modify: `experiment-worker/src/commands/{fixture,recover,live-smoke}.ts`
- Modify: `experiment-worker/src/harness/mastra-adapter.test.ts:5,50,61-62,80,87`
- Modify: `docs/mastra-integration.md:42`
- Create: `api/src/routes/jev-extension.test.ts`
- Create: `analysis-worker/src/oversight/provider.test.ts`

**Interfaces:**
- Produces, in `experiment-worker/src/mastra/index.ts`:

```ts
export interface TraceRuntime {
    readonly storage: MongoDBStore;
    register(agent: Agent, tools: Record<string, ToolAction<any, any, any, any, any>>): Agent;
    flush(): Promise<void>;
    verify(traceId?: string, spanId?: string): Promise<void>;
    close(): Promise<void>;
}
export function openTraceRuntime(uri: string, dbName?: string): TraceRuntime;
/** Tracing is off unless a runtime is injected; production always injects one from `openRuntime()`. */
export const NO_TRACE_RUNTIME: TraceRuntime;
```

- Produces, in `experiment-worker/src/harness/mastra-adapter.ts`: `constructor(trace?: TraceRuntime, modelOverride?: ConstructorParameters<typeof Agent>[0]['model'])`.
- Produces, in `experiment-worker/src/worker.ts`:

```ts
export interface WorkerDeps {
    queue: RunQueue;
    guard: WorkerGuard;
    runState: RunStateStore;
    events: EventLog;
    scheduler(run: Run): { run(id: string): Promise<Run> };
    flush(): Promise<void>;
    close(): Promise<void>;
}
export async function runWorker(deps: WorkerDeps, owner?: string): Promise<void>;
```

- Produces, in `experiment-worker/src/harness/runtime.ts`: `export interface WorkerRuntime extends WorkerDeps { scheduler(run: Run): HarnessScheduler }` and `export async function openRuntime(): Promise<WorkerRuntime>`.
- Produces, in `api/src/routes/jev-extension.ts`:

```ts
export function createJevExtension(repository: AnalysisRepository, reviews: ReviewStore, source: Pick<Repository, 'getRun' | 'listEvents'>): ResearchRouteHandler;
```

- Produces, in `analysis-worker/src/oversight/provider.ts`: `export function createMonitorProvider(adapter: ModelAdapter): MonitorProvider`.

**Characterization gate:** `node scripts/verify-compiled.mjs` (compiled API + scripted run + export), `tests/integration/integration-mongo.mongo.test.ts` (worker guard, run completion, export), `tests/integration/{analysis-jev-api,oversight-oversight}.test.ts`, `experiment-worker/src/harness/mastra-adapter.test.ts` (trace durability), `npm run fixture` sequence unchanged (Step 5.12), `npm run smoke:live` (skipped without credentials — it must still fail only on credentials, not on constructors).

**Behaviour-change statement:** three deliberate, evidence-backed changes: (1) `api/src/main.ts` runs the analysis/review `initialize()` calls at startup instead of during `createJevExtension`, so index creation happens once at boot and a Mongo failure surfaces before the port is bound rather than on the first JEV request; (2) `createMonitorProvider` can no longer fall back to a lazily imported adapter — `analysis-worker/src/main.ts` constructs `MonitorModelAdapter` eagerly, so a broken import fails at startup. **Credential** failures still surface at the first evaluation: the monitor model is a per-run setting (`MonitorSettings.model` from `createMonitorPreview`), so no startup code can name the provider; this is the narrowest achievable fail-fast and is recorded as deviation 7. (3) the Mastra registry becomes an explicitly passed value, so two runtimes can coexist in one process (previously `configureExperimentRuntime` threw on a second identity).

**Effort:** 1.5 dev-days.

- [ ] **Step 5.1: Write the failing composition tests**

Create `api/src/routes/jev-extension.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { MemoryReviewStore } from '@sidechannel/persistence/analysis/review-repository';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { createJevExtension } from './jev-extension.js';

test('the JEV extension is composed from injected ports and never constructs a Mongo adapter', async () => {
    const analysis = new InMemoryAnalysisRepository();
    const reviews = new MemoryReviewStore();
    const source = new InMemoryRepository();
    const handler = createJevExtension(analysis, reviews, source);
    const response = await handler({ method: 'GET', path: '/jev/codebooks', query: new URLSearchParams(), body: {} });
    assert.equal(response?.status, 200);
    assert.deepEqual((response?.data as { items: unknown[] }).items.length, 1); // the seeded tentative default
});
```

Create `analysis-worker/src/oversight/provider.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMonitorProvider } from './provider.js';

test('createMonitorProvider requires an injected adapter and never imports one lazily', async () => {
    // @ts-expect-error the monitor adapter is required; omitting it must not compile
    const invalid: unknown = createMonitorProvider();
    assert.equal(typeof invalid, 'object');
    const seen: string[] = [];
    const provider = createMonitorProvider({ async complete(input) { seen.push(input.invocationId); return { text: '{"judgments":[]}', toolCalls: [] }; } });
    await provider.evaluate({ evaluationId: 'e', projection: { runId: 'r', view: 'continuity' } as never, definition: { outcomes: [] } as never,
        settings: { model: { provider: 'fixture', id: 'x', settings: {} }, timeoutMs: 10 } as never });
    assert.deepEqual(seen, ['e:r:continuity']);
});
```

- [ ] **Step 5.2: Run both to verify they fail**

```bash
npm run build
node --import tsx --test api/src/routes/jev-extension.test.ts
npm run check --workspace=@sidechannel/analysis-worker
```

Expected: `jev-extension.test.ts` FAILS with an arity/`MongoRepository` type error (it currently takes one `MongoRepository` and is `async`); the type check FAILS with `Unused '@ts-expect-error' directive.` on the `createMonitorProvider()` line, because the parameter is still optional. (The unused-directive error is the red signal — a runtime assertion cannot distinguish an optional from a required parameter — and `scripts/verify-composition.mjs` keeps the requiredness from regressing.)

- [ ] **Step 5.3: Make `createJevExtension` a synchronous injection point**

Replace `api/src/routes/jev-extension.ts` lines 1-16 with:

```ts
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { AnalysisRepository } from '@sidechannel/contracts/analysis/jev-repository';
import type { ReviewStore } from '@sidechannel/contracts/analysis/review-repository';
import type { Repository } from '@sidechannel/contracts/harness/server';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { AnalysisService } from '@sidechannel/domain/analysis/jev-service';
import { createAnalysisRouteHandler } from './jev-routes.js';
import { createReviewRouteHandler, createReviewService } from './review-routes.js';

/** Canonical JEV API. Repositories arrive fully initialized from the composition root. */
export function createJevExtension(repository: AnalysisRepository, reviews: ReviewStore, source: Pick<Repository, 'getRun' | 'listEvents'>): ResearchRouteHandler {
    return createJevRouteExtension(new AnalysisService(repository, source), createReviewService(repository, reviews));
}
```

`createJevRouteExtension` (lines 18-40) is unchanged.

- [ ] **Step 5.4: Build the analysis and review repositories in the API composition root**

Replace `api/src/main.ts` with:

```ts
import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { MongoAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { MongoReviewStore } from '@sidechannel/persistence/analysis/review-repository';
import { MongoResearchStore } from '@sidechannel/persistence/analysis/store';
import { MongoHealthcareCatalog } from '@sidechannel/persistence/healthcare/catalog';
import { buildMetadata } from '@sidechannel/domain/harness/provenance';
import { createResearcherServer } from './server/index.js';
import { createJevExtension } from './routes/jev-extension.js';
import { createOversightHandler } from './routes/oversight.js';

const host = process.env.HARNESS_HOST ?? '127.0.0.1';

const port = Number(process.env.HARNESS_PORT ?? 4310);

const repository = await MongoRepository.connect(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0', process.env.MONGODB_DB_NAME ?? 'sidechannel');

const researchStore = new MongoResearchStore(repository.db);

await researchStore.initialize();
const healthcareCatalog = new MongoHealthcareCatalog(repository.client, repository.db);
await healthcareCatalog.initialize();
// The analysis and review stores are built here, not inside the route module: one
// startup migration, one failure point, and no request path can construct storage.
const analysisRepository = new MongoAnalysisRepository(repository.client, repository.db);
await analysisRepository.initialize();
const reviewStore = new MongoReviewStore(repository.db);
await reviewStore.initialize();

const server = createResearcherServer(repository, { host, healthcareCatalog, token: process.env.RESEARCHER_TOKEN, buildMetadata: await buildMetadata(),
    extensionHandlers: [createJevExtension(analysisRepository, reviewStore, repository), createOversightHandler(repository, researchStore)] });

server.listen(port, host, () => console.log(`Researcher dashboard: http://${host}:${port}`));

async function stop() { server.close(); await repository.close(); }

process.on('SIGINT', () => void stop());

process.on('SIGTERM', () => void stop());
```

- [ ] **Step 5.5: Require the monitor adapter**

Replace `analysis-worker/src/oversight/provider.ts` lines 6-9 with:

```ts
/** A new stateless invocation for every view; no tools, memory, other judgments or Jev. */
export function createMonitorProvider(adapter: ModelAdapter): MonitorProvider {
    return {
        async evaluate({ evaluationId, projection, definition, settings }) {
            const transport = adapter;
```

(the rest of the body is unchanged: `const identity = …` through `return { output, usage: result.usage };`).

In `analysis-worker/src/main.ts`, add `import { MonitorModelAdapter } from './oversight/model-adapter.js';` and replace line 22 with:

```ts
const monitor = createMonitorProvider(new MonitorModelAdapter());
```

- [ ] **Step 5.6: Turn the Mastra registry into a `TraceRuntime` value**

Replace `experiment-worker/src/mastra/index.ts` with:

```ts
import { Mastra } from '@mastra/core/mastra';
import type { Agent } from '@mastra/core/agent';
import type { ToolAction } from '@mastra/core/tools';
import { MongoDBStore } from '@mastra/mongodb';
import { Observability, MastraStorageExporter, SensitiveDataFilter } from '@mastra/observability';

/** Everything the trace pipeline needs. A value, not module state: two runtimes may coexist. */
export interface TraceRuntime {
    readonly storage: MongoDBStore;
    register(agent: Agent, tools: Record<string, ToolAction<any, any, any, any, any>>): Agent;
    flush(): Promise<void>;
    verify(traceId?: string, spanId?: string): Promise<void>;
    close(): Promise<void>;
}

class MastraTraceRuntime implements TraceRuntime {
    readonly storage: MongoDBStore;
    private readonly mastra: Mastra;
    constructor(uri: string, dbName: string) {
        this.storage = new MongoDBStore({ id: 'experiment-traces', uri, dbName });
        this.mastra = new Mastra({ agents: {}, tools: {}, storage: this.storage,
            observability: new Observability({ configs: { default: { serviceName: 'sidechannel-experiment', logging: { enabled: false },
                        exporters: [new MastraStorageExporter()], spanOutputProcessors: [new SensitiveDataFilter()] } } }) });
    }
    register(agent: Agent, tools: Record<string, ToolAction<any, any, any, any, any>>) {
        for (const [name, tool] of Object.entries(tools))
            if (tool.execute)
                throw new Error('Experiment tools must be proposal-only');
        for (const [name, tool] of Object.entries(tools)) this.mastra.addTool(tool, name);
        // addAgent skips an existing ID. Each scheduler step supplies a fresh Agent;
        // replace the prior registration so this instance receives storage/tracing.
        // Scheduler calls are serial, and the prior invocation is already flushed.
        this.mastra.removeAgent(agent.id);
        this.mastra.addAgent(agent);
        return agent;
    }
    async flush() { await this.mastra.observability?.flush(); }
    /** A successful exporter flush alone does not guarantee Mongo accepted the writes. */
    async verify(traceId?: string, spanId?: string) {
        if (!traceId || !spanId)
            throw new Error('Native Mastra invocation omitted trace correlation');
        await this.flush();
        const store = await this.storage.getStore('observability');
        const trace = await store?.getTrace({ traceId });
        const root = trace?.spans.find(span => span.spanId === spanId);
        if (!root?.endedAt)
            throw new Error(`Native Mastra trace was not durably completed: ${traceId}`);
    }
    async close() { await this.mastra.observability?.shutdown(); await this.storage.close(); }
}

export function openTraceRuntime(uri: string, dbName = 'sidechannel_mastra'): TraceRuntime {
    return new MastraTraceRuntime(uri, dbName);
}

/**
 * Explicit "no tracing" runtime for scripted/unit callers that deliberately omit persistence.
 * It holds no Mastra instance, so it cannot accidentally accumulate registrations.
 */
export const NO_TRACE_RUNTIME: TraceRuntime = {
    storage: undefined as never,
    register: agent => agent,
    flush: async () => {},
    verify: async () => {},
    close: async () => {},
};
```

- [ ] **Step 5.7: Inject the runtime into `MastraModelAdapter`**

`experiment-worker/src/harness/mastra-adapter.ts`: line 6 → `import { NO_TRACE_RUNTIME, type TraceRuntime } from '../mastra/index.js';`; line 38 → `constructor(private readonly trace: TraceRuntime = NO_TRACE_RUNTIME, private readonly modelOverride?: ConstructorParameters<typeof Agent>[0]['model']) { }`; line 48 → `const agent = this.trace.register(new Agent({ … }), tools);`; line 55 → `await this.trace.verify(result.traceId, result.spanId);`.

**Every existing positional call must become named or updated:** no call site passes `modelOverride` positionally today (`new MastraModelAdapter()` and `new MastraModelAdapter(model)` in tests and `live-smoke.ts:60`). `new MastraModelAdapter(model)` at `mastra-adapter.test.ts:26/41/46/58/71` becomes `new MastraModelAdapter(undefined, model)` — or, preferred, `new MastraModelAdapter(NO_TRACE_RUNTIME, model)` for the first test and `new MastraModelAdapter(trace, model)` inside the Mongo test (Step 5.9).

- [ ] **Step 5.8: Make `openRuntime()` the only place that names a concrete adapter**

Replace `experiment-worker/src/harness/runtime.ts` with:

```ts
import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { createMongoMemory, MastraModelAdapter, MastraPrivateMemory } from './mastra-adapter.js';
import { fixtureScript, ScriptedAdapter } from './scripted-adapter.js';
import { healthcareScript } from './healthcare-script.js';
import { healthcareScenario } from './healthcare-scenario.js';
import { fixtureScenario } from './scenario.js';
import { HEALTHCARE_SCENARIO_VERSION } from '@sidechannel/contracts/healthcare/contracts';
import { HarnessScheduler } from './scheduler.js';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import { openTraceRuntime, type TraceRuntime } from '../mastra/index.js';
import type { WorkerDeps } from '../worker.js';

export const defaultMongoUri = 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';

/** Composition root: the only experiment-worker module that may name a concrete adapter. */
export interface WorkerRuntime extends WorkerDeps { scheduler(run: Run): HarnessScheduler }

export async function openRuntime(): Promise<WorkerRuntime> {
    const uri = process.env.MONGODB_URI ?? defaultMongoUri;
    const repository = await MongoRepository.connect(uri, process.env.MONGODB_DB_NAME ?? 'sidechannel');
    const memory = createMongoMemory(uri, process.env.MASTRA_DB_NAME ?? 'sidechannel_mastra');
    const trace: TraceRuntime = openTraceRuntime(uri, process.env.MASTRA_DB_NAME ?? 'sidechannel_mastra');
    return {
        queue: repository, guard: repository, runState: repository, events: repository, memory,
        scheduler(run: Run) {
            const healthcare = run.config.scenario.version === HEALTHCARE_SCENARIO_VERSION;
            if (!healthcare && run.config.scenario.version !== 'fixture-v1')
                throw new Error(`Scenario runtime unavailable: ${run.config.scenario.version}`);
            if (healthcare && run.config.model.provider === 'scripted' && run.config.model.id !== HEALTHCARE_SCENARIO_VERSION)
                throw new Error('Scripted model does not match the selected scenario');
            return new HarnessScheduler({ runState: repository, events: repository,
                scenario: healthcare ? healthcareScenario : fixtureScenario,
                memory: new MastraPrivateMemory(memory.storage, run.config.memory.template),
                adapter: run.config.model.provider === 'scripted' ? new ScriptedAdapter(healthcare ? healthcareScript : fixtureScript) : new MastraModelAdapter(trace),
            });
        },
        flush: () => trace.flush(),
        async close() { await trace.close(); await repository.close(); await memory.storage.close(); },
    };
}
```

`memory` is exposed on `WorkerRuntime` for `live-smoke`-style callers; `WorkerDeps` does not require it, so nothing in the loop can reach Mastra memory.

- [ ] **Step 5.9: Extract the worker loop**

Create `experiment-worker/src/worker.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { EventLog, RunQueue, RunStateStore, WorkerGuard } from '@sidechannel/contracts/harness/server';
import type { Run } from '@sidechannel/contracts/harness/contracts';

/** Everything the loop needs. No concrete adapter, no Mastra, no Mongo. */
export interface WorkerDeps {
    queue: RunQueue;
    guard: WorkerGuard;
    runState: RunStateStore;
    events: EventLog;
    scheduler(run: Run): { run(id: string): Promise<Run> };
    flush(): Promise<void>;
    close(): Promise<void>;
}

export async function runWorker(deps: WorkerDeps, owner: string = randomUUID()): Promise<void> {
    let stopping = false;
    let activeId: string | undefined;
    const stop = async () => { stopping = true; if (activeId) await deps.runState.requestCancel(activeId); };
    const onSignal = () => void stop();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    if (!await deps.guard.acquireWorker(owner)) {
        await deps.close();
        throw new Error('A worker owns this database. If its process crashed, use npm run recover only after stopping every worker.');
    }
    console.log('Harness worker ready; one run at a time.');
    try {
        while (!stopping) {
            const queued = (await deps.queue.listRuns()).filter(run => run.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt) || ((a.pairPosition ?? 0) - (b.pairPosition ?? 0)));
            const run = queued[0];
            if (!run) {
                await setTimeout(500);
                continue;
            }
            activeId = run.id;
            try {
                const result = await deps.scheduler(run).run(run.id);
                await deps.flush();
                console.log(`${run.id}: ${result.status}`);
            }
            catch (error) {
                try {
                    const latest = await deps.runState.getRun(run.id);
                    if (latest) {
                        latest.status = 'interrupted';
                        latest.failureReason = error instanceof Error ? error.message : 'Worker failed';
                        await deps.runState.saveRun(latest);
                        await deps.events.appendEvent({ runId: run.id, type: 'worker_interrupted', data: { reason: latest.failureReason } });
                    }
                }
                catch { }
                console.error(`${run.id}: execution stopped; inspect persisted failure evidence`);
            }
            finally {
                activeId = undefined;
            }
        }
    }
    finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
        await deps.guard.releaseWorker(owner);
        await deps.close();
    }
}
```

Replace `experiment-worker/src/main.ts` with:

```ts
import { openRuntime } from './harness/runtime.js';
import { runWorker } from './worker.js';

const runtime = await openRuntime();

await runWorker(runtime);
```

`main.ts` now imports exactly two relative modules and no port implementation; `runtime.ts` is the single concrete-adapter site.

- [ ] **Step 5.10: Update the CLI commands to the slice names**

`experiment-worker/src/commands/fixture.ts`: line 12 → `if (!await runtime.guard.acquireWorker(owner)) {`; line 19 → `const queued = await runtime.queue.createRun(createQueuedRun(config, \`fixture-${randomUUID()}\`));`; line 25 → `const page = await runtime.events.listEvents(run.id, cursor, 1000);`; line 39 → `await runtime.guard.releaseWorker(owner);`.

`experiment-worker/src/commands/recover.ts` is unchanged: it is an operator maintenance command that deliberately talks to the concrete adapter (guard collection cleanup at line 17 has no port by design).

`experiment-worker/src/commands/live-smoke.ts`: line 5 → `import { openTraceRuntime } from '../mastra/index.js';`; line 40 → `const trace = openTraceRuntime(uri, dbName);`; line 60 → `const response = await new MastraModelAdapter(trace).complete(input);`; line 67 → `await trace.flush();`; line 74 → `await trace.close();`.

- [ ] **Step 5.11: Update the trace test to the runtime value**

`experiment-worker/src/harness/mastra-adapter.test.ts`: line 5 → `import { openTraceRuntime, NO_TRACE_RUNTIME } from '../mastra/index.js';`; lines 26/41/46 → `new MastraModelAdapter(NO_TRACE_RUNTIME, model)`; line 50 → `const trace = openTraceRuntime(process.env.TEST_MONGODB_URI!, 'sidechannel_adapter_trace_test');`; line 58/71 → `new MastraModelAdapter(trace, model)`; line 61 → `await trace.flush();`; line 62 → `const store = await trace.storage.getStore('observability');`; line 80 → `await assert.rejects(trace.verify(result.trace!.traceId, result.trace!.spanId), /not durably completed/);`; line 87 → `await trace.close();`.

Update `docs/mastra-integration.md:42` to describe `openTraceRuntime(uri, dbName)` / `runtime.flush()` / `runtime.verify(...)` / `runtime.close()` and state that the runtime is a value injected into `MastraModelAdapter`.

- [ ] **Step 5.12: Verify**

```bash
npm run build
node --import tsx --test api/src/routes/jev-extension.test.ts analysis-worker/src/oversight/provider.test.ts experiment-worker/src/harness/mastra-adapter.test.ts experiment-worker/src/harness/ports.characterization.test.ts
npm run lint
npm run check
npm test
node scripts/verify-compiled.mjs
docker compose up -d --wait mongo
npm run test:integration
npm run fixture
node -e "const f=require('./agent/examples/completed-fixture.json');console.log(f.events.length)"
git diff --stat agent/examples/completed-fixture.json
```

Expected: PASS everywhere; the regenerated fixture still has 103 events and only timestamp/UUID/build-hash fields differ (`git diff` limited to those lines — inspect and record). Any event-type or ordering change means the composition change altered execution.

- [ ] **Step 5.13: Commit**

```bash
git add api/src/main.ts api/src/routes/jev-extension.ts api/src/routes/jev-extension.test.ts analysis-worker/src/main.ts analysis-worker/src/oversight/provider.ts analysis-worker/src/oversight/provider.test.ts experiment-worker/src/mastra/index.ts experiment-worker/src/harness/mastra-adapter.ts experiment-worker/src/harness/mastra-adapter.test.ts experiment-worker/src/harness/runtime.ts experiment-worker/src/main.ts experiment-worker/src/worker.ts experiment-worker/src/commands/fixture.ts experiment-worker/src/commands/live-smoke.ts docs/mastra-integration.md
git commit -m "refactor(services): move adapter and runtime construction to composition roots"
```

---

## T2.6 — Guardrails and verification

**Files:**
- Create: `scripts/verify-composition.mjs`
- Modify: `package.json:28` (`verify` script) and `scripts` (add `verify:composition`)
- Modify: `docs/solid-remediation-decisions.md`

**Interfaces:**
- Consumes: all T2.1–T2.5 deliverables (worker entry, routes, provider, Mastra module).
- Produces: `npm run verify:composition` — exits 0 or throws an `AssertionError` naming the offending file and pattern.

**Characterization gate:** the script itself is the gate; it must pass on the finished branch and fail if a future PR reintroduces any of the five patterns (proven by temporarily adding one, running it, then reverting — no code left behind).

**Behaviour-change statement:** none (developer tooling only).

**Effort:** 0.5 dev-day.

- [ ] **Step 6.1: Write the static composition check**

Create `scripts/verify-composition.mjs`:

```js
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = file => readFileSync(resolve(root, file), 'utf8');
const forbidden = (file, pattern, reason) => assert(!pattern.test(source(file)), `${file}: ${reason} (matched ${pattern})`);

// 1. The experiment worker loop and entrypoint may name no concrete adapter.
for (const file of ['experiment-worker/src/main.ts', 'experiment-worker/src/worker.ts']) {
    forbidden(file, /@sidechannel\/persistence/, 'the worker may depend only on contract ports');
    forbidden(file, /\bMongo\w*/, 'the worker may not name a Mongo adapter');
    forbidden(file, /new Mastra(Memory|ModelAdapter|PrivateMemory)/, 'the worker may not construct Mastra collaborators');
}

// 2. Route modules never construct or initialize storage.
const routes = readdirSync(resolve(root, 'api/src/routes')).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'));
for (const name of routes) {
    forbidden(join('api/src/routes', name), /new Mongo\w+/, 'composition belongs to api/src/main.ts');
    forbidden(join('api/src/routes', name), /\.initialize\(\)/, 'startup migrations belong to api/src/main.ts');
}

// 3. The monitor provider requires an injected adapter and never imports one lazily.
forbidden('analysis-worker/src/oversight/provider.ts', /await import\(/, 'the monitor adapter must be injected, not imported lazily');
forbidden('analysis-worker/src/oversight/provider.ts', /adapter\?/, 'the monitor adapter parameter is required');

// 4. The Mastra registry is a value, never mutable module state.
forbidden('experiment-worker/src/mastra/index.ts', /export let /, 'the trace runtime is injected, not a mutable module global');
forbidden('experiment-worker/src/mastra/index.ts', /^let /m, 'the trace runtime holds its state in an instance field');

// 5. Exactly one contracts module may use zod at runtime (accepted deviation from T2.4;
//    the extraction itself belongs to WS4 and packages/domain/src/healthcare).
const contractsFiles = [];
const walk = directory => { for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.ts')) contractsFiles.push(path);
} };
walk(resolve(root, 'packages/contracts/src'));
const zodUsers = contractsFiles.filter(file => /from 'zod'/.test(readFileSync(file, 'utf8')));
assert.deepEqual(zodUsers.map(file => file.replaceAll('\\', '/').split('/packages/contracts/')[1]), ['src/healthcare/contracts.ts'],
    'only the healthcare schema module may depend on zod; move new runtime schemas to packages/domain');

console.log('Composition roots verified: no concrete adapters in workers or routes, no lazy provider import, no mutable Mastra global, one zod module in contracts.');
```

- [ ] **Step 6.2: Prove the check fails when a pattern returns**

```bash
node scripts/verify-composition.mjs
node -e "require('node:fs').appendFileSync('experiment-worker/src/worker.ts', '\n// import { MongoRepository } from \'@sidechannel/persistence/harness/repository\';\n')"
node scripts/verify-composition.mjs ; echo "expected failure above"
git checkout -- experiment-worker/src/worker.ts
node scripts/verify-composition.mjs
```

Expected: first run prints the success line; the second throws `experiment-worker/src/worker.ts: the worker may depend only on contract ports`; after the revert the script prints the success line again.

- [ ] **Step 6.3: Wire it into the verification entry point**

In `package.json`: add `"verify:composition": "node scripts/verify-composition.mjs"` to `scripts` and extend `verify`:

```json
"verify": "npm run lint && npm run verify:composition && npm run check && npm test && npm run build",
```

- [ ] **Step 6.4: Run the full matrix**

```bash
npm run verify
node scripts/verify-boundaries.mjs
npm run test:integration
node scripts/verify-compiled.mjs
node scripts/verify-migration-equivalence.mjs
node -e "const f=require('./agent/examples/completed-fixture.json');console.log(f.events.length)"
git grep -n "as unknown as Review\|as unknown as AnalysisRepository\|readyJob\|export let mastra" -- packages api analysis-worker experiment-worker tests
```

Expected: every command exits 0; the fixture still has 103 events; the final `git grep` is empty.

- [ ] **Step 6.5: Record the decisions and finish**

Append to `docs/solid-remediation-decisions.md`:

```markdown
## WS2 — Ports and composition roots (2026-11-07)

- Harness ports: `RunStateStore` (incl. `requestCancel`), `EventLog`, `RunQueue` (incl. `createPair`), `WorkerGuard`; `Repository` is their composition.
  `HarnessScheduler` takes `{ runState, events, memory, adapter, scenario? }`; the worker loop takes `queue`, `guard`,
  `runState`, `events`, `scheduler`, `flush` and names no adapter.
- `ResearcherRepository` is a composition of `RunQueries`, `DraftStore`, `EvidenceReader`, `WorkerSupervisor`
  and the four harness slices; it inherits `createPair` from `RunQueue`.
- Analysis ports: `CodebookStore`, `JobLifecycleStore`, `WindowStore`, `ArtifactStore`, `ResultStore`;
  `AnalysisWorker` takes `AnalysisWorkerStore` (= job+window+artifact+result). `readyJob` deleted (zero callers).
- Store ports are typed: `ResearchCollection` union + `ResearchFilter` values, generic `ReviewStore`
  with `ReviewRow<T>`; `previewPartKey`/`reviewRevisionKey` own the physical key layout; domain casts removed.
- `AnalysisAttempt.usage` is `ProviderUsage` (S6 partially closed, no adapter change).
- Composition roots: `api/src/main.ts` builds and initializes the Mongo analysis/review repositories,
  `createMonitorProvider(adapter)` requires injection, `openTraceRuntime()` returns a `TraceRuntime` value
  injected into `MastraModelAdapter`; the worker guard remains a registration without heartbeat.
- Accepted deviation: zod runtime schemas stay in `packages/contracts/src/healthcare/contracts.ts` until WS4;
  `scripts/verify-composition.mjs` pins the single-module boundary in the meantime.
- Accepted deviation: monitor credentials still fail at first evaluation, because the monitor model is a
  per-run setting; only the transport construction moved to startup.
```

```bash
git add scripts/verify-composition.mjs package.json docs/solid-remediation-decisions.md
git commit -m "chore(scripts): verify composition roots and pin the contracts zod boundary"
```

---

## Verification summary

| Check | Command | Expected |
| --- | --- | --- |
| Characterization (memory) | `node --import tsx --test experiment-worker/src/harness/ports.characterization.test.ts` | PASS, 103 events, unchanged array |
| Lint + boundaries | `npm run lint` | exit 0 |
| Composition gate | `node scripts/verify-composition.mjs` | exit 0 |
| Types | `npm run check` | exit 0 |
| Unit + memory contracts | `npm test` | PASS, includes `port-contracts.test.ts` |
| Mongo parity + integration | `docker compose up -d --wait mongo && npm run test:integration` | PASS, includes `port-contracts.mongo.test.ts` |
| Build + compiled ESM | `npm run build && node scripts/verify-compiled.mjs` | PASS |
| Migration equivalence | `node scripts/verify-migration-equivalence.mjs` | PASS |
| Fixture evidence | `npm run fixture` + `node -e …events.length` | 103 events, same types/order |
| No concrete deps in workers | `node scripts/verify-composition.mjs` | exit 0 |
| Dead code gone | `git grep -n "readyJob\|export let mastra" -- packages api analysis-worker experiment-worker tests` | empty |
| No domain downcasts | `git grep -n "as unknown as Review\|as unknown as AnalysisRepository" -- .` | empty |

## Rollback

Each task is one commit, `git revert`-able, with no schema change and no destructive migration.

- **T2.1** — revert restores the single `Repository` option. The characterization test lands in its own preceding commit and must be reverted with T2.1 only if the scheduler is reverted too; leaving it in place is harmless and keeps the pin.
- **T2.2** — revert restores the fat `ResearcherRepository` and the wide handler parameters. No stored data or payload is affected.
- **T2.3** — revert restores `readyJob` and the fat `AnalysisRepository`. Because the WS1 suite line was deleted in the same commit, reverting both together keeps the suite consistent (`readyJob` no-op behaviour returns with it).
- **T2.4** — revert restores `ReviewDocument`-based inserts and the domain casts. Stored documents are byte-identical either way (the `id` UUID simply moves from domain to adapter), so no data migration is required in either direction.
- **T2.5** — revert restores the lazy monitor import, the module-global `mastra` and `initialize()` inside `createJevExtension`. Startup order returns to the previous behaviour; no data changes.
- **T2.6** — revert deletes only the script and the `verify` wiring; nothing depends on it at runtime.

Cross-task dependency: T2.3 edits `api/src/routes/review-routes.ts` (shared with T2.2) and T2.4 edits `packages/domain/src/oversight/service.ts` (shared with T2.2's narrowing). Revert in reverse order (T2.6 → T2.1); do not revert a middle task alone.

## Out of scope (owned elsewhere)

- Scheduler body extraction (`EventRecorder`, `Termination`, `InferenceGateway`, `ToolAdmission`, `ReportPhase`) — WS3b T3.2/T3.3.
- API server split, unified route-handler contract, one body reader — WS3a T3.4/T3.5.
- `HealthcareService` decomposition and `packages/domain/src/oversight` module split — WS3c T3.7/T3.8.
- `processNextMonitorJob`'s unused `_repository` parameter — WS3c when the monitor worker is split (12 call sites across tests and smokes; not worth the blast radius here).
- Provider/scenario registries, the byte-identical `inference-provider.ts`, and the zod-schema extraction — WS4 T4.1 plus conventions §5 (`D13 partial`).
- Dashboard clients/hooks and `ReviewInput` split — WS5 T5.3/T5.5.
- Closed vocabularies (`RUN_STATUSES`, `EVIDENCE_KINDS`, `toRunSummary`) — WS7 T7.1–T7.3.
- Canonical sorted-key hashing — WS7 T7.4 (gated).
- `experiment-worker/src/commands/recover.ts` keeps its direct adapter access: clearing the worker-guard collection has no port by design.

## Self-review

**Finding coverage.** P10: `AnalysisRepository` 28 → 27 methods across five ports of ≤10 members; `ResearcherRepository` 20 → a composition of six slices of ≤5 members each; worker-specific guard/queue/event splits added; zero-caller `readyJob` deleted; store ports no longer leak `collection: string`, `Record<string, unknown>` filters, or domain-built keys, and the `row.value as unknown as Review` casts (4 sites) plus the 1-member `as unknown as AnalysisRepository` stub are gone. S8: the worker loop depends on `RunQueue`/`WorkerGuard`/`RunStateStore`/`EventLog` only (`requestCancel` is part of `RunStateStore`), and `scripts/verify-composition.mjs` enforces it. S10: `createJevExtension` no longer builds Mongo siblings or runs migrations; `createMonitorProvider` has no dynamic-import default; `export let mastra` is replaced by a `TraceRuntime` value injected into `MastraModelAdapter`. Appendix B's "S6 if cheap" is taken: `AnalysisAttempt.usage` is typed with no adapter change.

**Deviations from conventions §3 (recorded, not silent).** (1) Review routes are narrowed per function (`getJob` alone for the route handler; four methods for `createReviewService`) — stricter than §3.2's single `Pick`, and it is what removes the test cast. (2) `MastraModelAdapter`'s runtime parameter defaults to the exported `NO_TRACE_RUNTIME` instead of being required, because three existing unit tests deliberately run without Mongo trace storage and would otherwise need a fake Mongo. (3) zod extraction deferred with the assessment in T2.4 and the guardrail in T2.6. The original createPair/requestCancel gaps are resolved in conventions §3.1 (both are first-class on `RunQueue`/`RunStateStore`), so they are no longer deviations.

**Placeholders.** None: every code-changing step shows the new source or an exact old→new line mapping with the anchor line numbers verified against the current tree. The only run-dependent value is the fixture assertion array, which is read from the committed `agent/examples/completed-fixture.json` (103 events verified on 2026-11-07) instead of being hand-copied, and Step 1.2 forbids silently regenerating that committed evidence.

**Type consistency.** Names match conventions §3.1/§3.2 exactly (`RunStateStore`, `EventLog`, `RunQueue`, `WorkerGuard`, `RunQueries`, `DraftStore`, `EvidenceReader`, `WorkerSupervisor`, `CodebookStore`, `JobLifecycleStore`, `WindowStore`, `ArtifactStore`, `ResultStore`, `ResearcherRepository`, `AnalysisRepository`). Two names are added, not renamed: `AnalysisWorkerStore` (the worker's port intersection) and `WorkerRuntime`/`TraceRuntime`/`WorkerDeps` (service-local composition types). `Page<T>`/`PageOptions`/`Lease` keep their existing definitions; `ReviewRow<T>` is new and used consistently by contract, both adapters, and domain.

**Cross-plan notes.** WS2 composes with WS1 (contract suites and typed `WorkerStatus` are consumed, one WS1 assertion line is deleted with `readyJob`), WS3b (scheduler body untouched except the option surface), WS3a (route handler bodies untouched; `api/src/main.ts` wiring is shared and must be rebased), WS3c (type-only narrowing in `packages/domain/src/oversight/**`), WS4 (the Mastra adapter's provider resolution is left exactly as-is for T4.1; zod extraction is WS4's), WS5 (no dashboard file is touched).

**Behaviour-change statement (whole workstream).** Only three intentional deltas, all in T2.5 and all recorded above: analysis/review index creation moves to API startup, the monitor adapter is constructed eagerly, and the trace runtime becomes an instantiable value. Scheduling, tool admission, budget accounting, event types/order, hashes, statuses, API payloads and dashboard copy are unchanged, proven by the 103-event characterization test, the regenerated fixture comparison, the WS1 contract suites and `verify-compiled.mjs`.
