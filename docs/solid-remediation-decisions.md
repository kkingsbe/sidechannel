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

| Metric | Audit (20bc219) | Baseline (5a31bf7) | **Final (branch head)** | Program target | Note |
| --- | --- | --- | --- | --- | --- |
| Largest source file | 2,523 (`Analysis.tsx`) | 2,524 | **431** (`window-inspector.tsx`) | < 500 | WS6 closed the 2,524-line page; every page is now a router shell (largest page 149) |
| Largest page file | 2,523 (`Analysis.tsx`) | 2,524 | **149** (`Codebook.tsx`) | < 500 | WS6 |
| Largest backend module | 264 (`scheduler.ts`, `persistence/repository.ts`) | 272 | **242** | < 300 | WS3b `scheduler.ts` 98; WS3c persistence/oversight splits |
| Page files defining data hooks | 4 | 4 | **0** | 0 | WS5/WS6 |
| Fetch-page implementations (dashboard) | 6 (2 hooks + 4 pagers) | 6 | **1** | 1 | WS5 single implementation in `lib/clients/query.ts` |
| Provider-settings policy sites | 9 sites / 7 files | 10 sites / 9 files | **1** | 1 | WS4 registry + WS6 removal of the dashboard copy |
| Provider-name branch sites | 16 sites / 11 files | 20 sites / 14 files | **5** | no policy restated outside the registry | dashboard presentation checks + backend capability checks |
| Scenario-version literal sites (literal strings) | 30 (audit census: literals + constant refs) | 14 sites / 11 files | **6** | ≤ 6 | WS4/WS6; definitions and the metadata-unavailable fallback remain |
| Scenario-version constant references (`HEALTHCARE_SCENARIO_VERSION`) | 16 (derived) | 16 | **12** | informational | single-source form, not a copy |
| Byte-identical duplicated files | 2 | 2 | **0** | 0 | WS4 deleted the duplicated resolver |
| Status-vocabulary duplicate sites (outside canonical tables) | 8 (terminal subsets only) | 29 (all status arrays) | **3** | ≤ 3 | two dashboard UI grouping arrays + one compound Mongo `$or`; WS7 also added 12 canonical table definitions |
| `AnalysisRepository` members | 28 | 28 | **0** (composed) | 5 capability ports | WS2 split into CodebookStore/JobLifecycleStore/WindowStore/ArtifactStore/ResultStore |
| `ResearcherRepository` members | 20 | 13 declared + 7 inherited = 20 | **0** (composed) | capability slices | WS2 split into RunStore/RunQueries/DraftStore/EvidenceReader/WorkerSupervisor |
| Harness `Repository` members | 7 | 7 | **0** (composed) | split into 4 ports | WS2 split into RunStateStore/EventLog/RunQueue/WorkerGuard |

All budgets in `scripts/architecture-budget.json` are tightened to the final
column above at program close, so a regression fails `npm run architecture:check`
rather than merely showing a worse number. Budgets are never relaxed without an
entry in the decision log below.

## Finding ownership (all 45 findings)

Severity and titles are taken verbatim from the audit report.

| ID | Severity | Finding (short) | Owner | Status |
| --- | --- | --- | --- | --- |
| F1 | critical | Dashboard `Experiments` page: one 1,050-line component owns creation, validation, launch, drafts, recovery | WS6 T6.1 | done (`9b8e46a`) — 1,211 → 57 lines |
| F2 | critical | Dashboard `AnalysisDetail`: 553-line component, 18 hooks, 10 endpoints, six views | WS6 T6.2 | done (`f7e3c90`) — detail view registry |
| F3 | critical | Dashboard `OversightSetup` fuses monitor evaluation with human run-outcome adjudication | WS6 T6.3 | done (`485cf17`) — 1,832 → 52 lines, tabs own their fetches |
| F4 | high | Dashboard `AnalysisSetup`: 728-line component owns selection, form, preview, validation, launch | WS6 T6.4 | done (`e47ce38`) — `Analysis.tsx` 2,492 → 24 lines |
| F5 | high | Dashboard `RunDetail`: 692-line component owns polling, tabs, pagination, evidence, commands | WS6 T6.5 | done (`59b854f`) — `Runs.tsx` 1,195 → 16 lines |
| F6 | high | Dashboard `CodebookPage`: 16 `useState`, 5 `useEffect`, three validation paths | WS6 T6.6 | done (`78d62c5`) — 561 → 149 lines, one validator |
| F7 | high | Dashboard view dispatch is an else-chain with a silent fallback | WS6 T6.8/T6.9 | done (`d961ef0`) — `Record<TabId, ComponentType>` + `NotFound` on every page |
| F8 | high | Two abstractions, six implementations of data hooks and pagers | WS5 T5.1 | done (`ce3664c`) — `fetchPageImplementations` 6→1 |
| F9 | high | The two data hooks and two pagers are not substitutable | WS5 T5.1/T5.2 | done (`ce3664c`, `ff39399`) |
| F10 | high | The dashboard "port" is a URL string; five raw anchors bypass it | WS5 T5.2 | done (`ff39399`) — zero raw `/api/` anchors, six typed clients |
| F11 | high | `jev-transport.ts` is a stateful repository, policy layer and route table | WS5 T5.3 | done (`edaeb61`) |
| F12 | high | The adapter fabricates contract fields and invents constants | WS5 T5.3 | done (`edaeb61`) |
| F13 | high | Shared type modules are server-contract dumps; one review input serves two domains | WS0 (dead exports) / WS5 T5.5 / WS6 / WS7 T7.5 | done (`9b356e5`, `ce3664c`, `f36c926`; `tsc --noUnusedLocals` clean for `dashboard/src`) |
| F14 | high | Provider/scenario capability rules hardcoded in 5–7 dashboard sites | WS4 T4.3 (metadata) / WS6 (wiring) | done (`d443c77`, `0dc0efb`) — three documented payload gaps keep a literal |
| F15 | medium | Domain vocabularies bypassed by strings; `Badge` invents statuses | WS7 T7.1 | done (`5a66e6e`) — tone-only `Badge`, exhaustive tables, fabrication deleted |
| F16 | medium | No shared response-envelope contract; pages sniff payload shapes | WS5 T5.4 | done (`f91e735`) — `arrayOf` deleted |
| F17 | medium | App shell owns a domain table and forms an import cycle with the Runs page | WS6 T6.7 | done (`82c35b4`) — `RunTable` moved, App↔Runs cycle = 0 |
| F18 | medium | The two largest pages duplicate cancel, review-history and reviewer-identity code | WS6 T6.7 | done (`82c35b4`) — shared `CancelJobButton`/`ReviewHistoryRow`/`useClaimedReviewer` |
| F19 | low | Components take whole hook results as props; shared stylesheet imported by the wrong page | WS0 (unused imports) / WS6 T6.7 / WS7 T7.5 | done (`82c35b4`, `f36c926`) — per-page stylesheets |
| P1 | high | `domain/oversight/service.ts` has ten reasons to change, including Mongo storage layout | WS3c T3c.2 | done (`cf18026`) |
| P2 | high | Harness repository file is two adapters, a schema migration and copied domain invariants | WS3c T3c.1 | done (`058a180`) |
| P3 | high | Closed unions re-encoded as literal arrays and ternaries in 5–8 places | WS7 T7.3 / T7.1 | backend done (`baa89a3`); dashboard done (`5a66e6e`) |
| P4 | medium | "Which Run fields are summary fields" is expressed four times | WS7 T7.2 | done (`46d2b2a`) |
| P5 | high | The two harness repositories disagree about a missing run | WS1 Task 2 | done (`b169c1c`) |
| P6 | medium | `workerStatus(): Promise` unconstrained and returns different shapes | WS1 Task 3 | done (`c711a28`) — typed `WorkerStatus`; accepted note that registration is not a heartbeat |
| P7 | medium | Event-phase classification, claim lifecycle and list limits differ between adapters | WS1 Task 3/4 | done (`c711a28`, `5022462`) |
| P8 | high | In-memory analysis repository violates the port it implements | WS1 Task 6 | done (`5022462`) |
| P9 | medium | `ResearchStore` and `HealthcareCatalog` diverge on idempotent writes/integrity filtering | WS1 Task 7 | done (`2ec6118`) — `replace` revision-match semantics pinned; healthcare-catalog byte-level parity remains accepted |
| P10 | high | Ports fat for narrow consumers, thin for their client; store ports leak a document-store protocol | WS1 (parity) / WS2 T2.1–T2.4 | done (`e172b4a`, `52040ed`, `e46c85c`); see the `JobLifecycleStore` sizing decision below |
| S1 | high | API server module is transport, router, auth, parser, static host and launch service | WS3a T3a.2–T3a.3 | done (`29a4a6c`, `4320e5b`) |
| S2 | critical | `HarnessScheduler.run()` is a 249-line method with thirteen responsibilities | WS3b T3b.2–T3b.6 | done (`69f0653`) — `scheduler.ts` 98 lines, `run()` 74 lines |
| S3 | high | `HealthcareService` owns resolution, validation, provenance, routing, evaluation — and duplicated the validator | WS3c T3c.4 / WS4 T4.2 | done (`f0b127c`) — facade over resolver/routes/provenance; single domain rule site |
| S4 | medium | Common-tool dispatch is a name if-chain with a duplicated argument allowlist | backlog | deferred (covered functionally by WS3b T3b.4 tool admission; the dispatch table itself is polish) |
| S5 | high | `ModelAdapter` implementations are not substitutable | WS2 T2.4 (inject the adapter) / WS4 T4.1 (shared transport policy) | partially done: adapters are injected and `createMonitorProvider` requires a `ModelAdapter` (`447239b`); transport-policy unification is WS4 |
| S6 | medium | Model-usage provenance is untyped and inferred from configuration | WS3b T3b.7 (gated) | deferred: typing `ModelResponse` provenance requires edits in WS2/WS4-owned contracts while keeping recorded `model_usage` payloads byte-identical |
| S7 | medium | `PrivateMemory` is specified by two signatures only; implementations disagree on semantics | backlog | deferred (no correctness bug observed; typing it is a separate contract change) |
| S8 | medium | The `Repository` port is too narrow for the worker loop and too wide for the scheduler | WS2 T2.3 | done (`e172b4a`) |
| S9 | high | `AnalysisWorker` is a lease manager, scheduler, retry-budget accountant and progress ledger | WS3c T3c.3 | done (`7dbf591`) |
| S10 | medium | Composition leaks into operations: concrete adapter built in a use case, global Mastra runtime mutated | WS2 T2.4 / WS0 T0.2 (orphan starter agent) | done (`447239b`; WS0 deleted the orphan starter agent) |
| X1 | high | Provider capability and model-settings policy restated in 9 places, already drifted | WS4 T4.1 | done (`ef3a4c9`) — 2 sites, target 1 when WS6 removes the dashboard copy |
| X2 | high | Scenario selection by version string repeated across every tier | WS4 T4.2 | done (`4b85b98`) — 3 literal sites / 3 files, target ≤ 6 met |
| X3 | high | Domain layer encodes HTTP status codes; API guesses meaning from error message text | WS3a T3a.5 (mapper) / WS3c T3c.5 (producers) | done (`b9d7ecf`, `13f424c`) — `DomainFailure` kinds everywhere; `OversightError`/`readonly status` deleted |
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
| 2026-11-07 (WS5) | Dashboard data access is one requester seam: `lib/transport.ts` is the only `fetch`; six typed clients own every path/body/export URL; `ApiClientProvider` composes them; pure `translate`/`decodeJev` plus a provider-owned `JevSession` replace the module-global transport. Page tests inject `pageClients` over a fake requester with the adapter disabled; adapter mapping keeps its own characterization suite | F10/F11 close without payload changes and page tests stop stubbing global fetch | WS5 |
| 2026-11-07 (WS5) | `AnalysisSettings.frozen` replaces `resolvedSettings`; new analyses use `adapters/defaults.ts`; fabricated `revision: 1`, `archived: false`, `ReviewBatch.creator` and cached window/review derivation are deleted; `toReview` derives `runId` from the review analysis context and window membership from review subject scope | F12 closes; duplicate-analysis payloads stay byte-identical | WS5 |
| 2026-11-07 (WS5) | Client-side one-source-event review refusal deleted; server `ReviewService.save` owns it (D5.1). `WindowReviewInput`/`OutcomeReviewInput` split; `ReviewInput`/`ResearchRecord` deleted | F13/F11 close | WS5 |
| 2026-11-07 (WS5) | `packages/contracts/src/browser.ts` exports `RunSummary` (D5.3, one line); dashboard `mergeProgress` makes progress-over-run authority explicit. `/runs/:id/events` keeps a pager shim that normalizes `{events,nextCursor,hasMore}` to `Page<T>` because the server cursor is never null | Removes the fifth `RunSummary` declaration and the `Partial<Run>` merge without changing evidence payloads | WS5 |
| 2026-11-07 (WS3c, part 2) | `HealthcareService` is a four-method facade over resolver/route/provenance modules. Healthcare configuration rules exist only in the single domain scenario definition (WS4 moved them to `packages/domain/src/scenarios/healthcare.ts`); the re-duplication guard follows that definition site | S3 stays closed after the concurrent WS4 move; the guard now fails if a second domain copy appears | WS3c |
| 2026-11-07 (WS3c, part 2) | X3 completion: domain failures carry `FailureKind`; `OversightError` and every `readonly status` are deleted; `AnalysisConflict`/`AnalysisNotFound`/`AnalysisValidation`/`AnalysisPayloadTooLarge`/`RepositoryConflict` extend `DomainFailure` and keep their names and messages. The API mapper is `HttpError`/`DomainFailure`/unknown→400 | One failure vocabulary across layers; the legacy branches the plan said to keep became unreachable once the classes stopped carrying `status`, so they were removed with the statuses | WS3c |
| 2026-11-07 (WS3c, part 2) | Accepted status change: the two frozen-preview integrity failures now map to 503 (`unavailable`) instead of 500 | No test asserted 500 and 500 is not a failure kind; genuine unavailability/conflict conditions | WS3c |
| 2026-11-07 (Lead) | Architecture census split for X2: `scenarioVersionLiteralSites` now counts literal version strings only (audit 30 → baseline 14 → 3 after WS4; target ≤ 6 met); references to `HEALTHCARE_SCENARIO_VERSION` are reported separately as `scenarioVersionConstantReferences` (baseline 16 → 22, informational, capped at 22) | The audit's 30-site census conflated literal copies with the single-source constant; counting them together would punish the refactor for adopting the constant. Literal copies are the drift risk and stay budgeted | Lead |
| 2026-11-07 (WS7) | `RunSummary` derives from `SUMMARY_OMIT`/`SUMMARY_CONFIG_OMIT` in `packages/contracts/src/harness/repository.ts`, re-exported by `@sidechannel/domain/harness/repository`; `toRunSummary`/`summaryProjection()` replace `summarizeRun` and the Mongo projection literals | Contracts is the lowest layer that can define the browser-facing summary shape; a new heavy `Run` field is now one constants edit plus the `Run` interface | WS7 |
| 2026-11-07 (WS7) | Closed vocabularies are sole definitions: `RUN_STATUSES`/`TERMINAL_RUN_STATUSES`/`ACTIVE_RUN_STATUSES`/`COMPLETE_RUN_STATUSES`/`INCOMPLETE_RUN_STATUSES`/`CANCEL_OVERRIDE_RUN_STATUSES`/`isTerminalRun`, `EVIDENCE_KINDS`/`EVIDENCE_KEY_FIELD`/`EVIDENCE_KEY_COERCION`, `JOB_STATUSES`/`ACTIVE_JOB_STATUSES`/`RETRYABLE_JOB_STATUSES`/`isActiveJob`, `MONITOR_EVALUATION_STATUSES`/`ACTIVE_MONITOR_STATUSES`/`MONITOR_VIEW_STATUSES`, `MONITOR_VIEW_BUILDERS`, `SIDE_EFFECT_CATEGORIES`/`TOOL_EFFECT_ENABLED`/`SIDE_EFFECT_ENABLED`; backend literals migrated (including the newly split `oversight/cancel.ts`) | Backend half of P3; every table entry is transcribed from its literal and pinned by `vocabulary.test.ts`, `projections.test.ts`, `evidence-selection.test.ts`, `port-contracts.mongo.test.ts` | WS7 |
| 2026-11-07 (WS7) | `statusVocabularyArraySites` 28 → 21; the residual is 12 canonical table declarations (the census counts the tables themselves), 8 dashboard sites (WS7 T7.1/T7.5) and one compound Mongo `$or` in analysis persistence (a semantic condition, not a vocabulary copy). The ≤ 6 target is restated as "≤ 1 non-table, non-dashboard site" and enforced after the dashboard half lands | Every backend literal copy is gone; counting canonical table declarations as duplicates is a scanner artifact, so the target is stated in terms the census can actually measure | WS7 |
| 2026-11-07 (WS7) | Vocabulary exhaustiveness tests live in `tests/integration/vocabulary.test.ts`, not `packages/contracts/src/harness/*.test.ts` | WS0's `workspace/imports` rule forbids Node built-ins in browser-portable contracts, so the planned location cannot lint; integration owns cross-package table assertions | WS7 |

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

## WS7 dashboard half and program close-out (2026-11-07)

| Date | Decision | Rationale | Owner |
| --- | --- | --- | --- |
| 2026-11-07 (WS7) | `dashboard/src/lib/status.ts` is the sole dashboard vocabulary/tone source (`runStatusMeta`, `reviewDecisionMeta`, `monitorStatusMeta`, `jobStatusMeta`, `windowStatusMeta`, `agreementMeta`, `eventMeta`, `runListGroups`, `overviewCards`); `Badge` takes a semantic `tone` only and the fabricated `oversized → failed` mapping is deleted; all 19 `Badge status=` sites migrated | F15 closes: pages never re-list statuses, and an unknown status is a compile error through the exhaustive records | WS7 |
| 2026-11-07 (WS7) | `packages/contracts/src/browser.ts` publishes `RUN_STATUSES`/`TERMINAL_RUN_STATUSES`/`ACTIVE_RUN_STATUSES`/`isTerminalRun` and the `JobStatus` type to the browser graph (the only backend edit the dashboard half needed) | The dashboard consumes the canonical vocabulary instead of re-declaring it; the browser contract graph is the declared crossing point | WS7 |
| 2026-11-07 (WS7) | `statusVocabularyDuplicateSites` (ad-hoc status arrays outside canonical tables) reaches **3**: two dashboard UI grouping arrays in `lib/status.ts` (presentation groups such as "Active runs", not policy) and one compound Mongo `$or` in analysis persistence; the canonical table definitions are counted separately (12). Artifact rendering is keyed by scenario metadata's `artifactSchemaVersion`; the unreachable legacy scenario→schema map is deleted | The restated target "≤ 3 non-table sites" is now enforced by two separate budgets, so a future ad-hoc status list fails CI while the 12 legitimate single-source tables do not | WS7 |
| 2026-11-07 (WS7) | Dead-code cleanup: removed `ReviewBatchInput`, `analysisViewOrder`, a `ReactElement` re-export, the dead `withServer` helper, the unreachable legacy schema map, the orphaned `pages/analysis/analysis.css` (never imported, classes unstyled at baseline) and 51 unused imports/locals; `tsc --noUnusedLocals --noUnusedParameters` is clean for `dashboard/src`; `runs-oversight.css` split into per-page stylesheets | T7.5 closes F13 leftovers; the orphan CSS was dead at the baseline, so deleting it changes nothing rendered | WS7 |

### Final gate evidence

| Gate | Command | Result |
| --- | --- | --- |
| Lint + boundary verifier | `npm run lint` | pass (8/8 projects; "Type-only boundary violations rejected; browser contracts compile without server declarations") |
| Composition roots | `node scripts/verify-composition.mjs` | pass ("no concrete adapters in workers or routes, no lazy provider import, no mutable Mastra global, one zod module in contracts") |
| Typecheck | `npm run check` | pass (14/14 nx tasks) |
| Unit tests | `npm test` | pass (14/14 nx tasks) |
| Dashboard tests | `npm run nx sidechannel-dashboard:test -- --skip-nx-cache` | **37 files / 130 tests pass**, reproduced twice uncached |
| Mongo integration | `npm run test:integration` | **29/29 pass** |
| Adapter contract suites (memory) | `npm run test:contracts` | **98/98 pass** |
| Compiled ESM smoke | `node scripts/verify-compiled.mjs` | pass ("API matched-pair submission, idempotency, scripted worker execution, provenance, exports, SPA deep links, and assets") |
| Migration equivalence | `node scripts/verify-migration-equivalence.mjs` | pass ("configuration, pair, initial state, normalized trace, windows, definitions, and exact Jev payloads") |
| Architecture budgets | `npm run architecture:check` | pass with budgets tightened to the final state |
| Jev smoke | `npm run smoke:jev` | pass |
| Healthcare smoke | `npm run smoke:healthcare` | pass (`structuralValidity: true`, 3 submissions, truth hash recorded) |
| Dashboard smoke | `npm run smoke:dashboard` | **not runnable in this environment** — the long-lived in-memory server + browser probe does not finish within 180 s and hangs the same way on the untouched baseline checkout. Recorded as an environment limitation, not a green gate |
| Fixture export | `npm run fixture` | **blocked by environment** — a stale `worker_guard` document in the shared `sidechannel` database (owned by the compose stack's worker) refuses a second worker. Baseline verification used ephemeral databases; the committed export was never regenerated (see the WS1 evidence-drift entry) |

### Program status and accepted deferrals

All nine execution plans plus WS0 were executed on branch `refactor/solid-remediation`; every one of the 45 audit findings is closed or has a written rationale in the table above. The program-level deferred/accepted items are:

| Item | Status | Rationale |
| --- | --- | --- |
| WS7 T7.4 canonical hashing (`hashVersion: 2`, sorted keys, dual-read) | **deferred** to the post-program backlog | The gate requires confirming that no study data depends on the current hashes. `data/` holds scenario datasets and the committed fixture export is a referenced research artifact, so the gate is not satisfied. Persisted identity hashes (`configHash`, launch keys, review keys, preview hashes) stay byte-identical; WS1 de-duplicated the implementations without changing values. A future execution is additive/versioned per the WS7 plan. |
| S6 model-usage provenance typing | deferred (WS3b report) | Requires edits in WS2/WS4-owned contracts while keeping recorded `model_usage` payloads byte-identical. |
| S4 tool-dispatch table, S7 `PrivateMemory` typing | backlog | Medium findings; functionally covered by WS3b tool admission / unchanged memory semantics. |
| P6 `workerStatus` richness, P9 healthcare catalog byte-level parity | accepted | Documented in the ownership table; the honest contract is a typed shape with a "no heartbeat" note, and the in-memory catalog legitimately cannot reproduce byte-level integrity checks. |
| Evidence drift: committed `agent/examples/completed-fixture.json` (103 events) vs current code (123 events) | recorded, not fixed | Pre-existing at the baseline commit; program rule is never to rewrite characterization evidence to make a gate green. |
| `datasetExportUrl` dead route, `presentation.toolNames` / `modelCatalogPath` metadata gaps | backlog | Pre-existing/unreachable behaviours preserved by the no-behaviour-change constraint; additive follow-ups in the WS4 hand-off section. |
| Re-run the SOLID audit for the "grade ≥ B, 0 critical/high findings" program criterion | **not executed** | The audit is a research exercise outside this execution; it is the remaining external acceptance step named in program plan §9. |

### Execution record

- Branch: `refactor/solid-remediation`, created from `main` (`5a31bf7`) and executed in the worktree `C:\Users\Kyle\Documents\code\sidechannel-solid-remediation` (the source checkout was left untouched).
- Plan documents were committed first (`c998c28`), so the branch is self-contained.
- One commit per plan task (WS0 T0.1–T0.4 each have their own commit). Workstream anchors: WS0 `2661d9b`,`b9f7ee5`,`2c163cc`,`684032a`; WS1 `37085bd`…`8a1e0a3`; WS2 `8c78108`…`d886687`; WS3a `14a19c9`…`6b73807`; WS3b `dc40629`…`69f0653`; WS3c `058a180`,`7dbf591`,`cf18026`,`f0b127c`,`b781d28`,`13f424c`; WS4 `ef3a4c9`…`73ddcfb`; WS5 `ce3664c`…`18a560b`; WS6 `e9b02a4`…`d961ef0`; WS7 `46d2b2a`,`baa89a3`,`c228216`,`5a66e6e`,`f36c926`.
- Execution-order deviations (all recorded above): T3a.4 before T3a.3; WS3c ran T3c.1/T3c.3 before T3c.2 to avoid the WS3a-frozen oversight route; WS7 backend (T7.2/T7.3) and dashboard (T7.1/T7.5) ran as two disjoint halves; WS6 was split across three executors by page, with cross-page shared files (`App.tsx`, `ui.tsx`, registry, test clients) reserved to one owner at a time.
- One transient failure was observed during the first `npm run verify` of the close-out (dashboard vitest under load); two immediate uncached reruns passed (37/130) and the full `npm run verify` then passed. No source change was made for it.

## Main integration (2026-11-07)

While the remediation branch was being closed out, `main` advanced by seven commits
(`5a31bf7` → `48a2170`) with behaviour the audit had not seen. The branch was integrated by
**merging `main`** (never rebasing the 72-commit branch) and re-expressing each feature on the
refactored architecture.

**Merge mechanics**

- Safety refs: tag `pre-main-merge-2026-11-07` and branch `backup/pre-main-merge` at `c31aeb6`;
  merge commit `6dcb106`; integration prep `1432e9a` (package exports and browser DTO union).
- 21 structural conflicts were resolved by keeping the refactored shape (capability ports, split
  modules, decomposed dashboard, WS5 client layer), then main's behaviour was ported feature by
  feature so each resolution is a reviewable commit. No blanket "take theirs" survives unported.
- Main changes that auto-merged kept their behaviour: the scripted adapters/scripts already emit
  `submit_report` calls, `gateway.ts` report-tool catalog and failure `details`,
  `healthcare/artifact.ts` diagnostics, contracts `testing.ts` and the example config at
  `reportSchemaVersion: "2"`, the playbook package exports, and the deployment/docs updates.

**Feature ports**

| Main feature | Main commit | Branch commits |
| --- | --- | --- |
| `submit_report` tool-call report protocol | `0d96464` | `433135c` (port), `4866c0a` (evidence) |
| Expiring worker lease + abandoned-run interruption | `251ef9f` | `4fa22e3`, `e7459d4`, `bb1d6a1` |
| Adaption inference fixes (assistant item ids) | `deae91d` | `41b81f4` |
| Artifact diagnostics + 16,384 default output limit | `19648a2` | `d9f9cdf`, `6ced44c` |
| Playbooks: registry, API, worker runtime, catalogs | `48a2170` | `0eae010`, `6ced44c`, `57f31de`, `726d8ad`, `4a18d9d`, `29d37d8` |
| Model-call timeline / traces / call detail UI | `0bf0497` | `3cd2f8d`, `2d30ab2` |
| Playbook picker + playbook client on the dashboard | `48a2170` | `55df81c`, `3268d63` |

**Executed interface extensions** (binding document updated in `2026-11-07-plan-conventions.md`):

- `WorkerGuard` is an expiring lease (`DEFAULT_WORKER_LEASE_MS`, `acquireWorker(owner, leaseMs?)`,
  `heartbeatWorker`, `workerLease`); Mongo takeover is atomic on the database clock and the memory
  adapter mirrors it. `WorkerStatus` reports `available: boolean` and
  `status: 'active' | 'stale' | 'stopped' | 'registered' | 'unknown'` with optional `heartbeatAt`.
- `ProviderProfile` gained the data-only adapter extension
  `adapterKind: 'mastra' | 'scripted' | 'embedded-playbook'` and optional
  `validateModel(config)`; `ResolvedTransport` carries `assistantTextItemIds` for Adaption.
  The playbook provider is a registry entry (settings `playbookVersion`/`playbook`/`playbookHash`,
  `fixture: true`, `usageSource: 'scripted'`), so the worker selects adapters from registry data
  instead of provider-name branches, and `providerCatalog()`/`GET /providers` expose it.
- The browser contract graph publishes `RUN_STATUSES`/terminal status helpers and
  `PlaybookCatalogItem`; the dashboard gains a typed `playbooks` client
  (`list`/`upload`/`get` + path builders) in `ApiClients`.

**Evidence changes (all reviewed, none silent)**

| Artifact | Before → after | Cause |
| --- | --- | --- |
| Scheduler characterization snapshots | fixture 123 → 127, healthcare 356 → 366 | `submit_report` adds exactly `tool_requested` + `tool_result` per reporting role before `report_submitted`; no event removed or reordered and every final-state line is byte-identical (scripted argument JSON equals the former report text) |
| Ports characterization | recorded types + the same 4 events; export tripwire now asserts the current artifact | same protocol port |
| API route-contract snapshot | research 47 → 58, demo 1 → 2; 44 existing cases changed, 0 removed | 11 playbook cases + 1 unavailable-catalog demo case; v2 config defaults; lease-based worker status. Stable across a second uncached run (`UPDATE_ROUTE_CONTRACT=1` used once) |
| `agent/examples/completed-fixture.json` | 103 → 127 events | approved regeneration that also resolves the pre-existing 5a31bf7 evidence drift; reports now carry the tool-call argument JSON. Generated on isolated databases so the compose stack's live worker lease was untouched |
| `tests/fixtures/service-layout-baseline.json` | 7 hashes changed (`resolved`, `pair`, `queued`, `trace`, `serialized`, `requests`), 3 unchanged (`context`, `definitions`, `questions`) | v2 report settings change the resolved config and the regenerated fixture trace; the script now has an explicit `UPDATE_MIGRATION_BASELINE=1` re-record switch |
| `analysis-worker` monitor transport expectation | accepts `assistantTextItemIds: true` | main `deae91d` behaviour |

**Census and budgets**

`npm run architecture:check` passes with every budget. Two recorded adjustments:
`providerNameBranchSites` 5 → 6 because main's model-call timeline adds one dashboard
presentation branch (reasoning label over an already-resolved run, like the fixture badge and
capacity copy — not provider policy); and the new route-contract case literal was replaced with
`FIXTURE_SCENARIO_VERSION` so the scenario-literal census and provider-registry guard stay at
single-source.

**Wave-1 gates (clean tree, branch after `4866c0a` and the evidence commits)**

`npm run verify` (lint + composition + check + test + build), dashboard **43 files / 192 tests**,
experiment-worker **100 tests (98 pass, 2 Mongo skips, 0 fail)**, Mongo integration **30/30**,
adapter contracts **98/98**, `verify-compiled`, `verify-migration-equivalence`,
`architecture:check`, `smoke:jev`, `smoke:healthcare` — all pass. `smoke:dashboard` remains the
documented environment limitation from the program close-out (long-lived browser probe does not
finish in this environment).

**Wave 2 (current):** main advanced again to `3efcb2e` (28 commits: the live turn-aligned event
timeline with SSE and turn paging, the dashboard review fixes, codebook archive/restore, Jev
ordering/chart fixes, and deployment updates). A second merge/port wave follows the same policy and
is recorded here when it closes.
