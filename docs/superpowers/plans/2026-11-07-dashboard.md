# Researcher dashboard implementation plan

> **For agentic workers:** Execute task-by-task with the requested GPT-6.1 Sol subagents; the referenced superpowers execution skills are not installed in this checkout.

**Goal:** Implement the complete researcher workflow described in `docs/dashboard-spec.md`, preserving experiment semantics and existing uncommitted work.

**Architecture:** A separate React application consumes the researcher API. The experiment worker and analysis/monitor worker independently persist jobs and evidence in MongoDB. Versioned contracts connect forms and immutable research records.

**Tech Stack:** React, Vite, TypeScript, Tailwind, shadcn-style components, Node HTTP, MongoDB, existing Mastra inference adapter.

## Global constraints

- Default Jev model `jev-1.14.0`; windows 12 classification steps, stride 4.
- Never shrink, split, truncate, or summarize oversized evidence automatically.
- Freeze all four oversight views under the same independently selected monitor settings.
- Jev scores and human labels never enter oversight projections.
- Two distinct claimed reviewer identities must agree to finalize a run outcome.
- Keep experiment scheduling and agent evidence exposure unchanged.
- Inspect existing Cloudflare routing before changing deployment; initial dashboard access is open.
- Preserve unrelated user edits; no live paid inference is needed for routine validation.

## Task 1 — React researcher workspace (dashboard_ui)

Files: new `dashboard/` package, `src/components/`, `src/pages/`, `src/lib/`, Vite and TypeScript configuration.

- [ ] Build persistent navigation, shared evidence inspector, stable routes, responsive layout and system/light/dark themes.
- [ ] Implement configuration forms, validation, saved draft revisions, matched-pair launch review, run list, polling and all evidence views.
- [ ] Implement codebook forms, analysis previews/charts/tables/comparison, review sampling/blinding, outcome adjudication, monitor forms/previews/results.
- [ ] Use backend contracts and preserve missing/unavailable/partial states rather than generated data.
- [ ] Run `npm run build` in `dashboard`; browser-check keyboard navigation, narrow layout and both themes.

## Task 2 — Researcher experiment API (experiment_api)

Files: `agent/src/server/index.ts`, `agent/src/server.ts`, `agent/src/harness/repository.ts`, focused server/repository tests.

Interface: extension handlers accept `{method,path,query:URLSearchParams,body:unknown}` and return `{status,data}` or null.

- [ ] Add atomic draft revision checks, retain invalid drafts, and reject conflicting reuse of launch keys.
- [ ] Add overview, summaries, bounded event/evidence reads and configuration field descriptions.
- [ ] Serve the built dashboard with safe static paths and SPA deep links; allow explicitly open deployment.
- [ ] Wire analysis and oversight handlers to the Mongo research store.
- [ ] Verify HTTP revision conflicts, launch retries, pagination and malformed inputs with Node test fixtures.

## Task 3 — Analysis and human review (analysis_backend)

Files: `agent/src/analysis/`, `agent/src/analysis-worker.ts` and tests.

Interfaces: `ResearchStore`, `MongoResearchStore`, `InMemoryResearchStore`, analysis request handler, independent worker loop.

- [ ] Build canonical invocation reconstruction with operation correlation, fixed windows and category-aware evidence.
- [ ] Add immutable codebook revisions, preview contracts, durable jobs, provider validation and null scores for missing results.
- [ ] Implement deterministic durable random/flagged sampling, append-only review revisions and two-reviewer run outcomes.
- [ ] Verify normalization, oversized windows, frozen definitions, conflicts, job ownership, missingness and review agreement with deterministic fixtures.

## Task 4 — Oversight (parent)

Files: `agent/src/oversight/{contracts,projections,service,api,provider,worker}.ts` and focused tests.

Interfaces: `createOversightHandler(repository,store)`, `processNextMonitorJob(repository,store,provider,owner)`.

- [ ] Define versioned editable monitor questions/outcomes and immutable definition snapshots.
- [ ] Build four explicit projections from source evidence; use metadata allowlists and omit scenario answer keys and research labels.
- [ ] Preview exact serialized requests and freeze preview hashes; reject stale or changed previews at launch.
- [ ] Persist on-demand jobs and execute each view through an isolated adapter invocation. Validate verdicts and evidence citations; retain partial results and expose oversized views.
- [ ] Test nested field isolation, frozen snapshots, invalid citations, independent settings, unavailable capacity, cancellation and idempotent launches.

## Task 5 — Integration and release verification (parent + agents)

Files: `agent/package.json`, `agent/compose.yaml`, `agent/Dockerfile`, deployment documentation and browser smoke tests.

- [ ] Build dashboard in Docker and route UI/API through the existing dashboard-only tunnel network.
- [ ] Run `npm run check` and `npm test` in `agent`; run frontend build/tests.
- [ ] Exercise a deterministic local fixture across experiment, analysis, review, oversight and exports without paid inference.
- [ ] Review gaps against every acceptance scenario; document operational requirements and any externally blocked deployment verification honestly.
