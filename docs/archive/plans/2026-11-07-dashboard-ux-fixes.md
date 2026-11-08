# Dashboard UX Fixes Implementation Plan

> **For agentic workers:** Execute the scoped tasks below with GPT-6.1 Sol subagents, as requested by the user. Use the built-in collaboration tools.

**Goal:** Resolve F01–F14 in the supplied Dashboard UX Audit while retaining research semantics and existing URLs.

**Architecture:** Keep the React route structure and transport contracts. Use collection entry views and progressive disclosure around existing state; readable evidence remains a formatting layer over canonical events.

**Tech Stack:** React, TypeScript, Vite, Radix Dialog, Vitest, Testing Library.

## Global constraints

- Preserve frozen configurations, exact event citations, append-only judgments, missing scores, blind-review boundaries, preview invalidation, and request identities.
- No paid model jobs for validation. No invented worker health, aggregate progress, or scenario registries.
- Existing unrelated working-tree changes belong to the user and must be preserved.
- Source brief: `docs/archive/plans/2026-11-07-dashboard-ux-audit-source.md`.

### Task 1: Analysis and evidence review (Sol agent)

**Files:** `dashboard/src/pages/Analysis.tsx`, related new analysis components/styles, `dashboard/src/pages/Analysis.test.tsx`.
**Interfaces:** Existing `/analyses` adapter and canonical `/jev` endpoints; retain `WindowInspector` export and its existing required props. Shared `Drawer` will accept optional `wide`; `JsonView` will accept optional `open`.

- [x] Add collection landing view with explicit creation route and preserved source/deep links.
- [x] Explain preview prerequisites; aggregate scoreability and distinguish an explicitly unscored record from inference.
- [x] Default results to coverage and compact heatmap with accessible score table.
- [x] Render canonical events first, support selectable citations, show the definition next to judgment, keep raw input secondary.
- [x] Separate batch creation from saved queues; implement save-and-next only after success and preserve failed drafts and blind boundaries.
- [x] Test preview invalidation, zero scores, exact citations, failed saves and blind review using controlled fixtures.

### Task 2: Experiment setup (Sol agent)

**Files:** `dashboard/src/pages/Experiments.tsx`, dedicated experiment test/style files.
**Interfaces:** Existing draft/config/pair endpoints. `/experiments` becomes collection; `/experiments/new` opens setup; existing query links continue to work.

- [x] Surface drafts before creation and preserve local recovery separately from shared drafts.
- [x] Group scenario/data, model/roles, execution and review; collapse optional technical fields without resetting values.
- [x] Use readable parameter names and exact human-duration conversions.
- [x] Open and focus collapsed errors and explain blocked save/launch requirements.
- [x] Validate recovery, unchanged frozen payloads, and focused errors with fixtures.

### Task 3: Runs, pair comparison and oversight (Sol agent)

**Files:** `dashboard/src/pages/Runs.tsx`, `dashboard/src/pages/Oversight.tsx`, dedicated test/style files.
**Interfaces:** Existing evidence, pair and evaluation endpoints; `/oversight` defaults to jobs, explicit setup remains linked.

- [x] Preserve run filters in detail/back links; show evidence freshness separately from execution.
- [x] Align both conditions, exact wording, state and available artifacts/reports; show readable config differences.
- [x] Put evaluations first; explain unmet prerequisites for configuration and reference actions.
- [x] Verify incomplete pairs, existing URLs and oversight pagination using mocked data.

### Task 4: Shared shell, overview and codebook (primary agent)

**Files:** `dashboard/src/App.tsx`, `dashboard/src/components/ui.tsx`, `dashboard/src/styles.css`, `dashboard/src/pages/Overview.tsx`, `dashboard/src/pages/Codebook.tsx`.

- [x] Make overview operational and full width; link state counts and collapse onboarding.
- [x] Add contextual breadcrumb labels and predictable focus; make view switches complete tab controls with associated panels and arrow-key navigation.
- [x] Extend shared fields for required state, drawers for wide review and raw views for collapsed defaults.
- [x] Enlarge prose editors and offer expanded editing while retaining drafts/history.
- [x] Check demo/service facts against API; show unknown and stale states accurately.

### Task 5: Integration verification

- [x] Run `npm run check --workspace=sidechannel-dashboard` and `npm run lint --workspace=sidechannel-dashboard` (expect exit 0).
- [x] Run `npm test --workspace=sidechannel-dashboard` (all tests pass), updating existing tests only for intended navigation changes.
- [x] Run `npm run build --workspace=sidechannel-dashboard` (production bundle succeeds).
- [x] Inspect desktop/narrow layouts and interactions if a local browser is available; document any unverified checks.
- [x] Review the diff against all findings and record implementation coverage and remaining product/research decisions.


## Implementation receipt

Implemented with three GPT-6.1 Sol subagents and primary-agent integration. The independent review found and corrected queue remounts, misleading loading progress, stale worker wording, and inconsistent codebook save guards.

| Findings | Delivered behavior |
| --- | --- |
| F01, F10 | Readable canonical messages/actions, selectable exact citations, adjacent frozen definitions, saved batches, reviewer-scoped progress and success-only save-and-next |
| F02, F11 | Draft/analysis/evaluation collection entry views, explicit creation routes, contextual breadcrumbs, URL-preserved list position, keyboard tabs and drawer focus restoration |
| F03, F04, F07 | Advanced setup disclosures, focused validation, visible prerequisites, contextual names, exact human-duration conversions |
| F05, F13 | Scoreability preflight, explicit unscored-record action, preview invalidation, coverage-first heatmap and score table |
| F06, F12, F14 | Full-width operational overview, linked counts, collapsible onboarding, separate API/worker/freshness states and explicit demo metadata |
| F08, F09 | Aligned pair wording, states and outputs; larger expandable prose editors with separate multiline criteria |

Existing APIs do not provide durable skipped review states: Skip for now is explicitly navigation and leaves the item unreviewed. No cross-analysis review destination or unverified aggregate counts were invented. Scenario/dataset free text remains where the server has no enumerated registry. No automatic inference-window shrinking or scientific computation changes were introduced.

Validation passed: 43 dashboard tests, 8 local API server tests, 1 scripted integration test, lint, TypeScript checks and the production build. Browser checks covered the operational desktop overview, saved analysis discovery, readable evidence, desktop side-by-side review, 390px stacked review with working focus jump, no whole-page horizontal overflow on the inspected analysis, codebook fields, and drawer focus return. Formal screen-reader, exhaustive dark-theme contrast, production-scale and researcher usability studies remain follow-up validation.
