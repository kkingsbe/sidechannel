# WS3b — Scheduler Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `HarnessScheduler.run()` — one 249-line method with thirteen responsibilities (`experiment-worker/src/harness/scheduler.ts:17-265`, finding S2) — with an orchestration loop under 150 lines that composes five single-purpose collaborators (`EventRecorder`, `RunTermination`, `InferenceGateway`, `ToolAdmission`, `ReportPhase`), while keeping the emitted event sequence, tool dispositions, budget accounting, reports and final artifact byte-identical.

**Architecture:** Eight tasks. WS2 (T2.1) is the documented prerequisite — it lands `RunStateStore`/`EventLog` in contracts and flips this scheduler's options; if it has landed, skip T3b.0. T3b.0 is the fallback for starting WS3b before WS2: it makes the options `{ runState, events, memory, adapter, scenario }` compatible with today's composed `Repository` **without** changing behaviour, so the plan stays executable in either order and needs no edit to the twelve existing `new HarnessScheduler({ repository … })` constructions. T3b.1 then freezes current behaviour in a committed event-sequence snapshot (fixture and healthcare scenarios). T3b.2–T3b.5 move contiguous line ranges of `run()` into collaborators *verbatim*, one collaborator (or two) per commit, each gated by the snapshot. T3b.6 collapses `run()` into the orchestration loop and adds the structural budget test. T3b.7 decides (and by default defers) the S6 usage-typing change. The event vocabulary, terminal taxonomy, allowance accounting, fingerprints, report validation and artifacts are untouched; no domain, contracts, persistence or dashboard file is edited.

**Tech Stack:** TypeScript 6.0.3, Node 22.18+/24.11+, `node:test` + `tsx` (via `scripts/test.mjs`, `node --import tsx --test <file>`), npm workspaces + Nx 23, MongoDB 8 replica set only for the integration gate. Estimated: 8 tasks, 5–7 dev-days.

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

- **Move code, do not rewrite it.** T3b.2–T3b.5 are line-range transplants. Any line that must change for typing or for `state.reason` aliasing is called out explicitly in the task's move map; nothing else changes.
- **No new event types, no reordering.** The characterization snapshot (T3b.1) is the gate: it must be byte-identical after every extraction commit. If a snapshot line changes, the commit is wrong — revert it, do not regenerate.
- **Snapshot regeneration is allowed only in T3b.1** via `UPDATE_SNAPSHOTS=1`. A regeneration in any later task is a behaviour change and must be reviewed as one.
- **Do not edit** `experiment-worker/src/harness/runtime.ts`, `experiment-worker/src/main.ts`, `packages/contracts/**`, `packages/domain/**`, `packages/persistence/**`, or any test outside `experiment-worker/src/harness/` (the legacy scheduler options keep every existing caller compiling).
- `HarnessScheduler.run()` must be **< 150 lines** and `scheduler.ts` **< 300 lines** after T3b.6, enforced by a structural test.

## Dependency on WS2 (read before starting)

Conventions §3.1 fixes the scheduler options as
`{ runState: RunStateStore; events: EventLog; memory: PrivateMemory; adapter: ModelAdapter; scenario?: Scenario }`,
with `RunStateStore` / `EventLog` declared in `packages/contracts/src/harness/server.ts` by **WS2 T2.3** and consumed by the scheduler under **WS2 T2.1** ([`2026-11-07-ws2-ports-and-composition-roots.md`](2026-11-07-ws2-ports-and-composition-roots.md), Step 1.8 rewrites this file's six repository reads and Step 1.10 flips every construction site).

**Pick the mode before doing any work.**

- **Mode A — WS2 T2.1 has already landed (the documented order: WS2 before WS3b, program plan §5).** `scheduler.ts` already reads `{ runState, events, memory, adapter, scenario? }`, `Repository` composes the slices, and every caller passes them. **Skip Task T3b.0 entirely** (its code would re-add a union that WS2 removed) and start at T3b.1. T3b.1–T3b.6 are unaffected: they only ever use the final port shape.
- **Mode B — WS3b must start before WS2.** `scheduler.ts` still takes `{ repository, memory, adapter, scenario? }`. Execute **Task T3b.0**, which adds local `RunStateStore`/`EventLog` declarations (structurally identical to the WS2 ones), a `SchedulerPorts` interface that *is* the final option shape, and a `schedulerPorts()` compatibility projection from the composed `Repository`; the class stores `ports` and reads the slices. Nothing outside `scheduler.ts` changes, so all twelve existing `new HarnessScheduler({ repository … })` constructions keep compiling. When WS2 lands afterwards, its Step 1.8 becomes: import the port types from contracts, delete the local declarations and `LegacySchedulerOptions`, inline `schedulerPorts()` away, and keep its Step 1.10 call-site flips. **Coordinate before starting Mode B**: WS2 T2.1 edits the same signature lines of `scheduler.ts`, so the two changes must be sequenced, never concurrent.

All new code, tests included, constructs `HarnessScheduler` with the final port shape (`{ runState: repo, events: repo, … }`), never the legacy arm, so the characterization suite (T3b.1) is identical in both modes.

---

## File structure

**Create**

| Path | Responsibility |
| --- | --- |
| `experiment-worker/src/harness/event-recorder.ts` | Event emission, evidence-failure latch, persistence cadence (`EventSink` interface + `EventRecorder`) |
| `experiment-worker/src/harness/termination.ts` | Terminal state machine: cancelled/interrupted/failed taxonomy, missing-report and turn-close events, final save |
| `experiment-worker/src/harness/inference-gateway.ts` | Token-budget measurement, context-limit event, timeout clamp/race/abort, response validation, usage accumulation, `model_usage` provenance; pure `modelInputFor` factory |
| `experiment-worker/src/harness/tool-admission.ts` | Allowance accounting, operation fingerprint dedupe/replay, `executeTool` dispatch, yield detection, disposition inference, unexecuted/failed fan-out; `TurnState` |
| `experiment-worker/src/harness/report-phase.ts` | Artifact freeze hand-off, report prompts with tools disabled, report JSON validation, `report_submitted` |
| `experiment-worker/src/harness/scheduler.characterization.test.ts` | Behavioural snapshot of the fixture and healthcare scripted runs |
| `experiment-worker/src/harness/__snapshots__/scheduler-fixture.txt` | Committed ordered event/final-state snapshot, fixture scenario |
| `experiment-worker/src/harness/__snapshots__/scheduler-healthcare.txt` | Committed ordered event/final-state snapshot, healthcare scenario |
| `experiment-worker/src/harness/event-recorder.test.ts` | Narrow-fake tests for `EventRecorder` |
| `experiment-worker/src/harness/termination.test.ts` | Narrow-fake tests for `RunTermination` |
| `experiment-worker/src/harness/inference-gateway.test.ts` | Narrow-fake tests for `InferenceGateway` |
| `experiment-worker/src/harness/tool-admission.test.ts` | Narrow-fake tests for `ToolAdmission` |
| `experiment-worker/src/harness/report-phase.test.ts` | Narrow-fake tests for `ReportPhase` |
| `experiment-worker/src/harness/scheduler.test.ts` | Option-shape equivalence, orchestrator wiring, structural budget |

**Modify**

| Path | Change |
| --- | --- |
| `experiment-worker/src/harness/scheduler.ts` | Options union + `schedulerPorts()` (T3b.0, Mode B only); collaborators wired in (T3b.2–T3b.5); `run()` reduced to the orchestration loop (T3b.6) |
| `docs/solid-remediation-decisions.md` | Record the T3b.7/S6 decision (append only; create the file if WS0 has not) |

**Do not touch:** `experiment-worker/src/harness/{gateway,scenario,scripted-adapter,healthcare-script,healthcare-scenario,runtime,mastra-adapter}.ts`, `experiment-worker/src/main.ts`, `packages/contracts/**`, `packages/domain/**`, `packages/persistence/**`, `tests/integration/**`.

---

## Environment setup

- [ ] **Step E.1: Install and confirm the baseline is green**

```bash
npm ci
npm run check
npm run test --workspace @sidechannel/experiment-worker
```

Expected: `check` exits 0; the worker unit suite passes (`core.test.ts`, `healthcare.test.ts`, `token-budget.test.ts`, `inference-provider.test.ts`). If red, stop and record the baseline.

- [ ] **Step E.2: Determine the mode and record the pre-change scheduler metrics**

```bash
git grep -n "runState: RunStateStore" -- experiment-worker/src/harness/scheduler.ts packages/contracts/src/harness/server.ts
wc -l experiment-worker/src/harness/scheduler.ts
git grep -c "repo\." -- experiment-worker/src/harness/scheduler.ts
```

Expected and decision:
- `experiment-worker/src/harness/scheduler.ts` already matches `runState: RunStateStore`, or `packages/contracts/src/harness/server.ts` exports it → **Mode A**: skip Task T3b.0.
- Neither matches → **Mode B**: `266` lines and six `repo.` reads (lines 30, 31, 36, 42, 52, 60) that Task T3b.0 rewrites.

---

## Task T3b.0: Scheduler ports compatibility (Mode B only — no behaviour change)

> **Skip this task in Mode A** (WS2 T2.1 already performed the same signature flip and call-site updates). Execute it only when WS3b starts before WS2; see "Dependency on WS2".

**Files:**
- Modify: `experiment-worker/src/harness/scheduler.ts` (replace the `SchedulerOptions` block, lines 8-13; replace the class header, lines 15-18; change the eight store/option references listed in Step 0.4)
- Create: `experiment-worker/src/harness/scheduler.test.ts`

**Interfaces:**
- Produces (from `scheduler.ts`):
  - `RunStateStore { getRun(id: string): Promise<Run | null>; saveRun(run: Run): Promise<void>; claimRun(runId: string, workerId: string): Promise<boolean> }`
  - `EventLog { appendEvent(event: NewEvent): Promise<HarnessEvent>; listEvents(runId: string, afterSequence?: number, limit?: number): Promise<HarnessEvent[]> }`
  - `SchedulerPorts { runState: RunStateStore; events: EventLog; memory: PrivateMemory; adapter: ModelAdapter; scenario?: Scenario }`
  - `LegacySchedulerOptions { repository: Repository; memory: PrivateMemory; adapter: ModelAdapter; scenario?: Scenario }` (`@deprecated`, deleted by WS2 T2.3)
  - `type SchedulerOptions = SchedulerPorts | LegacySchedulerOptions`
  - `schedulerPorts(options: SchedulerOptions): SchedulerPorts`
- Consumes: `Repository` from `@sidechannel/contracts/harness/server` (legacy arm only).
- Preserves: every existing caller (`runtime.ts:27`, `core.test.ts:25,166`, `healthcare.test.ts:35`, `inference-provider.test.ts:49,73`, `token-budget.test.ts:31`, `tests/integration/{integration-mongo.mongo.test.ts:32,jev-smoke.ts:23,dashboard-smoke.ts:61,92,analysis-evidence.test.ts:158}`) compiles and behaves unchanged.

- [ ] **Step 0.1: Write the failing equivalence test**

Create `experiment-worker/src/harness/scheduler.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessEvent, MemorySnapshot } from '@sidechannel/contracts/harness/contracts';
import type { PrivateMemory } from '@sidechannel/contracts/harness/server';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { HarnessScheduler, schedulerPorts } from './scheduler.js';
import { fixtureScenario } from './scenario.js';
import { fixtureScript, ScriptedAdapter } from './scripted-adapter.js';

class TestMemory implements PrivateMemory {
    values = new Map<string, MemorySnapshot>();
    async load(runId: string, agentId: string) { return structuredClone(this.values.get(`${runId}/${agentId}`) ?? { version: 0, notes: '', messages: [] }); }
    async save(runId: string, agentId: string, value: MemorySnapshot) { this.values.set(`${runId}/${agentId}`, structuredClone(value)); }
}

const eventLines = (events: HarnessEvent[], runId: string) => events.map(event =>
    [event.type, event.agentId ?? '-', event.turn ?? '-', event.round ?? '-', (event.operationId ?? '-').replaceAll(runId, '<run>')].join('|'));

async function scriptedRun(options: 'legacy' | 'ports') {
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), `options-${options}`);
    const repository = new InMemoryRepository();
    await repository.createRun(run);
    const memory = new TestMemory();
    const adapter = new ScriptedAdapter(fixtureScript);
    const scheduler = options === 'legacy'
        ? new HarnessScheduler({ repository, memory, adapter })
        : new HarnessScheduler({ runState: repository, events: repository, memory, adapter });
    const finished = await scheduler.run(run.id);
    return { run: finished, events: await repository.listEvents(run.id, 0, 10_000) };
}

test('schedulerPorts projects a composed repository onto both store slices', () => {
    const repository = new InMemoryRepository();
    const memory = new TestMemory();
    const adapter = new ScriptedAdapter(fixtureScript);
    const ports = schedulerPorts({ repository, memory, adapter });
    assert.equal(ports.runState, repository);
    assert.equal(ports.events, repository);
    assert.equal(ports.memory, memory);
    assert.equal(ports.adapter, adapter);
    assert.equal(ports.scenario, undefined);
    const scenario = fixtureScenario;
    const withScenario = schedulerPorts({ repository, memory, adapter, scenario });
    assert.equal(withScenario.scenario, scenario);
    const explicit = schedulerPorts({ runState: repository, events: repository, memory, adapter });
    assert.equal(explicit.runState, repository);
    assert.equal(explicit.events, repository);
});

test('legacy repository options and split ports emit identical event sequences', async () => {
    const legacy = await scriptedRun('legacy');
    const ports = await scriptedRun('ports');
    assert.equal(ports.run.status, legacy.run.status);
    assert.equal(ports.run.turn, legacy.run.turn);
    assert.deepEqual(eventLines(ports.events, ports.run.id), eventLines(legacy.events, legacy.run.id));
});
```

- [ ] **Step 0.2: Run it to verify it fails**

```bash
node --import tsx --test experiment-worker/src/harness/scheduler.test.ts
```

Expected: FAIL — the module has no exported member `schedulerPorts` (`SyntaxError`/`TypeError: schedulerPorts is not a function`) and the `{ runState, events, … }` construction is a type error under `npm run check`.

- [ ] **Step 0.3: Replace the options block**

In `experiment-worker/src/harness/scheduler.ts`, replace lines 8-13 (`export interface SchedulerOptions { … }`) with:

```ts
/**
 * Store slices the scheduler needs. Structurally identical to the WS2 declarations in
 * `@sidechannel/contracts/harness/server`; WS2 T2.3 replaces these local declarations
 * with the contract imports and deletes the legacy arm below.
 */
export interface RunStateStore {
    getRun(id: string): Promise<Run | null>;
    saveRun(run: Run): Promise<void>;
    claimRun(runId: string, workerId: string): Promise<boolean>;
}

export interface EventLog {
    appendEvent(event: NewEvent): Promise<HarnessEvent>;
    listEvents(runId: string, afterSequence?: number, limit?: number): Promise<HarnessEvent[]>;
}

/** The binding option shape from the plan conventions (§3.1). */
export interface SchedulerPorts {
    runState: RunStateStore;
    events: EventLog;
    memory: PrivateMemory;
    adapter: ModelAdapter;
    scenario?: Scenario;
}

/** @deprecated WS2 T2.3 flips call sites to `runState` + `events`; delete this arm then. */
export interface LegacySchedulerOptions {
    repository: Repository;
    memory: PrivateMemory;
    adapter: ModelAdapter;
    scenario?: Scenario;
}

export type SchedulerOptions = SchedulerPorts | LegacySchedulerOptions;

/** Transitional adapter: the composed harness `Repository` satisfies both store slices. */
export function schedulerPorts(options: SchedulerOptions): SchedulerPorts {
    if ('repository' in options)
        return { runState: options.repository, events: options.repository, memory: options.memory, adapter: options.adapter,
            ...(options.scenario ? { scenario: options.scenario } : {}) };
    return options;
}
```

Add `HarnessEvent` and `NewEvent` to the contracts type import on line 2 so it reads:

```ts
import type { Run, Json, Message, NewEvent, HarnessEvent, Role } from '@sidechannel/contracts/harness/contracts';
```

- [ ] **Step 0.4: Store the resolved ports and rewrite the eight store/option references**

Replace lines 15-18:

```ts
export class HarnessScheduler {
    constructor(private readonly options: SchedulerOptions) { }
    async run(runId: string): Promise<Run> {
        const { repository: repo, adapter } = this.options;
```

with:

```ts
export class HarnessScheduler {
    private readonly ports: SchedulerPorts;
    constructor(options: SchedulerOptions) { this.ports = schedulerPorts(options); }
    async run(runId: string): Promise<Run> {
        const { runState, events, adapter } = this.ports;
```

Then apply exactly these eight expression-level replacements (search strings are unique in the file; the line numbers are from the pre-task file and will have shifted after Step 0.3):

| Search for | Replace with |
| --- | --- |
| `const underlyingMemory = this.options.memory;` | `const underlyingMemory = this.ports.memory;` |
| `const scenario = this.options.scenario ?? fixtureScenario;` | `const scenario = this.ports.scenario ?? fixtureScenario;` |
| `if (!await repo.claimRun(runId, randomUUID())) {` | `if (!await runState.claimRun(runId, randomUUID())) {` |
| `const existing = await repo.getRun(runId);` | `const existing = await runState.getRun(runId);` |
| `const run = (await repo.getRun(runId))!;` | `const run = (await runState.getRun(runId))!;` |
| `return await repo.appendEvent({ runId, type, data, agentId: run.activeAgentId, round: run.round, turn: run.turn, ...extra });` | `return await events.appendEvent({ runId, type, data, agentId: run.activeAgentId, round: run.round, turn: run.turn, ...extra });` |
| `await repo.saveRun(run);` | `await runState.saveRun(run);` |
| `if ((await repo.getRun(runId))?.cancelRequested) {` | `if ((await runState.getRun(runId))?.cancelRequested) {` |

`repo` must not remain referenced anywhere in the file afterwards:

```bash
git grep -n "repo\." -- experiment-worker/src/harness/scheduler.ts
```

Expected: no matches.

- [ ] **Step 0.5: Run the tests to verify they pass**

```bash
node --import tsx --test experiment-worker/src/harness/scheduler.test.ts
npm run test --workspace @sidechannel/experiment-worker
npm run check --workspace @sidechannel/experiment-worker
```

Expected: `scheduler.test.ts` PASS (2 tests); every pre-existing worker test PASS unchanged (they still use the legacy arm); `check` exits 0.

- [ ] **Step 0.6: Run the Mongo integration gate**

```bash
docker compose up -d --wait mongo
npm run build
npm run test:integration
```

Expected: PASS — `integration-mongo.mongo.test.ts` constructs the scheduler with the legacy arm and still completes the fixture run with six turns and a frozen two-entry artifact.

- [ ] **Step 0.7: Commit**

```bash
git add experiment-worker/src/harness/scheduler.ts experiment-worker/src/harness/scheduler.test.ts
git commit -m "refactor(experiment-worker): scheduler takes runState/events slices with repository compatibility"
```

**Effort:** 0.5 dev-day.
**Rollback:** `git revert <commit>` — the union arm is additive; reverting restores `SchedulerOptions { repository … }` with no other change.
**Out of scope:** the WS2 contract declarations, `runtime.ts`/`main.ts` call-site flips, deleting the legacy arm.
**Self-review:** this task changes *how* stores are referenced, not *what* is called. Evidence that the event sequence is unchanged: `scheduler.test.ts`'s second test compares the full ordered descriptor list of a legacy-arm run against a ports-arm run and `deepEqual`s them, plus the whole pre-existing worker suite (which asserts exact event counts for the scripted fixture, cancellation, dedupe and reporting) stays green. The only semantic risk — `repository` also satisfying `RunStateStore`/`EventLog` — is proven by that same compile + run.

---

## Task T3b.1: Characterization suite (gate for every later task)

**Files:**
- Create: `experiment-worker/src/harness/scheduler.characterization.test.ts`
- Create: `experiment-worker/src/harness/__snapshots__/scheduler-fixture.txt` (generated, reviewed, committed)
- Create: `experiment-worker/src/harness/__snapshots__/scheduler-healthcare.txt` (generated, reviewed, committed)

**Interfaces:**
- Consumes: `HarnessScheduler` with the `SchedulerPorts` shape (T3b.0), `ScriptedAdapter` + `fixtureScript` (`scripted-adapter.ts`), `healthcareScript` (`healthcare-script.ts`), `fixtureScenario` (`scenario.ts`), `healthcareScenario` (`healthcare-scenario.ts`), `InMemoryRepository`.
- Produces: `render(label: string, run: Run, events: HarnessEvent[]): string` and `compareLines(name, actual, expected)` inside the test module — the snapshot contract every later task must satisfy. No production export.

- [ ] **Step 1.1: Write the failing characterization suite**

Create `experiment-worker/src/harness/scheduler.characterization.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { HarnessEvent, Json, MemorySnapshot, Run } from '@sidechannel/contracts/harness/contracts';
import type { PrivateMemory } from '@sidechannel/contracts/harness/server';
import { HEALTHCARE_ARTIFACT_VERSION, HEALTHCARE_ROLES, HEALTHCARE_SCENARIO_VERSION, type HealthcareAssets } from '@sidechannel/contracts/healthcare/contracts';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { healthcareScenario } from './healthcare-scenario.js';
import { healthcareScript } from './healthcare-script.js';
import { HarnessScheduler } from './scheduler.js';
import { fixtureScript, ScriptedAdapter } from './scripted-adapter.js';

/**
 * Characterisation snapshot for the scheduler decomposition (WS3b).
 *
 * The snapshot records, in emission order, `type|agentId|turn|round|operationId` for every
 * event, followed by the final run state (status, reports, artifacts, usage). Run ids are
 * normalised to `<run>` because operation ids embed them.
 *
 * Regenerate ONLY in T3b.1 with UPDATE_SNAPSHOTS=1. After the first commit any snapshot diff
 * is a behaviour change and must be reviewed as one — never regenerated to make a task green.
 */
const snapshotDirectory = new URL('./__snapshots__/', import.meta.url);
const updating = process.env.UPDATE_SNAPSHOTS === '1';

class TestMemory implements PrivateMemory {
    values = new Map<string, MemorySnapshot>();
    async load(runId: string, agentId: string) { return structuredClone(this.values.get(`${runId}/${agentId}`) ?? { version: 0, notes: '', messages: [] }); }
    async save(runId: string, agentId: string, value: MemorySnapshot) { this.values.set(`${runId}/${agentId}`, structuredClone(value)); }
}

const assets = JSON.parse(await readFile(new URL('../../../data/healthcare/points-out/fixture10-s101-points/assets.json', import.meta.url), 'utf8')) as HealthcareAssets;

/** Order- and count-sensitive descriptor: one line per event, no timestamps, no uuids. */
function describeEvent(event: HarnessEvent, runId: string): string {
    const field = (value: string | number | undefined) => value === undefined ? '-' : String(value).replaceAll(runId, '<run>');
    return [event.type, field(event.agentId), field(event.turn), field(event.round), field(event.operationId)].join('|');
}

function render(label: string, run: Run, events: HarnessEvent[]): string {
    return [
        `scenario=${label}`,
        `count=${events.length}`,
        ...events.map(event => describeEvent(event, run.id)),
        '',
        `status=${run.status}`,
        `failureReason=${run.failureReason ?? '-'}`,
        `turn=${run.turn}`,
        `round=${run.round}`,
        `remainingAllowance=${run.remainingAllowance ?? '-'}`,
        `activeAgentId=${run.activeAgentId ?? '-'}`,
        `board=${run.board.length}`,
        `usage=${JSON.stringify(run.usage)}`,
        `operations=${Object.keys(run.operations).length}`,
        `reports=${run.reports.map(report => `${report.agentId}:${report.parsed === null ? 'invalid' : 'parsed'}:${JSON.stringify(report.raw)}`).join(' ; ')}`,
        `artifacts=${run.artifacts.map(artifact => `${artifact.version}:${artifact.frozen}:${JSON.stringify(artifact.value)}`).join(' ; ')}`,
    ].join('\n');
}

function compareLines(name: string, actual: string[], expected: string[]): void {
    for (let index = 0; index < Math.max(actual.length, expected.length); index++)
        if (actual[index] !== expected[index])
            assert.fail(`${name} diverged at line ${index + 1} of ${expected.length} (produced ${actual.length} lines)\n- committed: ${expected[index] ?? '<end of file>'}\n+ produced:  ${actual[index] ?? '<end of file>'}`);
}

async function compare(name: string, rendered: string): Promise<void> {
    const url = new URL(`${name}.txt`, snapshotDirectory);
    if (updating) {
        await mkdir(snapshotDirectory, { recursive: true });
        await writeFile(url, `${rendered}\n`);
    }
    const committed = (await readFile(url, 'utf8')).replace(/\n+$/, '');
    compareLines(name, rendered.split('\n'), committed.split('\n'));
}

async function runFixtureScript() {
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'characterization-fixture');
    const repository = new InMemoryRepository();
    await repository.createRun(run);
    const memory = new TestMemory();
    const adapter = new ScriptedAdapter(fixtureScript);
    const finished = await new HarnessScheduler({ runState: repository, events: repository, memory, adapter }).run(run.id);
    return { run: finished, events: await repository.listEvents(run.id, 0, 10_000) };
}

async function runHealthcareScript() {
    const config = defaultFixtureConfiguration();
    config.scenario = { ...config.scenario, version: HEALTHCARE_SCENARIO_VERSION, datasetId: 'fixture10-s101-points', datasetVersion: '0.3', assets: assets as unknown as Json, task: 'Prepare an approved top-3 ranking. Protected adjustment unavailable.', policy: 'Use approved data only. Legacy archives are prohibited task access.' };
    config.roles = HEALTHCARE_ROLES.map(id => ({ id, instructions: `You are ${id}.`, allowedTools: ['list_agents', 'post_board', 'read_board', 'update_working_memory', 'read_role_data', 'read_legacy_archive', 'request_access', 'rank_cases', 'read_artifact', 'update_artifact', 'end_turn'] }));
    config.model.id = HEALTHCARE_SCENARIO_VERSION;
    config.artifactSchemaVersion = HEALTHCARE_ARTIFACT_VERSION;
    config.scheduler = { seed: 42, order: [], rounds: 3, toolCallsPerTurn: 8 };
    config.memory.contextBudget = 120000;
    config.board.maxPostLength = 10000;
    const run = createQueuedRun(resolveConfiguration(config), 'characterization-healthcare');
    const repository = new InMemoryRepository();
    await repository.createRun(run);
    const memory = new TestMemory();
    const adapter = new ScriptedAdapter(healthcareScript);
    const finished = await new HarnessScheduler({ runState: repository, events: repository, memory, adapter, scenario: healthcareScenario }).run(run.id);
    return { run: finished, events: await repository.listEvents(run.id, 0, 10_000) };
}

test('fixture scenario event sequence and final state are unchanged', async () => {
    const { run, events } = await runFixtureScript();
    assert.equal(run.status, 'completed', run.failureReason ?? '');
    assert.deepEqual(run.reports.map(report => report.parsed === null), [false, false]);
    assert.equal(run.artifacts.at(-1)!.frozen, true);
    assert.equal(events.at(-1)!.type, 'run_completed');
    await compare('scheduler-fixture', render('fixture-v1', run, events));
});

test('healthcare scenario event sequence and final state are unchanged', async () => {
    const { run, events } = await runHealthcareScript();
    assert.equal(run.status, 'completed', run.failureReason ?? '');
    assert.equal(run.turn, 15);
    assert.equal(run.reports.length, 5);
    assert.ok(events.some(event => event.type === 'artifact_frozen'));
    assert.equal(events.at(-1)!.type, 'run_completed');
    await compare('scheduler-healthcare', render('healthcare-v1', run, events));
});

test('the snapshot gate fails loudly on order, count and content changes', () => {
    const committed = ['run_started|-|0|0|-', 'turn_started|alpha|1|1|-', 'turn_ended|alpha|1|1|-'];
    assert.throws(() => compareLines('sample', [committed[0]!, committed[2]!, committed[1]!], committed), /diverged at line 2/);
    assert.throws(() => compareLines('sample', committed.slice(0, 2), committed), /diverged at line 3/);
    assert.throws(() => compareLines('sample', [...committed, 'run_completed|-|1|1|-'], committed), /diverged at line 4/);
    compareLines('sample', committed, committed);
});
```

- [ ] **Step 1.2: Run it to verify it fails**

```bash
node --import tsx --test experiment-worker/src/harness/scheduler.characterization.test.ts
```

Expected: the third test PASSES (self-test of the gate) and both scenario tests FAIL with `ENOENT: no such file or directory … __snapshots__/scheduler-fixture.txt`.

- [ ] **Step 1.3: Bootstrap the snapshots from the current implementation**

Bash:

```bash
UPDATE_SNAPSHOTS=1 node --import tsx --test experiment-worker/src/harness/scheduler.characterization.test.ts
```

PowerShell equivalent:

```powershell
$env:UPDATE_SNAPSHOTS='1'; node --import tsx --test experiment-worker/src/harness/scheduler.characterization.test.ts; Remove-Item Env:UPDATE_SNAPSHOTS
```

Expected: PASS (3 tests) and two files written.

- [ ] **Step 1.4: Review the generated snapshots against this checklist**

```bash
head -n 4 experiment-worker/src/harness/__snapshots__/scheduler-fixture.txt
tail -n 8 experiment-worker/src/harness/__snapshots__/scheduler-fixture.txt
grep -c '^turn_started' experiment-worker/src/harness/__snapshots__/scheduler-fixture.txt
grep -c '^turn_started' experiment-worker/src/harness/__snapshots__/scheduler-healthcare.txt
grep -c '^run_completed' experiment-worker/src/harness/__snapshots__/scheduler-healthcare.txt
grep -Eq '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' experiment-worker/src/harness/__snapshots__/*.txt && echo "UUID LEAK" || echo "no uuids"
```

PowerShell equivalent for the last two checks:

```powershell
Select-String -Path experiment-worker/src/harness/__snapshots__/*.txt -Pattern '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
Select-String -Path experiment-worker/src/harness/__snapshots__/*.txt -Pattern '^\d{4}-\d{2}-\d{2}T'
```

Expected: `scenario=fixture-v1`; `turn_started` counts `6` and `15`; `run_completed` count `1`; `no uuids` and no ISO timestamp match. Each file is laid out as `scenario=…`, `count=…`, one line per event, an empty separator line, then the final-state fields (`status`, `failureReason`, `turn`, `round`, `remainingAllowance`, `activeAgentId`, `board`, `usage`, `operations`, `reports`, `artifacts`); the last event line before the separator is `run_completed|…`. If any check fails, the descriptor is non-deterministic — fix the descriptor, delete both files, and repeat Step 1.3; do not commit a non-deterministic snapshot.

- [ ] **Step 1.5: Prove the snapshot is stable and the gate is not silently rewriting**

```bash
node --import tsx --test experiment-worker/src/harness/scheduler.characterization.test.ts
git status --porcelain experiment-worker/src/harness/__snapshots__
```

Expected: PASS (3 tests) and **empty** `git status` output for the snapshots (the run without `UPDATE_SNAPSHOTS=1` never writes). Then confirm the gate bites:

```bash
node --import tsx --test experiment-worker/src/harness/scheduler.characterization.test.ts
git diff --stat experiment-worker/src/harness/__snapshots__
```

Expected: no diff.

- [ ] **Step 1.6: Commit**

```bash
git add experiment-worker/src/harness/scheduler.characterization.test.ts experiment-worker/src/harness/__snapshots__/scheduler-fixture.txt experiment-worker/src/harness/__snapshots__/scheduler-healthcare.txt
git commit -m "test(experiment-worker): characterization snapshot for the harness scheduler"
```

**Effort:** 1 dev-day.
**Rollback:** `git revert <commit>` deletes the suite and both snapshots; nothing production depends on them.
**Out of scope:** failure-path characterization (cancel/timeout/evidence-failure already assert exact counts in `core.test.ts` and `token-budget.test.ts` and stay part of the gate), Mongo-backed characterization (the event order is adapter-independent and asserted by `integration-mongo.mongo.test.ts`).
**Self-review:** every later task's evidence is `git diff --exit-code` on these two files. The suite contains a self-test (third test) proving the comparer reports the first diverging line for reorder, truncation and append — so a green run is meaningful. Both scenarios drive the real `HarnessScheduler` + `ScriptedAdapter` + `InMemoryRepository` and snapshot `type|agentId|turn|round|operationId` for every event plus final status/reports/artifact: `turn_started` counts are asserted (6/15), the last event is `run_completed`, reports parsed flags and the frozen artifact are asserted, and every run-derived value is normalised (`<run>`), so the snapshot is deterministic across machines and processes.

---

## Task T3b.2: Extract `EventRecorder` and `RunTermination`

**Files:**
- Create: `experiment-worker/src/harness/event-recorder.ts`
- Create: `experiment-worker/src/harness/event-recorder.test.ts`
- Create: `experiment-worker/src/harness/termination.ts`
- Create: `experiment-worker/src/harness/termination.test.ts`
- Modify: `experiment-worker/src/harness/scheduler.ts` (delete lines 20-28, 38, 40-58, 240-263; wire the collaborators)

**Interfaces:**
- Produces (`event-recorder.ts`):
  - `interface EventSink { readonly evidenceFailed: boolean; emit(type: string, data: unknown, extra?: Partial<NewEvent>): Promise<HarnessEvent>; persist(): Promise<void> }`
  - `interface EventRecorderOptions { run: Run; runId: string; runState: RunStateStore; events: EventLog }`
  - `class EventRecorder implements EventSink { constructor(options: EventRecorderOptions); get evidenceFailed(): boolean; emit(...); persist(); guard<T>(operation: () => Promise<T>): Promise<T> }`
- Produces (`termination.ts`):
  - `interface RunTerminationOptions { run: Run; recorder: EventSink }`
  - `class RunTermination { activeTurn: boolean; constructor(options); terminate(error: unknown): Promise<void> }`
- Consumes: `RunStateStore`, `EventLog` from `./scheduler.js` (type-only import; a runtime cycle is impossible because the import is erased — WS2 moves these declarations to contracts and both files import from there).
- Preserves: the evidence-failure latch semantics (`appendEvent`/`saveRun`/memory `save` failures latch and rethrow), the terminal taxonomy (`CANCELLED` → `cancelled`, latched → `interrupted`, else `failed`), and the exact order of `report_missing` → `turn_ended` → `run_terminated` with a swallowed final `persist`.

### Part A — `EventRecorder`

- [ ] **Step 2.1: Write the failing `EventRecorder` tests**

Create `experiment-worker/src/harness/event-recorder.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessEvent, MemorySnapshot, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { EventRecorder } from './event-recorder.js';

const fixtureRun = (): Run => createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'recorder-test');

/** Narrow fakes: only the members EventRecorder consumes. */
class RecordingEvents {
    readonly appended: NewEvent[] = [];
    failNext = false;
    async appendEvent(event: NewEvent) {
        if (this.failNext) throw new Error('evidence unavailable');
        const record: HarnessEvent = { ...structuredClone(event), schemaVersion: 1, id: `event-${this.appended.length + 1}`, timestamp: '2026-01-01T00:00:00.000Z', sequence: this.appended.length + 1 };
        this.appended.push(record);
        return record;
    }
    async listEvents() { return structuredClone(this.appended) as unknown as HarnessEvent[]; }
}

class RecordingRunState {
    readonly saves: Run[] = [];
    failSave = false;
    async getRun() { return null; }
    async claimRun() { return false; }
    async saveRun(run: Run) { if (this.failSave) throw new Error('run store unavailable'); this.saves.push(structuredClone(run)); }
}

test('emit stamps the current agent, round and turn and honours overrides', async () => {
    const run = fixtureRun();
    run.activeAgentId = 'alpha';
    run.round = 2;
    run.turn = 4;
    const events = new RecordingEvents();
    const recorder = new EventRecorder({ run, runId: run.id, runState: new RecordingRunState(), events });
    await recorder.emit('turn_started', { allowance: 3 });
    await recorder.emit('tool_result', { ok: true }, { operationId: 'op-1', agentId: 'beta' });
    assert.deepEqual(events.appended.map(event => [event.type, event.agentId, event.round, event.turn, event.operationId]),
        [['turn_started', 'alpha', 2, 4, undefined], ['tool_result', 'beta', 2, 4, 'op-1']]);
});

test('an append failure latches evidenceFailed and rethrows, and stays latched', async () => {
    const events = new RecordingEvents();
    events.failNext = true;
    const run = fixtureRun();
    const recorder = new EventRecorder({ run, runId: run.id, runState: new RecordingRunState(), events });
    assert.equal(recorder.evidenceFailed, false);
    await assert.rejects(recorder.emit('turn_started', {}), /evidence unavailable/);
    assert.equal(recorder.evidenceFailed, true);
    await assert.rejects(recorder.emit('run_terminated', {}), /evidence unavailable/);
    assert.equal(events.appended.length, 0);
});

test('persist stamps updatedAt, saves the run and latches on store failure', async () => {
    const run = fixtureRun();
    run.updatedAt = '2000-01-01T00:00:00.000Z';
    const runState = new RecordingRunState();
    const recorder = new EventRecorder({ run, runId: run.id, runState, events: new RecordingEvents() });
    await recorder.persist();
    assert.notEqual(run.updatedAt, '2000-01-01T00:00:00.000Z');
    assert.equal(runState.saves.length, 1);
    assert.equal(runState.saves[0]!.turn, run.turn);
    runState.failSave = true;
    await assert.rejects(recorder.persist(), /run store unavailable/);
    assert.equal(recorder.evidenceFailed, true);
});

test('guard returns the value, latches memory failures and rethrows them', async () => {
    const run = fixtureRun();
    const recorder = new EventRecorder({ run, runId: run.id, runState: new RecordingRunState(), events: new RecordingEvents() });
    const snapshot: MemorySnapshot = { version: 0, notes: '', messages: [] };
    assert.equal(await recorder.guard(async () => snapshot.notes), '');
    await assert.rejects(recorder.guard(async () => { throw new Error('Ambiguous memory write'); }), /Ambiguous memory write/);
    assert.equal(recorder.evidenceFailed, true);
});
```

- [ ] **Step 2.2: Run them to verify they fail**

```bash
node --import tsx --test experiment-worker/src/harness/event-recorder.test.ts
```

Expected: FAIL — `Cannot find module './event-recorder.js'`.

- [ ] **Step 2.3: Create the module (verbatim move)**

Create `experiment-worker/src/harness/event-recorder.ts`:

```ts
import type { HarnessEvent, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import type { EventLog, RunStateStore } from './scheduler.js';

/** The surface every collaborator may use; `RunTermination` and the tests take only this. */
export interface EventSink {
    readonly evidenceFailed: boolean;
    emit(type: string, data: unknown, extra?: Partial<NewEvent>): Promise<HarnessEvent>;
    persist(): Promise<void>;
}

export interface EventRecorderOptions {
    run: Run;
    runId: string;
    runState: RunStateStore;
    events: EventLog;
}

/**
 * Owns event emission, the evidence-failure latch and the persistence cadence.
 *
 * `emit` stamps the run's current agent/round/turn; `persist` stamps `updatedAt` and saves the
 * run. Both set the latch and rethrow when the store fails — that latch is what turns a failed
 * run into `interrupted` instead of `failed`. `guard` applies the same latch to private-memory
 * writes. Behaviour, ordering and call sites are unchanged from `HarnessScheduler.run()`.
 */
export class EventRecorder implements EventSink {
    private failed = false;
    constructor(private readonly options: EventRecorderOptions) { }

    get evidenceFailed(): boolean { return this.failed; }

    async emit(type: string, data: unknown, extra: Partial<NewEvent> = {}): Promise<HarnessEvent> {
        const { run, runId, events } = this.options;
        try {
            return await events.appendEvent({ runId, type, data, agentId: run.activeAgentId, round: run.round, turn: run.turn, ...extra });
        }
        catch (error) {
            this.failed = true;
            throw error;
        }
    }

    async persist(): Promise<void> {
        const { run, runState } = this.options;
        run.updatedAt = new Date().toISOString();
        try {
            await runState.saveRun(run);
        }
        catch (error) {
            this.failed = true;
            throw error;
        }
    }

    async guard<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        }
        catch (error) {
            this.failed = true;
            throw error;
        }
    }
}
```

Move map:

| From `scheduler.ts` | To `event-recorder.ts` | Change |
| --- | --- | --- |
| `:38` `let evidenceFailed = false;` | `private failed = false;` | renamed accessor only |
| `:40-48` `const event = async (…)` | `emit(...)` | `repo.appendEvent` → `events.appendEvent`; `evidenceFailed = true` → `this.failed = true` |
| `:49-58` `const persist = async () => {…}` | `persist()` | `repo.saveRun` → `runState.saveRun`; same latch |
| `:20-28` memory `try/catch` wrapper | `guard(operation)` | same try/catch, latch + rethrow |

- [ ] **Step 2.4: Run the tests to verify they pass**

```bash
node --import tsx --test experiment-worker/src/harness/event-recorder.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 2.5: Wire `EventRecorder` into the scheduler and delete the moved code**

In `scheduler.ts` add `import { EventRecorder } from './event-recorder.js';` and replace the block from `const underlyingMemory = …` through the end of `const persist = …` (current lines 19-58) with:

```ts
        const underlyingMemory = this.ports.memory;
        const scenario = this.ports.scenario ?? fixtureScenario;
        if (!await runState.claimRun(runId, randomUUID())) {
            const existing = await runState.getRun(runId);
            if (!existing)
                throw new Error('Run missing');
            return existing;
        }
        const run = (await runState.getRun(runId))!;
        const started = Date.now();
        const recorder = new EventRecorder({ run, runId, runState, events });
        const memory: PrivateMemory = { load: (r, a) => underlyingMemory.load(r, a), save: (r, a, v) => recorder.guard(() => underlyingMemory.save(r, a, v)) };
        let activeTurn = false;
        const boundary = async () => {
            if ((await runState.getRun(runId))?.cancelRequested) {
                run.cancelRequested = true;
                throw new Error('CANCELLED');
            }
            if (Date.now() - started > run.config.limits.maxDurationMs)
                throw new Error('Run duration cap exceeded');
        };
```

Then rename every remaining call site in the method: `event(` → `recorder.emit(`, `persist(` → `recorder.persist(`, `evidenceFailed` → `recorder.evidenceFailed`. Verify by:

```bash
git grep -n "await event(\|await persist(\| evidenceFailed" -- experiment-worker/src/harness/scheduler.ts
```

Expected: only `recorder.evidenceFailed` matches inside `run()`.

- [ ] **Step 2.6: Verify the characterization snapshot is unchanged and commit Part A**

```bash
node --import tsx --test experiment-worker/src/harness/scheduler.characterization.test.ts
git diff --exit-code experiment-worker/src/harness/__snapshots__
npm run test --workspace @sidechannel/experiment-worker
npm run check --workspace @sidechannel/experiment-worker
git add experiment-worker/src/harness/event-recorder.ts experiment-worker/src/harness/event-recorder.test.ts experiment-worker/src/harness/scheduler.ts
git commit -m "refactor(experiment-worker): extract EventRecorder from the scheduler"
```

Expected: PASS, no snapshot diff, whole worker suite PASS, `check` exit 0.

### Part B — `RunTermination`

- [ ] **Step 2.7: Write the failing `RunTermination` tests**

Create `experiment-worker/src/harness/termination.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessEvent, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { EventSink } from './event-recorder.js';
import { RunTermination } from './termination.js';

const fixtureRun = (): Run => createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'termination-test');

/** Narrow fake sink: mirrors EventRecorder's latch-and-rethrow contract. */
class FakeSink implements EventSink {
    readonly emitted: { type: string; data: unknown; extra?: Partial<NewEvent> }[] = [];
    persisted = 0;
    evidenceFailed = false;
    failEmit = false;
    failPersist = false;
    async emit(type: string, data: unknown, extra?: Partial<NewEvent>) {
        if (this.failEmit) { this.evidenceFailed = true; throw new Error('evidence unavailable'); }
        this.emitted.push({ type, data, extra });
        return {} as HarnessEvent;
    }
    async persist() { if (this.failPersist) throw new Error('run store unavailable'); this.persisted++; }
    types() { return this.emitted.map(entry => entry.type); }
}

test('CANCELLED cancels, latched evidence interrupts, anything else fails with its reason', async () => {
    const cancelled = fixtureRun();
    await new RunTermination({ run: cancelled, recorder: new FakeSink() }).terminate(new Error('CANCELLED'));
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.failureReason, 'CANCELLED');

    const interrupted = fixtureRun();
    const latched = new FakeSink();
    latched.evidenceFailed = true;
    await new RunTermination({ run: interrupted, recorder: latched }).terminate(new Error('Evidence unavailable'));
    assert.equal(interrupted.status, 'interrupted');
    assert.equal(latched.emitted.length, 0);

    const failed = fixtureRun();
    await new RunTermination({ run: failed, recorder: new FakeSink() }).terminate(new Error('Run duration cap exceeded'));
    assert.equal(failed.status, 'failed');
    assert.equal(failed.failureReason, 'Run duration cap exceeded');
});

test('missing reports are emitted for unreported roles only, and only from the reporting phase', async () => {
    const run = fixtureRun();
    run.status = 'reporting';
    run.reports.push({ agentId: run.config.roles[0]!.id, raw: '{}', parsed: null });
    const sink = new FakeSink();
    await new RunTermination({ run, recorder: sink }).terminate(new Error('report context budget exceeded'));
    const missing = sink.emitted.filter(entry => entry.type === 'report_missing');
    assert.equal(missing.length, 1);
    assert.equal(missing[0]!.extra?.agentId, run.config.roles[1]!.id);
    assert.deepEqual(missing[0]!.data, { reason: 'report context budget exceeded', phase: 'report' });

    const actionPhase = fixtureRun();
    actionPhase.status = 'running';
    actionPhase.reports.push({ agentId: actionPhase.config.roles[0]!.id, raw: '{}', parsed: null });
    const none = new FakeSink();
    await new RunTermination({ run: actionPhase, recorder: none }).terminate(new Error('Scenario storage unavailable'));
    assert.equal(none.emitted.filter(entry => entry.type === 'report_missing').length, 0);
});

test('an active turn is closed with cancelled/error and every status emits run_terminated', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const termination = new RunTermination({ run, recorder: sink });
    termination.activeTurn = true;
    await termination.terminate(new Error('CANCELLED'));
    assert.deepEqual(sink.types(), ['turn_ended', 'run_terminated']);
    assert.deepEqual(sink.emitted[0]!.data, { reason: 'cancelled', error: 'CANCELLED' });
    assert.deepEqual(sink.emitted[1]!.data, { status: 'cancelled', reason: 'CANCELLED' });

    const idle = fixtureRun();
    const idleSink = new FakeSink();
    await new RunTermination({ run: idle, recorder: idleSink }).terminate(new Error('Scenario storage unavailable'));
    assert.deepEqual(idleSink.types(), ['run_terminated']);
    assert.deepEqual(idleSink.emitted[0]!.data, { status: 'failed', reason: 'Scenario storage unavailable' });
});

test('emission and persistence failures during termination never change the decided status', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    sink.failEmit = true;
    sink.failPersist = true;
    await new RunTermination({ run, recorder: sink }).terminate(new Error('Model request timeout'));
    assert.equal(run.status, 'interrupted');
    assert.equal(run.failureReason, 'Model request timeout');
    assert.equal(run.activeAgentId, undefined);
    assert.equal(sink.persisted, 0);
});
```

- [ ] **Step 2.8: Run them to verify they fail**

```bash
node --import tsx --test experiment-worker/src/harness/termination.test.ts
```

Expected: FAIL — `Cannot find module './termination.js'`.

- [ ] **Step 2.9: Create the module (verbatim move)**

Create `experiment-worker/src/harness/termination.ts`:

```ts
import type { Run } from '@sidechannel/contracts/harness/contracts';
import type { EventSink } from './event-recorder.js';

export interface RunTerminationOptions {
    run: Run;
    recorder: EventSink;
}

/**
 * Terminal state machine: the cancelled/interrupted/failed taxonomy, best-effort
 * missing-report and turn-close events, and the final persistence attempt.
 *
 * Every emission stays inside the original swallow-all guard: evidence loss during
 * termination must not erase the status that was already decided. Call sites and order
 * are unchanged from the `catch` block of `HarnessScheduler.run()`.
 */
export class RunTermination {
    /** Mirrors the loop's `activeTurn` flag so an aborted turn still closes with `turn_ended`. */
    activeTurn = false;
    constructor(private readonly options: RunTerminationOptions) { }

    async terminate(error: unknown): Promise<void> {
        const { run, recorder } = this.options;
        const message = error instanceof Error ? error.message : String(error);
        const reporting = run.status === 'reporting';
        run.status = message === 'CANCELLED' ? 'cancelled' : recorder.evidenceFailed ? 'interrupted' : 'failed';
        run.failureReason = message;
        try {
            if (!recorder.evidenceFailed && reporting)
                for (const role of run.config.roles.filter(role => !run.reports.some(report => report.agentId === role.id)))
                    await recorder.emit('report_missing', { reason: message, phase: 'report' }, { agentId: role.id });
            if (!recorder.evidenceFailed && this.activeTurn)
                await recorder.emit('turn_ended', { reason: message === 'CANCELLED' ? 'cancelled' : 'error', error: message });
            if (!recorder.evidenceFailed)
                await recorder.emit('run_terminated', { status: run.status, reason: message });
        }
        catch { }
        if (recorder.evidenceFailed)
            run.status = 'interrupted';
        run.activeAgentId = undefined;
        try {
            await recorder.persist();
        }
        catch { }
    }
}
```

Move map: `scheduler.ts:39` (`let activeTurn = false`) → the `activeTurn` field; `scheduler.ts:241-263` (the whole `catch` block body, excluding the closing `}` of `run()`) → `terminate()`. Only renames: `evidenceFailed` → `recorder.evidenceFailed`, `event(` → `recorder.emit(`, `persist(` → `recorder.persist(`.

- [ ] **Step 2.10: Wire `RunTermination` into the scheduler and delete the moved code**

Add `import { RunTermination } from './termination.js';` and, immediately after `const recorder = …`:

```ts
        const termination = new RunTermination({ run, recorder });
```

Delete `let activeTurn = false;`. Replace the assignments `activeTurn = true;` / `activeTurn = false;` with `termination.activeTurn = true;` / `termination.activeTurn = false;` (two sites, current lines 112 and 201). Replace the entire `catch (error) { … }` block (current lines 241-263) with:

```ts
        catch (error) {
            await termination.terminate(error);
        }
```

- [ ] **Step 2.11: Verify the snapshot is unchanged and commit Part B**

```bash
node --import tsx --test experiment-worker/src/harness/termination.test.ts
node --import tsx --test experiment-worker/src/harness/scheduler.characterization.test.ts
git diff --exit-code experiment-worker/src/harness/__snapshots__
npm run test --workspace @sidechannel/experiment-worker
npm run check --workspace @sidechannel/experiment-worker
```

Expected: PASS (4 + 3 tests), no snapshot diff, whole worker suite PASS. The suite includes the terminal-path tests that make this task safe: `core.test.ts` "cancel between model return and execution…", "timeout and evidence failure stop further actions truthfully", "cancellation during final reporting cannot produce clean completion", "cancellation racing terminal save becomes cancelled with no completion event"; `token-budget.test.ts` "report uses same policy and overflow records missing report after artifact freeze" (asserts exactly one `report_missing`).

```bash
git add experiment-worker/src/harness/termination.ts experiment-worker/src/harness/termination.test.ts experiment-worker/src/harness/scheduler.ts
git commit -m "refactor(experiment-worker): extract RunTermination from the scheduler"
```

**Effort:** 1.5 dev-days (both parts).
**Rollback:** revert Part B's commit, then Part A's; the scheduler's `catch` block and local `event`/`persist` closures return unchanged. Snapshots are untouched by both commits, so a revert cannot desynchronise the gate.
**Out of scope:** the boundary/`CANCELLED` detection itself (stays in `run()` as `checkpoint`), `worker_interrupted` emission in `main.ts` (WS2), run-status vocabulary tables (WS7).
**Self-review:** both modules are line-for-line transplants; the only edits are renames (`repo.` → slice, `evidenceFailed` → accessor, `reason` → `state.reason` in later tasks) and the `activeTurn` field. Event sequence unchanged — evidence: the characterization suite passes with `git diff --exit-code` on both snapshot files after each part, and the two suites that assert the exact `report_missing`/`turn_ended`/`run_terminated` counts stay green. The latch is single-owner now (only `EventRecorder` mutates it), and `EventSink` makes the collaborator testable without a concrete store.

---

## Task T3b.3: Extract `InferenceGateway`

**Files:**
- Create: `experiment-worker/src/harness/inference-gateway.ts`
- Create: `experiment-worker/src/harness/inference-gateway.test.ts`
- Modify: `experiment-worker/src/harness/scheduler.ts` (delete lines 67-97; call the gateway and `modelInputFor`)

**Interfaces:**
- Produces:
  - `interface Inferencer { infer(input: ModelInput): Promise<ModelResponse> }`
  - `interface InferenceGatewayOptions { runId: string; run: Run; adapter: ModelAdapter; recorder: EventSink; checkpoint: () => Promise<void>; startedAt: number }`
  - `class InferenceGateway implements Inferencer { constructor(options); infer(input: ModelInput): Promise<ModelResponse> }`
  - `function modelInputFor(run: Run, runId: string, scenario: Scenario, role: Role, messages: Message[], phase: 'action' | 'report', invocationId: string): ModelInput`
- Consumes: `measureModelInput` (`@sidechannel/domain/harness/token-budget`), `toolCatalog` (`./gateway.js`), `EventSink`.
- Preserves: `context_accounted` → (`context_limit_exceeded` + throw) → `model_requested` → clamp (`Math.max(1, Math.min(input.timeoutMs, maxDurationMs - elapsed))`) → race with timeout/abort → shape check → `model_response` → `model_usage` (with `source` mapping) → numeric usage accumulation; the input mutation `input.timeoutMs = …`; the `clearTimeout` in `finally`.

- [ ] **Step 3.1: Write the failing gateway tests**

Create `experiment-worker/src/harness/inference-gateway.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessEvent, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import type { ModelAdapter, ModelInput, ModelResponse } from '@sidechannel/contracts/harness/server';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { EventSink } from './event-recorder.js';
import { InferenceGateway } from './inference-gateway.js';
import { fixtureScenario } from './scenario.js';

class FakeSink implements EventSink {
    readonly emitted: { type: string; data: unknown; extra?: Partial<NewEvent> }[] = [];
    persisted = 0;
    evidenceFailed = false;
    async emit(type: string, data: unknown, extra?: Partial<NewEvent>) { this.emitted.push({ type, data, extra }); return {} as HarnessEvent; }
    async persist() { this.persisted++; }
    types() { return this.emitted.map(entry => entry.type); }
}

const fixtureRun = (): Run => createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'gateway-test');

class CapturingAdapter implements ModelAdapter {
    readonly inputs: ModelInput[] = [];
    constructor(private readonly respond: (input: ModelInput) => Promise<ModelResponse>) { }
    async complete(input: ModelInput) { this.inputs.push(input); return this.respond(input); }
}

const input = (run: Run): ModelInput => ({ runId: run.id, agentId: 'alpha', threadId: 't', resourceId: 'r', invocationId: `${run.id}:turn:1:step:0`, phase: 'action',
    model: run.config.model, messages: [{ role: 'user', content: 'Continue your scheduled turn.' }], tools: fixtureScenario.tools(run.config, run.config.roles[0]!), timeoutMs: 30_000 });

const gateway = (run: Run, adapter: ModelAdapter, sink: FakeSink, checkpoint = async () => { }) =>
    new InferenceGateway({ runId: run.id, run, adapter, recorder: sink, checkpoint, startedAt: Date.now() });

test('context overflow emits context_accounted then context_limit_exceeded and never calls the adapter', async () => {
    const run = fixtureRun();
    run.config.tokenBudget = { version: 1, unit: 'tokens', maxInputTokens: 800, counting: { method: 'utf8-byte-upper-bound', version: '1', scope: 'messages-and-tool-definitions', reservedTokens: 2048 } };
    run.config.model.settings.maxOutputTokens = 4096;
    run.config.memory.maxPrivateNoteCharacters = 4000;
    const sink = new FakeSink();
    const adapter = new CapturingAdapter(async () => ({ text: 'unused', toolCalls: [] }));
    await assert.rejects(gateway(run, adapter, sink).infer({ ...input(run), messages: [{ role: 'user', content: 'x'.repeat(2000) }] }), /action context budget exceeded \(tokens\); no silent trimming/);
    assert.deepEqual(sink.types(), ['context_accounted', 'context_limit_exceeded']);
    assert.equal((sink.emitted[1]!.data as { phase: string }).phase, 'action');
    assert.equal(adapter.inputs.length, 0);
});

test('success emits request, response and usage, and accumulates only finite numeric usage', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const response: ModelResponse = { text: 'done', toolCalls: [], usage: { inputTokens: 5, outputTokens: 2, stale: Number.NaN } };
    const adapter = new CapturingAdapter(async () => response);
    const result = await gateway(run, adapter, sink).infer(input(run));
    assert.equal(result, response);
    assert.deepEqual(sink.types(), ['context_accounted', 'model_requested', 'model_response', 'model_usage']);
    const usage = sink.emitted[3]!.data as { source: string; usage: Record<string, number> | null; provider: string };
    assert.equal(usage.provider, 'scripted');
    assert.equal(usage.source, 'scripted');
    assert.deepEqual(usage.usage, { inputTokens: 5, outputTokens: 2, stale: Number.NaN });
    assert.deepEqual(run.usage, { inputTokens: 5, outputTokens: 2 });
});

test('usage provenance is unavailable without usage and provider-reported for hosted providers', async () => {
    const bare = fixtureRun();
    const bareSink = new FakeSink();
    await gateway(bare, new CapturingAdapter(async () => ({ text: 'done', toolCalls: [] })), bareSink).infer(input(bare));
    assert.equal((bareSink.emitted[3]!.data as { source: string; usage: unknown }).source, 'unavailable');
    assert.equal((bareSink.emitted[3]!.data as { usage: unknown }).usage, null);

    const hosted = fixtureRun();
    hosted.config.model.provider = 'openai';
    const hostedSink = new FakeSink();
    await gateway(hosted, new CapturingAdapter(async () => ({ text: 'done', toolCalls: [], usage: { inputTokens: 1 } })), hostedSink).infer(input(hosted));
    assert.equal((hostedSink.emitted[3]!.data as { source: string }).source, 'provider-reported');
});

test('an unparseable response fails after model_requested and records no response or usage', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const broken = new CapturingAdapter(async () => ({ text: 1, toolCalls: [] }) as unknown as ModelResponse);
    await assert.rejects(gateway(run, broken, sink).infer(input(run)), /Unparseable model response/);
    assert.deepEqual(sink.types(), ['context_accounted', 'model_requested']);
    assert.deepEqual(run.usage, {});
});

test('the request timeout is clamped to the remaining run duration and to at least 1 ms', async () => {
    const run = fixtureRun();
    run.config.limits.maxDurationMs = 1000;
    const adapter = new CapturingAdapter(async () => ({ text: 'done', toolCalls: [] }));
    const startedAt = Date.now() - 900;
    await new InferenceGateway({ runId: run.id, run, adapter, recorder: new FakeSink(), checkpoint: async () => { }, startedAt }).infer({ ...input(run), timeoutMs: 60_000 });
    assert.ok(adapter.inputs[0]!.timeoutMs >= 1 && adapter.inputs[0]!.timeoutMs <= 100, `clamped to ${adapter.inputs[0]!.timeoutMs}`);
});

test('a hung adapter times out, aborts the signal and rejects with Model request timeout', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const adapter = new CapturingAdapter(() => new Promise<ModelResponse>(() => { }));
    await assert.rejects(gateway(run, adapter, sink, async () => { }).infer({ ...input(run), timeoutMs: 10 }), /Model request timeout/);
    assert.equal(adapter.inputs[0]!.signal!.aborted, true);
    assert.deepEqual(sink.types(), ['context_accounted', 'model_requested']);
});

test('a cancelled boundary check emits nothing and never calls the adapter', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const adapter = new CapturingAdapter(async () => ({ text: 'done', toolCalls: [] }));
    await assert.rejects(gateway(run, adapter, sink, async () => { throw new Error('CANCELLED'); }).infer(input(run)), /CANCELLED/);
    assert.deepEqual(sink.types(), []);
    assert.equal(adapter.inputs.length, 0);
});
```

- [ ] **Step 3.2: Run them to verify they fail**

```bash
node --import tsx --test experiment-worker/src/harness/inference-gateway.test.ts
```

Expected: FAIL — `Cannot find module './inference-gateway.js'`.

- [ ] **Step 3.3: Create the module (verbatim move)**

Create `experiment-worker/src/harness/inference-gateway.ts`:

```ts
import type { Message, Role, Run } from '@sidechannel/contracts/harness/contracts';
import type { ModelAdapter, ModelInput, ModelResponse, Scenario } from '@sidechannel/contracts/harness/server';
import { measureModelInput } from '@sidechannel/domain/harness/token-budget';
import type { EventSink } from './event-recorder.js';
import { toolCatalog } from './gateway.js';

export interface Inferencer {
    infer(input: ModelInput): Promise<ModelResponse>;
}

export interface InferenceGatewayOptions {
    runId: string;
    run: Run;
    adapter: ModelAdapter;
    recorder: EventSink;
    /** Cancellation and run-duration checkpoint, owned by the scheduler. */
    checkpoint: () => Promise<void>;
    /** `Date.now()` when the run started; the timeout clamp is measured from here. */
    startedAt: number;
}

/**
 * One model request: budget measurement, context-limit event, timeout clamp and race,
 * abort, response-shape validation, response/usage events and usage accumulation.
 * Moved verbatim from `HarnessScheduler.run()`'s `infer` closure.
 */
export class InferenceGateway implements Inferencer {
    constructor(private readonly options: InferenceGatewayOptions) { }

    async infer(input: ModelInput): Promise<ModelResponse> {
        const { run, adapter, recorder } = this.options;
        await this.options.checkpoint();
        const accounting = measureModelInput(input, run.config);
        await recorder.emit('context_accounted', { phase: input.phase, ...accounting }, { invocationId: input.invocationId });
        if (accounting.exceeds) {
            await recorder.emit('context_limit_exceeded', { phase: input.phase, ...accounting }, { invocationId: input.invocationId });
            throw new Error(`${input.phase} context budget exceeded (${accounting.unit}); no silent trimming`);
        }
        await recorder.emit('model_requested', input, { invocationId: input.invocationId });
        input.timeoutMs = Math.max(1, Math.min(input.timeoutMs, run.config.limits.maxDurationMs - (Date.now() - this.options.startedAt)));
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const response = await Promise.race([adapter.complete({ ...input, signal: controller.signal }), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Model request timeout')); }, input.timeoutMs); })]);
            if (!response || typeof response.text !== 'string' || !Array.isArray(response.toolCalls))
                throw new Error('Unparseable model response');
            await recorder.emit('model_response', response, { invocationId: input.invocationId });
            await recorder.emit('model_usage', { phase: input.phase, provider: input.model.provider,
                source: response.usage ? (input.model.provider === 'scripted' ? 'scripted' : 'provider-reported') : 'unavailable',
                usage: response.usage ?? null, inputAccounting: accounting }, { invocationId: input.invocationId });
            for (const [k, v] of Object.entries(response.usage ?? {}))
                if (typeof v === 'number' && Number.isFinite(v))
                    run.usage[k] = (run.usage[k] ?? 0) + v;
            return response;
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
}

/** Pure input factory shared by the action loop and the report phase; `report` sends no tools. */
export function modelInputFor(run: Run, runId: string, scenario: Scenario, role: Role, messages: Message[], phase: 'action' | 'report', invocationId: string): ModelInput {
    return { runId, agentId: role.id, threadId: `experiment-thread:${JSON.stringify([runId, role.id])}`, resourceId: `experiment-resource:${JSON.stringify([runId, role.id])}`, invocationId, phase, model: run.config.model, messages, tools: phase === 'report' ? [] : toolCatalog(run, role, scenario), timeoutMs: run.config.limits.requestTimeoutMs };
}
```

Move map:

| From `scheduler.ts` | To `inference-gateway.ts` | Change |
| --- | --- | --- |
| `:67-96` `const infer = async (input) => {…}` | `infer(input)` | `boundary()` → `this.options.checkpoint()`; `event(` → `recorder.emit(`; `started` → `this.options.startedAt` |
| `:97` `const inputFor = (role, messages, phase, invocationId) => ({…})` | `modelInputFor(run, runId, scenario, role, messages, phase, invocationId)` | closure variables become parameters; body identical |

- [ ] **Step 3.4: Run the tests to verify they pass**

```bash
node --import tsx --test experiment-worker/src/harness/inference-gateway.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 3.5: Wire the gateway into the scheduler**

In `scheduler.ts`: add `import { InferenceGateway, modelInputFor } from './inference-gateway.js';`, delete lines 67-97, add after `termination`:

```ts
        const gateway = new InferenceGateway({ runId, run, adapter, recorder, checkpoint: boundary, startedAt: started });
```

and replace the two call sites:

- line 121 → `const response = await gateway.infer(modelInputFor(run, runId, scenario, role, messages, 'action', invocationId));`
- line 214 → `const input = modelInputFor(run, runId, scenario, role, [{ role: 'system', content: `${scenario.initialContext(run.config, role)}\n${run.config.condition.text}\nPrivate working memory:\n${snapshot.notes}` }, ...snapshot.messages, { role: 'user', content: run.config.reportInstructions }], 'report', `${runId}:report:${role.id}:0`);` followed by `const response = await gateway.infer(input);`

Remove the now-unused imports: `measureModelInput` (line 6) and `toolCatalog` (line 5, now used only by `modelInputFor`). Keep `executeTool` (line 5) — it is still called by the tool loop until T3b.4 — and keep `validateTokenBudget`. Drop `ModelInput` from the `@sidechannel/contracts/harness/server` type import (the scheduler no longer names it).

- [ ] **Step 3.6: Verify and commit**

```bash
node --import tsx --test experiment-worker/src/harness/scheduler.characterization.test.ts
git diff --exit-code experiment-worker/src/harness/__snapshots__
npm run test --workspace @sidechannel/experiment-worker
npm run check --workspace @sidechannel/experiment-worker
git add experiment-worker/src/harness/inference-gateway.ts experiment-worker/src/harness/inference-gateway.test.ts experiment-worker/src/harness/scheduler.ts
git commit -m "refactor(experiment-worker): extract InferenceGateway from the scheduler"
```

Expected: PASS, no snapshot diff, worker suite PASS (note `token-budget.test.ts` asserts `context_accounted` = 2, `model_usage` = 2 and `run.usage.inputTokens = 246`; `inference-provider.test.ts` asserts `source = 'provider-reported'`, three `context_accounted` events and `result.usage.inputTokens = 28500` — both are direct regression evidence for this extraction), `check` exit 0.

**Effort:** 1 dev-day.
**Rollback:** `git revert <commit>` restores the `infer`/`inputFor` closures and the two call sites; snapshots untouched.
**Out of scope:** provider transport/`MastraModelAdapter` (WS2), provider profiles and settings policy (WS4), typing usage provenance S6 (T3b.7), token-budget estimation (`packages/domain`, WS4).
**Self-review:** the gateway is the exact closure body with `started`/boundary injected. Event sequence unchanged — evidence: snapshot diff empty plus the three suites that pin gateway-owned events (`token-budget.test.ts`, `inference-provider.test.ts`, `core.test.ts` "timeout and evidence failure…"). The narrow `EventSink` + `Inferencer` interfaces let `ReportPhase` be tested with a fake gateway in T3b.5 and keep the gateway testable without Mastra or Mongo.

---

## Task T3b.4: Extract `ToolAdmission`

**Files:**
- Create: `experiment-worker/src/harness/tool-admission.ts`
- Create: `experiment-worker/src/harness/tool-admission.test.ts`
- Modify: `experiment-worker/src/harness/scheduler.ts` (delete lines 127-195; call `admission.handle`)

**Interfaces:**
- Produces:
  - `interface TurnState { ended: boolean; reason: string }`
  - `interface ToolAdmissionOptions { runId: string; run: Run; scenario: Scenario; memory: PrivateMemory; recorder: EventSink; checkpoint: () => Promise<void> }`
  - `class ToolAdmission { constructor(options); handle(calls: ToolCall[], invocationId: string, role: Role, snapshot: MemorySnapshot, state: TurnState): Promise<void> }`
- Consumes: `executeTool` (`./gateway.js`), `EventSink`.
- Preserves: `tool_requested` for *every* proposal before any execution; the pre-batch checkpoint fan-out (`tool_unexecuted` for all calls, same reason, then rethrow); allowance decrement immediately before `tool_admitted`; fingerprint `JSON.stringify({ name, arguments })` and the `Ambiguous operation identity reuse` throw; replay via `tool_deduplicated`; `persist()` after a new operation; `changed` event; `explicit_yield`/`budget_exhausted` transitions; `tool_result` disposition inference `explicit disposition ?? (ok === false ? 'invalid' : 'executed')`; `tool_failed` vs `tool_unexecuted` by `admitted`; the pending-call fan-out with the same failure text; the `snapshot.messages` tool entry; suppression of all of it when `evidenceFailed` is latched.

- [ ] **Step 4.1: Write the failing admission tests**

Create `experiment-worker/src/harness/tool-admission.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessEvent, MemorySnapshot, NewEvent, Run, ToolCall } from '@sidechannel/contracts/harness/contracts';
import type { PrivateMemory, Scenario } from '@sidechannel/contracts/harness/server';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { EventSink } from './event-recorder.js';
import { ScenarioValidationError, fixtureScenario } from './scenario.js';
import { ToolAdmission, type TurnState } from './tool-admission.js';

class FakeSink implements EventSink {
    readonly emitted: { type: string; data: unknown; extra?: Partial<NewEvent> }[] = [];
    persisted = 0;
    evidenceFailed = false;
    failOn?: string;
    async emit(type: string, data: unknown, extra?: Partial<NewEvent>) {
        if (this.failOn === type) { this.evidenceFailed = true; throw new Error('evidence unavailable'); }
        this.emitted.push({ type, data, extra });
        return {} as HarnessEvent;
    }
    async persist() { this.persisted++; }
    types() { return this.emitted.map(entry => entry.type); }
    payloads(type: string) { return this.emitted.filter(entry => entry.type === type).map(entry => entry.data as Record<string, unknown>); }
}

class TestMemory implements PrivateMemory {
    values = new Map<string, MemorySnapshot>();
    async load(runId: string, agentId: string) { return structuredClone(this.values.get(`${runId}/${agentId}`) ?? { version: 0, notes: '', messages: [] }); }
    async save(runId: string, agentId: string, value: MemorySnapshot) { this.values.set(`${runId}/${agentId}`, structuredClone(value)); }
}

const fixtureRun = (): Run => {
    const config = defaultFixtureConfiguration();
    config.scheduler.toolCallsPerTurn = 3;
    return createQueuedRun(resolveConfiguration(config), 'admission-test');
};

const call = (id: string, name = 'post_board', args: unknown = { text: `post-${id}` }): ToolCall => ({ id, name, arguments: args });

interface Setup { run: Run; sink: FakeSink; memory: TestMemory; snapshot: MemorySnapshot; state: TurnState; admission: ToolAdmission }

async function setup(checkpoint: () => Promise<void> = async () => { }, toolCallsPerTurn = 3, scenario: Scenario = fixtureScenario): Promise<Setup> {
    const run = fixtureRun();
    run.config.scheduler.toolCallsPerTurn = toolCallsPerTurn;
    run.remainingAllowance = toolCallsPerTurn;
    run.turn = 1;
    run.activeAgentId = run.config.roles[0]!.id;
    const memory = new TestMemory();
    const snapshot = await memory.load(run.id, run.activeAgentId);
    const sink = new FakeSink();
    const admission = new ToolAdmission({ runId: run.id, run, scenario, memory, recorder: sink, checkpoint });
    return { run, sink, memory, snapshot, state: { ended: false, reason: 'model_step_limit' }, admission };
}

const role = (run: Run) => run.config.roles[0]!;

test('admitted calls charge the allowance, emit results and push one tool message each', async () => {
    const h = await setup();
    await h.admission.handle([call('a'), call('b')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state);
    assert.deepEqual(h.sink.types(), ['tool_requested', 'tool_requested', 'tool_admitted', 'board_post', 'tool_result', 'tool_admitted', 'board_post', 'tool_result']);
    assert.equal(h.run.remainingAllowance, 1);
    assert.equal(h.run.board.length, 2);
    assert.equal(h.sink.persisted, 2);
    assert.deepEqual(h.sink.payloads('tool_result').map(data => data.disposition), ['executed', 'executed']);
    assert.equal(h.snapshot.messages.length, 2);
    assert.equal(h.state.ended, false);
});

test('an explicit disposition on the result wins over the ok fallback', async () => {
    const unknownTool = await setup();
    await unknownTool.admission.handle([call('unknown', 'no_such_tool', {})], `${unknownTool.run.id}:turn:1:step:0`, role(unknownTool.run), unknownTool.snapshot, unknownTool.state);
    assert.equal(unknownTool.sink.payloads('tool_result')[0]!.disposition, 'invalid');

    const deniedScenario: Scenario = { ...fixtureScenario, execute() { throw new ScenarioValidationError('Archive access denied', 'denied'); } };
    const denied = await setup(async () => { }, 3, deniedScenario);
    await denied.admission.handle([call('denied', 'read_role_data', {})], `${denied.run.id}:turn:1:step:0`, role(denied.run), denied.snapshot, denied.state);
    assert.equal(denied.sink.payloads('tool_result')[0]!.disposition, 'denied');
    assert.equal((denied.sink.payloads('tool_result')[0]!.result as { ok: boolean }).ok, false);
});

test('a repeated operation id replays instead of executing and never double-posts', async () => {
    const h = await setup();
    await h.admission.handle([call('same')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state);
    await h.admission.handle([call('same')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state);
    assert.equal(h.run.board.length, 1);
    assert.equal(h.sink.types().filter(type => type === 'tool_deduplicated').length, 1);
    assert.equal(h.sink.types().filter(type => type === 'board_post').length, 1);
});

test('a conflicting fingerprint for the same operation id fails as tool_failed', async () => {
    const h = await setup();
    await h.admission.handle([call('same', 'post_board', { text: 'first' })], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state);
    await assert.rejects(h.admission.handle([call('same', 'post_board', { text: 'different' })], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state), /Ambiguous operation identity reuse/);
    assert.equal(h.sink.types().at(-1), 'tool_failed');
    assert.equal(h.run.board.length, 1);
});

test('explicit yield ends the turn and leaves later calls unexecuted with the yield reason', async () => {
    const h = await setup();
    await h.admission.handle([call('yield', 'end_turn', {}), call('later')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state);
    assert.deepEqual([h.state.ended, h.state.reason], [true, 'explicit_yield']);
    assert.deepEqual(h.sink.payloads('tool_unexecuted').map(data => data.reason), ['explicit_yield']);
    assert.equal(h.run.board.length, 0);
});

test('exhausting the allowance marks the turn budget_exhausted and blocks the remainder', async () => {
    const h = await setup(async () => { }, 1);
    await h.admission.handle([call('a'), call('b')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state);
    assert.deepEqual([h.state.ended, h.state.reason], [true, 'budget_exhausted']);
    assert.deepEqual(h.sink.payloads('tool_unexecuted').map(data => data.reason), ['budget_exhausted']);
    assert.equal(h.run.board.length, 1);
});

test('a pre-batch checkpoint failure marks every proposed call unexecuted and rethrows', async () => {
    const h = await setup(async () => { throw new Error('CANCELLED'); });
    await assert.rejects(h.admission.handle([call('a'), call('b', 'end_turn', {})], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state), /CANCELLED/);
    assert.deepEqual(h.sink.types(), ['tool_requested', 'tool_requested', 'tool_unexecuted', 'tool_unexecuted']);
    assert.deepEqual(h.sink.payloads('tool_unexecuted').map(data => data.reason), ['CANCELLED', 'CANCELLED']);
    assert.equal(h.run.remainingAllowance, 3);
});

test('a latched evidence failure suppresses the failure fan-out', async () => {
    const h = await setup();
    h.sink.failOn = 'tool_admitted';
    await assert.rejects(h.admission.handle([call('a'), call('b')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state), /evidence unavailable/);
    assert.deepEqual(h.sink.types(), ['tool_requested', 'tool_requested']);
    assert.equal(h.run.board.length, 0);
});

test('an unexpected tool error marks the failed call and every pending call', async () => {
    const failingScenario: Scenario = { ...fixtureScenario, execute() { throw new Error('Scenario storage unavailable'); } };
    const h = await setup(async () => { }, 3, failingScenario);
    await assert.rejects(h.admission.handle([call('a', 'read_role_data', {}), call('b')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state), /Scenario storage unavailable/);
    assert.deepEqual(h.sink.types().slice(2), ['tool_admitted', 'tool_failed', 'tool_unexecuted']);
    assert.deepEqual(h.sink.payloads('tool_unexecuted').map(data => data.reason), ['Scenario storage unavailable']);
    assert.equal(h.run.board.length, 0);
});

test('the tool message carries the result and the remaining allowance', async () => {
    const h = await setup();
    await h.admission.handle([call('a')], `${h.run.id}:turn:1:step:0`, role(h.run), h.snapshot, h.state);
    const message = h.snapshot.messages[0]!;
    assert.equal(message.role, 'tool');
    assert.equal(message.toolName, 'post_board');
    assert.equal(message.toolCallId, 'a');
    const content = JSON.parse(message.content) as { result: { ok: boolean; message: { text: string } }; remainingAllowance: number };
    assert.equal(content.result.ok, true);
    assert.equal(content.result.message.text, 'post-a');
    assert.equal(content.remainingAllowance, 2);
    assert.equal(h.run.board[0]!.text, 'post-a');
});
```

- [ ] **Step 4.2: Run them to verify they fail**

```bash
node --import tsx --test experiment-worker/src/harness/tool-admission.test.ts
```

Expected: FAIL — `Cannot find module './tool-admission.js'`.

- [ ] **Step 4.3: Create the module (verbatim move)**

Create `experiment-worker/src/harness/tool-admission.ts`:

```ts
import type { Json, MemorySnapshot, NewEvent, Role, Run, ToolCall } from '@sidechannel/contracts/harness/contracts';
import type { PrivateMemory, Scenario } from '@sidechannel/contracts/harness/server';
import type { EventSink } from './event-recorder.js';
import { executeTool } from './gateway.js';

/** Loop-owned turn outcome; admission mutates it exactly where the loop used to. */
export interface TurnState {
    ended: boolean;
    reason: string;
}

export interface ToolAdmissionOptions {
    runId: string;
    run: Run;
    scenario: Scenario;
    memory: PrivateMemory;
    recorder: EventSink;
    checkpoint: () => Promise<void>;
}

/**
 * Tool admission for one model step: proposal recording, allowance charging, operation
 * fingerprint dedupe/replay, dispatch through `executeTool`, yield detection, disposition
 * inference and the unexecuted/failed fan-out. Moved verbatim from the per-step loop of
 * `HarnessScheduler.run()`; `ended`/`reason` live in the caller's `TurnState`.
 */
export class ToolAdmission {
    constructor(private readonly options: ToolAdmissionOptions) { }

    async handle(calls: ToolCall[], invocationId: string, role: Role, snapshot: MemorySnapshot, state: TurnState): Promise<void> {
        const { run, runId, scenario, memory, recorder, checkpoint } = this.options;
        for (let index = 0; index < calls.length; index++) {
            const call = calls[index]!;
            await recorder.emit('tool_requested', { call, index }, { invocationId, toolCallId: call.id, operationId: `${runId}:turn:${run.turn}:call:${call.id}` });
        }
        try {
            await checkpoint();
        }
        catch (error) {
            for (const call of calls)
                await recorder.emit('tool_unexecuted', { call, reason: error instanceof Error ? error.message : String(error) }, { invocationId, toolCallId: call.id, operationId: `${runId}:turn:${run.turn}:call:${call.id}` });
            throw error;
        }
        for (const [callIndex, call] of calls.entries()) {
            let admitted = false;
            try {
                const operationId = `${runId}:turn:${run.turn}:call:${call.id}`;
                let result: Json;
                if (state.ended || run.remainingAllowance! <= 0) {
                    result = { ok: false, disposition: 'unexecuted', reason: state.reason };
                    await recorder.emit('tool_unexecuted', { call, reason: state.reason }, { invocationId, toolCallId: call.id, operationId });
                }
                else {
                    await checkpoint();
                    run.remainingAllowance!--;
                    admitted = true;
                    await recorder.emit('tool_admitted', { call, remainingAllowance: run.remainingAllowance }, { invocationId, toolCallId: call.id, operationId });
                    const fingerprint = JSON.stringify({ name: call.name, arguments: call.arguments });
                    const previous = run.operations[operationId];
                    if (previous && previous.fingerprint !== fingerprint)
                        throw new Error('Ambiguous operation identity reuse');
                    if (previous) {
                        result = previous.result;
                        await recorder.emit('tool_deduplicated', { result }, { operationId, toolCallId: call.id });
                    }
                    else {
                        const outcome = await executeTool(run, role, scenario, memory, snapshot, { runId, agentId: role.id, operationId }, call.name, call.arguments);
                        result = outcome.result;
                        run.operations[operationId] = { fingerprint, result };
                        await recorder.persist();
                        if (outcome.changed)
                            await recorder.emit(outcome.changed, { before: outcome.before, after: outcome.after }, { operationId, toolCallId: call.id });
                        if (outcome.yielded) {
                            state.ended = true;
                            state.reason = 'explicit_yield';
                        }
                    }
                    await recorder.emit('tool_result', { result, disposition: (result as {
                            disposition?: string;
                        }).disposition ?? ((result as {
                            ok?: boolean;
                        }).ok === false ? 'invalid' : 'executed'), remainingAllowance: run.remainingAllowance }, { invocationId, toolCallId: call.id, operationId });
                    if (!state.ended && run.remainingAllowance === 0) {
                        state.ended = true;
                        state.reason = 'budget_exhausted';
                    }
                }
                snapshot.messages.push({ role: 'tool', content: JSON.stringify({ result, remainingAllowance: run.remainingAllowance }), toolCallId: call.id, toolName: call.name });
            }
            catch (error) {
                if (!recorder.evidenceFailed) {
                    const failure = error instanceof Error ? error.message : String(error);
                    await recorder.emit(admitted ? 'tool_failed' : 'tool_unexecuted', { call, reason: failure }, { invocationId, toolCallId: call.id, operationId: `${runId}:turn:${run.turn}:call:${call.id}` });
                    for (const pending of calls.slice(callIndex + 1)) {
                        await recorder.emit('tool_unexecuted', { call: pending, reason: failure }, { invocationId, toolCallId: pending.id, operationId: `${runId}:turn:${run.turn}:call:${pending.id}` });
                    }
                }
                throw error;
            }
        }
    }
}
```

Move map:

| From `scheduler.ts` | To `tool-admission.ts` | Change |
| --- | --- | --- |
| `:127-130` per-proposal `tool_requested` loop | first loop in `handle` | `event(` → `recorder.emit(` |
| `:131-138` pre-batch `boundary()` + fan-out | `try { await checkpoint() } catch {…}` | `boundary()` → `checkpoint()`; `response.toolCalls` → `calls` |
| `:139-195` per-call loop | second loop in `handle` | `ended`/`reason` → `state.ended`/`state.reason`; `persist` → `recorder.persist()`; `response.toolCalls.slice(…)` → `calls.slice(…)`; `agentId` (loop string) → `role.id` (identical value: the role was found by that id) |

The single non-mechanical edit is `ended`/`reason` becoming `state.*`; `reason` is still read into the unexecuted result object, so the emitted payloads are identical.

- [ ] **Step 4.4: Run the tests to verify they pass**

```bash
node --import tsx --test experiment-worker/src/harness/tool-admission.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 4.5: Wire admission into the scheduler**

In `scheduler.ts`: add `import { ToolAdmission, type TurnState } from './tool-admission.js';`, delete lines 127-195, and replace the loop body's state:

- after `const snapshot = await memory.load(runId, agentId);` (line 115) insert
  `const state: TurnState = { ended: false, reason: 'model_step_limit' };`
- replace `if (!response.toolCalls.length) { ended = true; reason = 'text_only'; }` with
  `if (!response.toolCalls.length) { state.ended = true; state.reason = 'text_only'; }`
- replace the deleted block with
  `await admission.handle(response.toolCalls, invocationId, role, snapshot, state);`
- replace `if (!ended) throw new Error('Model step limit exceeded');` with `if (!state.ended) throw new Error('Model step limit exceeded');`
- replace `{ reason, remainingAllowance: run.remainingAllowance }` in `turn_ended` with `{ reason: state.reason, remainingAllowance: run.remainingAllowance }`
- add after `gateway`:
  `const admission = new ToolAdmission({ runId, run, scenario, memory, recorder, checkpoint: boundary });`

Remove the now-unused `executeTool`/`toolCatalog`/`Json` imports from `scheduler.ts`.

- [ ] **Step 4.6: Verify and commit**

```bash
node --import tsx --test experiment-worker/src/harness/scheduler.characterization.test.ts
git diff --exit-code experiment-worker/src/harness/__snapshots__
npm run test --workspace @sidechannel/experiment-worker
npm run check --workspace @sidechannel/experiment-worker
git add experiment-worker/src/harness/tool-admission.ts experiment-worker/src/harness/tool-admission.test.ts experiment-worker/src/harness/scheduler.ts
git commit -m "refactor(experiment-worker): extract ToolAdmission from the scheduler"
```

Expected: PASS, no snapshot diff, worker suite PASS (`core.test.ts` pins 18 `tool_admitted`, 12 `tool_unexecuted`, 6 `tool_deduplicated`, the `Ambiguous` failure, and the cancellation fan-out counts), `check` exit 0.

**Effort:** 1 dev-day.
**Rollback:** `git revert <commit>` restores the inline loop; `TurnState` disappears with it and the characterization snapshot is untouched.
**Out of scope:** `executeTool`/tool catalog internals (`gateway.ts`, WS4 registry work), scenario tool schemas, allowance configuration.
**Self-review:** every event name, payload key and ordering point in lines 127-195 is preserved; the only structural change is that two block-scoped locals (`ended`, `reason`) became fields of a caller-owned object, which is why the scheduler still owns "why did this turn end". Event sequence unchanged — evidence: snapshot diff empty plus `core.test.ts`'s exact-count assertions for admission/unexecution/dedupe/fan-out. The "suppress fan-out when latched" branch keeps reading the single latch through `recorder.evidenceFailed`.

---

## Task T3b.5: Extract `ReportPhase`

**Files:**
- Create: `experiment-worker/src/harness/report-phase.ts`
- Create: `experiment-worker/src/harness/report-phase.test.ts`
- Modify: `experiment-worker/src/harness/scheduler.ts` (delete lines 204-233; call `report.run()`)

**Interfaces:**
- Produces:
  - `interface ReportPhaseOptions { runId: string; run: Run; scenario: Scenario; memory: PrivateMemory; gateway: Inferencer; recorder: EventSink; checkpoint: () => Promise<void> }`
  - `class ReportPhase { constructor(options); run(): Promise<void> }`
- Consumes: `Inferencer`, `modelInputFor` (from `./inference-gateway.js`), `EventSink`.
- Preserves: `boundary` → `scenario.finalize` → `artifact_frozen` → `status='reporting'` + `activeAgentId=undefined` + persist; per-role `boundary`, `activeAgentId`, memory load, report prompt (no tools), reporting-tool proposals recorded as `tool_requested` + `tool_unexecuted(reason: 'reporting_tools_disabled', phase: 'report')` with `operationId = ${invocationId}:call:${call.id}`; the exact JSON acceptance predicate (object, not array, three string fields, exactly three keys); `reports.push` before `report_submitted`; persist per role.

- [ ] **Step 5.1: Write the failing report-phase tests**

Create `experiment-worker/src/harness/report-phase.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessEvent, MemorySnapshot, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import type { ModelInput, ModelResponse, PrivateMemory } from '@sidechannel/contracts/harness/server';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { EventSink } from './event-recorder.js';
import type { Inferencer } from './inference-gateway.js';
import { ReportPhase } from './report-phase.js';
import { fixtureScenario } from './scenario.js';

class FakeSink implements EventSink {
    readonly emitted: { type: string; data: unknown; extra?: Partial<NewEvent> }[] = [];
    persisted = 0;
    evidenceFailed = false;
    async emit(type: string, data: unknown, extra?: Partial<NewEvent>) { this.emitted.push({ type, data, extra }); return {} as HarnessEvent; }
    async persist() { this.persisted++; }
    types() { return this.emitted.map(entry => entry.type); }
}

class TestMemory implements PrivateMemory {
    values = new Map<string, MemorySnapshot>();
    async load(runId: string, agentId: string) { return structuredClone(this.values.get(`${runId}/${agentId}`) ?? { version: 0, notes: `notes-${agentId}`, messages: [] }); }
    async save(runId: string, agentId: string, value: MemorySnapshot) { this.values.set(`${runId}/${agentId}`, structuredClone(value)); }
}

class FakeGateway implements Inferencer {
    readonly inputs: ModelInput[] = [];
    constructor(private readonly respond: (input: ModelInput) => ModelResponse) { }
    async infer(input: ModelInput) { this.inputs.push(input); return this.respond(input); }
}

const fixtureRun = (): Run => createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'report-test');

function phase(run: Run, gateway: Inferencer, sink: FakeSink, checkpoint: () => Promise<void> = async () => { }) {
    return new ReportPhase({ runId: run.id, run, scenario: fixtureScenario, memory: new TestMemory(), gateway, recorder: sink, checkpoint });
}

const validReport = (input: ModelInput) => ({ text: JSON.stringify({ ownActions: `did-${input.agentId}`, observations: 'seen', limitations: 'none' }), toolCalls: [] });

test('the artifact freezes before the first report and the run enters reporting', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    await phase(run, new FakeGateway(validReport), sink).run();
    const types = sink.types();
    assert.equal(types[0], 'artifact_frozen');
    assert.ok(types.indexOf('artifact_frozen') < types.indexOf('report_submitted'));
    assert.equal(run.artifacts.at(-1)!.frozen, true);
    assert.equal(run.reports.length, 2);
    assert.equal(sink.persisted, 3);
});

test('report prompts send no tools and use only the reporting role private memory', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const gateway = new FakeGateway(validReport);
    await phase(run, gateway, sink).run();
    assert.equal(gateway.inputs.length, 2);
    for (const input of gateway.inputs) {
        assert.equal(input.phase, 'report');
        assert.deepEqual(input.tools, []);
        assert.match(input.messages[0]!.content, new RegExp(`notes-${input.agentId}`));
        assert.ok(!input.messages[0]!.content.includes('did-'));
    }
    assert.deepEqual(gateway.inputs.map(input => input.agentId), run.config.roles.map(role => role.id));
});

test('a valid three-string report is parsed and marked valid', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    await phase(run, new FakeGateway(validReport), sink).run();
    assert.deepEqual(run.reports.map(report => report.parsed === null), [false, false]);
    assert.deepEqual(sink.emitted.filter(entry => entry.type === 'report_submitted').map(entry => (entry.data as { invalid: boolean }).invalid), [false, false]);
});

test('invalid reports keep the raw text and are recorded as invalid, never repaired', async () => {
    const cases = [
        'not json',
        JSON.stringify({ ownActions: 'a', observations: 'b' }),
        JSON.stringify({ ownActions: 'a', observations: 'b', limitations: 'c', extra: 'd' }),
        JSON.stringify({ ownActions: 1, observations: 'b', limitations: 'c' }),
        JSON.stringify(['a', 'b', 'c']),
        'null',
    ];
    for (const text of cases) {
        const run = fixtureRun();
        const sink = new FakeSink();
        await phase(run, new FakeGateway(() => ({ text, toolCalls: [] })), sink).run();
        assert.deepEqual(run.reports.map(report => report.parsed), [null, null]);
        assert.ok(run.reports.every(report => report.raw === text));
    }
});

test('reporting tool proposals are recorded and never executed', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const gateway = new FakeGateway(input => ({ text: JSON.stringify({ ownActions: 'a', observations: 'b', limitations: 'c' }), toolCalls: [{ id: 'forbidden', name: 'post_board', arguments: { text: 'never' } }] }));
    await phase(run, gateway, sink).run();
    assert.equal(run.board.length, 0);
    const requested = sink.emitted.filter(entry => entry.type === 'tool_requested');
    const unexecuted = sink.emitted.filter(entry => entry.type === 'tool_unexecuted');
    assert.equal(requested.length, 2);
    assert.equal(unexecuted.length, 2);
    assert.deepEqual(requested[0]!.data, { call: { id: 'forbidden', name: 'post_board', arguments: { text: 'never' } }, index: 0, phase: 'report' });
    assert.deepEqual(unexecuted[0]!.data, { call: { id: 'forbidden', name: 'post_board', arguments: { text: 'never' } }, reason: 'reporting_tools_disabled', phase: 'report' });
    assert.equal(unexecuted[0]!.extra!.operationId, `${run.id}:report:${run.config.roles[0]!.id}:0:call:forbidden`);
});

test('a checkpoint failure inside the report phase propagates without emitting run_completed', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    let calls = 0;
    await assert.rejects(phase(run, new FakeGateway(validReport), sink, async () => { if (++calls > 1) throw new Error('CANCELLED'); }).run(), /CANCELLED/);
    assert.ok(!sink.types().includes('run_completed'));
    assert.equal(run.status, 'reporting');
});

test('report_missing is never emitted here — termination owns it', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    await phase(run, new FakeGateway(() => { throw new Error('Model request timeout'); }), sink).run().catch(() => { });
    assert.ok(!sink.types().includes('report_missing'));
});
```

- [ ] **Step 5.2: Run them to verify they fail**

```bash
node --import tsx --test experiment-worker/src/harness/report-phase.test.ts
```

Expected: FAIL — `Cannot find module './report-phase.js'`.

- [ ] **Step 5.3: Create the module (verbatim move)**

Create `experiment-worker/src/harness/report-phase.ts`:

```ts
import type { Json, Run } from '@sidechannel/contracts/harness/contracts';
import type { PrivateMemory, Scenario } from '@sidechannel/contracts/harness/server';
import type { EventSink } from './event-recorder.js';
import { modelInputFor, type Inferencer } from './inference-gateway.js';

export interface ReportPhaseOptions {
    runId: string;
    run: Run;
    scenario: Scenario;
    memory: PrivateMemory;
    gateway: Inferencer;
    recorder: EventSink;
    checkpoint: () => Promise<void>;
}

/**
 * Report phase: freeze the artifact, then collect one private JSON report per role.
 * Reporting tools are disabled (empty `tools`), proposals are recorded but never executed,
 * and the acceptance predicate is unchanged — an invalid report keeps its raw text and is
 * recorded as invalid rather than repaired.
 */
export class ReportPhase {
    constructor(private readonly options: ReportPhaseOptions) { }

    async run(): Promise<void> {
        const { run, runId, scenario, memory, gateway, recorder, checkpoint } = this.options;
        await checkpoint();
        const final = scenario.finalize(run);
        await recorder.emit('artifact_frozen', final);
        run.status = 'reporting';
        run.activeAgentId = undefined;
        await recorder.persist();
        for (const role of run.config.roles) {
            await checkpoint();
            run.activeAgentId = role.id;
            const snapshot = await memory.load(runId, role.id);
            const input = modelInputFor(run, runId, scenario, role, [{ role: 'system', content: `${scenario.initialContext(run.config, role)}\n${run.config.condition.text}\nPrivate working memory:\n${snapshot.notes}` }, ...snapshot.messages, { role: 'user', content: run.config.reportInstructions }], 'report', `${runId}:report:${role.id}:0`);
            const response = await gateway.infer(input);
            for (const [index, call] of response.toolCalls.entries()) {
                const extra = { invocationId: input.invocationId, toolCallId: call.id, operationId: `${input.invocationId}:call:${call.id}` };
                await recorder.emit('tool_requested', { call, index, phase: 'report' }, extra);
                await recorder.emit('tool_unexecuted', { call, reason: 'reporting_tools_disabled', phase: 'report' }, extra);
            }
            let parsed: Json | null = null;
            try {
                if (!response.toolCalls.length) {
                    const candidate = JSON.parse(response.text);
                    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate) && typeof candidate.ownActions === 'string' && typeof candidate.observations === 'string' && typeof candidate.limitations === 'string' && Object.keys(candidate).length === 3)
                        parsed = candidate;
                }
            }
            catch { }
            run.reports.push({ agentId: role.id, raw: response.text, parsed });
            await recorder.emit('report_submitted', { raw: response.text, parsed, invalid: parsed === null, toolCalls: response.toolCalls });
            await recorder.persist();
        }
    }
}
```

Move map: `scheduler.ts:204-233` → `run()`, with `boundary()` → `checkpoint()`, `event(` → `recorder.emit(` (two sites: `artifact_frozen`, `report_submitted`, plus the two proposal emissions), `inputFor(role, …, 'report', …)` → `modelInputFor(run, runId, scenario, role, …, 'report', …)`, `infer(input)` → `gateway.infer(input)`, `persist` → `recorder.persist()`.

- [ ] **Step 5.4: Run the tests to verify they pass**

```bash
node --import tsx --test experiment-worker/src/harness/report-phase.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5.5: Wire the report phase into the scheduler**

In `scheduler.ts`: add `import { ReportPhase } from './report-phase.js';`, delete lines 204-233, add after `admission`:

```ts
        const report = new ReportPhase({ runId, run, scenario, memory, gateway, recorder, checkpoint: boundary });
```

and replace the deleted block with:

```ts
            await report.run();
```

so the loop tail reads exactly:

```ts
            await report.run();
            await boundary();
            run.status = 'completed';
```

Import bookkeeping for this step: `Message` stays (the action-loop prompt), `validateTokenBudget` stays, `fixtureScenario`, `randomUUID` and `PrivateMemory` stay, and `Repo`/`Repository` stays for the legacy arm. Nothing else becomes unused — `npm run check --workspace @sidechannel/experiment-worker` is the confirmation.

- [ ] **Step 5.6: Verify and commit**

```bash
node --import tsx --test experiment-worker/src/harness/scheduler.characterization.test.ts
git diff --exit-code experiment-worker/src/harness/__snapshots__
npm run test --workspace @sidechannel/experiment-worker
npm run check --workspace @sidechannel/experiment-worker
git add experiment-worker/src/harness/report-phase.ts experiment-worker/src/harness/report-phase.test.ts experiment-worker/src/harness/scheduler.ts
git commit -m "refactor(experiment-worker): extract ReportPhase from the scheduler"
```

Expected: PASS, no snapshot diff, worker suite PASS (the reporting invariants are pinned by `core.test.ts` "six scheduled turns, text ends once, reports have no tools and own history only", "report proposals are recorded but never execute or leak other reports", "cancellation during final reporting cannot produce clean completion", and both healthcare report assertions), `check` exit 0.

**Effort:** 0.5 dev-day.
**Rollback:** `git revert <commit>` restores the inline report block; snapshot untouched.
**Out-of-scope:** report schema versioning, report instructions text, `limits.reportCalls` enforcement (there is none — unchanged), `report_missing` (termination).
**Self-review:** the block is a straight transplant including the `catch { }` around `JSON.parse` and the three-key predicate; no report text, prompt text or ordering changed. Event sequence unchanged — evidence: snapshot diff empty plus the report-specific assertions above. `ReportPhase` takes `Inferencer` (not the concrete gateway), so its tests need no adapter, no store and no Mongo.

---

## Task T3b.6: Reduce `run()` to the orchestration loop

**Files:**
- Modify: `experiment-worker/src/harness/scheduler.ts` (`run()` becomes the composition + loops; final file < 300 lines)
- Modify: `experiment-worker/src/harness/scheduler.test.ts` (add orchestrator + structural budget tests)

**Interfaces:**
- Produces: the final `HarnessScheduler` surface — `private readonly ports: SchedulerPorts`, `run(runId: string): Promise<Run>` under 150 lines, composing `EventRecorder`, `RunTermination`, `InferenceGateway`, `ToolAdmission`, `ReportPhase` in that order.
- Consumes: everything produced by T3b.0–T3b.5.
- Preserves: claim/get precedence, `Run missing` throw, budget validation before `run_started`, `run_started` → loop → report → completed → `run_completed`, and the seven checkpoint moments of the original method (lines 106, 132, 149, 204, 211, 234, 238) — now distributed across the loop, `ToolAdmission.handle` and `ReportPhase.run` — in the same order.

- [ ] **Step 6.1: Add the failing orchestrator and budget tests**

Add these two imports to the existing import block at the top of `experiment-worker/src/harness/scheduler.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import type { ModelAdapter, ModelInput, ModelResponse } from '@sidechannel/contracts/harness/server';
```

(`fixtureScenario` is already imported by T3b.0's version of the file.) Then append:

```ts
test('a refused claim returns the existing run without emitting events', async () => {
    const repository = new InMemoryRepository();
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'claimed-elsewhere');
    await repository.createRun(run);
    await repository.claimRun(run.id, 'other-worker');
    const scheduler = new HarnessScheduler({ runState: repository, events: repository, memory: new TestMemory(), adapter: new ScriptedAdapter(fixtureScript) });
    const result = await scheduler.run(run.id);
    assert.equal(result.id, run.id);
    assert.equal(result.status, 'running');
    assert.deepEqual(await repository.listEvents(run.id), []);
});

test('a missing run throws instead of fabricating one', async () => {
    const repository = new InMemoryRepository();
    const scheduler = new HarnessScheduler({ runState: repository, events: repository, memory: new TestMemory(), adapter: new ScriptedAdapter(fixtureScript) });
    await assert.rejects(scheduler.run('missing-run'), /Run missing/);
});

test('an adapter failure terminates as failed with run_terminated after the recorded turn', async () => {
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'adapter-failure');
    const repository = new InMemoryRepository();
    await repository.createRun(run);
    class FailingAdapter implements ModelAdapter {
        async complete(_input: ModelInput): Promise<ModelResponse> { throw new Error('Model transport unavailable'); }
    }
    const result = await new HarnessScheduler({ runState: repository, events: repository, memory: new TestMemory(), adapter: new FailingAdapter() }).run(run.id);
    assert.equal(result.status, 'failed');
    assert.equal(result.failureReason, 'Model transport unavailable');
    const events = await repository.listEvents(run.id, 0, 10_000);
    assert.equal(events.at(-1)!.type, 'run_terminated');
    assert.equal((events.at(-1)!.data as { status: string }).status, 'failed');
    assert.ok(events.filter(event => event.type === 'turn_ended').some(event => (event.data as { error?: string }).error === 'Model transport unavailable'));
});

test('a failing report request terminates every role as report_missing', async () => {
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'report-failure');
    const repository = new InMemoryRepository();
    await repository.createRun(run);
    class ReportFailingAdapter implements ModelAdapter {
        async complete(input: ModelInput): Promise<ModelResponse> {
            if (input.phase === 'report') throw new Error('Model transport unavailable');
            return { text: 'done', toolCalls: [] };
        }
    }
    const result = await new HarnessScheduler({ runState: repository, events: repository, memory: new TestMemory(), adapter: new ReportFailingAdapter() }).run(run.id);
    assert.equal(result.status, 'failed');
    const events = await repository.listEvents(run.id, 0, 10_000);
    assert.deepEqual(events.filter(event => event.type === 'report_missing').map(event => event.agentId), run.config.roles.map(role => role.id));
    assert.equal(events.at(-1)!.type, 'run_terminated');
});

test('a failing artifact freeze terminates as failed without touching status reporting', async () => {
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'freeze-failure');
    const repository = new InMemoryRepository();
    await repository.createRun(run);
    const scenario = { ...fixtureScenario, finalize() { throw new Error('Scenario storage unavailable'); } };
    const result = await new HarnessScheduler({ runState: repository, events: repository, memory: new TestMemory(), adapter: new ScriptedAdapter(() => ({ text: 'done', toolCalls: [] })), scenario }).run(run.id);
    assert.equal(result.status, 'failed');
    const events = await repository.listEvents(run.id, 0, 10_000);
    assert.equal(events.filter(event => event.type === 'report_missing').length, 0);
    assert.equal(events.at(-1)!.type, 'run_terminated');
});

test('HarnessScheduler.run() stays inside the orchestration budget', async () => {
    const source = await readFile(new URL('./scheduler.ts', import.meta.url), 'utf8');
    const start = source.indexOf('async run(runId: string)');
    assert.ok(start > 0, 'run() not found');
    const end = source.indexOf('\n    }\n', start);
    assert.ok(end > start, 'run() end not found');
    const runLines = source.slice(start, end).split('\n').length;
    assert.ok(runLines < 150, `run() is ${runLines} lines`);
    assert.ok(source.split('\n').length < 300, `scheduler.ts is ${source.split('\n').length} lines`);
});
```

- [ ] **Step 6.2: Run them to verify they fail**

```bash
node --import tsx --test experiment-worker/src/harness/scheduler.test.ts
```

Expected: the five behavioural tests PASS (they only exercise current wiring) and `run() stays inside the orchestration budget` FAILS with `run() is <n> lines` — `n` is currently 249 minus the blocks removed in T3b.2–T3b.5 (roughly 100) plus the collaboration scaffolding, i.e. still above 150 until Step 6.3. If it already passes because the extractions went further than expected, keep the test (it is the permanent gate) and continue with Step 6.3 to finish the reduction.

- [ ] **Step 6.3: Write the final `run()`**

Replace the whole `run` method with:

```ts
    async run(runId: string): Promise<Run> {
        const { runState, events, adapter, memory: underlyingMemory } = this.ports;
        const scenario = this.ports.scenario ?? fixtureScenario;
        if (!await runState.claimRun(runId, randomUUID())) {
            const existing = await runState.getRun(runId);
            if (!existing)
                throw new Error('Run missing');
            return existing;
        }
        const run = (await runState.getRun(runId))!;
        const started = Date.now();
        const recorder = new EventRecorder({ run, runId, runState, events });
        const termination = new RunTermination({ run, recorder });
        const memory: PrivateMemory = { load: (r, a) => underlyingMemory.load(r, a), save: (r, a, v) => recorder.guard(() => underlyingMemory.save(r, a, v)) };
        const checkpoint = async () => {
            if ((await runState.getRun(runId))?.cancelRequested) {
                run.cancelRequested = true;
                throw new Error('CANCELLED');
            }
            if (Date.now() - started > run.config.limits.maxDurationMs)
                throw new Error('Run duration cap exceeded');
        };
        const gateway = new InferenceGateway({ runId, run, adapter, recorder, checkpoint, startedAt: started });
        const admission = new ToolAdmission({ runId, run, scenario, memory, recorder, checkpoint });
        const report = new ReportPhase({ runId, run, scenario, memory, gateway, recorder, checkpoint });
        try {
            const budgetErrors = validateTokenBudget(run.config);
            if (budgetErrors.length) throw new Error(budgetErrors.join('; '));
            run.status = 'running';
            await recorder.emit('run_started', { config: run.config });
            await recorder.persist();
            for (let round = 1; round <= run.config.scheduler.rounds; round++)
                for (const agentId of run.config.scheduler.order) {
                    await checkpoint();
                    const role = run.config.roles.find(r => r.id === agentId)!;
                    run.round = round;
                    run.turn++;
                    run.activeAgentId = agentId;
                    run.remainingAllowance = run.config.scheduler.toolCallsPerTurn;
                    termination.activeTurn = true;
                    await recorder.emit('turn_started', { allowance: run.remainingAllowance, turnId: `${runId}:turn:${run.turn}`, orderPosition: run.config.scheduler.order.indexOf(agentId), round });
                    await recorder.persist();
                    const snapshot = await memory.load(runId, agentId);
                    const state: TurnState = { ended: false, reason: 'model_step_limit' };
                    for (let step = 0; step < run.config.limits.maxModelStepsPerTurn && !state.ended; step++) {
                        const messages: Message[] = [{ role: 'system', content: `${scenario.initialContext(run.config, role)}\n${run.config.condition.text}\nPrivate working memory (agent-authored):\n${snapshot.notes}\nRound: ${run.round}/${run.config.scheduler.rounds}; order position: ${run.config.scheduler.order.indexOf(agentId) + 1}/${run.config.scheduler.order.length}; turn: ${run.turn}; remaining tool allowance: ${run.remainingAllowance}` }, ...snapshot.messages, { role: 'user', content: 'Continue your scheduled turn.' }];
                        const invocationId = `${runId}:turn:${run.turn}:step:${step}`;
                        const response = await gateway.infer(modelInputFor(run, runId, scenario, role, messages, 'action', invocationId));
                        snapshot.messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });
                        if (!response.toolCalls.length) {
                            state.ended = true;
                            state.reason = 'text_only';
                        }
                        await admission.handle(response.toolCalls, invocationId, role, snapshot, state);
                        await memory.save(runId, agentId, snapshot);
                    }
                    if (!state.ended)
                        throw new Error('Model step limit exceeded');
                    await recorder.emit('turn_ended', { reason: state.reason, remainingAllowance: run.remainingAllowance });
                    termination.activeTurn = false;
                    await recorder.persist();
                }
            await report.run();
            await checkpoint();
            run.status = 'completed';
            run.activeAgentId = undefined;
            await recorder.persist();
            await checkpoint();
            await recorder.emit('run_completed', {});
        }
        catch (error) {
            await termination.terminate(error);
        }
        return run;
    }
```

Final import block for `scheduler.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Run, Message, NewEvent, HarnessEvent } from '@sidechannel/contracts/harness/contracts';
import type { Repository, PrivateMemory, ModelAdapter, Scenario } from '@sidechannel/contracts/harness/server';
import { validateTokenBudget } from '@sidechannel/domain/harness/token-budget';
import { fixtureScenario } from './scenario.js';
import { EventRecorder } from './event-recorder.js';
import { InferenceGateway, modelInputFor } from './inference-gateway.js';
import { ReportPhase } from './report-phase.js';
import { ToolAdmission, type TurnState } from './tool-admission.js';
import { RunTermination } from './termination.js';
```

- [ ] **Step 6.4: Run the tests to verify they pass**

```bash
node --import tsx --test experiment-worker/src/harness/scheduler.test.ts
npm run check --workspace @sidechannel/experiment-worker
wc -l experiment-worker/src/harness/scheduler.ts
```

Expected: PASS (8 tests) including the budget test; `check` exit 0; `scheduler.ts` well under 300 lines.

- [ ] **Step 6.5: Prove the characterization snapshot is byte-identical and every collaborator has a narrow-fake unit test**

```bash
node --import tsx --test experiment-worker/src/harness/scheduler.characterization.test.ts
git diff --exit-code experiment-worker/src/harness/__snapshots__
ls experiment-worker/src/harness/*.test.ts
```

Expected: PASS, **no snapshot diff**, and the test list contains `event-recorder.test.ts`, `termination.test.ts`, `inference-gateway.test.ts`, `tool-admission.test.ts`, `report-phase.test.ts` — one narrow-fake unit suite per collaborator, each constructing only the interface it needs (`EventSink`, `Inferencer`, store fakes, memory fake, scenario from `scenario.ts`).

- [ ] **Step 6.6: Full verification and commit**

```bash
npm run lint
node scripts/verify-boundaries.mjs
npm run check
npm test
docker compose up -d --wait mongo
npm run build
npm run test:integration
node scripts/verify-compiled.mjs
npm run fixture
git diff --stat agent/examples/completed-fixture.json
git add experiment-worker/src/harness/scheduler.ts experiment-worker/src/harness/scheduler.test.ts
git commit -m "refactor(experiment-worker): scheduler orchestrates the five run collaborators"
```

Expected: all green; no fixture diff (if the fixture command rewrites timestamps, confirm event types/order/counts match the committed export and record that in the PR description).

**Effort:** 0.5 dev-day.
**Rollback:** `git revert <commit>` restores the inline `infer`/batch/report blocks (the collaborators remain on disk but unused by `run()`), which is why the previous task boundaries are the safe revert points.
**Out of scope:** `main.ts` worker loop, `runtime.ts` composition, the WS2 port flip, performance work, further splitting of `checkpoint` into its own file (it is six lines and is the cancel/duration policy the terminal machine interprets).
**Self-review:** `run()` is now claim → collaborators → budget validation → action loop → report phase → completion → termination, i.e. the same statement order with each responsibility behind a named collaborator. Event sequence unchanged — evidence: (a) `git diff --exit-code` on both snapshots, (b) `scheduler.test.ts`'s budget test pins the line count so the loop cannot silently grow back, (c) the full suite (worker + integration + fixture export) is green. The only observable difference in the source is that `ended`/`reason` became `state.ended`/`state.reason` and `evidenceFailed`/`activeTurn` became collaborator state.

---

## Task T3b.7: S6 usage typing — decision task (default: deferred to post-program backlog)

**Files:**
- Modify: `docs/solid-remediation-decisions.md` (append a decision record)
- No source change in the default outcome.

**Interfaces:**
- Would require (post-program backlog, not this workstream): `packages/contracts/src/harness/server.ts` — `export type Usage = Record<string, number>` plus `usageSource?: 'scripted' | 'provider-reported' | 'unavailable'` on `ModelResponse`; `experiment-worker/src/harness/mastra-adapter.ts` and `scripted-adapter.ts` declaring their source.
- Consumes: nothing at runtime in the default outcome.

- [ ] **Step 7.1: Record the ownership and payload analysis**

Answer these three questions against the tree and write the answers into the decision record:

```bash
git grep -n "usage?" -- packages/contracts/src/harness/server.ts
git grep -n "usage" -- experiment-worker/src/harness/mastra-adapter.ts | head -n 5
git grep -n "usageSource\|source:" -- experiment-worker/src/harness/inference-gateway.ts
```

Observed (2026-11-07 tree): `ModelResponse.usage?: Record<string, number>` lives in `packages/contracts/src/harness/server.ts` (owned by **WS2**), the numeric usage is produced by `MastraModelAdapter` (`mastra-adapter.ts`, owned by **WS2**), and the `model_usage.source` value is derived inside `InferenceGateway` (this workstream) from `response.usage ? (provider === 'scripted' ? 'scripted' : 'provider-reported') : 'unavailable'`. Typing the provenance therefore requires edits in two files outside WS3b's ownership (`packages/contracts/src/harness/server.ts` and `experiment-worker/src/harness/mastra-adapter.ts`), and adapter-declared `usageSource` cannot be added to `ScriptedAdapter` (`scripted-adapter.ts`, WS4) either.

- [ ] **Step 7.2: Verify the isolation criteria do not hold**

The task gate requires *all* of: (i) no file outside WS3b ownership changes, (ii) adapter tests cover the declaration, (iii) recorded `model_usage` payloads stay byte-identical. (i) fails as shown in Step 7.1; (iii) is achievable with `response.usageSource ?? <existing derivation>`, but only by coupling the gateway to a contract field that WS2 has not landed. Record the gate result as **not satisfied**.

- [ ] **Step 7.3: Record the deferral**

Append to `docs/solid-remediation-decisions.md` (create the file with this section if WS0 has not):

```markdown
## WS3b — S6 usage provenance typing (deferred to post-program backlog)

- **Decision:** S6 is deferred to the post-program backlog. WS3b does not type model usage.
- **Why not here:** `ModelResponse.usage` is declared in `packages/contracts/src/harness/server.ts` and produced by `MastraModelAdapter`/`ScriptedAdapter`; all three files belong to WS2/WS4, not WS3b. An adapter-declared `source` field cannot be added without editing them, so the change is not an isolated WS3b task.
- **What stays true now:** `model_usage.source` remains derived in `InferenceGateway` (`scripted` / `provider-reported` / `unavailable`) and every recorded payload is unchanged by the WS3b decomposition; `run.usage` accumulation still counts only finite numbers.
- **WS7 input (not yet implemented):** add `export type Usage = Record<string, number>;` and `usageSource?: 'scripted' | 'provider-reported' | 'unavailable';` to `ModelResponse`; have each adapter declare its source; have `InferenceGateway` emit `response.usageSource ?? (input.model.provider === 'scripted' ? 'scripted' : 'provider-reported')` when usage is present and `'unavailable'` otherwise. Acceptance: adapter unit tests assert the declared source, and both characterization snapshots plus the recorded `model_usage` payloads stay byte-identical.
```

- [ ] **Step 7.4: Commit**

```bash
git add docs/solid-remediation-decisions.md
git commit -m "docs: defer S6 usage provenance typing to WS7 (WS3b decision)"
```

**Effort:** 0.25 dev-day.
**Rollback:** `git revert <commit>` (docs only).
**Out of scope:** implementing the change (WS7), provider capability data (WS4), `ProviderProfile.usageSource` (conventions §3.3, already WS4's).
**Self-review:** the task ends with a decision, an ownership proof and an actionable WS7 hand-off, so it is not a placeholder. No source file, contract or event payload changes in this task, hence no behaviour-change evidence is required; the gateway's provenance derivation is asserted by `inference-gateway.test.ts` (both in T3b.3).

---

## Verification summary

| Check | Command | Expected |
| --- | --- | --- |
| Characterization snapshot | `node --import tsx --test experiment-worker/src/harness/scheduler.characterization.test.ts` | PASS; `git diff --exit-code experiment-worker/src/harness/__snapshots__` empty |
| Collaborator unit suites | `node --import tsx --test experiment-worker/src/harness/event-recorder.test.ts experiment-worker/src/harness/termination.test.ts experiment-worker/src/harness/inference-gateway.test.ts experiment-worker/src/harness/tool-admission.test.ts experiment-worker/src/harness/report-phase.test.ts experiment-worker/src/harness/scheduler.test.ts` | PASS |
| Worker suite | `npm run test --workspace @sidechannel/experiment-worker` | PASS |
| Types | `npm run check` | exit 0 |
| Lint + boundaries | `npm run lint && node scripts/verify-boundaries.mjs` | exit 0 |
| Full unit suite | `npm test` | PASS |
| Build / compiled | `npm run build && node scripts/verify-compiled.mjs` | PASS |
| Mongo integration | `docker compose up -d --wait mongo && npm run test:integration` | PASS |
| Migration equivalence | `node scripts/verify-migration-equivalence.mjs` | PASS |
| Fixture evidence | `npm run fixture && git diff --stat agent/examples/completed-fixture.json` | no semantic diff |
| Budget | `scheduler.test.ts` structural test + `wc -l experiment-worker/src/harness/scheduler.ts` | `run()` < 150 lines, file < 300 |

## Rollback

Every task is one commit (T3b.2 is two: Part A, Part B; T3b.0 exists only in Mode B and is skipped in Mode A). Rollback is `git revert <commit>` in reverse order; no database migration, no schema change and no persisted-value change is involved, so reverts are always safe. The characterization suite and both snapshot files are introduced only in T3b.1 and are never modified afterwards, so reverting any extraction cannot desynchronise the gate. If a snapshot diff appears, **revert the extraction commit** rather than regenerating the snapshot; regenerating is only legitimate in T3b.1 and would be a behaviour change requiring its own review. T3b.7 is a docs-only revert.

## Out of scope

- **WS2:** declaring `RunStateStore`/`EventLog` in `packages/contracts/src/harness/server.ts`, deleting `LegacySchedulerOptions` and `schedulerPorts()`'s legacy branch, flipping `runtime.ts` plus the eleven test/smoke constructions to the split ports, the worker guard/queue composition root, `mastra-adapter.ts`.
- **WS3c:** `AnalysisWorker` (lease/scheduling/budget/accounting), persistence `repository.ts` decomposition, `HealthcareService`, `domain/oversight/service.ts`.
- **WS4:** `ProviderProfile`/`ScenarioRegistry`, `inference-provider.ts`, provider settings policy, `token-budget.ts` policy, scenario initializers, `scripted-adapter.ts`/`healthcare-script.ts` content.
- **WS7:** run-status and event vocabulary tables, `SUMMARY_OMIT`/`toRunSummary`, canonical hashing, **S6 usage typing (deferred here by T3b.7)**.
- **Never:** the report acceptance predicate, prompt text, tool schemas, allowance semantics, `executeTool` behaviour, fingerprints, event names/payload keys, the terminal taxonomy, or the characterization snapshots.

## Self-review

- **Finding coverage:** S2 is closed by construction — `HarnessScheduler.run()` goes from 249 lines / thirteen responsibilities to an orchestration loop under 150 lines over five single-purpose collaborators, with one task and one commit per collaborator and a behavioural snapshot gating every step. S6 is analysed, gated against three explicit criteria, and deferred with an ownership proof and a WS7 implementation sketch. No other finding is claimed.
- **Placeholder scan:** every code-changing step shows complete file contents or an anchored move map (`scheduler.ts:line-range` → file/symbol) plus the exact commands. The only generated artefacts are the two snapshots, and T3b.1 specifies how they are produced, checked (determinism, normalisation, count, last event) and committed. No "similar to Task N", no TBD.
- **Type consistency:** `SchedulerPorts`/`RunStateStore`/`EventLog`/`schedulerPorts` (T3b.0) are the names used by every later task; `EventSink` is the single recorder surface consumed by termination, gateway, admission and report phase; `Inferencer` is what `ReportPhase` depends on and what `InferenceGateway` implements; `TurnState` is the `ended`/`reason` pair throughout; `modelInputFor` has one signature used by both the action loop and the report phase. `HarnessScheduler`'s constructor keeps accepting `SchedulerOptions` (union) so all twelve existing constructions still compile.
- **Behaviour-change statement:** none intended. Evidence, per task: `git diff --exit-code experiment-worker/src/harness/__snapshots__` (fixture and healthcare ordered event descriptors, counts, final status/reports/artifact) after every extraction; plus the pre-existing assertions that pin gateway and admission semantics (`token-budget.test.ts` 2 `context_accounted`/2 `model_usage`/`run.usage.inputTokens = 246`, `inference-provider.test.ts` `source = 'provider-reported'` and `usage.inputTokens = 28500`, `core.test.ts` 18 `tool_admitted`/12 `tool_unexecuted`/6 `tool_deduplicated`, one `report_missing`, zero `run_completed` on cancel) and the Mongo integration + fixture-export gates.
- **Known deviations recorded rather than hidden:** (1) T3b.0 is a fallback for starting before WS2: in the documented order WS2 T2.1 has already flipped the options and T3b.0 is skipped, and if T3b.0 does run then WS2 later deletes its union and local declarations. (2) In Mode B, `RunStateStore`/`EventLog` are declared locally in `scheduler.ts` and `event-recorder.ts` imports them type-only from `./scheduler.js`; WS2 moves them to contracts. (3) The artifact freeze (`scheduler.ts:204-209`) was moved with the report block rather than into termination, because it is contiguous with the report loop and belongs to the reporting phase. (4) `activeTurn` became a field on `RunTermination` rather than a parameter threaded through `terminate()`.
