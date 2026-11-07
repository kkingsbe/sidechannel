---
date: 2026-11-07 14:46:00 UTC
researcher: lead agent (SOLID audit)
git_commit: 20bc21978cc6137f2246be44f241fac1536ceb38
branch: main
repository: sidechannel
topic: "SOLID-principles audit of the sidechannel research harness"
tags: [research, codebase, solid, architecture, dashboard, scheduler, persistence, contracts]
status: complete
last_updated: 2026-11-07
last_updated_by: lead agent
---

# Research: SOLID-principles audit

## Research question

Audit the repository against the SOLID principles and produce a report of the areas,
modules, services and code that violate them.

**Deliverable:** [`2026-11-07-solid-audit-report.html`](2026-11-07-solid-audit-report.html) —
a self-contained, filterable HTML report (45 verified findings, 4 critical / 25 high /
15 medium / 1 low, hotspots, metrics, and a phased refactor roadmap).

## Summary

The repository's **boundary architecture** is unusually disciplined for its size and is
mechanically enforced (Nx layer tags + a custom ESLint import rule, proven by
`scripts/verify-boundaries.mjs`, which was re-run during the audit and passes). Its
SOLID violations are almost entirely **inside modules**: god files and god functions,
policies restated in many places, and interchangeable implementations whose contracts
differ.

At the time of the audit: 149 TypeScript source files, 18,257 lines (excluding
`node_modules`, `dist`, `.nx`), of which the React dashboard is 10,569 lines (58%).
Four dashboard pages — `Analysis.tsx`, `Oversight.tsx`, `Experiments.tsx`, `Runs.tsx`
— account for 6,877 lines (65% of the dashboard, 38% of all source).

Scores: SRP **D**, OCP **C-**, LSP **C**, ISP **C+**, DIP **C+**; overall **C**.

## What exists (as-is documentation)

### Layers and enforcement

- `packages/contracts` — data shapes and ports; no persistence or provider imports.
  `browser.ts` is a deliberate DTO-only subpath so server-only declarations never reach
  the browser graph.
- `packages/domain` — pure rules plus orchestration (config validation, token budget,
  analysis preparation, oversight projections).
- `packages/persistence` — Mongo and in-memory adapters for the same ports.
- `api`, `experiment-worker`, `analysis-worker` — services; `dashboard` is the React
  researcher workspace and may import only browser contracts.
- Enforcement: `eslint.config.mjs` (`workspace/imports`, `@nx/enforce-module-boundaries`)
  and `scripts/verify-boundaries.mjs`.

### Composition and infrastructure

- Ports at the hot seams: `Repository`, `ModelAdapter`, `PrivateMemory`, `Scenario`
  (`experiment-worker/src/harness/scheduler.ts:8-16`); `AnalysisRepository` +
  injectable provider (`analysis-worker/src/jev/jev-worker.ts:11,16,31`); `ResearchStore`
  + `MonitorProvider` (`analysis-worker/src/oversight/worker.ts:41`).
- Mongo + in-memory adapters for all five ports, used by unit tests.
- Versioned provenance: `normalizerVersion`, `serializationVersion`,
  `questionTemplateVersion`, `adapterVersion`, `sdkVersion`, `settingsHash`, `build`.

### Where the violations concentrate

| Area | Characteristic violation |
| --- | --- |
| Dashboard | One component per page owning fetch + form + validation + routing + commands; 6 implementations of 2 data abstractions |
| API | One 237-line module that is transport, router, auth, parser, static host and launch service |
| Experiment worker | `HarnessScheduler.run()` — a 249-line method with 13 responsibilities |
| Analysis worker | `AnalysisWorker` — lease lifecycle, scheduling, provider budget and accounting in one class |
| Domain / persistence | 10–12-responsibility modules; domain knows HTTP status codes and a Mongo document-size workaround |
| Contracts | Fat ports (28 and 20 members), a document-store protocol leaking through "store" ports, zod at runtime |
| Cross-cutting | Provider policy in 9 places (already drifted), scenario literals in 30 production sites / 14 files, byte-identical provider transport in two services, 5 hash families, 8 page-collector loops |

## Key findings (condensed)

| ID | Principle | Severity | Location |
| --- | --- | --- | --- |
| S2 | SRP | critical | `experiment-worker/src/harness/scheduler.ts:17-265` |
| F1 | SRP | critical | `dashboard/src/pages/Experiments.tsx:160-1209` |
| F2 | SRP | critical | `dashboard/src/pages/Analysis.tsx:959-1511` |
| F3 | SRP | critical | `dashboard/src/pages/Oversight.tsx:194-772` |
| S1 | SRP | high | `api/src/server/index.ts:32-245` |
| S9 | SRP | high | `analysis-worker/src/jev/jev-worker.ts:21-130` |
| P1/P2 | SRP | high | `packages/domain/src/oversight/service.ts`, `packages/persistence/src/harness/repository.ts` |
| X1 | OCP | high | provider settings policy across 7 files |
| X2 | OCP | high | scenario version literals across 14 files |
| S5 | LSP | high | `mastra-adapter.ts` vs `oversight/model-adapter.ts` |
| P5, P8 | LSP | high | in-memory vs Mongo adapter divergences |
| P10 | ISP | high | `AnalysisRepository` (28) / `ResearcherRepository` (20) |
| X3, F10 | DIP | high | HTTP semantics in domain; URL-string dashboard transport |
| X4 | ISP | high | three route-handler contracts + three body parsers |

The full 45 findings with evidence, rationale and refactor direction are in the HTML
report, filterable by severity / principle / area.

## Code references

- Boundary proof: `scripts/verify-boundaries.mjs`, `eslint.config.mjs:12-90`
- Scheduler god method: `experiment-worker/src/harness/scheduler.ts:17-265`
- Tool dispatch if-chain: `experiment-worker/src/harness/gateway.ts:38-73`
- Provider duplication: `experiment-worker/src/harness/inference-provider.ts` and
  `analysis-worker/src/oversight/inference-provider.ts` (verified byte-identical, SHA-256)
- Adapter divergence: `packages/persistence/src/harness/repository.ts:103` vs `:237`
- Fat port: `packages/contracts/src/analysis/jev-repository.ts:51-80`
- Dashboard giants: `dashboard/src/pages/Analysis.tsx`, `Oversight.tsx`,
  `Experiments.tsx`, `Runs.tsx`
- Transport duplication: `dashboard/src/lib/api.ts`, `lib/paging.ts`,
  `pages/Oversight.tsx:74-183`
- Adapter fabrication: `dashboard/src/lib/jev-transport.ts:12-17,22-38`

## Architecture documentation

The intended design is: versioned contracts + pure domain logic + swappable persistence,
with services composed from ports and the dashboard restricted to browser DTOs. That
intent is documented in `docs/service-layout-migration.md`, `docs/mastra-integration.md`,
`agent/docs/decisions.md` and `harness_handoff.md`, and is partially machine-enforced.
The audit finds the intent holds at package boundaries and breaks down inside modules.

## Historical context

- `b36f7d3 Dashboard improvements`, `a8121d4 Finish dashboard redesign, restructure repo`,
  `99d9fea Jev integration, dashboard spike` — the three commits that created the four
  large dashboard pages. The pages grew feature-by-feature (Jev, then oversight, then
  review) inside pre-existing files.
- `docs/service-layout-migration.md` records the Nx migration that introduced the layer
  tags; the extension-handler pattern is a visible in-progress seam (core routes inline,
  newer routes as handlers).
- `agent/docs/decisions.md` documents deliberate invariants (zero infrastructure
  retries, one report call, persistent worker guard) that the audit found intact.

## Open questions

- Which package would own a shared `ProviderProfile` / `ScenarioRegistry` without
  violating the current layer direction? (domain is the natural owner; the dashboard
  would need a metadata endpoint.)
- Are the adapter divergences observable in a running deployment, or are they masked by
  the single-worker guard? The audit shows they affect unit tests and any in-memory
  deployment; it did not execute them.
- Should the dashboard keep page-local `.css` files or consolidate into the design
  system (`styles.css`, `components/ui.tsx`)?
- Is a "research workspace" route split (Experiments / Runs / Analysis / Oversight)
  worth introducing per-domain API clients before splitting the pages?

## Related research

- None yet; `research/` is introduced by this audit.
