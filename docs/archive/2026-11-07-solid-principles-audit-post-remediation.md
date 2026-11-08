---
date: 2026-11-07 22:40:00 -05:00
researcher: lead agent (SOLID audit, post-remediation follow-up)
git_commit: fd07454
branch: main
repository: sidechannel
topic: "SOLID-principles audit of the sidechannel research harness after the 2026-11-07 remediation program"
tags: [research, codebase, solid, architecture, dashboard, scheduler, persistence, contracts, remediation, guardrails]
status: complete
last_updated: 2026-11-07
last_updated_by: lead agent
---

# Research: SOLID audit after the remediation

## Research question

Audit the repository against the SOLID principles and produce a report of the areas, modules,
services and code that violate them — 162 commits after the previous SOLID audit and its
nine-workstream remediation program closed all 45 of its findings.

**Deliverable:** [`2026-11-07-solid-audit-post-remediation.html`](2026-11-07-solid-audit-post-remediation.html)
— a self-contained, filterable HTML report (53 verified findings,
2 critical / 23 high / 19 medium / 9 low, a
guardrail scoreboard against the pre-remediation baseline, hotspots, a duplication/cast census,
a re-verification of every deferred item, and a three-phase roadmap).

## Summary

**The skeleton held; the new tissue re-accreted in a different shape.** The previous audit
(45 findings, 4 critical) was followed by a remediation that closed every finding and left
mechanical guardrails behind. Re-measured now: the dependency-boundary verifier and the
composition verifier pass, all eight projects typecheck, there is exactly one network `fetch`
in 175 dashboard production files, the three repositories are genuine capability slices with
shared contract suites, provider/scenario registries are real data, the status vocabulary is
single-sourced, and 13 of 15 architecture budgets hold. The largest source file fell from
2,523 lines to 514; there are zero `@ts-ignore`, zero mutable module singletons, zero
byte-identical duplicate files, and the largest cross-file duplicate block is 12 lines.

What returned is duplication of **logic** rather than literals, and concentration in **hooks**
rather than page components:

- one policy (pair comparability) has two shipped, contradictory implementations (`C2`);
- the dashboard's dependency direction now runs backwards — `lib` and `components` import from
  `pages` in six production edges (`C1`);
- four closures own several change axes each: a 295-line / 45-member codebook draft hook, a
  219-line experiment draft hook, a 418-line window-inspector function, a 30-field setup props
  object;
- the extensibility seams the core got right are bypassed on the new surfaces: tool admission
  (three expressions), evidence tabs (if-chain beside a working registry), experiment sections
  (parallel list + literal step number), adapter-kind selection (fail-open `default`);
- the typed client layer is cast-deep (34 `as unknown as` casts, two client methods returning
  `unknown`), and three adapter divergences sit outside the contract suites;
- two of the repository's own budgets are red, both introduced by post-remediation commits.

Scores: SRP **C+** (was D), OCP **C+** (was C-), LSP **C+** (was C), ISP **B-** (was C+),
DIP **C** (was C+); overall **C+** (was C). Violation density fell from 2.46 to
1.80 findings per 1k production lines while the tree grew
from 18,257 to 29,450 production lines.

## Guardrail scoreboard (re-measured)

| Metric | First audit | Remediation close | Now | Budget | Status |
| --- | --- | --- | --- | --- | --- |
| `largestSourceFileLines` | 2,523 | 431 | **514** | 500 | **over** (`dashboard/src/components/ui.tsx`) |
| `largestPageFileLines` | 2,523 | 149 | 160 | 500 | ok |
| `largestBackendModuleLines` | 264 | 242 | 242 | 300 | ok |
| `pageFilesDefiningDataHooks` | 4 | 0 | 0 | 0 | ok |
| `fetchPageImplementations` | 6 | 1 | 1 | 1 | ok |
| `providerSettingsPolicySites` | 9 | 1 | 1 | 1 | ok |
| `providerNameBranchSites` | 16 | 5 | 7 | 7 | at ceiling |
| `scenarioVersionLiteralSites` | 30 | 6 | 6 | 6 | ok |
| `scenarioVersionConstantReferences` | 16 | 12 | 12 | 12 | ok |
| `byteIdenticalDuplicateFiles` | 2 | 0 | 0 | 0 | ok |
| `statusVocabularyTableDefinitions` | – | 16 | 16 | 16 | ok |
| `statusVocabularyDuplicateSites` | 8 | 3 | **4** | 3 | **over** (`components/pairs/group.ts:79`) |
| `AnalysisRepository` members | 28 | 0 (composed) | 0 | 0 | ok |
| `ResearcherRepository` members | 20 | 0 (composed) | 0 | 0 | ok |
| `Repository` members | 7 | 0 (composed) | 0 | 0 | ok |

Other gates re-run during the audit: `node scripts/verify-boundaries.mjs` **pass**,
`node scripts/verify-composition.mjs` **pass**, `tsc --noEmit` for all eight projects **pass**
(after building the three shared packages), `node scripts/architecture-budget.mjs --check`
**exit 1**. `npm run check` / `npm test` cannot execute in the audit sandbox: NX forks child
processes and the sandbox denies the spawn (`EPERM`) — an environment boundary, not a code signal.

## Method note

The audited tree moved once, mid-audit: a concurrent pull replaced the local head 07e85da
with origin/main at fd07454 (113 files, mostly dashboard CSS). The full census was re-run
against fd07454 with every quoted metric unchanged, and every critical/high anchor was
re-located by content on the new head before publication — line references describe fd07454.

## Findings

| ID | Principle | Severity | Title | Anchor |
| --- | --- | --- | --- | --- |
| C1 | DIP | critical | The dashboard's dependency direction now runs backwards: lib and components import from pages | `dashboard/src/lib/clients/experiments.ts:4` |
| C2 | LSP | critical | One pair, two comparability verdicts: the same policy is implemented twice with contradictory rules | `dashboard/src/components/pairs/group.ts:59-90` |
| H1 | SRP | high | panels.tsx carries a dead 195-line duplicate of the evidence family, plus three orphaned imports | `dashboard/src/pages/runs/panels.tsx:187-381 (dead)` |
| H2 | LSP | high | Two components share the names TimelinePanel/TracesPanel with incompatible props, and the richer contract is unreachable | `dashboard/src/pages/runs/panels.tsx:179-184` |
| H3 | SRP | high | WindowInspector is one 418-line function owning evidence, judgment form, blind policy, save orchestration and review history | `dashboard/src/pages/analysis/window-inspector.tsx:14-431` |
| H4 | SRP | high | useCodebookDraft is a 295-line hook returning 45 members and owning five change axes | `dashboard/src/pages/codebook/use-codebook-draft.ts:16-310` |
| H5 | SRP | high | useExperimentDraft owns persistence, ten commands, launch-idempotency keys and navigation | `dashboard/src/pages/experiments/use-experiment-draft.ts:21-239` |
| H6 | OCP | high | Experiment sections are a parallel list plus an if-chain, and the review step number is the literal 6 | `dashboard/src/pages/experiments/sections.ts:7-22` |
| H7 | SRP | high | The browser re-implements the server config schema three times, and one helper is duplicated verbatim | `dashboard/src/pages/experiments/config-edit.ts:22-48` |
| H8 | SRP | high | Three independent localStorage draft-recovery implementations, and the reviewer identity written in four places despite a shared hook | `dashboard/src/pages/oversight/definitions-tab.tsx:41-66` |
| H9 | SRP | high | The runs router is one 91-line handler over ten operations, with the operation list baked into a regex | `api/src/server/routers/runs.ts:20 (route regex)` |
| H10 | LSP | high | One handler contract, three failure encodings — and a failed evaluator reported as HTTP 200 | `api/src/healthcare/routes.ts:15,22,35` |
| H11 | SRP | high | Config validation performs live network I/O and reconstructs field paths by regex | `api/src/server/configuration.ts:17-46` |
| H12 | SRP | high | The scheduler decomposition moved code, not ownership: four collaborators mutate the same Run aggregate | `experiment-worker/src/harness/scheduler.ts:64` |
| H13 | SRP | high | runWorker carries a second, divergent terminal-status taxonomy; scheduler throws are classified by a different rule | `experiment-worker/src/worker.ts:25-102` |
| H14 | LSP | high | Three ModelAdapters honour different contracts, and the transport body is duplicated across the two services | `experiment-worker/src/harness/mastra-adapter.ts:51-79` |
| H15 | SRP | high | Every evidence tab owns fetch + derivation + authored finding prose + presentation, and its model logic is untestable | `dashboard/src/components/run-evidence/artifacts-tab.tsx:153-176,213-232` |
| H16 | LSP | high | The page envelope is declared three times and the “typed” evidence contract is enforced only by casts | `dashboard/src/lib/contracts.ts:5` |
| H17 | DIP | high | Components build HTTP paths by hand, and the live stream is a second network boundary outside the transport seam | `dashboard/src/components/run-evidence/downstream.tsx:53-61` |
| H18 | OCP | high | Tool admission is expressed three times — catalog, allowlist table and if-chain — so a new tool is a four-site edit | `experiment-worker/src/harness/gateway.ts:9-15 (catalog)` |
| H19 | ISP | high | AnalysisSetupState is a 30-field props object that five sections must accept whole | `dashboard/src/pages/analysis/analysis-setup.tsx:28-111 (hook)` |
| H20 | ISP | high | ResearchStore is still a document-store protocol: collection-keyed CRUD, CAS and leases in one 7-member port | `packages/contracts/src/analysis/store.ts:10,14-22` |
| H21 | LSP | high | The two research-store adapters page with different comparators, so a cursor can skip a row in one deployment only | `packages/persistence/src/analysis/store.ts:14 (memory)` |
| H22 | DIP | high | Turn summaries and event-phase policy exist once as domain code and again as a Mongo aggregation | `packages/domain/src/harness/event-pages.ts:39-51 (phase), :63-78 (turns)` |
| H23 | DIP | high | The dataset export link points at a route the API does not register — and a test now pins the broken URL | `dashboard/src/lib/clients/analyses.ts:82-83` |
| M1 | OCP | medium | The evidence-tab dispatcher open-codes a vocabulary the contracts layer already closes | `dashboard/src/components/run-evidence/evidence-tab.tsx:36-38,47,59,70,80-82` |
| M2 | SRP | medium | evidence-model.ts is a 419-line grab-bag, and the ranking validator it exports is duplicated with divergent failure handling | `dashboard/src/components/run-evidence/evidence-model.ts:1-419 (20 exports)` |
| M3 | SRP | medium | Oversight routing is a second, parallel route framework with its own limit validator, error mapper and 404 | `api/src/routes/oversight.ts:14,18-76,22 (nested op regex),69,73` |
| M4 | OCP | medium | “Read every page” has three helpers and five hand-rolled cursor loops, because the store ports disagree on page shape | `packages/domain/src/pagination.ts:6` |
| M5 | SRP | medium | ReviewService.getBatch fuses blind-mode disclosure, history aggregation, queue filtering and pagination | `packages/domain/src/analysis/jev-reviews.ts:82-121` |
| M6 | OCP | medium | A provider-name literal survives inside domain projection, and a registered profile cannot honour its own interface | `packages/domain/src/harness/repository.ts:25` |
| M7 | OCP | medium | runtimePlugins claims “registry data only” but switches on adapterKind with a fail-open default | `experiment-worker/src/harness/runtime.ts:36-51` |
| M8 | DIP | medium | The JEV transport is constructed inside the use case and reads credentials in its constructor | `analysis-worker/src/jev/jev-worker.ts:43` |
| M9 | DIP | medium | Three lease-heartbeat implementations with different loss semantics — including one that cannot abort in-flight work | `experiment-worker/src/harness/worker-lease.ts:63` |
| M10 | SRP | medium | The pair comparison grid is seven hand-rolled two-sided rows, and three rules are re-derived across the pair screens | `dashboard/src/pages/runs/pair-detail.tsx:159,177,203,228,244,272,301` |
| M11 | SRP | medium | Overview keeps the path-string read idiom, redeclares response shapes and repeats the worker-state sentence three times | `dashboard/src/pages/Overview.tsx:6,15-22,28,71-76,80-81,108-109,120-121,125-127` |
| M12 | DIP | medium | Route bodies cross the HTTP boundary as unvalidated `as unknown as` casts | `api/src/routes/jev-routes.ts:29,34,39,42,47` |
| M13 | SRP | medium | Three adapter-parity gaps the shared contract suites cannot see | `EVIDENCE_KEY_COERCION contracts/harness/repository.ts:35-39 vs persistence/src/harness/memory/repository.ts:92` |
| M14 | ISP | medium | Two more ports stay wider than their consumers: AnalysisWorkerStore and HealthcareCatalog | `packages/contracts/src/analysis/jev-repository.ts:118 (worker store)` |
| M15 | SRP | medium | The repository's own architecture gate is red: two budgets now fail, and both are cheap code fixes rather than re-baselines | `scripts/architecture-budget.json:10-14,87-93` |
| M16 | OCP | medium | Field errors are reconstructed from free-text messages by regex and a hardcoded name map | `packages/contracts/src/server/config-schema.ts:31-38` |
| M17 | LSP | medium | putBlob returns a manifest for a write the store silently rejected — and the contract suite pins the lie | `packages/persistence/src/oversight/blob-store.ts:15-22` |
| M18 | ISP | medium | Two provider ports for one concept: one carries failure/attempt/retry state, the other returns a bare pair | `packages/contracts/src/analysis/jev-provider.ts:11-16,32` |
| M19 | ISP | medium | PrivateMemory is a two-signature port with no contract suite, and its only implementation coerces roles lossily | `packages/contracts/src/harness/server.ts:28-31` |
| L1 | OCP | low | Six “why is the primary action disabled” ladders with independent copy and independent predicates | `experiments/experiment-editor.tsx:61-67 + launch-review.tsx:103` |
| L2 | SRP | low | Test-only fixtures live in two production source trees and are counted as production code | `api/src/server/route-contract-cases.ts:1-221 (imported only by route-contract.test.ts:5)` |
| L3 | SRP | low | Shared text and guard helpers have no home: isRecord ×11, plural ×7, ellipsize ×6 | `isRecord: packages/domain/src/harness/config.ts:63, providers/settings.ts:16, api/src/playbook/service.ts:4, dashboard lib/model-calls-types.ts:88 + 7 page/component copies` |
| L4 | SRP | low | Verified debris: a dead events-hook twin, an identical-arm ternary, a no-op null branch, a confirm dialog in a presentational control and a duplicate fetch | `dashboard/src/lib/descriptors.ts:95` |
| L5 | OCP | low | Evidence-view cardinality is a magic 4 in three files, and the ladder is a second copy of the view names | `dashboard/src/pages/oversight/views.tsx:16-22` |
| L6 | SRP | low | Residual over-fragmentation: re-export-only modules and six exported names for two hash functions | `packages/domain/src/oversight/service.ts:5-9` |
| L7 | SRP | low | The decision log contradicts the committed evidence it says was never rewritten | `docs/solid-remediation-decisions.md:137,268` |
| L8 | SRP | low | The healthcare persistence adapter owns display copy, status literals and a read-path integrity policy | `packages/persistence/src/healthcare/catalog.ts:8,20,47` |
| L9 | LSP | low | Page-test clients share the production client type but not its wire contract, and are activated through a module global | `dashboard/src/test/clients.tsx:55-62,82` |

Full evidence, rationale and refactor direction per finding: the HTML report (filterable by
severity, principle and area).

### Critical

- **C1 (DIP)** — `lib/clients/experiments.ts:4` and four `components/run-evidence` files import
  from `pages/**`; the package boundary rule is green because it does not look inside the
  workspace. Blocks reuse of the run-evidence family and destabilises the page-split in flight.
- **C2 (LSP)** — `components/pairs/group.ts:76` requires both runs `completed`;
  `run-evidence/evidence-model.ts:198` accepts both terminal at the same round/turn. A pair of
  two failed runs reads "comparable" in the artifacts tab and "not comparable" in the pairs table.

### Highest-leverage refactors

1. Fix the inverted direction and add an ESLint restriction banning `pages/**` imports from
   `lib/**` and `components/**`.
2. Split the four mega-closures (`useCodebookDraft`, `useExperimentDraft`, `WindowInspector`,
   `AnalysisSetupState`) by change axis.
3. Replace the new if-chains with the registries that already exist next door (evidence tabs,
   experiment sections, tool admission, adapter-kind selection).
4. One failure encoding at the API edge (`DomainFailure` only) and typed route bodies.
5. One comparability rule, one artifact validator, one status→tone table, one reviewer-identity
   writer — all P0-sized deletions/unifications.
6. Turn the two red budgets green in code (extract primitives from `ui.tsx`; import
   `ACTIVE_RUN_STATUSES`/`INCOMPLETE_RUN_STATUSES`) rather than re-baselining.

## Code references

- Inverted layering: `dashboard/src/lib/clients/experiments.ts:4`,
  `dashboard/src/components/run-evidence/{evidence-tab.tsx:3-5,board-tab.tsx:18,evidence-model.ts:2}`
- Contradictory comparability: `dashboard/src/components/pairs/group.ts:59-90` vs
  `dashboard/src/components/run-evidence/evidence-model.ts:189-215`
- Dead 195-line duplicate: `dashboard/src/pages/runs/panels.tsx:187-381`
- Mega-hooks: `dashboard/src/pages/codebook/use-codebook-draft.ts:16-310`,
  `dashboard/src/pages/experiments/use-experiment-draft.ts:21-239`,
  `dashboard/src/pages/analysis/window-inspector.tsx:14-431`,
  `dashboard/src/pages/analysis/analysis-setup.tsx:85-110`
- Tool admission: `experiment-worker/src/harness/gateway.ts:9-15,38,41-62`
- Lease/paging parity: `packages/persistence/src/analysis/store.ts:14,33`;
  `packages/persistence/src/harness/memory/repository.ts:84,92` vs
  `packages/persistence/src/harness/mongo/repository.ts:119,128`
- Policy duplicated into the storage language: `packages/domain/src/harness/event-pages.ts:39-78`
  vs `packages/persistence/src/harness/mongo/repository.ts:133-156`
- Wide ports: `packages/contracts/src/analysis/store.ts:14-22`,
  `packages/contracts/src/analysis/jev-repository.ts:118`,
  `packages/contracts/src/healthcare/repository.ts:3-13`
- Failing budgets: `dashboard/src/components/ui.tsx:484-514`,
  `dashboard/src/components/pairs/group.ts:79`, `dashboard/src/lib/status.ts:160`

## Metric summary

- Production: **324 files / 29,450 lines** (dashboard 175 / 21,542 — 73.1%).
  Tests: 128 files / ~10,900 lines. First audit: 149 / 18,257.
- One network `fetch`; one raw `/api/` URL outside the client graph (an `EventSource`).
- `as unknown as` 34 / 15 files; `as any` 5; `@ts-ignore` 0.
- Largest cross-file duplicate block 12 lines; zero byte-identical production files.
- `isRecord` defined 11 times with 3 contracts; `plural` 7 times; 63 non-null assertion chains
  across 23 dashboard files.
- `process.env` 34 occurrences / 26 lines, two not injectable at all.

## Deferred and accepted items, re-verified

| Item | Status now |
| --- | --- |
| S4 tool dispatch table | **still open** — if-chain + second allowlist in `gateway.ts` |
| S6 `ModelResponse.usage` provenance | **still open**, narrowed — policy centralised, still inferred |
| S7 `PrivateMemory` typing | **still open** — two signatures, lossy role coercion, no contract suite |
| WS7 T7.4 canonical hashing | **still open** — `hashVersion` has zero occurrences; 4 alias names |
| `datasetExportUrl` 404 | **still broken** — and now pinned by a test asserting the broken URL |
| P6 `workerStatus` | closed |
| P9 healthcare catalog byte parity | accepted, holds |
| Fixture evidence drift | closed at 127 events; the decision log still says 103 and "not regenerated" |

## Historical context

- [`2026-11-07-solid-principles-audit.md`](2026-11-07-solid-principles-audit.md) — the first
  audit (45 findings; SRP D → overall C), measured on `20bc219`.
- [`2026-11-07-solid-audit-report.html`](2026-11-07-solid-audit-report.html) — the first report;
  this document reuses its design shell.
- [`docs/solid-remediation-decisions.md`](../solid-remediation-decisions.md) — the remediation
  decision log: one owner per finding, accepted deviations, gate evidence. Still the best single
  source of intent in the repository, with two stale entries (fixture count; deferred-item status).
- [`scripts/architecture-budget.json`](../../scripts/architecture-budget.json) and
  `scripts/architecture-budget.mjs` — the census this audit re-ran and extended by hand
  (duplication blocks, cast census, same-name helper census, hook density).
- Programme plans: [`docs/superpowers/plans/`](../superpowers/plans/) — one execution plan per
  workstream (WS1–WS7), all executed on `refactor/solid-remediation`.

## Open questions

- Which layer should own row identity formats (evidence keys, tie ordering, pagination
  comparator) so the two adapters cannot diverge again — contracts as pure predicates, or
  normalisation once at the router?
- Should the turn-summary/event-phase policy stay in domain and be executed by Mongo (simplicity,
  one owner) or be projected at append time (performance, index lookups)? The current split gives
  neither guarantee.
- What is the right guardrail for "one policy, one owner"? Literal censuses caught the last wave;
  validators and predicates are the current blind spot, and they need a different detector
  (same-schema-twice, same-derivation-twice) than the existing metrics.
- Is the run-evidence family a dashboard feature or a shared library? The answer decides whether
  `C1` is fixed by moving helpers down into `lib/` or by promoting the folder out of `pages/`.
- Should the two dashboard mega-hooks be split by *data ownership* (resources) or by *user task*
  (select / edit / submit)? The current hooks mix both, which is why their return surfaces are
  30–45 members.

## Related research

- `research/docs/2026-11-07-solid-principles-audit.md` (first audit)
- `research/docs/2026-11-07-solid-audit-report.html` (first report, same design shell)
- `docs/solid-remediation-decisions.md` (remediation ownership, deviations, gates)
