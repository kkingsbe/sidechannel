> Historical pre-workspace implementation plan. Paths and commands below record the earlier layout; use [current operations](../../harness-operations.md) for workspace commands and deployment.

# JEV Analysis Implementation Plan

> **For agentic workers:** Use task-by-task subagent implementation and review. The referenced superpowers execution skills are not installed; the user explicitly selected GPT-6.1 Sol subagents.

**Goal:** Analyze frozen terminal experiment traces through overlapping JEV windows, retain reproducible results, and support separate human review and oversight.

**Architecture:** The researcher API previews and queues immutable manifests in MongoDB. An independent leased worker calls a narrow provider adapter; evidence normalization, persistence, reviews, and oversight are separate modules.

**Tech Stack:** TypeScript, Node.js, MongoDB, official TypeSafe JavaScript SDK, node:test and tsx.

## Global Constraints

- Default windows: 12 classification steps, stride 4; fixed boundaries, no truncation.
- Default model: `jev-1.14.0`; long context disabled.
- Never modify source runs, feed Jev outputs into oversight, or equate missing scores with zero.
- Freeze source, codebook, settings, serialization and provider provenance.
- Preserve existing working tree changes and keep credentials server-side.
- User-supplied nine behavior definitions are the initial editable codebook.

### Task 1: Evidence and windows (evidence subagent)

Files: `agent/src/analysis/{evidence-contracts,configuration,normalization,windows,serialization}.ts` and tests.

Interfaces: `normalizeTrace(run, events)`, `buildWindows(steps, settings)`, `serializeWindow(window, steps, selection, context)`, `resolveAnalysisConfiguration(input)`.

- [x] Test invocation/operation joins, report lifecycle, duplicate history, partial traces and exact suffix windows.
- [x] Implement stable canonical steps, category projection and versioned estimated input budgeting.
- [x] Run `npx tsx --test src/analysis/evidence.test.ts`.

### Task 2: Provider (provider subagent)

Files: `agent/src/analysis/jev-provider.ts`, `jev-provider.test.ts`, package manifests.

Interface: `JevProvider.classify({state,questions,model,signal})` with validated per-code answers and request attempt provenance.

- [x] Verify official SDK and pin its version; inspect available tokenizer support.
- [x] Test malformed/missing/out-of-range answers, timeout, cancellation and permanent/transient errors through an injected transport.
- [x] Disable SDK retries and use one bounded retry owner.
- [x] Run `npx tsx --test src/analysis/jev-provider.test.ts`.

### Task 3: Jobs and API (backend subagent)

Files: `agent/src/analysis/{jev-repository,jev-service,jev-worker,jev-routes}.ts`, entrypoint and tests.

Interface: paginated `AnalysisRepository` with immutable artifacts, jobs, windows, results and attempts; `createAnalysisRouteHandler(service)` returns `{status,body}` or null.

- [x] Test revision conflicts, stale previews, idempotent launch, leases/recovery, cancellation and missing-only retries.
- [x] Implement separate Mongo collections, bounded artifacts and lease-fenced writes.
- [x] Integrate fake-provider execution with actual scripted evidence.

### Task 4: Review and integration (parent)

Files: review modules/tests, `agent/src/server.ts`, `agent/src/server/index.ts`, package scripts, compose and environment examples.

- [x] Add append-only reviewer revisions and deterministic frozen flagged/random queues with paginated membership.
- [x] Validate evidence references and preserve predictions separately; blind initial responses hide score-derived reasons.
- [x] Require two claimed reviewer identities to agree for final run-level judgments; revised decisions reopen agreement.
- [x] Wire routes and a separate analysis worker service; document use and deployment.

### Task 5: Independent oversight (coordinated dashboard chat)

Files: oversight modules/tests under `agent/src/oversight`.

- [x] Implement versioned definition snapshots, four allowlisted projections and isolated direct evaluations.
- [x] Test nested sentinel exclusion, projected citation membership, oversized views and independence from Jev.
- [x] Wire on-demand preview/jobs/status/export into the same independent worker service.

### Task 6: Acceptance

- [x] Run `npm run check`, `npm test`, `npm run test:mongo`, and `npm run build` in `agent`.
- [x] Credentialed smoke passed with the configured TYPESAFE_AI_API_KEY alias: one window/code, returned jev-1.14.0, 3,018 input / 22 output tokens, reproducible export saved.
- [x] Review final diff for source mutation, omitted evidence, credential exposure, lease races and unbounded documents.
- [x] Record tested behavior and remaining operational limitations in `agent/docs/jev-analysis.md`.

