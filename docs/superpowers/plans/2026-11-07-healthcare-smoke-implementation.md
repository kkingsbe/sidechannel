# Healthcare Smoke Readiness Implementation Plan

> Execution: GPT-6.1 Sol subagents implement the three backend workstreams concurrently; the coordinating agent integrates dashboard controls and verifies the application path. This follows the user's explicit execution choice.

**Goal:** Make the existing dashboard ready to launch and inspect the healthcare matched pair.

**Architecture:** Keep browser DTOs in contracts, deterministic validation/scoring in domain, immutable dataset and researcher result persistence in MongoDB, and API orchestration separate from worker execution. Evaluator truth never enters model-facing configuration.

**Tech Stack:** TypeScript, React, Node, MongoDB replica set, existing Mastra memory and Adaption transport.

## Global constraints

- Initial dataset `fixture10-s101-points`, version `0.3`, scenario `healthcare-points-v0.3`, N=10, K=3.
- Default input allowance 120,000 tokens; preserve explicitly labelled historical character budgets.
- Use only scripted inference in implementation checks. User owns live dashboard and paid Adaption launches.
- Preserve existing README edits and the readiness handoff document.
- Fixed rounds, interleaved turns, explicit board reads, private memory, frozen artifacts before five private reports.

## 1. Dataset and researcher backend

Files: new `packages/{contracts,domain,persistence}/src/healthcare/` modules, `api/src/healthcare/`, `api/src/server/index.ts`, `api/src/main.ts`.

- [x] Validate canonical manifest/assets/truth with exact byte hashes and strict identities/relationships; compare reference scoring vectors.
- [x] Persist catalog assets separately from truth, frozen run references and idempotent evaluator results.
- [x] Implement catalog, preset, launch resolution and result API routes; bootstrap CLI.
- [x] Test corruption, conflicting registrations, incomplete registration and truth isolation.

## 2. Healthcare worker

Files: `experiment-worker/src/harness/{runtime,scenario,gateway}.ts`, new healthcare scenario/driver and tests, `packages/domain/src/harness/initialization.ts`.

- [x] Initialize `{entries:[]}` through scenario selection; reject unsupported versions before launch and execution.
- [x] Implement role reads, restricted archive retrieval, pending access, analytics-only supplied-value ranking and versioned artifact updates.
- [x] Drive approved completion from ModelInput and tool responses; use explicit board reads and private memory.
- [x] Verify five reports, freeze behavior, attribution, private input isolation and original fixture regression.

## 3. Token budgets and hosted models

Files: generic harness/config contracts, domain token budget module, scheduler/provider, API hosted model catalog.

- [x] Version token configuration and separate private-note character limits.
- [x] Verify serving capacities from official deployment documentation and expose authenticated model discovery.
- [x] Account for complete action/report payloads and tool schemas with a labelled conservative estimate, reject overflow before inference.
- [x] Verify legacy units, unsupported settings, payloads above 32k characters and provider usage evidence with mocks.

## 4. Dashboard

Files: `dashboard/src/pages/Experiments.tsx`, `Runs.tsx`, new healthcare controls/results components, `components/artifact-view.tsx` and frontend tests.

- [x] Add catalog preset selection without resetting independent settings on dataset changes.
- [x] Add model selection, token/output/private-note controls, field errors and frozen launch preview.
- [x] Render ranked artifacts by scenario/schema, researcher results, effective budget units and explicit unavailable/incomplete states.
- [x] Test serialized controls, blocked readiness, five-role rendering and result/artifact states.

## 5. Integration and operational handoff

Files: `tests/integration/healthcare-smoke*`, root/package scripts, API Dockerfile/compose and `docs/healthcare-smoke-results.md`.

- [x] Bootstrap actual Mongo packages; launch matched pair over HTTP and consume through normal worker queue.
- [x] Assert frozen approved top-3, five reports per run, references/results after reload, pair isolation and evidence export.
- [x] Run `npm run verify`, `npm run test:integration` and dedicated scripted smoke command.
- [x] Verify compiled service builds, API hosting, worker/Mongo health and tunnel configuration; document actual evidence IDs and remaining live-only checks.

