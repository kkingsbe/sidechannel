# SOLID Remediation Program Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This program plan is supported by nine execution-ready workstream plans (all written on 2026-11-07; see [Appendix C](#appendix-c--execution-plan-index)). Shared interfaces and formatting rules are binding in [`2026-11-07-plan-conventions.md`](2026-11-07-plan-conventions.md).

**Goal:** Remove the four critical and twenty-five high-severity SOLID findings from the 2026-11-07 audit without changing research behaviour, API/dashboard semantics, or evidence content.

**Architecture:** Treat the remediation as a program of eleven workstreams (WS0, WS1, WS2, WS3a–c, WS4–WS7) split into three lanes: backend foundation, backend decomposition, and frontend. Behaviour-preserving refactors are gated by characterization tests and a contract-test suite that runs against both in-memory and Mongo adapters. Guardrails are added first so the ground does not re-accrete.

**Tech Stack:** TypeScript 6.0.3 (services/packages) / 5.9.3 (dashboard), Node 22.18+/24.11+, npm 11.5.1, Nx 23, `node:test` + `tsx` test runner, MongoDB 8 replica set, React 19 + Vite, ESLint 9 with custom `workspace/imports` rule.

## Global Constraints

- **No behavioural change.** Refactors must not alter experiment scheduling, tool admission, budget accounting, evidence hashes, event types, statuses, API payload shapes, or dashboard copy unless a task explicitly says so.
- **Every task ships tests.** No task is complete without its own test cycle; backend changes also require the Mongo integration suite.
- **Verification commands (run from repo root):** `npm run lint`, `node scripts/verify-boundaries.mjs`, `npm run check`, `npm test`, `npm run build`, `npm run test:integration` (requires `docker compose up -d --wait mongo`; Mongo on `127.0.0.1:27018`, CI uses `27017` via `TEST_MONGODB_URI`).
- **Evidence equivalence gates:** `node scripts/verify-compiled.mjs` and `node scripts/verify-migration-equivalence.mjs` must pass; fixture runs must still complete with the same event sequence and final artifact.
- **Boundary rules are non-negotiable.** `eslint.config.mjs` layer tags (`layer:contracts` → `layer:domain` → `layer:persistence` → `layer:service` → `layer:frontend`) and service-to-service isolation stay intact. New test-support code must not leak into the browser contract graph.
- **Dependencies are frozen for the duration of the program.** No upgrades of React, Mongo driver, Mastra, TypeScript major/minor, or test tooling.
- **One workstream (or one dashboard page) per branch.** Rebase on `main` before each merge; max ~400 changed lines per PR where possible.
- **Public compatibility:** API route shapes and dashboard `lib/types.ts` stay compatible within a release. Cross-layer payload changes ship in one PR (server + dashboard).
- **No new features, no UI redesigns, no research-protocol changes.** Dead code is deleted; nothing is rewritten "because it would be nicer".

---

## 1. Where we start (audit baseline)

Source size: 149 TypeScript files / 18,257 lines (excluding `node_modules`, `dist`, `.nx`).

| Metric | Baseline | Target |
| --- | --- | --- |
| Critical findings | 4 | 0 |
| High findings | 25 | 0 |
| Medium findings | 15 | ≤ 5 (accepted) |
| Largest source file | 2,523 lines (`Analysis.tsx`) | < 500 |
| Largest backend module | 264 lines (`scheduler.ts`, `repository.ts`) | < 300 |
| Page files defining data hooks | 4 | 0 |
| Implementations of "fetch page" (dashboard) | 6 | 1 |
| Provider-settings policy copies | 9 | 1 |
| Scenario-version literal sites (production) | 30 | ≤ 6 |
| Byte-identical duplicated files | 2 | 0 |
| `AnalysisRepository` methods | 28 | ≤ 8 per capability port |
| Contract tests against both adapters | 0 | 1 suite per port |
| Structural CI guardrails | 0 | budgets enforced |

Full findings: [`research/docs/2026-11-07-solid-audit-report.html`](../../../research/docs/2026-11-07-solid-audit-report.html), research record: [`research/docs/2026-11-07-solid-principles-audit.md`](../../../research/docs/2026-11-07-solid-principles-audit.md).

> **Baseline note (2026-11-07 15:05):** while the execution plans were being authored, a concurrent session committed `5a31bf7` ("Initial smoke test prep"), which included source changes in `api/src/healthcare/**`, `api/src/server/index.ts`, `api/src/main.ts` and dashboard healthcare components. The plans were written against the resulting tree, so line anchors are re-located by content at execution time. One audit finding was resolved by that work before execution: the duplicated healthcare five-role/artifact/tool/provider rules were removed from `api/src/healthcare/service.ts` (they exist only in `packages/domain/src/harness/config.ts:128-138`). WS3c T3c.4 records the deletion as already-true and adds a re-duplication guard; WS4 T4.2 only removes the remaining scenario-version branch. The audit HTML remains the `20bc219` snapshot.

## 2. Goals and non-goals

**Goals**

1. Close all critical and high findings (ids in Appendix A).
2. Make every port substitutable, proven by a contract suite that runs the same assertions against memory and Mongo.
3. Make the largest modules small enough to hold in context (< 500 lines frontend page, < 300 lines backend module, < 300 lines per component).
4. Make the bad shapes mechanically hard: size budgets, single data-access path, single provider/scenario registry, single source for closed vocabularies.
5. Leave the boundary enforcement stronger than it started (extend `verify-boundaries` coverage, add structural lint).

**Non-goals**

- No changes to the research protocol, prompts, scoring, conditions, or reporting schema.
- No UI redesign or new dashboard features; extracted views render the same markup.
- No dependency upgrades, no Mastra/SDK changes.
- No re-architecture of the database schema beyond additive fields required by contract parity.
- No attempt to reach "average file < 200 lines" or other aesthetic targets; only the audit findings and their guardrails.

## 3. Workstreams at a glance

| WS | Name | Findings closed | Effort (dev-days) | Risk | Depends on | Plan |
| --- | --- | --- | --- | --- | --- | --- |
| WS0 | Baseline, hygiene, guardrails | dead code in P10/S10/F13; X4 partial (housekeeping) | 2–3 | Low | — | inline below |
| WS1 | Evidence-integrity contract harness | P5, P6, P7, P8, P9, X6 (de-duplication half) | 5–7 | Low–medium | WS0 (optional) | [WS1](2026-11-07-ws1-adapter-contract-parity.md) |
| WS2 | Ports and composition roots | P10, S8, S10 | 4–6 | Medium | WS1 | [WS2](2026-11-07-ws2-ports-and-composition-roots.md) |
| WS3a | API server and route contract | S1, X3, X4, X5 | 5–7 | High | WS1, WS2 | [WS3a](2026-11-07-ws3a-api-server-and-route-contract.md) |
| WS3b | Scheduler decomposition | S2 (S6 optional) | 5–7 | High | WS2 | [WS3b](2026-11-07-ws3b-scheduler-decomposition.md) |
| WS3c | Domain, persistence, worker splits | P1, P2, S3, S9, X3 completion | 6–8 | High | WS1, WS2, WS3a | [WS3c](2026-11-07-ws3c-domain-persistence-worker-splits.md) |
| WS4 | Provider and scenario registries | X1, X2, S3 (duplication half) | 6–8 | Medium | WS1; WS3a for API routers | [WS4](2026-11-07-ws4-provider-scenario-registries.md) |
| WS5 | Dashboard data-access foundation | F8, F9, F10, F11, F12, F16, F13 | 6–8 | Medium | WS3a (stable routes) | [WS5](2026-11-07-ws5-dashboard-data-access.md) |
| WS6 | Dashboard page decomposition | F1–F7, F14 (dashboard), F17, F18, F19, F13 leftovers | 12–18 | Medium | WS5; WS4 metadata | [WS6](2026-11-07-ws6-dashboard-page-decomposition.md) |
| WS7 | Vocabulary unification and polish | F15, P3, P4, X6 (canonical half, gated) | 4–6 | Low–medium | WS3a–c, WS4, WS6 | [WS7](2026-11-07-ws7-vocabulary-unification.md) |

**Sequencing**

```
WS0 ──► WS1 ──► WS2 ──┬──► WS3b (scheduler)
                      │
                      ├──► WS3a (API) ──► WS5 ──► WS6 ──► WS7
                      │                      ▲
                      └──► WS3c (domain) ────┘
                                   │
                                   └──► WS4 (registries) ──► WS6 (metadata wiring)
```

Parallelisable once WS1 lands: WS2 first (ports are the shared vocabulary), then WS3a/WS3b/WS3c can run concurrently on disjoint files, WS5 can start as soon as WS3a's route shapes are stable, and WS4 starts after WS3a's router list exists. WS6 requires WS5 and the WS4 metadata endpoints. WS7 closes last.

**Lane model**

- **Lane A (backend core):** WS0 → WS1 → WS2 → WS3a/WS3b → WS3c → WS4.
- **Lane B (frontend):** WS0 → WS5 → WS6 → WS7 (WS5 may start after WS3a; WS6 only after WS5 and WS4 metadata).
- **Shared:** WS7 vocabulary tables require WS3x (backend tables) + WS6 (pages own rendering); schedule last.
- **File-conflict rule:** see the ownership table and the shared-file sequencing table in [`2026-11-07-plan-conventions.md`](2026-11-07-plan-conventions.md) §4. Never run WS3a/WS3b/WS3c and WS4 concurrently on the same file; WS3a lands before WS3c on `api/src/healthcare/**`.

## 4. Workstream plans

### WS0 — Baseline, hygiene, guardrails (2–3 days)

**Objective:** Establish measurable budgets, delete code that misleads readers, and add the mechanical guardrails that make every later task easier. This is the only workstream allowed to delete code without a refactor.

**Tasks**

| Task | Deliverable | Files | Gate |
| --- | --- | --- | --- |
| T0.1 | `scripts/architecture-budget.mjs` — computes file sizes, per-page data-hook counts, duplication census (provider settings, scenario literals, status arrays), emits JSON + human summary; `--check` fails when budgets in `scripts/architecture-budget.json` are exceeded | create `scripts/architecture-budget.mjs`, `scripts/architecture-budget.json`; modify `package.json` (`"architecture": "node scripts/architecture-budget.mjs"`, `"architecture:check": "... --check"`) | `npm run architecture` matches the audit baseline within ±1 |
| T0.2 | Delete dead code: unused `readyJob` (after WS1 parity, so order: T0.2a types only), orphan Mastra starter agent + schedule tools, unused dashboard exports (`AnalysisAttempt`, `CanonicalStep`, `CanonicalContribution`, `AnalysisRequest`, `AnalysisResponse`, `OutcomeAgreement`, `ConfigurationResponse`), unused imports (`api`, `GitCompare`, `ShieldCheck`, `BoardMessage`, `Braces`), half-wired `kind@schemaVersion` artifact key | `experiment-worker/src/mastra/agents/agent.ts`, `experiment-worker/src/mastra/tools/schedule-tools.ts`, `dashboard/src/lib/analysis-types.ts`, `dashboard/src/lib/types.ts`, `dashboard/src/pages/{Analysis,Oversight,Runs}.tsx`, `dashboard/src/components/artifact-view.tsx` | `git grep` proves zero references; lint/check/test/build green |
| T0.3 | Structural ESLint: `max-lines` (warn 700), `max-lines-per-function` (warn 250), ban `fetch(` outside `dashboard/src/lib/**` via `no-restricted-globals`/`no-restricted-syntax`, ban `as unknown as` in `dashboard/src/lib/**` | `eslint.config.mjs` | `npm run lint` exits 0 with warnings; documented in `docs/` |
| T0.4 | Archive the audit: link the HTML report + research doc from `README.md` docs table; record accepted findings and decisions in `docs/solid-remediation-decisions.md` | `README.md`, create `docs/solid-remediation-decisions.md` | links resolve; decisions doc lists every finding with planned WS |

**Exit gate:** `npm run lint && npm run check && npm test && npm run build` green; architecture budget script committed and runnable; no source behaviour touched.

---

### WS1 — Evidence-integrity contract harness (5–7 days)

**Objective:** Make the in-memory and Mongo adapters provably interchangeable, and de-duplicate hashing without changing any stored hash value. This is the highest-value, lowest-risk workstream: it protects the artifact the whole project exists to produce.

**Execution plan:** [`2026-11-07-ws1-adapter-contract-parity.md`](2026-11-07-ws1-adapter-contract-parity.md) (all tasks, code, and commands).

**Scope**

- P5 missing-run evidence page parity.
- P6 typed `WorkerStatus` + adapter parity.
- P7 event-phase predicate, `listEvents` clamp, claim lifecycle parity.
- P8 `InMemoryAnalysisRepository`: `readyJob`, `updateWindow`, `finishAttempt` bound, `resultsForWindows` cap.
- P9 `ResearchStore.replace` matched semantics.
- X6 de-duplicate five hash helpers into two explicitly named functions with **byte-identical** output for existing values; canonical sorted-key hashing is deferred to WS7 as a versioned migration.

**Exit gate:** contract suites run under `npm test` (memory) and `npm run test:integration` (Mongo); all differing behaviours fixed or documented with a test encoding the agreed semantics.

---

### WS2 — Ports and composition roots (4–6 days)

**Objective:** Size ports to their consumers and move object construction back to composition roots, so substitution is cheap and boundary violations are visible to the linter.

**Execution plan:** [2026-11-07-ws2-ports-and-composition-roots.md](2026-11-07-ws2-ports-and-composition-roots.md)

**Tasks**

| Task | Deliverable | Files | Gate |
| --- | --- | --- | --- |
| T2.1 | Split `ResearcherRepository` into `RunStore`, `RunQueries`, `DraftStore`, `EvidenceReader`, `WorkerSupervisor`; keep `ResearcherRepository` as a composed type for the API composition root only | `packages/contracts/src/server/contracts.ts`, `packages/contracts/src/harness/server.ts`, `api/src/server/index.ts`, `api/src/routes/*.ts`, `packages/persistence/src/harness/repository.ts` | every extension handler parameter is a `Pick<...>` of the slice it uses; `tsc` green |
| T2.2 | Split `AnalysisRepository` (28) into `CodebookStore`, `JobStore`, `WindowStore`, `ArtifactStore`, `ResultStore`; `AnalysisService` and `AnalysisWorker` take the composed port | `packages/contracts/src/analysis/jev-repository.ts`, `packages/domain/src/analysis/jev-service.ts`, `analysis-worker/src/**`, `packages/persistence/src/analysis/jev-repository.ts`, contract tests | no test uses `as unknown as AnalysisRepository`; contract suite green |
| T2.3 | Split harness `Repository` into `RunStateStore` + `EventLog` + `RunQueue` + `WorkerGuard`; `HarnessScheduler` takes the three it needs; worker `main.ts` depends only on `WorkerGuard`/`RunQueue` | `packages/contracts/src/harness/server.ts`, `experiment-worker/src/harness/scheduler.ts`, `experiment-worker/src/main.ts`, `packages/persistence/src/harness/repository.ts` | `main.ts` imports no concrete class; unit tests construct narrow fakes |
| T2.4 | Composition roots: build `MongoAnalysisRepository`/`MongoReviewStore` in `api/src/main.ts` (delete auto-`initialize()` wiring from the route layer); require `ModelAdapter` in `createMonitorProvider`; make Mastra a `TraceRuntime` object owned by `openRuntime()` | `api/src/main.ts`, `api/src/routes/jev-extension.ts`, `analysis-worker/src/{main,oversight/*}.ts`, `experiment-worker/src/mastra/index.ts`, `experiment-worker/src/harness/{runtime,mastra-adapter}.ts` | no `await import("./model-adapter.js")` default; no `export let mastra`; startup fails fast on missing credentials |

**Exit gate:** ports ≤ 8 members each; workers/tests depend only on ports; contract suites still green; `node scripts/verify-boundaries.mjs` extended to catch same-package concrete dependencies used by services.

---

### WS3a — API server and route contract (5–7 days)

**Objective:** Turn the 237-line API module into transport, auth, error boundary and per-resource routers behind one route contract, and finish the HTTP-status/domain-failure separation.

**Execution plan:** [2026-11-07-ws3a-api-server-and-route-contract.md](2026-11-07-ws3a-api-server-and-route-contract.md)

| Task | Deliverable | Gate |
| --- | --- | --- |
| T3a.1 | API route-contract characterization snapshot (statuses, payload keys, NDJSON, export) | snapshot committed and unchanged after refactor |
| T3a.2 | Extract `http.ts`, `auth.ts`, `errors.ts`, `static.ts` | `server/index.ts` loses transport/static/auth concerns |
| T3a.3 | Per-resource routers registered as one handler list; `index.ts` < 80 lines | API + integration tests green |
| T3a.4 | One transport-neutral route-handler contract; delete the synthetic `IncomingMessage` adapter; one body reader with per-route limits | Jev/oversight/adaption routes share one shape |
| T3a.5 | Error mapping by failure kind (no message regexes, no duck-typed `status`) | 400/404/409/413 tests green |
| T3a.6 | `packages/domain/src/pagination.ts` + replace page-collection loops | 8 loops → 2 helpers |

**Exit gate:** `server/index.ts` < 80 lines; one route contract; characterization snapshot unchanged; Mongo integration green.

---

### WS3b — Scheduler decomposition (5–7 days)

**Objective:** Reduce `HarnessScheduler.run()` from a 249-line thirteen-responsibility method to an orchestration loop over five collaborators, proven behaviour-identical by a characterization snapshot.

**Execution plan:** [2026-11-07-ws3b-scheduler-decomposition.md](2026-11-07-ws3b-scheduler-decomposition.md)

| Task | Deliverable | Gate |
| --- | --- | --- |
| T3b.1 | Scheduler characterization suite (ordered event descriptors, dispositions, terminal status) | committed before any extraction |
| T3b.2 | Extract `EventRecorder` + `RunTermination` | snapshot identical |
| T3b.3 | Extract `InferenceGateway` (budget/timeout/usage/provenance) | snapshot identical |
| T3b.4 | Extract `ToolAdmission` (allowance/dedupe/yield/dispositions) | snapshot identical |
| T3b.5 | Extract `ReportPhase` | snapshot identical |
| T3b.6 | `run()` orchestration loop < 150 lines + per-collaborator unit tests | snapshot identical; scheduler tests green |
| T3b.7 | Optional S6 usage typing, isolated and gated | no event-payload change |

**Exit gate:** scheduler module < 150 lines orchestration; characterization snapshot byte-identical; fixture + integration evidence unchanged.

---

### WS3c — Domain, persistence and analysis-worker splits (6–8 days)

**Objective:** Split the domain oversight service, the persistence repository file, the analysis worker class and the healthcare service; complete the domain-failure migration.

**Execution plan:** [2026-11-07-ws3c-domain-persistence-worker-splits.md](2026-11-07-ws3c-domain-persistence-worker-splits.md)

| Task | Deliverable | Gate |
| --- | --- | --- |
| T3c.1 | Persistence split (`memory/`, `mongo/`, `schema.ts`), invariants exist once | WS1 contract suites green |
| T3c.2 | Oversight service split + `BlobStore` port for preview chunking | preview hash/cancel semantics preserved |
| T3c.3 | `AnalysisWorker` split into `LeaseKeeper`/`WindowRunner`/`ProgressLedger`/`UsageReconciler` | Jev tests green; class < 80 lines |
| T3c.4 | `HealthcareService` split; duplicated rules deleted | rules once; healthcare tests green |
| T3c.5 | `DomainFailure` producers + API mapper completion (X3) | HTTP statuses unchanged |

**Exit gate:** backend modules < 300 lines; contract suites, integration, compiled and migration-equivalence checks green.

---

### WS4 — Provider and scenario registries (6–8 days)

**Objective:** Collapse 9 provider-policy sites and 30 scenario literal sites into one registry each, with capability data rather than name checks. Backend only; dashboard wiring lands in WS6.

**Execution plan:** [2026-11-07-ws4-provider-scenario-registries.md](2026-11-07-ws4-provider-scenario-registries.md)

**Tasks**

| Task | Deliverable | Files | Gate |
| --- | --- | --- | --- |
| T4.1 | `ProviderProfile` registry in domain: `{ id, settings, validateSettings, resolveTransport, credentialEnv, usageSource, fixture }`; config validator, token-budget, hosted-model catalog, both model adapters and both provider resolvers consume it; delete the byte-identical `inference-provider.ts` copy | `packages/domain/src/providers/**`, `packages/domain/src/harness/{config,token-budget}.ts`, `api/src/server/adaption-models.ts`, `experiment-worker/src/harness/{inference-provider,mastra-adapter}.ts`, `analysis-worker/src/oversight/*` | provider-settings list count = 1; duplicate file deleted; adaption tests green |
| T4.2 | `ScenarioRegistry` in domain: per-version validator, tool allowlists, initializer, artifact schema, scripted driver, dashboard descriptor; delete healthcare checks from API and config validator | `packages/domain/src/scenarios/**`, `packages/domain/src/harness/**`, `experiment-worker/src/harness/{runtime,scenario,healthcare-scenario}.ts`, `api/src/healthcare/**` | scenario literal count ≤ 6 production sites; healthcare tests green |
| T4.3 | Metadata endpoints `GET /scenarios`, `GET /providers`; dashboard descriptors consume them and replace 5–7 hardcoded provider/scenario sites | `api/src/server/routers/**`, `packages/contracts/src/server/**`, `dashboard/src/lib/descriptors.ts`, `dashboard/src/components/{model-controls,budget-summary}.tsx`, `dashboard/src/pages/{Experiments,Runs}.tsx`, `dashboard/src/App.tsx` | adding a fixture provider in a test requires zero edits outside the registry |
| T4.4 | OCP proof test: a test-only `ProviderProfile`/scenario is registered in a test and flows through config validation, launch and dashboard descriptor without touching existing modules | `tests/integration/provider-registry.test.ts` | test green |

**Exit gate:** duplication census for provider settings = 1, scenario literals down ≥ 80%; no `provider ===` / version-string special cases outside registries.

---

### WS5 — Dashboard data-access foundation (6–8 days)

**Objective:** One way to fetch, one way to paginate, typed clients, and a stateless transport. Do this before touching page internals; it removes ~200 lines and makes WS6 decomposition mostly mechanical.

**Execution plan:** [2026-11-07-ws5-dashboard-data-access.md](2026-11-07-ws5-dashboard-data-access.md)

**Tasks**

| Task | Deliverable | Files | Gate |
| --- | --- | --- | --- |
| T5.1 | Path-keyed `useApi` + single pager; delete `useExactApi`/`useCursorPage`/`useRunPage` and every inline pager | `dashboard/src/lib/{api,paging}.ts`, `dashboard/src/pages/{Analysis,Oversight,Runs,Codebook}.tsx` | 0 page-local data hooks; stale-path test green; pagination contract test |
| T5.2 | Typed resource clients (`runs`, `codebooks`, `analyses`, `monitor`, `reviews`) replacing stringly paths and the five raw `/api/...` anchors | create `dashboard/src/lib/clients/*.ts`; modify pages | 0 raw `/api/` in JSX; `git grep "fetch("` = 1 |
| T5.3 | `jev-transport.ts` → stateless translators + one session cache owned by the analysis page/context; stop fabricating `revision`/`archived`/limits (server returns real values or view models drop them); move review-admission rules to the server | `dashboard/src/lib/jev-transport.ts`, `analysis-types.ts`, `api/src/routes/{jev,oversight}.ts`, `packages/contracts/src/analysis/**` | transport file has no module-level mutable cache and no admission rules |
| T5.4 | One envelope contract (`Page<T>`, `OffsetPage<T>`), delete `arrayOf`, type the `/runs/:id/:tab` responses | `dashboard/src/lib/**`, pages | no `arrayOf`; no `unknown` item renderers |
| T5.5 | Split `ReviewInput` into `WindowReviewInput` / `OutcomeReviewInput`; delete dead type exports and `resolvedSettings` from the view model | `dashboard/src/lib/{analysis-types,types}.ts` | ISP finding F13 closed; `npm run check` green |

**Exit gate:** one fetch path, one pager, typed calls, no raw anchors; dashboard smoke (`npm run smoke:dashboard`) green.

---

### WS6 — Dashboard page decomposition (12–18 days, one page per PR)

**Objective:** Each page becomes a router + view components that own their own data. Target: page file < 500 lines, component < 300 lines, no component with more than ~8 hooks.

**Execution plan:** [2026-11-07-ws6-dashboard-page-decomposition.md](2026-11-07-ws6-dashboard-page-decomposition.md)

**Task template (repeat per page):** create hook file(s) → create one component per view in a `Record<TabId, ComponentType>` registry → move markup verbatim → delete dead branches → update tests to render views with fixtures instead of stubbing `fetch` → PR.

| Task | Page | Key extractions | Gate |
| --- | --- | --- | --- |
| T6.1 | `Experiments.tsx` (1,209 → < 400) | `useExperimentDraft`, `useExperimentValidation`, `buildLaunchPayload`, `DraftLibrary`, scenario form sections | single owner of validity (server `/config/validate`); launch payload snapshot test |
| T6.2 | `Analysis.tsx` detail (959–1511) | `useAnalysisJob`, `useAnalysisWindows`, `useReviewBatches`, tab registry | each view rendered from fixture data; no per-call-site stale filtering |
| T6.3 | `Oversight.tsx` setup (194–772) | `MonitorSetupTab`, `DefinitionsTab`, `ReferencesTab`, `JobsTab` | tab components fetch only what they need |
| T6.4 | `Analysis.tsx` setup (205–932) | `useAnalysisDraft`, `useCodebookPicker`, `usePreview` | generation counter gone; one validation owner |
| T6.5 | `Runs.tsx` detail (206–897) | `useRunRecord`, `useRunProgress`, `useRunEvidence`, tab registry | 7 tabs as components; polling isolated |
| T6.6 | `Codebook.tsx` (568 → < 350) | `useCodebookDraft`, `validateCodebook`, shared pagers | three validation paths → one |
| T6.7 | Shell/shell-adjacent | move `RunTable` to components; `useClaimedReviewer`, `CancelJobButton`, `ReviewHistoryRow`; CSS ownership | no App↔Runs cycle; shared CSS imported only by owner |
| T6.8 | Registry dispatch | replace `tab ===` else-chains with `Record<TabId, ComponentType>` + `NotFound` fallback | unknown view renders not-found, not another feature |

**Exit gate:** dashboard largest file < 500 lines; pages = 0 data hooks; `npm test` (dashboard vitest) green; manual smoke on fixture run/dashboard.

---

### WS7 — Vocabulary unification and polish (4–6 days)

**Objective:** One table per closed vocabulary, one summary projection definition, and (optionally) versioned canonical hashing.

**Execution plan:** [2026-11-07-ws7-vocabulary-unification.md](2026-11-07-ws7-vocabulary-unification.md)

**Tasks**

| Task | Deliverable | Files | Gate |
| --- | --- | --- | --- |
| T7.1 | `statusMeta: Record<RunStatus, ...>` and `eventMeta` tables; `Badge` takes a semantic tone; delete fabricated statuses (`oversized → failed`) | `dashboard/src/lib/status.ts`, `dashboard/src/components/ui.tsx`, pages | new status compiles with exhaustive `Record`; dashboard tests green |
| T7.2 | `SUMMARY_OMIT` + `toRunSummary` single source; derive Mongo projection | `packages/contracts/src/harness/repository.ts`, `packages/domain/src/harness/repository.ts`, `packages/persistence/src/harness/**` | adding a heavy field requires one edit |
| T7.3 | Dispatch tables for `EvidenceKind`, `CanonicalSideEffect`, `MonitorView`; `TERMINAL_STATUSES`/`isTerminal` shared by adapters | `packages/contracts/src/**`, `packages/domain/src/**`, `packages/persistence/src/**` | counts in duplication census → 1 each |
| T7.4 | **Optional, gated:** versioned canonical hashing (`hashVersion: 2`, sorted keys), dual-read for stored v1 hashes, friendly 409 for stale previews; only if the decision log confirms no study data | `packages/domain/src/hashing.ts` + call sites + migration note | migration test for v1-record read path; decision recorded |

**Exit gate:** no duplicated vocabulary tables; re-audit medium findings ≤ 5.

## 5. Dependencies and parallelisation

```
Week 1        WS0 ─────────────┐
Week 2        WS1 ─────────────┤
Week 3        WS2 ─────────────┴──► WS3a (API) ──► WS5 (a→c)
Week 4        WS3b (scheduler)      WS3c (domain)   WS5 (d→e) ──► WS6 (pages)
Week 5        WS4 (registries) ─────────────────────────────────► WS6 (metadata)
Week 6        WS7 (vocabularies, gated hashing) ◄──────────────────┘
```

- **WS1 must land before WS2/WS3x/WS4/WS5**: the contract suites are the safety net for every later backend change and define what "no behaviour change" means.
- **WS2 must land before WS3b/WS3c/WS4/WS5**: the split ports and composition roots are the shared vocabulary for all later tasks.
- **WS3a must land before WS5**: typed clients depend on stable route shapes; WS5 must land before WS6.
- **WS4 metadata endpoints must land before WS6 T6.8**: WS6 owns the dashboard descriptor wiring.
- **WS3a and WS3c share `api/src/healthcare/**`**: WS3a lands first (route registration + the one-line request-body compatibility edit), WS3c then owns the internals.
- **Cross-plan dependency register:**
  - **D5.1** — WS3a Step 5.4b adds the server-side one-source-event review rule (message preserved). WS5 T5.4 must not merge before it.
  - **D5.3** — the one-line `RunSummary` export in `packages/contracts/src/browser.ts` is approved and owned by WS5 T5.3 (no fallback declaration needed).
  - **Mode A/B** — WS3b consumes WS2's split ports. If WS3b starts first, it uses its T3b.0 compatibility shim and WS2 rebases the same signature lines; never run them concurrently.
- **Shared-file sequencing is binding**: see [`2026-11-07-plan-conventions.md`](2026-11-07-plan-conventions.md) §4.

## 6. Team scenarios

| Scenario | Plan | Calendar |
| --- | --- | --- |
| 1 engineer | strict WS0→WS1→WS2→WS3a→WS3b→WS3c→WS4→WS5→WS6→WS7 order | 9–12 weeks |
| 2 engineers | Lane A (WS2→WS3a→WS3b→WS3c→WS4) + Lane B (WS5→WS6 after WS3a) | 6–8 weeks |
| 3 engineers | A: WS3a→WS3b; B: WS2→WS3c→WS4; C: WS5→WS6 | 5–6 weeks |
| Minimum viable (time-boxed) | WS0, WS1, WS2, WS5.1–5.2, WS6.1–6.2, WS7.1–7.2 | 3–4 weeks |

**Cut line:** if time runs out, the program is still successful if WS0–WS2 plus WS5.1–5.2 land: evidence integrity is proven, ports are right-sized, and the biggest duplication is gone. WS3/WS6 are the long tail.

## 7. PR and review policy

1. One task = one PR (occasionally one PR for a task's tests+fix when small). Title: `refactor(<scope>): <task id> <summary>`.
2. Every PR description includes: task id, finding ids closed, verification commands run with results, behaviour-change statement ("none expected; evidence: …").
3. Reviewer checklist: budgets respected, no new `as unknown as`, no cross-layer import, tests added, no behaviour deltas in fixtures.
4. Refactors that must stay in sync (server + dashboard) are one PR; do not split across releases.
5. After each workstream: update `docs/solid-remediation-decisions.md`, re-run the architecture budget, and record the metric delta.
6. Rollback plan per PR: `git revert` is sufficient; no destructive DB migration is permitted in WS0–WS6. WS7 T7.4 is additive/versioned.

## 8. Risk register and mitigations

| # | Risk | Probability | Impact | Mitigation | Trigger/response |
| --- | --- | --- | --- | --- | --- |
| R1 | Scheduler extraction changes event order or budget accounting | Medium | Critical | T3b.1 characterization snapshot; fixture + integration evidence gates; extract one collaborator per PR | Snapshot diff → revert PR, re-derive sequence, add missing event assertion |
| R2 | Hash unification invalidates stored previews/reviews/launch keys | Medium | High | T1.2 preserves byte-identical output; canonical ordering deferred to T7.4 with versioning + friendly 409 | 409 storm in local data → keep legacy verifier, bump version |
| R3 | Contract-parity fixes change in-memory test expectations elsewhere | High | Medium | Contract suite defines agreed semantics first; update affected tests in the same PR with rationale | Unexpected red in unrelated suites → audit both adapters, add parity test |
| R4 | Dashboard decomposition breaks rendering while tests still pass (tests stub fetch) | Medium | Medium | WS5 replaces fetch-stubbing with fixture-rendered components before WS6; visual smoke on fixture dashboard each page | Visual diff → revert page PR; fixture render test added |
| R5 | Parallel lanes conflict on shared contracts (`packages/contracts`) | Medium | Low | Contracts changes are owned by the workstream that introduces them; announce before editing; rebase daily | Conflict → re-order tasks, keep contract change in one PR |
| R6 | Mongo integration becomes flaky/slow in CI | Low | Medium | Existing isolated Mongo step; DB-per-test UUID; no retries for assertions | Flake → isolate test, add deterministic seeding |
| R7 | Refactor scope creeps into feature work | Medium | High | Global constraint "no feature/UI change"; PR checklist; audit ids map to tasks | Scope creep → split issue, defer to post-program backlog |
| R8 | Program stalls mid-WS3 leaving a half-split API | Medium | High | Task ordering (tests first, small extractions); every task leaves the tree green; WS3a/3b/3c lists ordered by dependency | Stall → revert to last green task; cut line (Section 6) |
| R9 | Third-party types (Mastra) fight the new ports | Medium | Low | Adapters stay in services; ports stay minimal; no Mastra type leaks into contracts | Type fight → widen local adapter type, keep port |

## 9. Verification and definition of done

**Per-PR:** `npm run lint`, `node scripts/verify-boundaries.mjs`, `npm run check`, `npm test`, `npm run architecture:check`; backend PRs also `npm run test:integration`; affected PRs also `npm run build` and `node scripts/verify-compiled.mjs`.

**Per-workstream:** `npm run verify`, `node scripts/verify-migration-equivalence.mjs`, fixture export comparison (`agent/examples/completed-fixture.json` semantics: event types/order, report parsing, final artifact), dashboard smoke (`npm run smoke:dashboard`), Jev smoke (`npm run smoke:jev`).

**Program done when:**

- [x] All 4 critical and 25 high findings are closed or explicitly accepted with written rationale in `docs/solid-remediation-decisions.md`.
- [x] Contract suites exist for every persistence port and run against both adapters in CI.
- [x] Architecture budgets in CI: largest page < 500 lines, no page defines data hooks, provider-settings copy count = 1, scenario literals ≤ 6, no byte-identical duplicate files, no `as unknown as` on ports.
- [x] Boundary verifier extended and green; structural lint rules active.
- [x] Evidence equivalence: scripted fixture runs match pre-refactor event sequence/artifact; integration suite green.
- [ ] Re-audit (rerun the SOLID audit) shows overall grade ≥ B and SRP ≥ C+, with 0 critical/high findings.
- [x] `README.md` points to the audit, plan, and decision log.

> **Execution record (2026-11-07):** the program was executed on branch `refactor/solid-remediation` in a dedicated worktree. Every workstream landed with its task-level gates green; the final measured census, commit anchors, gate evidence, accepted deferrals (notably WS7 T7.4 canonical hashing) and environment limitations are recorded in [`docs/solid-remediation-decisions.md`](../../solid-remediation-decisions.md). The single unchecked criterion — the independent re-audit — is an external acceptance step and was not run as part of this execution.
>
> **Main integration (2026-11-07):** while the program closed out, `main` advanced by seven commits (`48a2170`) with behaviour the audit predates. They were merged into the branch (`6dcb106`, never a rebase) and re-expressed on the refactored architecture: the `submit_report` report protocol, the expiring worker lease, inference fixes, artifact diagnostics with the 16,384-token default, scripted playbooks (registry + API + worker runtime + dashboard picker) and the model-call/trace run UI. The binding interfaces were extended in `2026-11-07-plan-conventions.md` (lease `WorkerGuard`/`WorkerStatus`, `ProviderProfile.adapterKind`/`validateModel`, `ResolvedTransport.assistantTextItemIds`, browser vocabulary/playbook exports). Evidence was re-recorded once, with the deltas recorded in the decision log §Main integration: scheduler snapshots +4/+10 events, the route-contract snapshot (+11 research / +1 demo cases, 44 v2/worker-shape changes, none removed), the committed fixture export regenerated 103 → 127 events, and the migration-equivalence baseline re-recorded through its explicit switch. Further `main` movement is integrated under the same policy and recorded there.

## 10. Immediate next actions

1. Confirm team size and whether local/persisted research data must be preserved (affects WS7 T7.4 canonical hashing).
2. Execute WS0 T0.1–T0.2 (create the budget script, delete dead code) from this plan.
3. Execute WS1 from its execution-ready plan, starting with Task 1.
4. Then execute WS2 from its plan; WS3a/WS3b/WS3c and WS5 may start in parallel per Section 5 (respecting the shared-file sequencing table and D5.1/D5.3).
5. Keep [`2026-11-07-plan-conventions.md`](2026-11-07-plan-conventions.md) open while running subagent-driven execution: it holds the binding interfaces and file-ownership rules. All nine execution plans are written; when one disagrees with this program plan, the execution plan wins (it was written against the source) — update Appendix C rather than silently diverging.

## Appendix A — Finding-to-workstream map

| WS | Finding IDs |
| --- | --- |
| WS0 | P10 (dead `readyJob`), S10 (orphan starter agent), F13 (dead exports), F19 (unused imports), X4 (housekeeping only) |
| WS1 | P5, P6, P7, P8, P9, X6 (de-duplication) |
| WS2 | P10, S8, S10 (composition roots), D13 (store-protocol half) |
| WS3a | S1, X3 (API mapper + `jev-reviews.ts` typed throws), X4, X5 |
| WS3b | S2 (S6 deferred to backlog) |
| WS3c | P1, P2, S3, S9, X3 (producer completion) |
| WS4 | X1, X2, S3 (duplication half) |
| WS5 | F8, F9, F10, F11, F12, F16, F13 (types) |
| WS6 | F1, F2, F3, F4, F5, F6, F7, F14 (dashboard), F17, F18, F19, F13 (leftovers) |
| WS7 | F15, P3, P4, X6 (canonical half, gated) |

Note: X3 (HTTP status codes in domain) is split — WS3a removes message-regex/duck-typed mapping and defines failure-kind mapping; WS3c migrates domain throw sites. F14 is split — WS4 provides provider/scenario metadata endpoints; WS6 wires the dashboard descriptors.

## Appendix B — Accepted deferrals

| Finding | Decision | Rationale |
| --- | --- | --- |
| X6 canonical ordering | Deferred to WS7 T7.4, versioned/gated | Changing persisted identity hashes needs a data-migration policy; de-duplication lands in WS1 without changing values |
| P9 healthcare catalog integrity parity | Partially accepted | In-memory catalog stores structured values and legitimately cannot reproduce byte-level integrity checks; shared validation is unit-tested instead |
| P6 `workerStatus` richness | Accepted | Worker registration has no heartbeat by design (decision 6 in `agent/docs/decisions.md`); typed shape + note is the honest contract |
| S6 usage provenance typing | Deferred to the post-program backlog (WS3b T3b.7) | Typing `ModelResponse` usage provenance requires edits in WS2-owned contracts and WS2/WS4-owned adapters while keeping recorded `model_usage` payloads byte-identical; it is a medium finding, and WS2 already types the analysis-side `AnalysisAttempt.usage` |
| D13 zod runtime dependency in `packages/contracts` | Accepted | Contracts stays data-shape + declarative schema; the store-protocol half of D13 (collection/partition/key leakage, untyped filters) is closed by WS2 T2.4. Moving zod schemas to domain was assessed in WS2/WS4 and rejected as a larger schema-extraction project with no correctness payoff |

## Appendix C — Execution plan index

All execution-ready plans live in `docs/superpowers/plans/` and follow [`2026-11-07-plan-conventions.md`](2026-11-07-plan-conventions.md):

| Plan | Workstream | Tasks | Effort |
| --- | --- | --- | --- |
| [2026-11-07-ws1-adapter-contract-parity.md](2026-11-07-ws1-adapter-contract-parity.md) | WS1 | 7 | 5–7 d |
| [2026-11-07-ws2-ports-and-composition-roots.md](2026-11-07-ws2-ports-and-composition-roots.md) | WS2 | 6 | 4–6 d |
| [2026-11-07-ws3a-api-server-and-route-contract.md](2026-11-07-ws3a-api-server-and-route-contract.md) | WS3a | 6 | 5–7 d |
| [2026-11-07-ws3b-scheduler-decomposition.md](2026-11-07-ws3b-scheduler-decomposition.md) | WS3b | 8 | 5–7 d |
| [2026-11-07-ws3c-domain-persistence-worker-splits.md](2026-11-07-ws3c-domain-persistence-worker-splits.md) | WS3c | 5 | 6–8 d |
| [2026-11-07-ws4-provider-scenario-registries.md](2026-11-07-ws4-provider-scenario-registries.md) | WS4 | 5 | 6–8 d |
| [2026-11-07-ws5-dashboard-data-access.md](2026-11-07-ws5-dashboard-data-access.md) | WS5 | 5 | 6–8 d |
| [2026-11-07-ws6-dashboard-page-decomposition.md](2026-11-07-ws6-dashboard-page-decomposition.md) | WS6 | 10 | 12–18 d |
| [2026-11-07-ws7-vocabulary-unification.md](2026-11-07-ws7-vocabulary-unification.md) | WS7 | 6 | 4–6 d |

WS0 has no separate plan; its tasks are inline in §4. Total: **58 tasks across nine execution plans, ~53–75 dev-days** (plus WS0's 2–3 days). When a plan's task list disagrees with this program plan, the execution plan wins (it was written against the source) — update this table rather than silently diverging.

All plans were authored against baseline `20bc219`; the tree advanced to `5a31bf7` (unrelated smoke-test docs from a concurrent session) during authoring, so execution re-locates anchors by content.

**Execution status (2026-11-07):** all nine plans and WS0 were executed on branch `refactor/solid-remediation`; see the execution record in [`docs/solid-remediation-decisions.md`](../../solid-remediation-decisions.md) for per-workstream commit anchors, the final architecture census, gate evidence, and the accepted deferrals (WS7 T7.4 canonical hashing, S6 usage provenance, S4/S7 backlog, P6/P9 accepted). The remaining program criterion is the independent re-audit.

## Appendix D — Decision log (to be maintained in `docs/solid-remediation-decisions.md`)

| Date | Decision | Rationale | Owner |
| --- | --- | --- | --- |
| 2026-11-07 | Contract suites live in `tests/integration/` and run memory-only under `npm test`, memory+Mongo under `npm run test:integration` | Avoids shipping test helpers in production packages while keeping fast feedback and CI parity | Lead |
| 2026-11-07 | Hashing de-duplicated with byte-identical output first; canonical ordering versioned later | Persisted identity keys (launch, review, preview) must not silently change | Lead |
| 2026-11-07 | No destructive DB migrations in WS0–WS6 | Rollback stays `git revert`-only | Lead |
| 2026-11-07 | WS3 is split into WS3a (API), WS3b (scheduler) and WS3c (domain/persistence/workers) | Each is independently executable and revertable; characterization tests stay close to the code they protect | Lead |
| 2026-11-07 | Binding interface decisions and file-ownership/sequencing rules live in `2026-11-07-plan-conventions.md` | Independently written plans must compose; shared-file edits are ordered, not concurrent | Lead |
| 2026-11-07 | F14 is split: WS4 provides metadata, WS6 wires the dashboard | Avoids two workstreams editing the same dashboard components | Lead |
| 2026-11-07 | `createPair` is on `RunQueue`; `requestCancel` is on `RunStateStore` (not the researcher-only port) | The worker loop cancels the active run on shutdown and the API cancels via the same operation; one port owns run-state mutation | Lead |
| 2026-11-07 | Dashboard reads use ONE implementation (`useResource`/`useResourcePage`/`useResourceOffsetPage` in `lib/clients/query.ts`) with path-based wrappers; six typed clients incl. `experimentsClient`; fake clients injected via `ApiClientProvider` | Client-parameterised hooks are what let WS6 render views from fixtures and delete global-fetch stubbing; path wrappers keep undecayed pages working during migration | Lead |
| 2026-11-07 | Characterization baselines never silently regenerate committed evidence (`agent/examples/completed-fixture.json`). A drift is recorded as a finding and the test pins current code | The committed export is a research artifact referenced by the README/audit; rewriting it to make a test go green would hide evidence drift | Lead |
| 2026-11-07 | X3 ownership: WS3a types the 24 `Error` throws in `packages/domain/src/analysis/jev-reviews.ts` and adds D5.1 there; WS3c owns the oversight/analysis-service producers | Required to close X3 without a fourth workstream; the file was unowned in the original layout | Lead |
| 2026-11-07 | D5.1 accepted; D5.3 approved | D5.1 keeps the dashboard's exact refusal message after moving the rule server-side; D5.3 removes a fifth `RunSummary` declaration for one export line | Lead |
| 2026-11-07 | WS3a's two route-contract deltas are accepted: review body 1–2 MB now returns 413 (was 400), and unread malformed bodies no longer force 400 | Both are consequences of one lazy body reader with per-route limits; both are pinned by tests and the route-contract snapshot is otherwise identical | Lead |
| 2026-11-07 | Dashboard read seam: WS5 ships `lib/clients/query.ts` (`useResource*`) as the single implementation; path hooks wrap it; WS6 consumes it and owns the `experimentsClient` facade plus a `useCommand` wrapper over `useMutation` | Resolves the WS5/WS6 seam found during plan integration; fake-client fixture rendering requires client-parameterised reads | Lead |
| 2026-11-07 | WS3c owns `packages/domain/src/harness/launch.ts` (launch/pair invariants moved out of persistence); WS3a keeps only `differences()` in the pairs router | One owner for the invariants; avoids WS3a duplicating domain rules it does not own | Lead |
| 2026-11-07 | WS3c composes `BlobStore` as `MonitorStore = ResearchStore & BlobStore` rather than adding a parameter; blob rows and preview hashes stay byte-identical | Same inversion with no call-site churn; verified by preview-hash tests | Lead |
| 2026-11-07 | WS3c's single status change is accepted: two preview-integrity failures move `500 → 503` (`unavailable`) | They are genuine unavailability/conflict conditions, no test asserts 500, and the mapper vocabulary has no 500 kind | Lead |
| 2026-11-07 | Healthcare duplication (S3) is already resolved at the execution baseline; WS3c adds a re-duplication guard instead of a deletion, and WS4 T4.2 drops the API-side deletion | A concurrent session removed `HealthcareService.configurationErrors` after the audit; plans must reflect the tree, not the snapshot | Lead |
