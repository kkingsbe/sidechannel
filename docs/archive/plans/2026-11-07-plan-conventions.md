# Plan Conventions and Shared Interface Decisions

> **Purpose:** This file is the single source of truth for writing the per-workstream execution plans of the SOLID remediation program. Every workstream plan must follow it. It carries the conventions that the `writing-plans` skill requires plus the interface decisions that make independently written plans fit together.
>
> **Consumers:** the plan authors (agents) for WS2–WS7, and the executing engineers.
>
> **Baseline:** all nine plans were authored against `20bc219` by agents reading the tree at ~15:05 on 2026-11-07, after a concurrent session committed `5a31bf7` ("Initial smoke test prep"). That commit included source changes (healthcare service/API/dashboard smoke work), so the execution tree is post-commit; line anchors must be re-located by content (each task names symbols), not trusted numerically. One audit finding was resolved by that concurrent work before execution: the duplicated healthcare validation rules were removed from `api/src/healthcare/service.ts` (they live only in `packages/domain/src/harness/config.ts:128-138`); WS3c T3c.4 records this as already-true and adds a re-duplication guard, and WS4 T4.2 only removes the remaining scenario branch. No plan file was committed by the plan authors.

## 1. Required document format

Each workstream plan is a standalone markdown file at
`docs/archive/plans/YYYY-MM-DD-<ws>-<kebab-name>.md` with this header:

```markdown
# WS<N><letter> — <Name> Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence.]

**Architecture:** [2–3 sentences: approach, boundaries, what stays untouched.]

**Tech Stack:** [Exact versions/commands relevant to this workstream.]

## Global Constraints

[Copy section 2 of this file verbatim, plus any workstream-specific constraints.]
```

Then:

1. `## File structure` — table of files created/modified and their single responsibility.
2. `## Tasks` — numbered tasks (T<N>.<n>), each with:
   - `**Files:**` create/modify/test with exact paths (line anchors where known).
   - `**Interfaces:**` `Consumes:` previously defined exact signatures; `Produces:` exact signatures later tasks/plans rely on.
   - Steps as checkboxes, each one action (2–5 minutes):
     - `- [ ] **Step n: Write the failing test**` + complete test code
     - `- [ ] **Step n+1: Run the test to verify it fails**` + exact command + expected failure text
     - `- [ ] **Step n+2: Implement/minimal code** + complete code or exact move map
     - `- [ ] **Step n+3: Run the test to verify it passes** + command + expected result
     - `- [ ] **Step n+4: Commit**` + exact `git add`/`git commit`
3. `## Verification summary` — table of commands and expected results.
4. `## Rollback` — per-task revert strategy (no destructive DB migrations anywhere).
5. `## Out of scope` — what later workstreams own (prevents overlap).
6. `## Self-review` — coverage, placeholders, type consistency, behaviour-change statement.

**Hard rules**

- **No placeholders.** Never write "TBD", "TODO", "add appropriate error handling", "similar to Task N", or "write tests for the above". Every code-changing step shows the code or an exact, unambiguous move map (from `file:line-range` to `new/file:line`, plus the new signature).
- **Ground everything.** Read the actual source before citing lines or signatures. If a file differs from this document, trust the source and note the deviation in the plan's self-review.
- **Every task ends green.** No task may leave `npm run check`/`npm test` failing. Characterization tests come before structural moves.
- **TDD where testable.** Pure refactors that cannot be red-green tested use characterization tests plus explicit before/after assertions; say so.
- **Type consistency.** Names/signatures from section 3 are binding. Do not rename a shared interface inside one plan.
- **Plan authors do not modify source code or the program plan.** Write exactly one plan file.

## 2. Global constraints (copy into every plan)

- **No behavioural change** unless a task explicitly states the change and its evidence. Experiment scheduling, tool admission, budget accounting, evidence hashes, event types, statuses, API payloads and dashboard copy stay identical.
- **Every task ships tests.** Backend tasks also require the Mongo integration suite.
- **Verification (repo root):** `npm run lint`, `node scripts/verify-boundaries.mjs`, `npm run check`, `npm test`, `npm run build`, `npm run test:integration` (Mongo required), `node scripts/verify-compiled.mjs`, `node scripts/verify-migration-equivalence.mjs`.
- **Test runner facts:**
  - `scripts/test.mjs <dir>` collects `*.test.ts`; with `--mongo` it collects only `*.mongo.test.ts`. Helper modules must not end in `.test.ts`.
  - Tests under `tests/integration/` import workspace packages through their declared exports, which resolve to `dist/`. **Rebuild before running** (`npm run build`) or use the nx target (`node scripts/nx.mjs run @sidechannel/integration:test`).
  - Mongo URI comes from `TEST_MONGODB_URI`; local default `127.0.0.1:27018` (docker compose), CI uses `27017`. Never hardcode.
  - Unit tests use `node:test` + `assert/strict`; dashboard tests use vitest + Testing Library.
- **Boundary rules stay intact** (`eslint.config.mjs` layer tags, `scripts/verify-boundaries.mjs`). Services must not import services; dashboard imports only `@sidechannel/contracts/browser` / `testing`.
- **Run verification in a normal developer shell.** Nx targets fork child processes; a hardened agent sandbox that blocks process/pipe creation reports `Error: spawn EPERM` for every nx task (including `npm run lint`). That is an environment error, not a code failure — run the gates outside the sandbox or with host execution. Direct single-tool invocations (`npx eslint <dir>`, `node --import tsx --test <file>`) may still work for fast local loops.
- **Dependencies are frozen.** No upgrades.
- **No destructive DB migrations.** Changes are code + in-memory semantics; any Mongo change is query/return-value only and additive.
- **Characterization snapshots are evidence, not convenience.** `route-contract.snapshot.json`, scheduler event snapshots and fixture event sequences are never re-recorded to make a failing test pass. Re-recording requires a decision-log entry naming the behaviour delta and its cause; otherwise fix the code.
- **One task = one PR**, ≤ ~400 changed lines where possible, rebased on `main`.

## 3. Shared interface decisions (binding across plans)

These decisions are fixed so that independently authored plans compose. Use these names and signatures exactly.

### 3.1 Harness ports (WS2)

In `packages/contracts/src/harness/server.ts`:

```ts
export interface RunStateStore {
    getRun(id: string): Promise<Run | null>;
    saveRun(run: Run): Promise<void>;
    claimRun(runId: string, workerId: string): Promise<boolean>;
    /** Cooperative cancellation: the worker uses this on SIGINT/SIGTERM. */
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
    DEFAULT_WORKER_LEASE_MS: 30_000;
    acquireWorker(owner: string, leaseMs?: number): Promise<boolean>;
    heartbeatWorker(owner: string): Promise<boolean>;
    releaseWorker(owner: string): Promise<void>;
    workerLease(): Promise<WorkerLeaseRecord | null>;
}
```

> **Post-program integration (2026-11-07):** `main` moved seven commits while the program ran; the branch was merged with `main@48a2170` and the features re-expressed on this architecture. The `WorkerGuard` port is now the expiring single-worker lease (`DEFAULT_WORKER_LEASE_MS`, `heartbeatWorker`, `workerLease`) with takeover after heartbeat expiry and `interruptAbandonedRuns` on startup; the worker records the lease based `WorkerStatus` described below. `ProviderProfile` also gained the data-only adapter extension documented in §3.3. These are the executed shapes, and `docs/solid-remediation-decisions.md` §"Main integration" records the evidence deltas.
>
> **Second integration wave (2026-11-07):** `main` then advanced 28 more commits (live turn-aligned event timeline with SSE and turn paging, dashboard review fixes, codebook archive, Jev ordering/chart fixes, deployment update guards). Those were merged (`61e3332`) and ported, adding the wave-2 shapes: `EventQuery` gains `before`/`order` and `TurnSummary`; `EvidenceReader` gains `listTurns` and an optional `subscribeEvents` wake-up hint (polling stays the contract); `CodebookStore` gains `listCodebooks(page, filter)`/`setCodebookArchived` with `Codebook.archivedAt/archivedBy` and a write guard for archived codebooks; the API transport owns a raw-write SSE seam (`eventStreamRoute` + injectable timing) while JSON routes keep the handler contract; the dashboard's live hooks go through the WS5 requester/`EventSource` seam and typed clients gained codebook archive methods. The second-wave evidence record (route-contract +15 cases with none removed, extended adapter parity suites, unchanged scheduler/fixture/migration evidence) is in the decision log.

`HarnessScheduler` constructor options become
`{ runState: RunStateStore; events: EventLog; memory: PrivateMemory; adapter: ModelAdapter; scenario?: Scenario }`.
The worker entrypoint (`experiment-worker/src/main.ts`) depends on
`{ queue: RunQueue; guard: WorkerGuard; runState: RunStateStore; events: EventLog }`
and never on `MongoRepository`. `requestCancel` moved from the researcher-only port onto `RunStateStore` because the worker needs it to stop the active run on shutdown; `WorkerSupervisor` therefore only carries `workerStatus`.

In `packages/contracts/src/server/contracts.ts`:

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
export interface ResearcherRepository extends RunStateStore, EventLog, RunQueue, RunQueries, DraftStore, EvidenceReader, WorkerSupervisor {}
```

`WorkerStatus` is the typed interface already introduced by WS1:

```ts
export interface WorkerStatus {
    capacity: number;
    available: boolean;
    status: 'active' | 'stale' | 'stopped' | 'registered' | 'unknown';
    heartbeatAt?: string;
    startedAt?: string;
    note?: string;
}
```

Extension handlers take only the slice they use, e.g. `createHealthcareHandler(catalog: HealthcareCatalog, runs: Pick<RunStateStore, 'getRun'>)`.

### 3.2 Analysis ports (WS2)

In `packages/contracts/src/analysis/jev-repository.ts`:

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
export interface AnalysisRepository extends CodebookStore, JobLifecycleStore, WindowStore, ArtifactStore, ResultStore {}
```

`readyJob` is deleted in WS2 (it has zero callers).
`AnalysisService` takes the composed `AnalysisRepository` plus `Pick<Repository, 'getRun' | 'listEvents'>` (unchanged).
`AnalysisWorker` takes `JobLifecycleStore & WindowStore & ArtifactStore & ResultStore`.
Review routes take `Pick<AnalysisRepository, 'getJob' | 'getWindow' | 'listWindows' | 'listResults'>`.

### 3.3 Provider and scenario registries (WS4)

Domain stays provider-agnostic (no Mastra imports). In `packages/domain/src/providers/`:

```ts
export type TransportModel = string | { providerId: string; modelId: string; url: string; apiKey: string; api: 'responses' };
export interface ResolvedTransport {
    model: TransportModel;
    providerOptions: unknown;
    /** Adaption's Responses API needs item ids on replayed assistant text. */
    assistantTextItemIds?: boolean;
}

export interface ProviderProfile {
    readonly id: string;
    readonly label: string;
    /** Supported sampling controls, in display order. */
    readonly settings: readonly string[];
    /** Returns human-readable validation errors; empty means valid. */
    validateSettings(settings: Record<string, unknown>): string[];
    /** How the worker obtains a `ModelAdapter`; data, never a name check in call sites. */
    readonly adapterKind: 'mastra' | 'scripted' | 'embedded-playbook';
    /** Provider-specific model-id/settings validation run by the configuration validator. */
    validateModel?(config: ExperimentConfig): string[];
    resolveTransport(model: ExperimentConfig['model'], env: NodeJS.ProcessEnv): ResolvedTransport;
    readonly credentialEnv?: string;
    readonly usageSource: 'scripted' | 'provider-reported';
    readonly fixture: boolean;
}
export const PROVIDERS: Record<string, ProviderProfile>;
export function providerProfile(id: string): ProviderProfile;
export function providerCatalog(): { id: string; label: string; settings: string[]; fixture: boolean }[];
```

In `packages/domain/src/scenarios/`:

```ts
export interface ScenarioDescriptor {
    readonly version: string;
    readonly label: string;
    readonly fixture: boolean;
    readonly artifactSchemaVersion: string;
    readonly toolNames: readonly string[];
    readonly scenario: Scenario;
    readonly scriptedDriverId?: string;
    /** Returns validation errors for a configuration that selects this scenario. */
    validateConfiguration(config: ExperimentConfig): string[];
    /** Dashboard form/tab metadata. */
    readonly presentation: { title: string; tabs: readonly string[]; hasDatasetPreset: boolean };
}
export const SCENARIOS: Record<string, ScenarioDescriptor>;
export function scenarioDescriptor(version: string): ScenarioDescriptor | undefined;
export function scenarioCatalog(): { version: string; label: string; fixture: boolean; artifactSchemaVersion: string; presentation: ScenarioDescriptor['presentation'] }[];
```

API metadata endpoints (WS4 T4.3):

```ts
// GET /api/providers  -> { providers: ReturnType<typeof providerCatalog> }
// GET /api/scenarios  -> { scenarios: ReturnType<typeof scenarioCatalog> }
```

Dashboard consumes these in WS6 via `useApi` (WS5) — not in WS4.

### 3.4 Dashboard data access (WS5)

```ts
// dashboard/src/lib/transport.ts
export class ApiError extends Error { constructor(public status: number, message: string, public details?: unknown); }
export async function request<T>(path: string, options?: RequestInit): Promise<T>;

// dashboard/src/lib/api.ts
export interface PageRequestOptions { interval?: number; }
export function useApi<T>(path: string | null, options?: PageRequestOptions): {
    data: T | undefined; error: Error | undefined; loading: boolean;
    refresh: () => Promise<void>; updatedAt: number | undefined;
};
export function usePage<T>(path: string | null, options?: { interval?: number; cursorKey?: string; limit?: number }): {
    data: T[]; nextCursor: string | null; page: number; hasMore: boolean;
    loading: boolean; error: Error | undefined;
    onChange: (next: number) => void; refresh: () => Promise<void>;
};
export function useOffsetPage<T>(path: string | null, options?: { interval?: number; pageSize?: number }): {
    data: T[]; total: number; page: number; hasMore: boolean;
    loading: boolean; error: Error | undefined;
    onChange: (next: number) => void; refresh: () => Promise<void>;
};

// dashboard/src/lib/contracts.ts
export interface Page<T> { items: T[]; nextCursor: string | null; }
export interface OffsetPage<T> { items: T[]; total: number; nextOffset: number | null; }
export type ViewRegistry<TabId extends string> = Record<TabId, { title: string; description?: string; Component: ComponentType }>;

// dashboard/src/lib/clients/query.ts — ONE hook implementation, two adapters:
// (a) client/function-based (used by decomposed pages and by fake-client tests),
// (b) path-based convenience wrappers for pages not yet decomposed.
// Signatures below are binding (WS6 depends on them exactly).
export function useResource<T>(key: string | null, load: () => Promise<T>, options?: { interval?: number }): {
    data: T | undefined; error: Error | undefined; loading: boolean;
    refresh: () => Promise<void>; updatedAt: number | undefined;
};
export function useResourcePage<T>(
    key: string | null,
    load: (cursor: string | null) => Promise<Page<T>>,
    options?: { interval?: number; cursorKey?: string },
): {
    data: T[]; nextCursor: string | null; page: number; hasMore: boolean;
    loading: boolean; error: Error | undefined;
    onChange: (next: number) => void; refresh: () => Promise<void>;
};
export function useResourceOffsetPage<T>(
    key: string | null,
    load: (offset: number) => Promise<OffsetPage<T>>,
    options?: { interval?: number; pageSize?: number },
): {
    data: T[]; total: number; page: number; hasMore: boolean;
    loading: boolean; error: Error | undefined;
    onChange: (next: number) => void; refresh: () => Promise<void>;
};
```

`useApi`/`usePage`/`useOffsetPage` are thin path-based wrappers over the three hooks above (one implementation, no duplicated stale-path/pager logic). Decomposed pages (WS6) use the client-based hooks in `lib/clients/query.ts` so tests can inject fake clients; no test stubs global `fetch` after WS5. Mutations use the single `useMutation` in `lib/api.ts`; the `useCommand` name WS6 uses must be a thin wrapper/alias over it (same state machine), not a second implementation. `ApiClientProvider`/`useClients` expose six clients (experiments, runs, codebooks, analyses, monitor, reviews); `experimentsClient` may be registered by WS6 T6.1 if WS5 ships before it.

Clients (one object per resource; pages never build paths):

```ts
// dashboard/src/lib/clients/experiments.ts
export const experimentsClient: {
    defaultConfig(): Promise<ExperimentConfig>;
    schema(): Promise<ConfigurationSchema>;
    validate(config: unknown): Promise<ConfigValidation>;
    drafts(): Promise<Draft[]>;
    draft(id: string): Promise<Draft>;
    saveDraft(id: string, config: unknown, expectedRevision?: number, metadata?: DraftMetadata): Promise<Draft>;
    datasets(): Promise<DatasetCatalogItem[]>;
    datasetPreset(id: string, version: string): Promise<{ config: ExperimentConfig }>;
    launch(input: { config: unknown; idempotencyKey: string; pairingSeed?: number; sourceDraftId?: string; sourceDraftRevision?: number }): Promise<Run[]>;
    duplicate(source: 'draft' | 'run' | 'pair', id: string): Promise<Draft>;
};
// dashboard/src/lib/clients/runs.ts
export const runsClient: {
    list(query: RunListQuery): Promise<OffsetPage<RunSummary>>;
    get(id: string): Promise<Run>;
    progress(id: string): Promise<RunProgress>;
    events(id: string, query: EventQuery): Promise<Page<HarnessEvent>>;
    event(id: string, eventId: string): Promise<HarnessEvent>;
    evidence(id: string, kind: EvidenceKind, query: { offset: number; limit: number }): Promise<EvidencePage>;
    evidenceItem(id: string, kind: EvidenceKind, key: string): Promise<unknown>;
    board(id: string, query: { offset: number; limit: number; afterDelivery?: number }): Promise<BoardPage>;
    exportUrl(id: string): string;
    cancel(id: string): Promise<Run>;
    duplicate(id: string): Promise<Draft>;
};
// dashboard/src/lib/clients/codebooks.ts   -> CodebooksClient
// dashboard/src/lib/clients/analyses.ts    -> AnalysesClient (wraps the Jev adapter)
// dashboard/src/lib/clients/monitor.ts     -> MonitorClient
// dashboard/src/lib/clients/reviews.ts     -> ReviewsClient (window reviews + run-outcome reviews)
```

`ApiClientProvider` + `useClients()` (`dashboard/src/lib/clients/context.tsx`) expose all six clients (experiments, runs, codebooks, analyses, monitor, reviews) so pages and tests receive them by context; tests never stub global `fetch` after WS5.
Jev translation becomes stateless: `dashboard/src/lib/adapters/jev.ts` exports pure `translate(path, init)` → `{ path, init } | undefined` plus `createJevSession()` for the bounded caches; the session lives in the provider, not module scope.

### 3.5 Closed vocabularies (WS7)

```ts
// packages/contracts/src/harness/contracts.ts
export const RUN_STATUSES = ['queued', 'running', 'reporting', 'stopping', 'cancelled', 'completed', 'failed', 'interrupted'] as const;
export const TERMINAL_RUN_STATUSES: readonly RunStatus[];
export const ACTIVE_RUN_STATUSES: readonly RunStatus[];
export function isTerminalRun(status: RunStatus): boolean;

// packages/contracts/src/harness/repository.ts
export const EVIDENCE_KINDS = ['board', 'artifacts', 'reports'] as const;
export const EVIDENCE_KEY_FIELD: Record<EvidenceKind, 'id' | 'version' | 'agentId'>;

// packages/domain/src/oversight/projections.ts
export const MONITOR_VIEW_BUILDERS: Record<MonitorView, (…)=>Projection>;

// packages/domain/src/harness/repository.ts
export const SUMMARY_OMIT: readonly string[];
export function toRunSummary(run: Run): RunSummary;

// dashboard/src/lib/status.ts
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export const runStatusMeta: Record<RunStatus, { label: string; tone: Tone; group: 'active' | 'terminal' | 'attention' }>;
export const reviewDecisionMeta: Record<'present' | 'absent' | 'uncertain', { label: string; tone: Tone }>;
export const monitorStatusMeta: Record<string, { label: string; tone: Tone }>;
export const eventMeta: (event: HarnessEvent) => { label: string; tone: Tone; icon: IconName };
```

`Badge` in `dashboard/src/components/ui.tsx` becomes `Badge({ tone, children })`; status-to-tone translation lives in `status.ts` only.

### 3.6 Domain failure kinds (WS3a defines mapping, WS3c completes producers)

```ts
// packages/contracts/src/errors.ts  (transport-neutral)
export type FailureKind = 'invalid' | 'not-found' | 'conflict' | 'too-large' | 'unavailable';
export class DomainFailure extends Error { constructor(public kind: FailureKind, message: string); }
```

API mapping (WS3a): `invalid → 400`, `not-found → 404`, `conflict → 409`, `too-large → 413`, `unavailable → 503`; unknown errors → 400 (current behaviour) with no message-regex inference.
WS3c migrates domain throws to `DomainFailure`; until then WS3a's mapper also handles the legacy `OversightError`/`Analysis*` classes by their typed `status` property.

## 4. File ownership (avoid concurrent edits)| Workstream | Owns |
| --- | --- |
| WS2 | `packages/contracts/src/{harness/server,harness/contracts,server/contracts,analysis/*}.ts`; `packages/persistence/src/**`; `experiment-worker/src/main.ts`; `experiment-worker/src/harness/{runtime,mastra-adapter}.ts`; `analysis-worker/src/main.ts`, `analysis-worker/src/oversight/{provider,inference-provider}.ts`; `api/src/main.ts`; `api/src/routes/jev-extension.ts` |
| WS3a | `api/src/server/**`; `api/src/routes/**`; `api/src/main.ts` wiring; `packages/domain/src/pagination.ts`; `packages/domain/src/analysis/jev-reviews.ts` (typed throws + D5.1 rule); `api/src/healthcare/bootstrap.ts` route registration; `api/src/healthcare/service.ts` one-line `body: async () => ({})` compatibility edit; `packages/contracts/src/errors.ts`; `api/src/server/errors.ts` |
| WS3b | `experiment-worker/src/harness/{scheduler,event-recorder,inference-gateway,tool-admission,report-phase,termination}.ts` (+ their tests) |
| WS3c | `packages/domain/src/oversight/**`; `packages/persistence/src/harness/**`; `packages/domain/src/harness/launch.ts` (launch/pair invariants moved out of persistence); `api/src/healthcare/{service.ts,resolver.ts,provenance.ts}`; `analysis-worker/src/jev/{jev-worker.ts,lease-keeper.ts,window-runner.ts,progress-ledger.ts,usage-reconciler.ts}` |
| WS4 | `packages/domain/src/providers/**`; `packages/domain/src/scenarios/**`; `packages/domain/src/harness/{config,token-budget,scenario-initialization}.ts`; `api/src/server/adaption-models.ts`; `experiment-worker/src/harness/{inference-provider,scenario,healthcare-scenario,healthcare-script,runtime}.ts`; `analysis-worker/src/oversight/{inference-provider,model-adapter}.ts` |
| WS5 | `dashboard/src/lib/**`; `dashboard/src/components/ui.tsx` (only if a type is needed); page files for hook removal |
| WS6 | `dashboard/src/pages/**`; `dashboard/src/components/**` except shared `ui.tsx`; `dashboard/src/App.tsx` |
| WS7 | `packages/contracts/src/harness/contracts.ts`, `packages/contracts/src/harness/repository.ts`, `packages/domain/src/harness/repository.ts`, `packages/domain/src/oversight/projections.ts`, `packages/persistence/src/harness/**` (dispatch tables), `dashboard/src/lib/status.ts`, `dashboard/src/components/ui.tsx`, pages using `Badge` |

**Cross-plan ordering rules**

1. WS2 before WS3b (scheduler needs the split ports) and before WS3c (persistence split uses capability ports).
2. WS3a before WS5 Task 5.2 (typed clients depend on stable routes) and before WS4 T4.3 (metadata endpoints live in the router list).
3. WS4 backend before WS6 provider/scenario descriptor task; WS6 owns the dashboard wiring.
4. WS5 before WS6.
5. WS7 after WS3a/WS3b/WS3c/WS4/WS6.

**Sequential edits to shared files (later workstream rebases on the earlier one; never edit concurrently)**

| File | First | Then | Rule |
| --- | --- | --- | --- |
| `api/src/main.ts` | WS2 T2.5 (build repositories, inject adapters) | WS3a T3a.3 (final router wiring) | WS2 lands first; WS3a may reorganize wiring only after rebasing |
| `api/src/routes/jev-extension.ts` | WS2 T2.5 (inject adapters, delete auto-`initialize()`) | WS3a T3a.4 (unify handler contract) | WS2 first; WS3a consumes the injected ports |
| `api/src/healthcare/service.ts` | WS3a (one-line `body` compatibility edit only) | WS3c T3c.4 (split internals, delete duplicate rules) | WS3a must not change validation logic; WS3c owns internals |
| `packages/domain/src/analysis/jev-reviews.ts` | WS3a (typed `AnalysisValidation`/`AnalysisNotFound` throws + D5.1 one-source-event rule) | — | WS3a owns this file for X3; WS7 does not touch it |
| `experiment-worker/src/harness/runtime.ts` | WS2 T2.5 (TraceRuntime instance, injected adapters) | WS4 T4.2 (scenario/script selection via registry) | WS2 first; WS4 replaces only the selection block |
| `experiment-worker/src/harness/inference-provider.ts` | WS2 (adapters receive injected transport) | WS4 T4.1 (delete duplicate, import domain resolver) | WS4 deletes the file; WS2 must not depend on its internals |
| `analysis-worker/src/oversight/inference-provider.ts` | WS2 (inject adapter at composition root) | WS4 T4.1 (delete duplicate) | Same as above |
| `packages/contracts/src/harness/server.ts` | WS2 T2.1 (port split) | WS7 T7.3 (status constants) | WS2 lands first; WS7 only adds exports |
| `packages/persistence/src/harness/repository.ts` | WS2 + WS3c (split) | WS7 T7.2/T7.3 (projection/dispatch tables) | WS7 after WS3c |
| `experiment-worker/src/harness/scheduler.ts` | WS2 T2.1 (options/signature lines only) | WS3b T3b.2–T3b.6 (body extraction) | WS2 first; WS3b rebases on the new options |
| `api/src/routes/review-routes.ts` | WS2 T2.2/T2.3 (handler narrowing, type-only) | WS3a T3a.4/T3a.5 (route contract, error mapping) | WS2 first; WS3a owns the final shape |
| `api/src/routes/oversight.ts` | WS2 T2.2 (handler narrowing, type-only) | WS3a T3a.3/T3a.4 (router extraction) | WS2 first; WS3a owns the final shape |
| `packages/domain/src/oversight/**` | WS2 T2.2/T2.4 (type-only narrowing/cast removal) | WS3c T3c.2/T3c.5 (module split, failures) | WS2 first; WS3c owns bodies |
| `packages/contracts/src/analysis/store.ts` + `review-repository.ts` | WS2 T2.4 (typed ports) | WS3c T3c.2 (BlobStore addition) | WS3c rebases on typed ports |
| `packages/contracts/src/server/config-schema.ts` | WS4 T4.1 (`buildConfigurationSchema`) | WS6 (dashboard form metadata only) | WS4 owns the builder; payload must stay byte-identical |
| `dashboard/src/lib/**` | WS5 (data access) | WS6 and WS7 (page/status work) | WS5 first; later workstreams rebase |

## 5. Audit findings to cover (with evidence pointers)

Read `docs/archive/2026-11-07-solid-principles-audit.md` for the condensed audit and the relevant source files for current line numbers. Findings assigned to each plan:

- **WS2:** P10 (`AnalysisRepository` 28 methods; `ResearcherRepository` 20; `Repository` 7 but worker needs 3 more; zero-caller `readyJob`; store ports leak collection/partition/`Record<string, unknown>` and contracts imports zod), S8 (worker loop depends on concrete `MongoRepository`), S10 (`createMonitorProvider` dynamic import default; `createJevExtension` builds Mongo siblings and runs migrations; module-global `export let mastra` mutated per inference).
- **WS3a:** S1 (API server 237 lines, twelve responsibilities), X3 (HTTP status codes in domain; regex-on-message mapping in `review-routes.ts`), X4 (three route-handler contracts, three body parsers, synthetic `IncomingMessage`), X5 (eight page-collection loops).
- **WS3b:** S2 (`HarnessScheduler.run()` 249 lines, thirteen responsibilities), S6 (usage provenance untyped; include only if it fits without widening scope).
- **WS3c:** P1 (`domain/oversight/service.ts` ten responsibilities incl. Mongo chunking), P2 (`persistence/harness/repository.ts` twelve responsibilities, duplicated invariants), S9 (`AnalysisWorker` lease/scheduler/budget/accounting), S3 (`HealthcareService` four-in-one and duplicated validator rules), X3 completion (producers throw `DomainFailure`).
- **WS4:** X1 (provider settings policy in 9 sites / 7 files; already drifted), X2 (30 scenario literals / 14 files), S3 duplication half, D13 partial (zod runtime dependency in contracts moves to domain if feasible).
- **WS5:** F8 (2 fetch hooks + 4 pagers), F9 (non-substitutable hooks), F10 (URL-string transport + 5 raw anchors), F11 (`jev-transport` module caches + admission rules), F12 (fabricated `revision`/`archived`/limits; `Partial<Run>` progress merge), F16 (envelope sniffing / `arrayOf`), F13 (type dumps, `ReviewInput`).
- **WS6:** F1 (`Experiments` 1,050-line component), F2 (`AnalysisDetail`), F3 (`OversightSetup`), F4 (`AnalysisSetup`), F5 (`RunDetail`), F6 (`CodebookPage`), F7 (tab dispatch else-chains), F17 (App↔Runs cycle via `RunTable`), F18 (duplicated cancel/reviewer/review-row), F19 (hook-result props, CSS ownership), F14 dashboard wiring (provider/scenario descriptors), F13 leftovers.
- **WS7:** F15 (status vocabularies as strings; `Badge` fabricates statuses), P3 (closed-union literal arrays/ternaries), P4 (`RunSummary` definition four copies), X6 canonical hash half (gated migration), F13 dead exports if not done in WS0.

## 6. Effort and task sizing

- One task = 0.5–2 dev-days, independently reviewable and revertable.
- Each step = 2–5 minutes of work.
- Include an effort estimate per workstream in the `Architecture` block ("Estimated: N tasks, X–Y dev-days").
- Large mechanical decompositions (page splits, scheduler extraction) get one task per extracted collaborator, with the characterization/regression gate called out explicitly.

## 7. Reporting back to the Lead

Reply with ≤ 200 words:

```
Wrote: <path>
Tasks: <n> (<one-line list of task names>)
Effort: <x–y dev-days>
Key decisions/deviations from this sheet: <bullets>
Open questions or risks: <bullets>
```

Do not paste the plan into the reply. Do not modify source files, other plans, or the program plan.
