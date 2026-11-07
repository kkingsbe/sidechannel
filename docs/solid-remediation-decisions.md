# SOLID remediation decisions

This is the living decision log for the 2026-11-07 SOLID remediation program
([program plan](superpowers/plans/2026-11-07-solid-remediation-program.md),
[execution plans](superpowers/plans/2026-11-07-plan-conventions.md),
[audit report](../research/docs/2026-11-07-solid-audit-report.html),
[audit research record](../research/docs/2026-11-07-solid-principles-audit.md)).

It exists for three reasons:

1. every audit finding has one named owner workstream, so nothing silently drops;
2. every accepted deviation from the audit snapshot is written down with its
   cause, so a later reader can tell a deliberate decision from drift;
3. every behavioural decision made while executing the plans is recorded here,
   not re-recorded in a characterization fixture.

Status legend: `planned` (owned by an execution plan), `deferred` (moved to the
post-program backlog with rationale), `accepted` (won't fix, with rationale),
`done` (landed on `refactor/solid-remediation`).

## Baseline and measurement

Execution baseline: `5a31bf7` ("Initial smoke test prep"). The audit report was
measured on `20bc219`; `5a31bf7` added the smoke-test work and advanced the tree,
so line anchors are re-located by content and the measured censuses below can
differ slightly from the report. This is expected and is why the program plan
records both baselines.

Measured by `npm run architecture` (`scripts/architecture-budget.mjs` against
`scripts/architecture-budget.json`). Metrics are source files only
(`node_modules`, `dist`, `.nx`, docs and research excluded).

| Metric | Audit (20bc219) | Measured (5a31bf7) | Program target | Note |
| --- | --- | --- | --- | --- |
| Largest source file | 2,523 (`Analysis.tsx`) | 2,524 | < 500 | ±1 line; WS6 |
| Largest backend module | 264 (`scheduler.ts`, `persistence/repository.ts`) | 272 (`persistence/repository.ts`) | < 300 | tree advanced after the audit |
| Page files defining data hooks | 4 | 4 | 0 | >1000-line page entries that fetch; WS5/WS6 |
| Fetch-page implementations (dashboard) | 6 (2 hooks + 4 pagers) | 6 | 1 | WS5 |
| Provider-settings policy sites | 9 sites / 7 files | 10 sites / 9 files | 1 | +1 is the dashboard `Experiments.tsx` copy, owned by WS6 |
| Provider-name branch sites | 16 sites / 11 files | 20 sites / 14 files | 0 outside the registry | broader regex (includes dashboard/worker branches) |
| Scenario-version literal sites | 30 sites / 14 files | 30 sites / 14 files | ≤ 6 | reproduces the audit exactly |
| Byte-identical duplicated files | 2 | 2 | 0 | `inference-provider.ts` in two services |
| Status-vocabulary array sites | 8 (terminal subsets only) | 29 (all status arrays) | ≤ 6 | superset census; WS7 |
| `AnalysisRepository` members | 28 | 28 | ≤ 8 per capability port | WS2 |
| `ResearcherRepository` members | 20 | 13 declared + 7 inherited = 20 | composed type only | WS2 |
| Harness `Repository` members | 7 | 7 | split into 4 capability ports | WS2 |

`npm run architecture:check` fails when a budget in
`scripts/architecture-budget.json` is exceeded. Budgets are tightened by the
workstream that lowers a metric; they are never relaxed without an entry in the
decision log below.

## Finding ownership (all 45 findings)

Severity and titles are taken verbatim from the audit report.

| ID | Severity | Finding (short) | Owner | Status |
| --- | --- | --- | --- | --- |
| F1 | critical | Dashboard `Experiments` page: one 1,050-line component owns creation, validation, launch, drafts, recovery | WS6 T6.1 | planned |
| F2 | critical | Dashboard `AnalysisDetail`: 553-line component, 18 hooks, 10 endpoints, six views | WS6 T6.2 | planned |
| F3 | critical | Dashboard `OversightSetup` fuses monitor evaluation with human run-outcome adjudication | WS6 T6.3 | planned |
| F4 | high | Dashboard `AnalysisSetup`: 728-line component owns selection, form, preview, validation, launch | WS6 T6.4 | planned |
| F5 | high | Dashboard `RunDetail`: 692-line component owns polling, tabs, pagination, evidence, commands | WS6 T6.5 | planned |
| F6 | high | Dashboard `CodebookPage`: 16 `useState`, 5 `useEffect`, three validation paths | WS6 T6.6 | planned |
| F7 | high | Dashboard view dispatch is an else-chain with a silent fallback | WS6 T6.8 | planned |
| F8 | high | Two abstractions, six implementations of data hooks and pagers | WS5 T5.1 | done (`ce3664c`) — `fetchPageImplementations` 6→1 |
| F9 | high | The two data hooks and two pagers are not substitutable | WS5 T5.1/T5.2 | hook/pager unification done (`ce3664c`); client substitutability in T5.2 |
| F10 | high | The dashboard "port" is a URL string; five raw anchors bypass it | WS5 T5.2 | planned |
| F11 | high | `jev-transport.ts` is a stateful repository, policy layer and route table | WS5 T5.3 | planned |
| F12 | high | The adapter fabricates contract fields and invents constants | WS5 T5.3 | planned |
| F13 | high | Shared type modules are server-contract dumps; one review input serves two domains | WS0 (dead exports) / WS5 T5.5 / WS6 | planned |
| F14 | high | Provider/scenario capability rules hardcoded in 5–7 dashboard sites | WS4 T4.3 (metadata) / WS6 (wiring) | planned |
| F15 | medium | Domain vocabularies bypassed by strings; `Badge` invents statuses | WS7 T7.1 | planned |
| F16 | medium | No shared response-envelope contract; pages sniff payload shapes | WS5 T5.4 | planned |
| F17 | medium | App shell owns a domain table and forms an import cycle with the Runs page | WS6 T6.7 | planned |
| F18 | medium | The two largest pages duplicate cancel, review-history and reviewer-identity code | WS6 T6.7 | planned |
| F19 | low | Components take whole hook results as props; shared stylesheet imported by the wrong page | WS0 (unused imports) / WS6 T6.7 | planned |
| P1 | high | `domain/oversight/service.ts` has ten reasons to change, including Mongo storage layout | WS3c T3c.2 | done (`cf18026`) |
| P2 | high | Harness repository file is two adapters, a schema migration and copied domain invariants | WS3c T3c.1 | done (`058a180`) |
| P3 | high | Closed unions re-encoded as literal arrays and ternaries in 5–8 places | WS7 T7.3 | planned |
| P4 | medium | "Which Run fields are summary fields" is expressed four times | WS7 T7.2 | planned |
| P5 | high | The two harness repositories disagree about a missing run | WS1 Task 2 | done (`b169c1c`) |
| P6 | medium | `workerStatus(): Promise` unconstrained and returns different shapes | WS1 Task 3 | done (`c711a28`) — typed `WorkerStatus`; accepted note that registration is not a heartbeat |
| P7 | medium | Event-phase classification, claim lifecycle and list limits differ between adapters | WS1 Task 3/4 | done (`c711a28`, `5022462`) |
| P8 | high | In-memory analysis repository violates the port it implements | WS1 Task 6 | done (`5022462`) |
| P9 | medium | `ResearchStore` and `HealthcareCatalog` diverge on idempotent writes/integrity filtering | WS1 Task 7 | done (`2ec6118`) — `replace` revision-match semantics pinned; healthcare-catalog byte-level parity remains accepted |
| P10 | high | Ports fat for narrow consumers, thin for their client; store ports leak a document-store protocol | WS1 (parity) / WS2 T2.1–T2.4 | done (`e172b4a`, `52040ed`, `e46c85c`); see the `JobLifecycleStore` sizing decision below |
| S1 | high | API server module is transport, router, auth, parser, static host and launch service | WS3a T3a.2–T3a.3 | done (`29a4a6c`, `4320e5b`) |
| S2 | critical | `HarnessScheduler.run()` is a 249-line method with thirteen responsibilities | WS3b T3b.2–T3b.6 | done (`69f0653`) — `scheduler.ts` 98 lines, `run()` 74 lines |
| S3 | high | `HealthcareService` owns resolution, validation, provenance, routing, evaluation — and duplicated the validator | WS3c T3c.4 / WS4 T4.2 | planned (duplication already deleted at baseline; re-duplication guard added) |
| S4 | medium | Common-tool dispatch is a name if-chain with a duplicated argument allowlist | backlog | deferred (covered functionally by WS3b T3b.4 tool admission; the dispatch table itself is polish) |
| S5 | high | `ModelAdapter` implementations are not substitutable | WS2 T2.4 (inject the adapter) / WS4 T4.1 (shared transport policy) | partially done: adapters are injected and `createMonitorProvider` requires a `ModelAdapter` (`447239b`); transport-policy unification is WS4 |
| S6 | medium | Model-usage provenance is untyped and inferred from configuration | WS3b T3b.7 (gated) | deferred: typing `ModelResponse` provenance requires edits in WS2/WS4-owned contracts while keeping recorded `model_usage` payloads byte-identical |
| S7 | medium | `PrivateMemory` is specified by two signatures only; implementations disagree on semantics | backlog | deferred (no correctness bug observed; typing it is a separate contract change) |
| S8 | medium | The `Repository` port is too narrow for the worker loop and too wide for the scheduler | WS2 T2.3 | done (`e172b4a`) |
| S9 | high | `AnalysisWorker` is a lease manager, scheduler, retry-budget accountant and progress ledger | WS3c T3c.3 | done (`7dbf591`) |
| S10 | medium | Composition leaks into operations: concrete adapter built in a use case, global Mastra runtime mutated | WS2 T2.4 / WS0 T0.2 (orphan starter agent) | done (`447239b`; WS0 deleted the orphan starter agent) |
| X1 | high | Provider capability and model-settings policy restated in 9 places, already drifted | WS4 T4.1 | planned |
| X2 | high | Scenario selection by version string repeated across every tier | WS4 T4.2 | planned |
| X3 | high | Domain layer encodes HTTP status codes; API guesses meaning from error message text | WS3a T3a.5 (mapper) / WS3c T3c.5 (producers) | review routes done (`b9d7ecf`); producer completion in WS3c T3c.5 |
| X4 | high | Three competing route-handler contracts, three body parsers, synthetic `IncomingMessage` | WS3a T3a.4 | done (`8f3436c`) |
| X5 | medium | Generic "read every page" logic reimplemented eight times | WS3a T3a.6 | done (`6b73807`) |
| X6 | medium | Two canonical-JSON hash families in five copies produce different digests | WS1 Task 1 (de-duplicate, byte-identical) / WS7 T7.4 (canonical, versioned) | de-duplication done (`37085bd`); canonical ordering deferred |

## Decision log

Program-level decisions (from the program plan Appendices B and D) and the
decisions made while executing:

| Date | Decision | Rationale | Owner |
| --- | --- | --- | --- |
| 2026-11-07 | Contract suites live in `tests/integration/` and run memory-only under `npm test`, memory+Mongo under `npm run test:integration` | Avoids shipping test helpers in production packages while keeping fast feedback and CI parity | Lead |
| 2026-11-07 | Hashing de-duplicated with byte-identical output first; canonical ordering versioned later | Persisted identity keys (launch, review, preview) must not silently change | Lead |
| 2026-11-07 | No destructive DB migrations in WS0–WS6 | Rollback stays `git revert`-only | Lead |
| 2026-11-07 | WS3 is split into WS3a (API), WS3b (scheduler), WS3c (domain/persistence/workers) | Each is independently executable and revertable; characterization tests stay close to the code they protect | Lead |
| 2026-11-07 | Binding interface decisions and file-ownership/sequencing rules live in `2026-11-07-plan-conventions.md` | Independently written plans must compose; shared-file edits are ordered, not concurrent | Lead |
| 2026-11-07 | F14 is split: WS4 provides metadata, WS6 wires the dashboard | Avoids two workstreams editing the same dashboard components | Lead |
| 2026-11-07 | `createPair` is on `RunQueue`; `requestCancel` is on `RunStateStore` | The worker loop cancels the active run on shutdown and the API cancels via the same operation; one port owns run-state mutation | Lead |
| 2026-11-07 | Dashboard reads use ONE implementation (`useResource`/`useResourcePage`/`useResourceOffsetPage` in `lib/clients/query.ts`) with path-based wrappers; six typed clients incl. `experimentsClient`; fake clients injected via `ApiClientProvider` | Client-parameterised hooks let WS6 render views from fixtures and delete global-fetch stubbing | Lead |
| 2026-11-07 | Characterization baselines never silently regenerate committed evidence (`agent/examples/completed-fixture.json`) | The committed export is a research artifact; rewriting it to make a test green would hide evidence drift | Lead |
| 2026-11-07 | X3 ownership: WS3a types the 24 `Error` throws in `packages/domain/src/analysis/jev-reviews.ts` and adds D5.1; WS3c owns oversight/analysis-service producers | Closes X3 without a fourth workstream; the file was unowned in the original layout | Lead |
| 2026-11-07 | D5.1 accepted; D5.3 approved | D5.1 keeps the dashboard's exact refusal message after moving the rule server-side; D5.3 removes a fifth `RunSummary` declaration for one export line | Lead |
| 2026-11-07 | WS3a's two route-contract deltas are accepted: review body 1–2 MB now returns 413 (was 400), and unread malformed bodies no longer force 400 | Both follow from one lazy body reader with per-route limits; both are pinned by tests and the route-contract snapshot is otherwise identical | Lead |
| 2026-11-07 | WS3c's single status change is accepted: two preview-integrity failures move `500 → 503` (`unavailable`) | Genuine unavailability/conflict conditions; no test asserts 500; the mapper vocabulary has no 500 kind | Lead |
| 2026-11-07 | Healthcare duplication (S3) is already resolved at the execution baseline; WS3c adds a re-duplication guard instead of a deletion, and WS4 T4.2 drops the API-side deletion | A concurrent session removed `HealthcareService.configurationErrors` after the audit | Lead |
| 2026-11-07 (WS0) | Architecture censuses are defined in `scripts/architecture-budget.mjs` and documented in `scripts/architecture-budget.json`; the audit report does not publish its scanner, so definitions are explicit and deviations from the report are recorded in the baseline table above | A guardrail that cannot be reproduced is not a guardrail | Lead |
| 2026-11-07 (WS0) | Budgets are ceilings: `max` is enforced now, `target` is the program-end value. A budget is only raised with an entry here | Prevents silently relaxing a guardrail to make a PR green | Lead |
| 2026-11-07 (WS0) | T0.2 does **not** delete `readyJob`; that deletion is WS2 T2.2 | WS1 T2 adds contract tests around the method before WS2 removes it; deleting it first would delete the test target | Lead |
| 2026-11-07 (WS0) | The ban on `fetch(` outside `dashboard/src/lib/**` excludes `*.test.ts(x)`: a test that asserts a request was not made must inspect the fetch mock | The rule protects the production transport seam, not test introspection; WS5 removes global-fetch stubbing | Lead |
| 2026-11-07 (WS0) | The half-wired `kind@schemaVersion` artifact-renderer key is deleted together with the unused `schemaVersion` prop; renderer lookup is keyed by scenario version only | The fallback key was never registered, so rendering is byte-identical; keeping an unused prop would preserve dead wiring | Lead |
| 2026-11-07 (WS1) | Contract suites live in `tests/integration/contracts/` (`harness-repository`, `analysis-repository`, `research-store`) with a memory entry (`port-contracts.test.ts`, runs under `npm test`) and a Mongo entry (`port-contracts.mongo.test.ts`, runs under `npm run test:integration`); `npm run test:contracts` runs the memory suites on demand | One assertion set proves the two adapters interchangeable; no test helper is exported from a production package | WS1 |
| 2026-11-07 (WS1) | Agreed port semantics fixed by the suites: unknown run yields `{ items: [], total: 0 }` evidence pages and null items/summaries; event phase classification is report-first; `listEvents` clamps requests to 10,000; `updateWindow` on a missing window is a lease-checked no-op; analysis attempts enforce the 1 MiB metadata bound before writing; `resultsForWindows` caps at 50,000; `ResearchStore.replace` reports the matched revision (not the modified count) | These are the behaviours the audit (P5, P7, P8, P9) found divergent; the suites are now the source of truth and later workstreams must not re-invent them | WS1 |
| 2026-11-07 (WS1) | Canonical (sorted-key) hashing stays deferred to WS7 T7.4; WS1 only de-duplicates the five helpers into `jsonHash` (insertion-order, byte-identical) and `canonicalHash` (sorted keys, byte-identical to the old `snapshotHash`) | Persisted identity hashes (`configHash`, review keys, previews, launch keys) must not change without a versioned migration | WS1 |
| 2026-11-07 (WS1) | `packages/domain` does not gain a `./hashing` package export in WS1; `hashing.ts` is imported relatively inside the domain package until WS7 T7.4 needs the public subpath | Keeps the change inside one package; adding an export is a WS7 concern | WS1 |
| 2026-11-07 (WS1) | **Evidence drift is pre-existing at the baseline.** The committed `agent/examples/completed-fixture.json` holds 103 events; a scripted fixture run on the baseline `5a31bf7` code emits the same sequence plus 20 `context_accounted`/`model_usage` events (123). The file is **not** regenerated | Program rule: characterization evidence is never rewritten to make a gate green. The drift predates the remediation and is recorded here; evidence gates compare generated runs against the WS3b characterization snapshot, and a later task may only regenerate the export with an explicit decision entry naming the delta | WS1 |
| 2026-11-07 (WS1) | `npm run fixture` is blocked in this environment by a stale `worker_guard` document in the shared `sidechannel` database (the compose stack's experiment worker may own it); baseline verification used an ephemeral database instead | Deleting a live worker guard could admit two workers; the gate is reproducible on a clean database and the docker stack is not part of this program | WS1 |
| 2026-11-07 (WS3b) | Scheduler characterization snapshots (`experiment-worker/src/harness/__snapshots__/scheduler-{fixture,healthcare}.txt`) are committed **before** WS2 changes the scheduler constructor (WS3b T3b.1, commit `dc40629`); the two `new HarnessScheduler(...)` lines carry `// Rebase point (WS2 T2.1)` comments and WS2 may rewrite only those lines, proving zero snapshot diff | The snapshot is the evidence budget for the scheduler decomposition; it must exist before the constructor moves | WS3b |
| 2026-11-07 (WS3b) | Snapshot comparison normalises CRLF to LF before comparing | The repository is checked out with `core.autocrlf=true` on Windows; the gate must compare event content, not checkout encoding | WS3b |
| 2026-11-07 (WS2) | Harness/Researcher/Analysis ports are composed capability slices; `HarnessScheduler` takes `{ runState, events, memory, adapter, scenario? }`; the worker loop takes `queue`/`guard`/`runState`/`events`/`scheduler`/`flush` and names no adapter; `readyJob` deleted | Ports sized to consumers; the WS1-recorded 103→123 fixture drift is pinned on current code by `ports.characterization.test.ts` and the committed export stays untouched | WS2 |
| 2026-11-07 (WS2) | Store ports typed: `ResearchCollection` union (incl. synthetic `'records'` used only by the adapter contract suite), `ResearchFilter` scalars, generic `ReviewStore`/`ReviewRow<T>`, `previewPartKey`/`reviewRevisionKey`, `AnalysisAttempt.usage?: ProviderUsage`; domain key-building and downcasts removed | Keeps the WS1 suite unmodified while rejecting arbitrary collection strings; physical key layout moves to adapters | WS2 |
| 2026-11-07 (WS2) | Composition roots: `api/src/main.ts` builds/initializes Mongo analysis+review stores; `createMonitorProvider(adapter)` requires injection; `openTraceRuntime()` returns an injected `TraceRuntime`; `export let mastra` removed. `studio`/`build:studio`/`start:studio` may no longer discover a Mastra instance and are deliberately not fixed | Those targets are developer conveniences, not gates; composition correctness is pinned by `scripts/verify-composition.mjs` | WS2 |
| 2026-11-07 (WS2) | `scripts/verify-composition.mjs` is part of `npm run verify`; `persistence/harness/repository.ts` is 295 lines (budget 300) after the in-memory worker guard | Pins no concrete adapters in worker/routes, no lazy monitor import, no mutable Mastra global, one zod module in contracts | WS2 |
| 2026-11-07 (WS2) | The program KPI "≤ 8 members per capability port" is restated as "no capability port exposes storage layout; each is sized to its consumer". `JobLifecycleStore` has 10 cohesive members (reserve/get/list/listAll/claim/heartbeat/updateCounters/finishJob/cancel/retry) and is the documented bound by conventions §3.2 | Splitting the fenced-lease state machine into a second port would recreate the fat-port problem it solves; the audit finding (P10) was about narrow consumers and leaked storage, both closed | WS2 |
| 2026-11-07 (WS3a) | T3a.4 executed before T3a.3 — routers call `request.body()` and the contract flip is a compile prerequisite; the only task-order deviation | The plan's ordering leaves `npm run check` red between the two tasks; ordering by compile dependency keeps every task green | WS3a |
| 2026-11-07 (WS3a) | The lazy body reader unifies two message-only strings at unchanged statuses: malformed review POST bodies now say "Expected a JSON object" and the Jev 2 MB cap says "Request exceeds 2 MB"; the accepted "unread malformed body no longer forces 400" delta is pinned in `api/src/server/failures.test.ts` | Statuses and payload shapes are unchanged; only human-readable messages moved to one reader, and the delta the decision log predicted is now tested | WS3a |
| 2026-11-07 (WS3a) | X3 closed for review routes by typing the 24 `Error` throws in `packages/domain/src/analysis/jev-reviews.ts`; mapped statuses equal the removed regexes. Edge delta: a concurrent review-insert race (store duplicate-key error, formerly regex-mapped to 409) now returns 400 | Untested client edge; typing the store layer is deferred rather than guessed. The statuses for every tested path are unchanged | WS3a |
| 2026-11-07 (WS3a) | D5.1 one-source-event rule lives in `ReviewService.save` with the refusal message byte-identical to `dashboard/src/lib/jev-transport.ts:36`; WS5 T5.3 deletes the client-side rule with no behaviour change | Rule ownership moves to the server without changing observable behaviour | WS3a |
| 2026-11-07 (WS3a) | `jev-service.pages()` stays as a delegation wrapper over `iteratePages(fetch, 100)`; the plan's limit test expected three pages for a 4-item store and was corrected to 5 items | Helper semantics unchanged; the plan's fixture arithmetic was wrong, not the code | WS3a |
| 2026-11-07 (WS3b) | **S6 usage provenance typing (T3b.7) deferred to the post-program backlog.** `ModelResponse.usage` is declared in `packages/contracts/src/harness/server.ts` and produced by `MastraModelAdapter`/`ScriptedAdapter` — all WS2/WS4 files, so an adapter-declared `source` cannot be added as an isolated WS3b change. `model_usage.source` remains derived in `InferenceGateway` (`scripted`/`provider-reported`/`unavailable`) and every recorded payload is unchanged. WS7 input: add `Usage`/`usageSource?` to `ModelResponse`, have adapters declare it, keep both characterization snapshots and recorded payloads byte-identical | The typing requires cross-workstream contract edits for a medium finding; deferring keeps WS3b revertable and evidence untouched | WS3b |
| 2026-11-07 (WS3b) | The scheduler's structural budget is pinned by a unit test: `scheduler.ts` < 300 lines and `run()` < 150 lines, plus the characterization snapshot gate | Turns the audit's S2 target into a mechanical guard rather than a review promise | WS3b |
| 2026-11-07 (WS5) | One dashboard read implementation (`lib/clients/query.ts`), one transport (`lib/transport.ts`), path-keyed `useApi`/`usePage`/`useOffsetPage` as thin wrappers; `lib/paging.ts` and all six page-local hook/pager implementations deleted. Legacy `api`/`rawApi`/`post`/`arrayOf` retained until T5.2 so responses stay byte-identical | F8/F9 closed without a big-bang transport switch; pages migrate per-client in T5.2 | WS5 |
| 2026-11-07 (WS5) | The Runs events tab keeps a page-local `useResourcePage` shim that normalizes `{events, nextCursor, hasMore}` to `Page<T>`; evidence tabs use `useResourceOffsetPage` plus a payload ref so board `reporting`/`deliveries` extras survive. `useApi` now clears data on path change (the F9 delta the hook test pins) | The server's events `nextCursor` is never null (only `hasMore` ends the list), so a naive pager would loop; the shim is the documented seam until the envelope is typed in T5.4 | WS5 |
| 2026-11-07 (WS5) | Rendered copy is byte-identical, including Codebook's "Load more codebooks", "Previous revisions" and "Next revisions", now driven by `usePage` state | "No UI change" is a program constraint; only the implementation moves | WS5 |
| 2026-11-07 (WS5) | **Pre-existing finding, preserved:** `datasetExportUrl` targets `/api/analyses/:id/export?dataset=…`, which is not a registered route (the real export is `/api/jev/analyses/:id/export`), so that dashboard link 404s at the baseline. WS5 preserves it and does not fix it | Behaviour preservation outranks opportunistic fixes during the remediation; recorded here for the post-program backlog | WS5 |
| 2026-11-07 (WS3c) | Frozen monitor previews are stored through `BlobStore` (`packages/contracts/src/oversight/blob-store.ts`), implemented by `ResearchBlobStore` in persistence. Part rows, the 250 000-character chunk size and the `contentHash` formula are unchanged, so previews written before the refactor still verify | The P1 Mongo-chunking concern leaves the domain without changing any stored bytes; the WS1 contract suite plus three blob-store tests prove parity | WS3c |
| 2026-11-07 (WS3c) | Launch-idempotency and matched-pair invariants live in `packages/domain/src/harness/launch.ts`; adapters call them and throw nothing of their own for those rules. During T3c.1 they still throw `RepositoryConflict`; T3c.5 re-kinds them | One owner for the invariants the persistence split duplicated (P2) | WS3c |
| 2026-11-07 (WS3c) | `AnalysisWorker` composes `LeaseKeeper`, `WindowRunner`, `ProgressLedger` and `UsageReconciler`; its constructor and `runOnce` contract are unchanged (class 59 lines). `LeaseKeeper` takes the narrow `LeasePorts` (heartbeat; `getJob` narrowed to `Pick<AnalysisJob,'id'\|'cancelRequested'>`) | S9 closes without touching the worker's external contract; the narrow port keeps test fakes honest | WS3c |
| 2026-11-07 (WS4) | `packages/domain/src/providers/settings.ts` is the single definition of the supported sampling controls; `ADAPTION_SETTINGS` is a projection of `GENERIC_SETTINGS`, never a second allowlist. Provider-settings policy census: **10 sites / 9 files → 2 sites / 2 files** (`packages/domain/src/providers/settings.ts:6` plus the WS6-owned dashboard copy `dashboard/src/pages/Experiments.tsx:77`); the architecture-budget target of 1 site is reached when WS6 removes the dashboard copy. Baseline sites: `packages/contracts/src/server/config-schema.ts:11`, `packages/domain/src/harness/config.ts:105,120`, `packages/domain/src/harness/token-budget.ts:39`, `api/src/server/adaption-models.ts:22`, both byte-identical `inference-provider.ts:18` copies, `experiment-worker/src/harness/mastra-adapter.ts:41`, `analysis-worker/src/oversight/model-adapter.ts:25`, `dashboard/src/pages/Experiments.tsx:76` | X1 closes with one owner; the remaining dashboard occurrence is sequenced to WS6, so no consumer restates the list | WS4 |
| 2026-11-07 (WS4) | `packages/domain/src/scenarios/` is the single install set: per-version validator, tool allowlist, initializer, artifact schema, scripted driver and presentation metadata. Scenario-version literal census: **30 sites / 14 files → 25 sites / 13 files** under the architecture definition (dashboard remainder = WS6; worker/domain entries are registry wiring that references the contracts constant). The WS4 duplication guard (dashboard excluded) proves exactly **3 files** carry the installed-version literals: `packages/contracts/src/healthcare/contracts.ts`, `packages/contracts/src/testing.ts` (accepted browser DTO copy) and `packages/domain/src/scenarios/fixture.ts` | X2 closes for backend production code with one policy owner; the two accepted exceptions are documented rather than silently scanned away | WS4 |
| 2026-11-07 (WS4) | `api/src/healthcare/**` was not edited by T4.2 (Lead decision): the duplicated validator rules were already removed before execution, so only the scenario branch needed moving. Dataset preparation is now keyed by `healthcareDescriptor.version` in `api/src/server/configuration.ts`; `HealthcareService` keeps its `HEALTHCARE_SCENARIO_VERSION` guards (constant references, not literal copies) | Keeps the WS3c-owned API healthcare files out of this workstream; the dataset-unavailable field error stays byte-identical | WS4 |
| 2026-11-07 (WS4) | `providerCatalog()` is derived from `PROVIDERS` minus the fallback identity (`generic`) and `scenarioCatalog()` from `SCENARIOS`; `runtimePlugins()` keys scripted drivers by `descriptor.scriptedDriverId ?? FIXTURE_SCENARIO_VERSION`. The fixture descriptor deliberately omits `scriptedDriverId`, because adding one would newly reject `provider: 'scripted'` runs whose model id is not the fixture version | A test-only provider/scenario registration appears in both catalogs and flows through validation, launch and runtime selection with zero production edits — the OCP proof in `tests/integration/provider-registry.test.ts` (red/green guard evidence in the WS4 PR: adding `presencePenalty` to `adaption-models.ts` failed the census with both file paths listed) | WS4 |
| 2026-11-07 (WS4) | Byte-identical duplicate resolver (SHA-256 `3100B349…D890C33`, 1659 bytes) collapsed: the analysis-worker copy is deleted and the experiment-worker copy is a Mastra-cast delegator to `@sidechannel/domain/providers` that keeps `adaptionBaseUrl` exported for `live-smoke.ts`. `byteIdenticalDuplicateFiles` census: **2 → 0** | S5's shared transport policy is now a single implementation with no service-to-service import; the recorded host-only cast remains at the SDK edge | WS4 |
| 2026-11-07 (WS4) | The config form schema is a pure `buildConfigurationSchema(settings)` in `packages/contracts` bound in `packages/domain/src/harness/configuration-schema.ts` (contracts must not import domain), and the browser metadata DTOs mark `presentation.tabs` readonly because `ScenarioDescriptor.presentation` stays `readonly string[]` per conventions §3.3. `/api/config/schema` is byte-identical before/after: **5313 bytes, sha256 `25bba8b4d83eaebfab7c7c6474cd746fccb2fc4b96ad2f52312471958671151c`** | Payload stability is proven, not assumed; the DTO readonly marker changes no serialized byte while keeping the binding domain type | WS4 |
| 2026-11-07 (WS4) | Plan deviations recorded: T4.1's fixture-literal/descriptor edits in `harness/config.ts` moved to T4.2 (they depend on the scenario module); the OCP test needed a catalog derivation and a scripted-driver fallback as above (the plan's literal `scriptedDriver(descriptor.version)` throws for a registered test scenario); the plan's T4.1 unit expectation `seed must be finite` for `{ seed: 1.5 }` was corrected to the historical `provider seed must be integer`, and its healthcare role-error expectation was corrected because the shipped fixture roles already use a subset of the healthcare tool list | Each correction preserves the pre-WS4 observable behaviour; the plan's fixture arithmetic was wrong, not the code | WS4 |

## Verification gates

Per-PR: `npm run lint`, `node scripts/verify-boundaries.mjs`, `npm run check`,
`npm test`, `npm run architecture:check`; backend PRs also
`npm run test:integration`; affected PRs also `npm run build` and
`node scripts/verify-compiled.mjs`.

Per-workstream: `npm run verify`, `node scripts/verify-migration-equivalence.mjs`,
fixture export comparison (`agent/examples/completed-fixture.json` semantics:
event types/order, report parsing, final artifact), dashboard smoke
(`npm run smoke:dashboard`), Jev smoke (`npm run smoke:jev`).

Definition of done for the program is in the
[program plan §9](superpowers/plans/2026-11-07-solid-remediation-program.md)
and is tracked there; this file only records decisions made while executing it.

## WS4 → WS6 dashboard hand-off (2026-11-07)

Two read endpoints, both `GET`, both credential-free, both stable for one release:

`GET /api/providers` → `{ providers: { id, label, settings: string[], fixture: boolean }[] }`
`GET /api/scenarios` → `{ scenarios: { version, label, fixture, artifactSchemaVersion, presentation: { title, tabs: string[], hasDatasetPreset: boolean } }[] }`

Types: `ProviderMetadata`, `ProviderCatalogResponse`, `ScenarioMetadata`, `ScenarioCatalogResponse`, `ScenarioPresentationMetadata` in `@sidechannel/contracts/server/metadata`, re-exported from `@sidechannel/contracts/browser` (`tabs` is readonly in the DTO; the serialized JSON is a normal array). Field-by-field consumption (WS6 owns every edit below; WS4 ships none of them):

| Dashboard site (measured at WS4 HEAD) | Today | Replace with |
| --- | --- | --- |
| `components/model-controls.tsx:56-57` hardcoded `<option value="scripted">` / `adaption` | two literals | `providers.map(p => <option value={p.id}>{p.label}</option>)`; keep the "preserve unknown provider" fallback at `:58-62` unchanged |
| `components/model-controls.tsx:40-41` phase auto-switch on `provider === "scripted"` | provider name check | `providers.find(p => p.id === provider)?.fixture ? "development" : "pilot"` |
| `components/model-controls.tsx:46-48` `id: provider === "scripted" ? "healthcare-points-v0.3" : ""` | scenario literal | leave `model.id` blank until a dataset preset is applied; the healthcare default comes from the selected scenario (`scenarios.find(s => s.presentation.hasDatasetPreset)`) |
| `components/model-controls.tsx:65` and `:109-113` scripted helper copy | shown for non-adaption | shown when the selected provider has `fixture: true` |
| `components/model-controls.tsx:16` `useApi("/models/adaption")` | provider literal in the path | keep for non-fixture providers until a per-provider catalog path exists (open question 1); WS4 does not add one |
| `components/budget-summary.tsx:23` `config.model.provider === "scripted"` → "Scripted driver — no provider context" | provider name check | `providers.find(p => p.id === config.model.provider)?.fixture` |
| `pages/Experiments.tsx:71-79` `supportedSettings` literal | 7-key literal | `providers.find(p => p.id === config.model.provider)?.settings ?? []` (falls back to the union for unknown providers) |
| `pages/Experiments.tsx:61-70` `tools` literal | 8 fixture tool names | `scenarios.find(s => s.version === config.scenario.version)?.toolNames` — **requires** `toolNames` in the payload; see open question 2 |
| `pages/Experiments.tsx:652,689` `config.scenario.version !== "healthcare-points-v0.3"` | version check | `!descriptor.presentation.hasDatasetPreset` using the descriptor for `config.scenario.version` |
| `pages/Experiments.tsx:761` `=== "healthcare-points-v0.3" ? <ModelControls/> : …` | version check | `descriptor.presentation.hasDatasetPreset` |
| `pages/Experiments.tsx:1038` raw `config.scenario.version` label | raw version | `descriptor.label` (fall back to the raw version when unknown) |
| `pages/Runs.tsx:463` conditional `results` tab | version check | `descriptor.presentation.tabs` — render the tab strip from the array, appending the `results` tab only when present |
| `App.tsx:30` `run.config?.model?.provider === 'scripted'` fixture badge | provider name check | `providers.find(p => p.id === run.config?.model?.provider)?.fixture` |
| `components/healthcare-preset.tsx:19` `scenario.version === "healthcare-points-v0.3"` | version check | `descriptor.presentation.hasDatasetPreset` (the preset form only renders when a dataset preset exists) |
| `components/artifact-view.tsx:7` `"healthcare-points-v0.3": HealthcareArtifact` map | version key | `descriptor.artifactSchemaVersion`, i.e. key the renderer map by artifact schema version instead of scenario version |
| `lib/types.ts` re-exports | n/a | re-export `ProviderMetadata`, `ScenarioMetadata`, `ScenarioPresentationMetadata` from `@sidechannel/contracts/browser` |

**Not in the payloads, and therefore not yet expressible (WS6 must keep a literal or ask for a contract change):**

1. Which path serves a provider's live model catalog. WS6 keeps the `/models/adaption` call for non-fixture providers. Adding `modelCatalogPath?: string` to `ProviderMetadata` is additive and the recommended follow-up (WS6 + a contract change, one PR).
2. `toolNames` is present on the domain descriptor but **not** in `scenarioCatalog()`, because the conventions-pinned payload is `{ version, label, fixture, artifactSchemaVersion, presentation }`. If WS6 needs the tool list for the roles editor, the additive fix is `presentation.toolNames` (single PR across contracts + domain + dashboard).
3. Per-scenario dataset identifiers. `presentation.hasDatasetPreset` tells the form whether a dataset preset exists; the actual list still comes from `GET /api/datasets`.
