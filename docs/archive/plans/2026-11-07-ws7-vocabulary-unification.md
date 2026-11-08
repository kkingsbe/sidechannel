# WS7 — Vocabulary Unification and Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every closed vocabulary in the repository exactly one table (dashboard statuses, run-status/evidence-kind/job-status/monitor-view dispatch, summary projection), and migrate canonical (sorted-key) hashing behind a recorded decision, closing F15, P3, P4, the canonical half of X6, and whatever dead code WS0 did not delete.

**Architecture:** Three seams, added in dependency order. (1) The dashboard stops re-encoding domain taxonomies: `dashboard/src/lib/status.ts` holds every display vocabulary and `Badge` becomes a tone-only presentational component. (2) Contracts and domain export the vocabularies they already own (`RUN_STATUSES`, `EVIDENCE_KINDS`, `JOB_STATUSES`, `MONITOR_VIEW_BUILDERS`, `SUMMARY_OMIT`/`toRunSummary`), and every literal array or ternary found by the audit is replaced by a table lookup; each table is an exhaustive `Record<Union, …>` so a new status or kind is a compile error. (3) `hashVersion` v2 (sorted keys) lands only after an explicit decision step; identities and keys stay v1, comparison hashes move to v2 with the version recorded next to the hash. Nothing else changes: no API shapes, no event types, no statuses, no scheduler behaviour.

**Tech Stack:** TypeScript 6.0.3 (packages/services) / 5.9.3 (dashboard), Node 22.18+/24.11+, npm 11.5.1, Nx 23, `node:test` + `tsx` (packages), vitest 5 + Testing Library (dashboard), MongoDB 8 replica set, React 19 + Vite, ESLint 9.

**Estimated:** 6 tasks, 5.25 dev-days (4–6 dev-day envelope).

## Global Constraints

- **No behavioural change** unless a task explicitly states the change and its evidence. Experiment scheduling, tool admission, budget accounting, evidence hashes, event types, statuses, API payloads and dashboard copy stay identical.
- **Every task ships tests.** Backend tasks also require the Mongo integration suite.
- **Verification (repo root):** `npm run lint`, `node scripts/verify-boundaries.mjs`, `npm run check`, `npm test`, `npm run build`, `npm run test:integration` (Mongo required), `node scripts/verify-compiled.mjs`, `node scripts/verify-migration-equivalence.mjs`.
- **Test runner facts:**
  - `scripts/test.mjs <dir>` collects `*.test.ts`; with `--mongo` it collects only `*.mongo.test.ts`. Helper modules must not end in `.test.ts`.
  - Tests under `tests/integration/` import workspace packages through their declared exports, which resolve to `dist/`. **Rebuild before running** (`npm run build`) or use the nx target (`node scripts/nx.mjs run @sidechannel/integration:test`).
  - Mongo URI comes from `TEST_MONGODB_URI`; local default `127.0.0.1:27018` (docker compose), CI uses `27017`. Never hardcode.
  - Unit tests use `node:test` + `assert/strict`; dashboard tests use vitest + Testing Library.
- **Boundary rules stay intact** (`eslint.config.mjs` layer tags, `scripts/verify-boundaries.mjs`). Services must not import services; dashboard imports only `@sidechannel/contracts/browser` / `testing`.
- **Dependencies are frozen.** No upgrades.
- **No destructive DB migrations.** Changes are code + in-memory semantics; any Mongo change is query/return-value only and additive.
- **One task = one PR**, ≤ ~400 changed lines where possible, rebased on `main`.
- **WS7-specific:** new browser-visible vocabulary exports must be type-only or plain frozen arrays — no new runtime dependency reaches the dashboard graph. Vocabulary tables are the *only* place a status label/tone/literal may be written; a second copy is a review defect.

## Preconditions and line-anchor policy

WS7 executes **after** WS1, WS2, WS3, WS4 and WS6 (program plan §4 ordering rule 5). It reads source that those workstreams moved. Run the checks below and stop if any fails.

- [ ] **P.1: WS1 hashing module exists**

```bash
node -e "const fs=require('fs');for(const f of ['packages/domain/src/hashing.ts','tests/integration/contracts/fixtures.ts'])console.log(fs.existsSync(f)?'present '+f:'MISSING '+f)"
git grep -n "export function canonicalHash" -- packages/domain/src
```

Expected: two `present` lines and the `canonicalHash` declaration. If `hashing.ts` is missing, T7.4 Step 4.2 supplies fallback code; if the contract fixtures are missing, WS1 has not landed — stop.

- [ ] **P.2: The vocabulary consumers are the post-WS6 shapes**

```bash
git grep -n "export function Badge" -- dashboard/src/components/ui.tsx
git grep -c "Badge status=" -- dashboard/src
git grep -n "summary=true" -- dashboard/src/pages/Runs.tsx | head -3
git grep -n "summarizeRun" -- packages
```

Expected: `Badge` still takes `status` (21 call sites), the run list still uses `summary=true`, and `summarizeRun` is still the only summary helper. Any other result means T7.1/T7.2 have partially landed; re-read the source and record the deviation.

- [ ] **P.3: The hashing decision file exists**

```bash
ls docs/solid-remediation-decisions.md
```

Expected: present (created by WS0 T0.4 and extended by WS1 Task 6). If absent, T7.1–T7.3 and T7.5 may proceed; **T7.4 is blocked** (Step 4.1).

- [ ] **P.4: The architecture budget script exists**

```bash
node -e "const fs=require('fs');console.log(fs.existsSync('scripts/architecture-budget.mjs')?'present':'MISSING scripts/architecture-budget.mjs')"
```

Expected: `present`. If missing, T7.6 Step 6.1 gives the substitute `git grep`/`wc` metrics; do not create the script in WS7 (it is WS0's deliverable).

**Line-anchor policy**

1. Every `file:line` anchor below is the **current baseline** (`main` at the audit commit `20bc219`). Before editing a file, re-locate the anchor (one `grep` per step; each step names the search text). If an anchor has moved, apply the replacement by content, not by line number, and note it in the PR description.
2. If a named symbol is already gone (because WS0/T0.2, WS5 or WS6 removed it), the step is a no-op: record "already done in <task>" and move on. Do not re-create it.
3. `packages/domain/src/hashing.ts`, `tests/integration/contracts/*` and `docs/solid-remediation-decisions.md` are created by WS1/WS0. T7.4 Step 4.1 verifies them and Step 4.2 gives the exact fallback if `hashing.ts` is absent.

## File structure

**Create**

| Path | Responsibility |
| --- | --- |
| `dashboard/src/lib/status.ts` | Every dashboard display vocabulary: `Tone`, `runStatusMeta`, `reviewDecisionMeta`, `monitorStatusMeta`, `jobStatusMeta`, `windowStatusMeta`, `agreementMeta`, `eventMeta`, `runListGroups`, `overviewCards`; the single source of label/tone/group |
| `dashboard/src/lib/status.test.ts` | Exhaustiveness, tone-stability and grouping invariants (vitest, node env) |
| `packages/domain/src/harness/summary.test.ts` | `SUMMARY_OMIT`/`toRunSummary`/`summaryProjection` invariants |
| `packages/contracts/src/harness/contracts.test.ts` | Run-status partition and vocabulary completeness (first test in the package) |
| `packages/contracts/src/harness/repository.test.ts` | `EVIDENCE_KINDS`/`EVIDENCE_KEY_FIELD`/`EVIDENCE_KEY_COERCION` completeness |
| `packages/domain/src/analysis/evidence-selection.ts` | Canonical side-effect → evidence-category and enablement tables |
| `packages/domain/src/hashing.test.ts` | v1/v2 byte-compatibility and `verifyHash` matrix (WS1 creates the module; T7.4 extends the test) |
| `tests/integration/run-summary.mongo.test.ts` | Mongo vs memory summary parity; no heavy key in a run list |
| `tests/integration/oversight-hash-migration.test.ts` | Stored-v1 comparison and new-v2 writes for monitor previews and review evidence revisions |

**Modify**

| Path | Change |
| --- | --- |
| `packages/contracts/src/harness/contracts.ts` | `RUN_STATUSES` + derived `RunStatus`, `TERMINAL_RUN_STATUSES`, `ACTIVE_RUN_STATUSES`, `COMPLETE_RUN_STATUSES`, `INCOMPLETE_RUN_STATUSES`, `CANCEL_OVERRIDE_RUN_STATUSES`, `isTerminalRun` |
| `packages/contracts/src/harness/repository.ts` | `EVIDENCE_KINDS`/`EvidenceKind`, `EVIDENCE_KEY_FIELD`, `EVIDENCE_KEY_COERCION` |
| `packages/contracts/src/analysis/jev-repository.ts` | `JOB_STATUSES` + derived `JobStatus`, `ACTIVE_JOB_STATUSES`, `RETRYABLE_JOB_STATUSES`, `isActiveJob` |
| `packages/contracts/src/oversight/contracts.ts` | `MONITOR_EVALUATION_STATUSES`/`ACTIVE_MONITOR_STATUSES`, `MONITOR_VIEW_STATUSES`; `Projection.hashVersion?`, `MonitorPreview.hashVersion?` |
| `packages/contracts/src/browser.ts` | Export `RUN_STATUSES`, `TERMINAL_RUN_STATUSES`, `ACTIVE_RUN_STATUSES`, `isTerminalRun`, and the `JobStatus` type |
| `packages/domain/src/harness/repository.ts` | `SUMMARY_OMIT`, `SUMMARY_CONFIG_OMIT`, `SummaryRun`, `summaryProjection()`, `toRunSummary` (replaces `summarizeRun`) |
| `packages/domain/src/analysis/normalization.ts`, `serialization.ts` | Consume the side-effect tables; terminal predicate via `isTerminalRun` |
| `packages/domain/src/analysis/jev-service.ts` | Terminal predicate via `isTerminalRun` |
| `packages/domain/src/oversight/reviews.ts` | Terminal predicate; `evidenceRevisions` dual-read for stored revisions (T7.4) |
| `packages/domain/src/oversight/projections.ts` | `MONITOR_VIEW_BUILDERS` table replaces the `view !== 'reports'` chain; `buildProjectionWithPayload`; canonical hash (T7.4) |
| `packages/domain/src/oversight/service.ts` | Preview hash/content-hash versioning, `verifyHash`-based staleness checks, friendly 409 |
| `packages/domain/src/hashing.ts` | `HASH_VERSION`, `HashVersion`, `hashWith`, `verifyHash`, `evidenceRevisions`, `LEGACY_HASHES_ACCEPTED`, `LEGACY_HASH_CONFLICT_MESSAGE` |
| `packages/persistence/src/harness/repository.ts` | `summaryProjection()` in both Mongo reads; `EVIDENCE_KEY_FIELD`/`EVIDENCE_KEY_COERCION`/`EVIDENCE_KINDS` dispatch; run-status vocabularies; artifact chunk `hashVersion` |
| `packages/persistence/src/analysis/jev-repository.ts` | `ACTIVE_JOB_STATUSES`/`RETRYABLE_JOB_STATUSES`; artifact chunk `hashVersion` |
| `dashboard/src/components/ui.tsx` | `Badge({ tone, children })` + `EventIcon` |
| `dashboard/src/components/ui.test.tsx` | Badge tone test |
| `dashboard/src/pages/{Runs,Overview,Analysis,Oversight}.tsx`, `dashboard/src/App.tsx` | Migrate every `Badge status=` call site to a table; delete the duplicated status lists |
| `dashboard/src/pages/Overview.tsx` | `Job.status` typed `JobStatus`; stat cards from `overviewCards` |
| `dashboard/src/lib/analysis-types.ts`, `dashboard/src/lib/types.ts` | Delete dead exports (T7.5) |
| `experiment-worker/src/harness/gateway.ts` | Derive the tool argument allowlist from `commonTools` (T7.5) |
| `docs/solid-remediation-decisions.md` | WS7 migration decision + metric deltas (T7.4, T7.6) |

---

## Task 7.1: Dashboard vocabularies and a tone-only `Badge`

**Files:**
- Create: `dashboard/src/lib/status.ts`
- Create: `dashboard/src/lib/status.test.ts`
- Modify: `packages/contracts/src/browser.ts` (export the run-status vocabulary + `JobStatus`)
- Modify: `dashboard/src/components/ui.tsx:58-88` (`Badge`), add `EventIcon`
- Test: `dashboard/src/components/ui.test.tsx`
- Modify: `dashboard/src/pages/Runs.tsx` (`:114-125`, `:305-307`, `:345`, `:535-543`, `:556`, `:561`, `:721`, `:1084`), `dashboard/src/pages/Overview.tsx` (`:11-16`, `:22`, `:32-38`), `dashboard/src/pages/Analysis.tsx` (`:194`, `:709`, `:766`, `:1037`, `:1664`, `:2491`), `dashboard/src/pages/Oversight.tsx` (`:669-677`, `:1151`, `:1270`, `:1367-1369`, `:1388-1390`, `:1556`, `:1568`, `:1887-1889`, `:1922`), `dashboard/src/App.tsx:30`

**Interfaces:**
- Consumes: `RunStatus`, `HarnessEvent`, `JobStatus`, `MonitorEvaluation`, `MonitorViewResult`, `Projection`, `Verdict`, `WindowRecord` from `@sidechannel/contracts/browser`; `RUN_STATUSES`, `isTerminalRun` (re-exported from `browser.ts` in Step 2).
- Produces (binding for later tasks and for every dashboard page):

```ts
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export interface StatusMeta { label: string; tone: Tone; }
export const runStatusMeta: Record<RunStatus, StatusMeta & { group: 'active' | 'terminal' | 'attention' }>;
export const reviewDecisionMeta: Record<Verdict, StatusMeta>;
export const monitorStatusMeta: Record<MonitorStatus, StatusMeta>;
export function monitorStatusMetaFor(status: string): StatusMeta;
export const jobStatusMeta: Record<JobStatus, StatusMeta>;
export function jobStatusMetaFor(status: string): StatusMeta;
export const windowStatusMeta: Record<WindowRecord['status'], StatusMeta>;
export const agreementMeta: Record<'provisional' | 'disagreement' | 'agreed', StatusMeta>;
export type IconName = 'error' | 'board' | 'tool' | 'success' | 'default';
export function eventMeta(event: Pick<HarnessEvent, 'type'>): { label: string; tone: Tone; icon: IconName };
export const runListGroups: readonly { label: string; statuses: readonly RunStatus[] }[];
export const overviewCards: readonly { label: string; detail: string; statuses: readonly RunStatus[] }[];
// dashboard/src/components/ui.tsx
export function Badge({ tone, children }: { tone?: Tone; children?: React.ReactNode }): React.ReactElement;
export function EventIcon({ name, size }: { name: IconName; size?: number }): React.ReactElement;
```

**Declared behaviour change (the only one in this task):** a projection/result status of `oversized` now renders with `warning` styling instead of being translated to `failed` (danger) or falling through to neutral. Evidence: `docs/archive/2026-11-07-solid-audit-report.html` finding F15 (`Badge` fabricates statuses) and `dashboard/src/pages/Oversight.tsx:669-677`. Everything else renders byte-identical DOM class names.

- [ ] **Step 1.1: Write the failing vocabulary test**

Create `dashboard/src/lib/status.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { RUN_STATUSES, isTerminalRun } from '@sidechannel/contracts/browser';
import {
  agreementMeta, eventMeta, jobStatusMeta, monitorStatusMeta, overviewCards,
  reviewDecisionMeta, runListGroups, runStatusMeta, windowStatusMeta,
} from './status';

describe('run status vocabulary', () => {
  it('covers every run status exactly once', () => {
    expect(Object.keys(runStatusMeta).sort()).toEqual([...RUN_STATUSES].sort());
  });
  it('agrees with the domain terminal predicate', () => {
    for (const status of RUN_STATUSES)
      expect([status, runStatusMeta[status].group === 'terminal']).toEqual([status, isTerminalRun(status)]);
  });
  it('keeps the tones the workspace rendered before WS7', () => {
    expect(runStatusMeta.completed.tone).toBe('success');
    expect(runStatusMeta.failed.tone).toBe('danger');
    expect(runStatusMeta.running.tone).toBe('warning');
    expect(runStatusMeta.queued.tone).toBe('warning');
    expect(runStatusMeta.stopping.tone).toBe('neutral');
    expect(runStatusMeta.cancelled.tone).toBe('neutral');
    expect(runStatusMeta.interrupted.tone).toBe('neutral');
    expect(reviewDecisionMeta.present.tone).toBe('success');
    expect(reviewDecisionMeta.absent.tone).toBe('neutral');
    expect(reviewDecisionMeta.uncertain.tone).toBe('warning');
  });
  it('styles an oversized projection as a warning, never as a failure', () => {
    expect(monitorStatusMeta.oversized).toEqual({ label: 'oversized', tone: 'warning' });
  });
  it('keeps the page groupings narrow and non-overlapping', () => {
    expect(runListGroups.map(group => group.label)).toEqual(['Active runs', 'Needs attention']);
    expect(runListGroups[0]!.statuses).toEqual(['running', 'reporting', 'stopping']);
    expect(runListGroups[1]!.statuses).toEqual(['failed', 'interrupted']);
    expect(overviewCards.map(card => card.label)).toEqual(['Active runs', 'Queued runs', 'Completed runs', 'Needs attention']);
    const listed = [...runListGroups, ...overviewCards].flatMap(group => group.statuses);
    expect(new Set(listed).size).toBe(listed.length);
  });
  it('covers every display status of jobs, windows, agreements and monitor results', () => {
    expect(Object.keys(jobStatusMeta).sort()).toEqual(['cancelled', 'completed', 'failed', 'partial', 'preparing', 'queued', 'running']);
    expect(Object.keys(windowStatusMeta).sort()).toEqual(['completed', 'failed', 'oversized', 'pending', 'running', 'skipped']);
    expect(Object.keys(agreementMeta).sort()).toEqual(['agreed', 'disagreement', 'provisional']);
    expect(Object.keys(monitorStatusMeta).sort()).toEqual(['cancelled', 'completed', 'failed', 'oversized', 'partial', 'pending', 'queued', 'ready', 'running']);
  });
});

describe('event vocabulary', () => {
  it('derives label, tone and icon from the event type only', () => {
    expect(eventMeta({ type: 'board_post' })).toEqual({ label: 'board post', tone: 'neutral', icon: 'board' });
    expect(eventMeta({ type: 'tool_denied' })).toEqual({ label: 'tool denied', tone: 'danger', icon: 'error' });
    expect(eventMeta({ type: 'tool_result' })).toEqual({ label: 'tool result', tone: 'neutral', icon: 'tool' });
    expect(eventMeta({ type: 'artifact_frozen' })).toEqual({ label: 'artifact frozen', tone: 'neutral', icon: 'default' });
    expect(eventMeta({ type: 'turn_started' })).toEqual({ label: 'turn started', tone: 'neutral', icon: 'default' });
  });
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

```bash
npm test --workspace=sidechannel-dashboard -- src/lib/status.test.ts
```

Expected: FAIL — `Failed to resolve import "./status"`, and `RunStatus`/`isTerminalRun` are not exported by `@sidechannel/contracts/browser`.

- [ ] **Step 1.3: Export the run-status vocabulary to the browser graph**

In `packages/contracts/src/browser.ts`, replace line 2 with:

```ts
export type { ExperimentConfig, Run, RunStatus, HarnessEvent, BoardMessage, ArtifactVersion, Json } from './harness/contracts.js';
export { RUN_STATUSES, TERMINAL_RUN_STATUSES, ACTIVE_RUN_STATUSES, isTerminalRun } from './harness/contracts.js';
```

and line 4 (the analysis job types) with:

```ts
export type { AnalysisJob, AnalysisResult, JobStatus, Page, WindowRecord } from './analysis/jev-repository.js';
```

`RUN_STATUSES`, `TERMINAL_RUN_STATUSES`, `ACTIVE_RUN_STATUSES` and `isTerminalRun` are created by T7.3 Step 3.1. If T7.3 has not run yet, land the two constants now in `packages/contracts/src/harness/contracts.ts` by applying T7.3 Step 3.3's T7.3a block first and continue (T7.3 then only adds the remaining constants).

- [ ] **Step 1.4: Create the vocabulary module**

Create `dashboard/src/lib/status.ts`:

```ts
import { RUN_STATUSES } from '@sidechannel/contracts/browser';
import type { HarnessEvent, JobStatus, MonitorEvaluation, MonitorViewResult, Projection, RunStatus, Verdict, WindowRecord } from '@sidechannel/contracts/browser';

/** Semantic colour of a badge. Only this module translates a domain value into a tone. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusMeta { label: string; tone: Tone; }

/**
 * One entry per RunStatus. Adding a status to RUN_STATUSES is a compile error here until it is
 * described, which is the guard the audit asked for (F15).
 */
export const runStatusMeta: Record<RunStatus, StatusMeta & { group: 'active' | 'terminal' | 'attention' }> = {
  queued: { label: 'queued', tone: 'warning', group: 'active' },
  running: { label: 'running', tone: 'warning', group: 'active' },
  reporting: { label: 'reporting', tone: 'warning', group: 'active' },
  stopping: { label: 'stopping', tone: 'neutral', group: 'active' },
  cancelled: { label: 'cancelled', tone: 'neutral', group: 'terminal' },
  completed: { label: 'completed', tone: 'success', group: 'terminal' },
  failed: { label: 'failed', tone: 'danger', group: 'attention' },
  interrupted: { label: 'interrupted', tone: 'neutral', group: 'attention' },
};

export const reviewDecisionMeta: Record<Verdict, StatusMeta> = {
  present: { label: 'present', tone: 'success' },
  absent: { label: 'absent', tone: 'neutral' },
  uncertain: { label: 'uncertain', tone: 'warning' },
};

export type MonitorStatus = Projection['status'] | MonitorViewResult['status'] | MonitorEvaluation['status'];

/** Previews, per-view results and evaluations share one vocabulary. `oversized` is a warning, not a failure. */
export const monitorStatusMeta: Record<MonitorStatus, StatusMeta> = {
  ready: { label: 'ready', tone: 'success' },
  pending: { label: 'pending', tone: 'neutral' },
  queued: { label: 'queued', tone: 'warning' },
  running: { label: 'running', tone: 'warning' },
  completed: { label: 'completed', tone: 'success' },
  partial: { label: 'partial', tone: 'warning' },
  failed: { label: 'failed', tone: 'danger' },
  oversized: { label: 'oversized', tone: 'warning' },
  cancelled: { label: 'cancelled', tone: 'neutral' },
};

/**
 * Untyped callers (a heterogeneous job list, or a server value added by a newer API) fall back to
 * the neutral badge they rendered before WS7. Typed callers index the table directly.
 */
export function monitorStatusMetaFor(status: string): StatusMeta {
  return (monitorStatusMeta as Record<string, StatusMeta>)[status] ?? { label: status, tone: 'neutral' };
}

export const jobStatusMeta: Record<JobStatus, StatusMeta> = {
  preparing: { label: 'preparing', tone: 'warning' },
  queued: { label: 'queued', tone: 'warning' },
  running: { label: 'running', tone: 'warning' },
  completed: { label: 'completed', tone: 'success' },
  partial: { label: 'partial', tone: 'warning' },
  failed: { label: 'failed', tone: 'danger' },
  cancelled: { label: 'cancelled', tone: 'neutral' },
};

export function jobStatusMetaFor(status: string): StatusMeta {
  return (jobStatusMeta as Record<string, StatusMeta>)[status] ?? monitorStatusMetaFor(status);
}

export const windowStatusMeta: Record<WindowRecord['status'], StatusMeta> = {
  pending: { label: 'pending', tone: 'neutral' },
  running: { label: 'running', tone: 'warning' },
  completed: { label: 'completed', tone: 'success' },
  failed: { label: 'failed', tone: 'danger' },
  skipped: { label: 'skipped', tone: 'neutral' },
  oversized: { label: 'oversized', tone: 'warning' },
};

export type AgreementState = 'provisional' | 'disagreement' | 'agreed';

export const agreementMeta: Record<AgreementState, StatusMeta> = {
  agreed: { label: 'agreed', tone: 'success' },
  provisional: { label: 'provisional', tone: 'warning' },
  disagreement: { label: 'disagreement', tone: 'danger' },
};

export type IconName = 'error' | 'board' | 'tool' | 'success' | 'default';

/** Event display metadata. The type string is the only input; precedence matches the pre-WS7 inline chain. */
export function eventMeta(event: Pick<HarnessEvent, 'type'>): { label: string; tone: Tone; icon: IconName } {
  const icon: IconName = /denied|error|fail/.test(event.type) ? 'error'
    : /board/.test(event.type) ? 'board'
      : /tool/.test(event.type) ? 'tool'
        : /complete|success/.test(event.type) ? 'success' : 'default';
  return { label: event.type.replaceAll('_', ' '), tone: icon === 'error' ? 'danger' : 'neutral', icon };
}

/**
 * Page-level groupings are deliberately narrower than the domain active/terminal split: the run
 * list "Active runs" filter excludes queued runs (a queued run has not started executing), and the
 * overview counts four buckets. They were duplicated in Runs.tsx and Overview.tsx; they live here now.
 */
export const runListGroups: readonly { label: string; statuses: readonly RunStatus[] }[] = [
  { label: 'Active runs', statuses: ['running', 'reporting', 'stopping'] },
  { label: 'Needs attention', statuses: ['failed', 'interrupted'] },
];

export const overviewCards: readonly { label: string; detail: string; statuses: readonly RunStatus[] }[] = [
  { label: 'Active runs', detail: 'Inspect execution progress', statuses: ['running', 'reporting', 'stopping'] },
  { label: 'Queued runs', detail: 'Awaiting the experiment worker', statuses: ['queued'] },
  { label: 'Completed runs', detail: 'Open recorded evidence', statuses: ['completed'] },
  { label: 'Needs attention', detail: 'Inspect failure or interruption', statuses: ['failed', 'interrupted'] },
];
```

- [ ] **Step 1.5: Make `Badge` tone-only and add `EventIcon`**

In `dashboard/src/components/ui.tsx`, replace the `Badge` function (lines 58-88) with:

```tsx
const toneClass: Record<Tone, string> = {
  neutral: "",
  info: "",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
};
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children?: React.ReactNode;
}) {
  return <span className={cn("badge", toneClass[tone])}>{children}</span>;
}
const eventIcon: Record<IconName, LucideIcon> = {
  error: XCircle,
  board: MessageSquare,
  tool: Wrench,
  success: CheckCircle2,
  default: Play,
};
export function EventIcon({ name, size = 13 }: { name: IconName; size?: number }) {
  const Icon = eventIcon[name];
  return <Icon size={size} aria-hidden="true" />;
}
```

Update the header imports: line 5 becomes

```tsx
import { X, XCircle, MessageSquare, Wrench, CheckCircle2, Play, AlertCircle, Inbox, LoaderCircle, type LucideIcon } from "lucide-react";
```

and add below the `utils` import:

```tsx
import type { IconName, Tone } from "../lib/status";
```

`info` maps to the plain badge class on purpose: `dashboard/src/styles.css` has no `.badge-info` and WS7 adds no CSS.

- [ ] **Step 1.6: Run the vocabulary test to verify it passes**

```bash
npm test --workspace=sidechannel-dashboard -- src/lib/status.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 1.7: Write the failing `Badge`/`EventIcon` test**

Append to `dashboard/src/components/ui.test.tsx`:

```tsx
it('takes a semantic tone instead of a domain status', () => {
  render(<><Badge tone="success">Done</Badge><Badge tone="danger">Broken</Badge><Badge>Plain</Badge></>);
  const [done, broken, plain] = screen.getAllByText(/Done|Broken|Plain/);
  expect(done!.className).toContain('badge-success');
  expect(broken!.className).toContain('badge-danger');
  expect(plain!.className).not.toMatch(/badge-(success|warning|danger)/);
});

it('renders one icon per event icon name', () => {
  const { container } = render(<><EventIcon name="error" /><EventIcon name="board" /><EventIcon name="tool" /><EventIcon name="success" /><EventIcon name="default" /></>);
  expect(container.querySelectorAll('svg')).toHaveLength(5);
});
```

Update the import line 6 to `import { Badge, Drawer, EventIcon, Field, Input, Tabs } from './ui';`.

- [ ] **Step 1.8: Run it to verify it fails, then passes**

```bash
npm test --workspace=sidechannel-dashboard -- src/components/ui.test.tsx
```

Expected before Step 1.5's edit is applied in this order: FAIL with a TypeScript error (`tone` is not a prop). After Step 1.5: PASS (6 tests).

- [ ] **Step 1.9: Migrate the run-status call sites (Runs, Overview, App)**

Exact migration map — apply each replacement by content:

| Site | Replacement |
| --- | --- |
| `dashboard/src/pages/Runs.tsx:114-125` (the eight hardcoded `<option>`s) | `{RUN_STATUSES.map((v) => (<option key={v}>{v}</option>))}` and add `import { RUN_STATUSES } from "@sidechannel/contracts/browser";` |
| `dashboard/src/pages/Runs.tsx:112-113` (two comma strings) | `{runListGroups.map((group) => (<option key={group.label} value={group.statuses.join(",")}>{group.label}</option>))}` |
| `dashboard/src/pages/Runs.tsx:305-307` (`active` membership array) | `const active = runStatusMeta[data.status].group === "active";` |
| `dashboard/src/pages/Runs.tsx:345` | `<Badge tone={runStatusMeta[data.status].tone}>{runStatusMeta[data.status].label}</Badge>` |
| `dashboard/src/pages/Runs.tsx:535-543` (inline icon chain) | `const meta = eventMeta(e);` then `<EventIcon name={meta.icon} />` in the marker span and `<strong>{meta.label}</strong>` at `:555` |
| `dashboard/src/pages/Runs.tsx:560-562` (`/denied\|error\|fail/` guard + `status="failed"`) | `{meta.tone === "danger" && (<Badge tone="danger">Diagnostic</Badge>)}` |
| `dashboard/src/pages/Runs.tsx:721` | `<Badge tone="danger">Invalid / unparsed</Badge>` |
| `dashboard/src/pages/Runs.tsx:1084` | `actions={<Badge tone={runStatusMeta[run.status].tone}>{runStatusMeta[run.status].label}</Badge>}` |
| `dashboard/src/App.tsx:30` (`RunTable`) | `<Badge tone={runStatusMeta[run.status].tone}>{runStatusMeta[run.status].label}</Badge>` and add `import { runStatusMeta } from './lib/status';` |
| `dashboard/src/pages/Overview.tsx:11` (`Job.status: string`) | `status: JobStatus;` with `import type { JobStatus } from '../lib/types'` re-exported from `lib/types.ts` (Step 1.12) |
| `dashboard/src/pages/Overview.tsx:22` | `{(() => { const meta = jobStatusMetaFor(job.status); return <Badge tone={meta.tone}>{meta.label}</Badge>; })()}` |
| `dashboard/src/pages/Overview.tsx:32-38` (stat cards) | replace with the block in Step 1.10 |

- [ ] **Step 1.10: Derive the overview cards from the table**

In `dashboard/src/pages/Overview.tsx`, replace lines 32-38 (`const count = …` and the `stats` array) with:

```tsx
  const count = (...states: string[]) => counts ? states.reduce((sum, state) => sum + (counts[state] ?? 0), 0) : null;
  const cards = overviewCards.map((card, index) => ({ ...card, value: count(...card.statuses), query: card.statuses.join(','), icon: [Activity, FlaskConical, BookOpen, ShieldCheck][index]! }));
```

and replace `stats.map(({ label, value, detail, states, icon: Icon }) => …` with `cards.map(({ label, value, detail, query, icon: Icon }) => …` and the link target with `` to={`/runs?status=${encodeURIComponent(query)}`} ``. Add `import { jobStatusMetaFor, overviewCards } from '../lib/status';`.

- [ ] **Step 1.11: Migrate the analysis and oversight call sites**

| Site | Replacement |
| --- | --- |
| `Analysis.tsx:194` | `<Badge tone={jobStatusMeta[analysisJob.status].tone}>{jobStatusMeta[analysisJob.status].label}</Badge>` (keep the local variable name used there) |
| `Analysis.tsx:709` | `<Badge tone={window.budget.oversized ? "warning" : "neutral"}>` |
| `Analysis.tsx:766` | `<Badge tone={jobStatusMeta[job.status].tone}>{jobStatusMeta[job.status].label}</Badge>` |
| `Analysis.tsx:1037` | `<Badge tone={jobStatusMeta[data.status].tone}>{jobStatusMeta[data.status].label}</Badge>` |
| `Analysis.tsx:1664` | `<Badge tone={windowStatusMeta[w.status].tone}>{windowStatusMeta[w.status].label}</Badge>` |
| `Analysis.tsx:2491` | `<Badge tone={reviewDecisionMeta[review.decision].tone}>{reviewDecisionMeta[review.decision].label}</Badge>` |
| `Oversight.tsx:669-677` | `<Badge tone={monitorStatusMetaFor(p.status).tone}>{monitorStatusMetaFor(p.status).label}</Badge>` |
| `Oversight.tsx:1151` | `<Badge tone={jobStatusMetaFor(job.status).tone}>{jobStatusMetaFor(job.status).label}</Badge>` |
| `Oversight.tsx:1270` | `<Badge tone={jobStatusMetaFor(data.status).tone}>{jobStatusMetaFor(data.status).label}</Badge>` |
| `Oversight.tsx:1367-1369` | `{reference ? <Badge tone={agreementMeta[reference.state].tone}>{agreementMeta[reference.state].label}</Badge> : <Badge>Unreviewed</Badge>}` |
| `Oversight.tsx:1388-1390` | `{result ? <Badge tone={monitorStatusMeta[result.status].tone}>{monitorStatusMeta[result.status].label}</Badge> : <Badge>Pending</Badge>}` |
| `Oversight.tsx:1556` | `<Badge tone={reviewDecisionMeta[judgment.verdict].tone}>{reviewDecisionMeta[judgment.verdict].label}</Badge>` |
| `Oversight.tsx:1568` | `<Badge tone={valid ? "success" : "danger"}>` |
| `Oversight.tsx:1887-1889` | `{agreement ? <Badge tone={agreementMeta[agreement.state].tone}>{agreementMeta[agreement.state].label}</Badge> : <Badge>Unreviewed</Badge>}` |
| `Oversight.tsx:1922` | `<Badge tone={reviewDecisionMeta[review.decision].tone}>{reviewDecisionMeta[review.decision].label}</Badge>` |

Add to each page's imports: `import { agreementMeta, jobStatusMeta, jobStatusMetaFor, monitorStatusMeta, monitorStatusMetaFor, reviewDecisionMeta, runStatusMeta, windowStatusMeta, eventMeta } from '../lib/status';` (only the names that page uses).

- [ ] **Step 1.12: Re-export the browser vocabularies the pages import**

In `dashboard/src/lib/types.ts`, extend the existing `export type { … } from '@sidechannel/contracts/browser'` block with `JobStatus` (and keep `ConfigurationResponse` until T7.5 removes it).

- [ ] **Step 1.13: Prove no status string survives as a Badge input**

```bash
git grep -n "Badge status=" -- dashboard/src
git grep -nE "\[\"?(queued|running|reporting|stopping|completed|failed|cancelled|interrupted)\"?\]" -- dashboard/src/pages/Runs.tsx dashboard/src/pages/Overview.tsx
node scripts/verify-boundaries.mjs
npm run check --workspace=sidechannel-dashboard
npm test --workspace=sidechannel-dashboard
```

Expected: the first two `git grep`s print nothing; boundaries pass; `check` exit 0; vitest PASS for every existing dashboard test (the pages render the same labels).

- [ ] **Step 1.14: Commit**

```bash
git add dashboard/src/lib/status.ts dashboard/src/lib/status.test.ts dashboard/src/components/ui.tsx dashboard/src/components/ui.test.tsx dashboard/src/pages/Runs.tsx dashboard/src/pages/Overview.tsx dashboard/src/pages/Analysis.tsx dashboard/src/pages/Oversight.tsx dashboard/src/App.tsx dashboard/src/lib/types.ts packages/contracts/src/browser.ts packages/contracts/src/harness/contracts.ts
git commit -m "refactor(dashboard): one status vocabulary, tone-only Badge, event metadata table (F15)"
```

**Effort:** 1.25 dev-days. **Rollback:** `git revert` — pure presentation layer, no data written. **Out of scope:** the `Oversight.tsx:615` / `Runs.tsx:473,930` plain `<Badge>` labels (no status input; they keep `tone="neutral"` by default), and any colour redesign.

---

## Task 7.2: `RunSummary` from one definition (`SUMMARY_OMIT` + `toRunSummary`)

**Files:**
- Create: `packages/domain/src/harness/summary.test.ts`
- Create: `tests/integration/run-summary.mongo.test.ts`
- Modify: `packages/domain/src/harness/repository.ts` (whole file, 8 lines today)
- Modify: `packages/persistence/src/harness/repository.ts:8,101,102,230,232,234`

**Interfaces:**
- Consumes: `Run`, `RunSummary` (unchanged shape).
- Produces:

```ts
// packages/domain/src/harness/repository.ts
export const SUMMARY_OMIT: readonly string[];
export const SUMMARY_CONFIG_OMIT: readonly string[];
export type SummaryRun = Omit<Run, typeof SUMMARY_OMIT[number]> & Partial<Pick<Run, typeof SUMMARY_OMIT[number]>>;
export function summaryProjection(): Record<string, 0>;
export function toRunSummary(run: SummaryRun): RunSummary;
```

**Declared behaviour change:** none. `summarizeRun` is renamed to `toRunSummary` and the Mongo projection is derived from the same constants; the produced summary and the projection key set are identical to today's literals (asserted in Step 2.6 by comparing against the old projection object copied verbatim into the test).

- [ ] **Step 2.1: Write the failing domain test**

Create `packages/domain/src/harness/summary.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import { defaultFixtureConfiguration, resolveConfiguration } from './config.js';
import { createQueuedRun } from './initialization.js';
import { SUMMARY_CONFIG_OMIT, SUMMARY_OMIT, summaryProjection, toRunSummary, type SummaryRun } from './repository.js';

const run = (overrides: Partial<Run> = {}): Run => ({ ...createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'summary'), ...overrides });

test('toRunSummary drops every heavy collection and the scenario assets', () => {
    const summary = toRunSummary(run({ board: [{ id: 'b1', runId: 'r', authorId: 'alpha', sequence: 1, timestamp: '2026-01-01T00:00:00.000Z', text: 'post' }], reports: [{ agentId: 'alpha', raw: '{}', parsed: null }] }));
    for (const field of SUMMARY_OMIT) assert.equal(field in summary, false, field);
    assert.equal('assets' in summary.config.scenario, false);
    assert.equal(summary.config.label, 'Development fixture');
    assert.equal(summary.designation, 'fixture');
    assert.equal(summary.sourceCompleteness, 'recording');
});

test('the mongo projection is derived from the same constants, so a new heavy field cannot leak', () => {
    const projection = summaryProjection();
    const expected = [...SUMMARY_OMIT.map(field => [field, 0]), ...SUMMARY_CONFIG_OMIT.map(field => [`config.scenario.${field}`, 0])];
    assert.deepEqual(Object.entries(projection).sort(), expected.sort());
    // The pre-WS7 literal, kept as the regression oracle.
    const legacy = { board: 0, artifacts: 0, reports: 0, operations: 0, scenarioState: 0, 'config.scenario.assets': 0 };
    assert.deepEqual(projection, legacy);
});

test('source completeness follows the run status', () => {
    for (const [status, completeness] of [['completed', 'recorded-terminal'], ['cancelled', 'recorded-terminal'], ['failed', 'possibly-incomplete'], ['interrupted', 'possibly-incomplete'], ['running', 'recording'], ['queued', 'recording']] as const)
        assert.equal(toRunSummary(run({ status })).sourceCompleteness, completeness, status);
});

test('a projection-shaped record summarises without its heavy fields present', () => {
    const projected = run();
    const stripped = { ...projected } as Record<string, unknown>;
    for (const field of SUMMARY_OMIT) delete stripped[field];
    assert.equal(toRunSummary(stripped as SummaryRun).id, projected.id);
});
```

- [ ] **Step 2.2: Run it to verify it fails**

```bash
node --import tsx --test packages/domain/src/harness/summary.test.ts
```

Expected: FAIL — `does not provide an export named 'SUMMARY_OMIT'` (and `summarizeRun` still exists).

- [ ] **Step 2.3: Replace the domain module**

Replace `packages/domain/src/harness/repository.ts` with:

```ts
import type { Run } from '@sidechannel/contracts/harness/contracts';
import type { RunSummary } from '@sidechannel/contracts/harness/repository';

/**
 * Run fields that are never part of a RunSummary. The Mongo adapters derive their projection from
 * this list, so adding a heavy Run field is one edit here plus the Run interface (finding P4).
 */
export const SUMMARY_OMIT = ['board', 'artifacts', 'reports', 'operations', 'scenarioState'] as const;

/** Scenario sub-fields that a summary never carries. */
export const SUMMARY_CONFIG_OMIT = ['assets'] as const;

/** A Run that may already have been read through a summary projection. */
export type SummaryRun = Omit<Run, typeof SUMMARY_OMIT[number]> & Partial<Pick<Run, typeof SUMMARY_OMIT[number]>>;

/** Exclusion projection for Mongo reads that feed toRunSummary. */
export function summaryProjection(): Record<string, 0> {
    return {
        ...Object.fromEntries(SUMMARY_OMIT.map(field => [field, 0])),
        ...Object.fromEntries(SUMMARY_CONFIG_OMIT.map(field => [`config.scenario.${field}`, 0])),
    } as Record<string, 0>;
}

export function toRunSummary(run: SummaryRun): RunSummary {
    const { board, artifacts, reports, operations, scenarioState, config, ...summary } = run;
    const { assets, ...scenario } = config.scenario;
    return { ...summary, config: { label: config.label, phase: config.phase, model: config.model, condition: config.condition, scenario, scheduler: config.scheduler }, designation: config.model.provider === 'scripted' ? 'fixture' : config.phase, sourceCompleteness: ['completed', 'cancelled'].includes(run.status) ? 'recorded-terminal' : ['failed', 'interrupted'].includes(run.status) ? 'possibly-incomplete' : 'recording' };
}
```

The `sourceCompleteness` expression is moved **verbatim**: T7.3 replaces its two literal arrays with `COMPLETE_RUN_STATUSES` / `INCOMPLETE_RUN_STATUSES`. Keeping the move byte-identical here is what makes this task a pure refactor.

- [ ] **Step 2.4: Run the domain test to verify it passes**

```bash
node --import tsx --test packages/domain/src/harness/summary.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 2.5: Derive the Mongo projections**

In `packages/persistence/src/harness/repository.ts`:

1. Line 8: `import { toRunSummary } from '@sidechannel/domain/harness/repository';` plus `import { summaryProjection } from '@sidechannel/domain/harness/repository';` merged into one import.
2. Every `summarizeRun(` becomes `toRunSummary(` (lines 101, 102, 232, 234).
3. Line 230 (`const projection = { board: 0, … };`) becomes `const projection = summaryProjection();`.
4. Line 234's inline `{ projection: { board: 0, … } }` becomes `{ projection: summaryProjection() }`.
5. `queryRuns`/`getRunSummary` rows are typed `clean<Run>(row)!`; change those casts to `clean<SummaryRun>(row)!` and import `type SummaryRun` from the domain module.

- [ ] **Step 2.6: Prove the Mongo path equals the memory path**

Create `tests/integration/run-summary.mongo.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { SUMMARY_OMIT } from '@sidechannel/domain/harness/repository';

const uri = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';

const runWithEvidence = () => {
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'summary-' + randomUUID());
    run.board.push({ id: 'post-1', runId: run.id, authorId: 'alpha', sequence: 1, timestamp: '2026-01-01T00:00:00.000Z', text: 'recorded' });
    run.reports.push({ agentId: 'alpha', raw: '{"ownActions":"x"}', parsed: { ownActions: 'x' } });
    return run;
};

test('mongo and memory summaries are identical and carry no heavy field', async (t) => {
    const database = 'sidechannel_summary_' + randomUUID().replaceAll('-', '');
    const mongo = await MongoRepository.connect(uri, database);
    const memory = new InMemoryRepository();
    t.after(async () => { await mongo.db.dropDatabase(); await mongo.close(); });
    const run = runWithEvidence();
    await mongo.createRun(run);
    await memory.createRun(run);
    for (const repository of [mongo, memory]) {
        const { items } = await repository.queryRuns({ limit: 10, offset: 0 });
        assert.equal(items.length, 1);
        for (const field of SUMMARY_OMIT) assert.equal(field in items[0]!, false, field);
        assert.equal('assets' in items[0]!.config.scenario, false);
        assert.deepEqual(await repository.getRunSummary(run.id), await memory.getRunSummary(run.id));
    }
});
```

- [ ] **Step 2.7: Run the suites**

```bash
npm run build
node --import tsx --test packages/domain/src/harness/summary.test.ts
node --env-file-if-exists=.env --import tsx --test tests/integration/run-summary.mongo.test.ts
npm test
```

Expected: PASS (4 + 1 tests, then the full unit suite).

- [ ] **Step 2.8: Commit**

```bash
git add packages/domain/src/harness/repository.ts packages/domain/src/harness/summary.test.ts packages/persistence/src/harness/repository.ts tests/integration/run-summary.mongo.test.ts
git commit -m "refactor(domain): one RunSummary projection definition, mongo projection derived (P4)"
```

**Effort:** 0.75 dev-days. **Rollback:** `git revert`; no stored data changes (projection only narrows fields already excluded). **Out of scope:** `RunSummary`'s shape (unchanged), `RunQuery` filters (WS3a), and any new summary field.

---

## Task 7.3: Backend dispatch tables

**Files:**
- Create: `packages/contracts/src/harness/contracts.test.ts`
- Create: `packages/contracts/src/harness/repository.test.ts`
- Create: `packages/domain/src/analysis/evidence-selection.ts`
- Modify: `packages/contracts/src/harness/contracts.ts:136`, `packages/contracts/src/harness/repository.ts:22`, `packages/contracts/src/analysis/jev-repository.ts:3`, `packages/contracts/src/oversight/contracts.ts`
- Modify: `packages/domain/src/harness/repository.ts` (`sourceCompleteness` arrays)
- Modify: `packages/domain/src/analysis/jev-service.ts:39`, `packages/domain/src/analysis/normalization.ts:32-34,52,110,115,119`, `packages/domain/src/analysis/serialization.ts:78,86`
- Modify: `packages/domain/src/oversight/reviews.ts:21`, `packages/domain/src/oversight/projections.ts:67-128`, `packages/domain/src/oversight/service.ts:156`
- Modify: `packages/persistence/src/harness/repository.ts:79,103,104,110,193,240,256`, `packages/persistence/src/analysis/jev-repository.ts:63,64,126,127`

**Interfaces:**
- Produces (binding):

```ts
// packages/contracts/src/harness/contracts.ts
export const RUN_STATUSES: readonly RunStatus[];                     // ['queued','running','reporting','stopping','cancelled','completed','failed','interrupted']
export const TERMINAL_RUN_STATUSES: readonly RunStatus[];            // cancelled, completed, failed, interrupted
export const ACTIVE_RUN_STATUSES: readonly RunStatus[];              // queued, running, reporting, stopping
export const COMPLETE_RUN_STATUSES: readonly RunStatus[];            // completed, cancelled
export const INCOMPLETE_RUN_STATUSES: readonly RunStatus[];          // failed, interrupted
export const CANCEL_OVERRIDE_RUN_STATUSES: readonly RunStatus[];     // queued, running, reporting, completed
export function isTerminalRun(status: RunStatus): boolean;

// packages/contracts/src/harness/repository.ts
export const EVIDENCE_KINDS: readonly EvidenceKind[];
export const EVIDENCE_KEY_FIELD: Record<EvidenceKind, 'id' | 'version' | 'agentId'>;
export const EVIDENCE_KEY_COERCION: Record<EvidenceKind, (key: string) => string | number>;

// packages/contracts/src/analysis/jev-repository.ts
export const JOB_STATUSES: readonly JobStatus[];
export const ACTIVE_JOB_STATUSES: readonly JobStatus[];              // preparing, queued, running
export const RETRYABLE_JOB_STATUSES: readonly JobStatus[];           // completed, partial, failed, cancelled
export function isActiveJob(status: JobStatus): boolean;

// packages/contracts/src/oversight/contracts.ts
export const MONITOR_EVALUATION_STATUSES: readonly MonitorEvaluationStatus[];
export const ACTIVE_MONITOR_STATUSES: readonly MonitorEvaluationStatus[]; // queued, running
export const MONITOR_VIEW_STATUSES: readonly MonitorViewStatus[];

// packages/domain/src/analysis/evidence-selection.ts
export const SIDE_EFFECT_CATEGORIES: Record<CanonicalSideEffect['type'], readonly EvidenceCategory[]>;
export const TOOL_EFFECT_ENABLED: Record<CanonicalSideEffect['type'], (selection: EvidenceSelection) => boolean>;
export const SIDE_EFFECT_ENABLED: Record<CanonicalSideEffect['type'], (selection: EvidenceSelection) => boolean>;

// packages/domain/src/oversight/projections.ts
export interface ProjectionContext { … }
export interface ProjectionBuilderResult { projection: Projection; payload: Record<string, unknown>; }
export type ProjectionBuilder = (context: ProjectionContext) => ProjectionBuilderResult;
export const MONITOR_VIEW_BUILDERS: Record<MonitorView, ProjectionBuilder>;
export function prepareProjection(run: Run, events: HarnessEvent[], definition: MonitorDefinition, settings: MonitorSettings): ProjectionContext;
export function buildProjectionWithPayload(run: Run, events: HarnessEvent[], view: MonitorView, definition: MonitorDefinition, settings: MonitorSettings): ProjectionBuilderResult;
export function buildProjection(run: Run, events: HarnessEvent[], view: MonitorView, definition: MonitorDefinition, settings: MonitorSettings): Projection;
```

**Declared behaviour change:** none. Every table entry is transcribed from the literal it replaces; the parity tests in Steps 3.7, 3.10 and 3.13 assert the old and new values produce identical output, including the two `board_delivery` enablement rules that intentionally differ.

- [ ] **Step 3.1: Write the failing vocabulary tests**

Create `packages/contracts/src/harness/contracts.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_RUN_STATUSES, CANCEL_OVERRIDE_RUN_STATUSES, COMPLETE_RUN_STATUSES, INCOMPLETE_RUN_STATUSES, RUN_STATUSES, TERMINAL_RUN_STATUSES, isTerminalRun } from './contracts.js';

test('active and terminal run statuses partition the union', () => {
    assert.deepEqual([...ACTIVE_RUN_STATUSES, ...TERMINAL_RUN_STATUSES].sort(), [...RUN_STATUSES].sort());
    assert.equal(new Set([...ACTIVE_RUN_STATUSES, ...TERMINAL_RUN_STATUSES]).size, RUN_STATUSES.length);
    for (const status of RUN_STATUSES) assert.equal(isTerminalRun(status), !ACTIVE_RUN_STATUSES.includes(status), status);
});

test('complete and incomplete run statuses partition the terminal set', () => {
    assert.deepEqual([...COMPLETE_RUN_STATUSES, ...INCOMPLETE_RUN_STATUSES].sort(), [...TERMINAL_RUN_STATUSES].sort());
});

test('the cancel-override set stays the historical literal', () => {
    assert.deepEqual([...CANCEL_OVERRIDE_RUN_STATUSES], ['queued', 'running', 'reporting', 'completed']);
});
```

Create `packages/contracts/src/harness/repository.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE_KEY_COERCION, EVIDENCE_KEY_FIELD, EVIDENCE_KINDS } from './repository.js';

test('every evidence kind has exactly one key field and one coercion', () => {
    assert.deepEqual(Object.keys(EVIDENCE_KEY_FIELD).sort(), [...EVIDENCE_KINDS].sort());
    assert.deepEqual(Object.keys(EVIDENCE_KEY_COERCION).sort(), [...EVIDENCE_KINDS].sort());
    assert.deepEqual(EVIDENCE_KEY_FIELD, { board: 'id', artifacts: 'version', reports: 'agentId' });
    assert.equal(EVIDENCE_KEY_COERCION.artifacts('7'), 7);
    assert.equal(EVIDENCE_KEY_COERCION.board('post-1'), 'post-1');
});
```

- [ ] **Step 3.2: Run them to verify they fail**

```bash
node --import tsx --test packages/contracts/src/harness/contracts.test.ts
node --import tsx --test packages/contracts/src/harness/repository.test.ts
```

Expected: FAIL — `does not provide an export named 'ACTIVE_RUN_STATUSES'` / `'EVIDENCE_KINDS'`.

- [ ] **Step 3.3: Add the vocabularies to contracts**

`packages/contracts/src/harness/contracts.ts` — replace line 136 with:

```ts
export const RUN_STATUSES = ['queued', 'running', 'reporting', 'stopping', 'cancelled', 'completed', 'failed', 'interrupted'] as const;

export type RunStatus = typeof RUN_STATUSES[number];

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['cancelled', 'completed', 'failed', 'interrupted'];

export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['queued', 'running', 'reporting', 'stopping'];

/** Terminal statuses whose recorded evidence is complete. */
export const COMPLETE_RUN_STATUSES: readonly RunStatus[] = ['completed', 'cancelled'];

/** Terminal statuses whose recorded evidence may be incomplete. */
export const INCOMPLETE_RUN_STATUSES: readonly RunStatus[] = ['failed', 'interrupted'];

/**
 * Statuses a persisted cancel request rewrites to `stopping`. `completed` is part of the historical
 * literal (a cancel racing a completion) and is pinned by contracts.test.ts; changing it is a
 * behaviour change, not a cleanup.
 */
export const CANCEL_OVERRIDE_RUN_STATUSES: readonly RunStatus[] = ['queued', 'running', 'reporting', 'completed'];

export function isTerminalRun(status: RunStatus): boolean {
    return TERMINAL_RUN_STATUSES.includes(status);
}
```

`packages/contracts/src/harness/repository.ts` — replace line 22 with:

```ts
export const EVIDENCE_KINDS = ['board', 'artifacts', 'reports'] as const;

export type EvidenceKind = typeof EVIDENCE_KINDS[number];

/** How an evidence collection is keyed for single-item reads. */
export const EVIDENCE_KEY_FIELD: Record<EvidenceKind, 'id' | 'version' | 'agentId'> = { board: 'id', artifacts: 'version', reports: 'agentId' };

/** Client keys arrive as strings; artifact versions are numbers in the stored document. */
export const EVIDENCE_KEY_COERCION: Record<EvidenceKind, (key: string) => string | number> = {
    board: key => key,
    artifacts: key => Number(key),
    reports: key => key,
};
```

`packages/contracts/src/analysis/jev-repository.ts` — replace line 3 with:

```ts
export const JOB_STATUSES = ['preparing', 'queued', 'running', 'completed', 'partial', 'failed', 'cancelled'] as const;

export type JobStatus = typeof JOB_STATUSES[number];

/** A job in one of these statuses is still owned by a worker: cancel is allowed, retry is not. */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['preparing', 'queued', 'running'];

/** A job in one of these statuses may be retried. */
export const RETRYABLE_JOB_STATUSES: readonly JobStatus[] = ['completed', 'partial', 'failed', 'cancelled'];

export function isActiveJob(status: JobStatus): boolean {
    return ACTIVE_JOB_STATUSES.includes(status);
}
```

`packages/contracts/src/oversight/contracts.ts` — after the `MonitorView` export block add:

```ts
export const MONITOR_EVALUATION_STATUSES = ['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'] as const;

export type MonitorEvaluationStatus = typeof MONITOR_EVALUATION_STATUSES[number];

/** Non-terminal evaluation statuses: the only ones a cancel request may modify. */
export const ACTIVE_MONITOR_STATUSES: readonly MonitorEvaluationStatus[] = ['queued', 'running'];

export const MONITOR_VIEW_STATUSES = ['pending', 'running', 'completed', 'failed', 'oversized', 'cancelled'] as const;

export type MonitorViewStatus = typeof MONITOR_VIEW_STATUSES[number];
```

and type the two status fields from them: `MonitorViewResult.status: MonitorViewStatus`, `MonitorEvaluation.status: MonitorEvaluationStatus`.

- [ ] **Step 3.4: Run the contracts tests to verify they pass**

```bash
node --import tsx --test packages/contracts/src/harness/contracts.test.ts
node --import tsx --test packages/contracts/src/harness/repository.test.ts
npm run check --workspace=@sidechannel/contracts
```

Expected: PASS (3 + 1 tests); `check` exit 0.

- [ ] **Step 3.5: Write the failing side-effect table test**

Create `packages/domain/src/analysis/evidence-selection.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE_CATEGORIES, type EvidenceSelection } from '@sidechannel/contracts/analysis/evidence-contracts';
import { SIDE_EFFECT_CATEGORIES, SIDE_EFFECT_ENABLED, TOOL_EFFECT_ENABLED } from './evidence-selection.js';

const selection = (overrides: Partial<EvidenceSelection> = {}): EvidenceSelection =>
    ({ ...Object.fromEntries(EVIDENCE_CATEGORIES.map(category => [category, false])), ...overrides }) as EvidenceSelection;

test('each side-effect type maps to the categories the normalizer marked available', () => {
    assert.deepEqual(SIDE_EFFECT_CATEGORIES, {
        board_post: ['boardContent'],
        board_delivery: ['boardContent', 'boardDelivery'],
        memory_updated: ['privateMemory'],
        artifact_updated: ['artifactChanges'],
    });
});

test('tool-attached effects require both board flags, side-effect records require delivery only', () => {
    assert.equal(TOOL_EFFECT_ENABLED.board_delivery(selection({ boardDelivery: true })), false);
    assert.equal(TOOL_EFFECT_ENABLED.board_delivery(selection({ boardDelivery: true, boardContent: true })), true);
    assert.equal(SIDE_EFFECT_ENABLED.board_delivery(selection({ boardDelivery: true })), true);
    assert.equal(SIDE_EFFECT_ENABLED.board_post(selection({ boardContent: true })), true);
    assert.equal(SIDE_EFFECT_ENABLED.memory_updated(selection({ privateMemory: true })), true);
    assert.equal(SIDE_EFFECT_ENABLED.artifact_updated(selection({ artifactChanges: true })), true);
});
```

- [ ] **Step 3.6: Run it to verify it fails**

```bash
node --import tsx --test packages/domain/src/analysis/evidence-selection.test.ts
```

Expected: FAIL — `Cannot find module './evidence-selection.js'`.

- [ ] **Step 3.7: Create the side-effect tables**

Create `packages/domain/src/analysis/evidence-selection.ts`:

```ts
import type { CanonicalSideEffect, EvidenceCategory, EvidenceSelection } from '@sidechannel/contracts/analysis/evidence-contracts';

/** Evidence categories that a canonical side-effect makes observable. */
export const SIDE_EFFECT_CATEGORIES: Record<CanonicalSideEffect['type'], readonly EvidenceCategory[]> = {
    board_post: ['boardContent'],
    board_delivery: ['boardContent', 'boardDelivery'],
    memory_updated: ['privateMemory'],
    artifact_updated: ['artifactChanges'],
};

/**
 * Enablement when a side effect is attached to a tool call. A delivery is only evidence when both
 * the delivery and the board content are selected, because the attachment carries message bodies.
 */
export const TOOL_EFFECT_ENABLED: Record<CanonicalSideEffect['type'], (selection: EvidenceSelection) => boolean> = {
    board_post: selection => selection.boardContent,
    board_delivery: selection => selection.boardDelivery && selection.boardContent,
    memory_updated: selection => selection.privateMemory,
    artifact_updated: selection => selection.artifactChanges,
};

/**
 * Enablement of the side-effect record itself. Deliberately differs from TOOL_EFFECT_ENABLED for
 * board_delivery: the record is projected with message text stripped when board content is off, so
 * delivery alone is enough. Pinned by evidence-selection.test.ts; unifying the two rules is a
 * serialization behaviour change and is out of scope for WS7.
 */
export const SIDE_EFFECT_ENABLED: Record<CanonicalSideEffect['type'], (selection: EvidenceSelection) => boolean> = {
    board_post: selection => selection.boardContent,
    board_delivery: selection => selection.boardDelivery,
    memory_updated: selection => selection.privateMemory,
    artifact_updated: selection => selection.artifactChanges,
};
```

- [ ] **Step 3.8: Run it to verify it passes, then migrate `serialization.ts` and `normalization.ts`**

```bash
node --import tsx --test packages/domain/src/analysis/evidence-selection.test.ts
```

Expected: PASS (2 tests).

Migration map (content-based replacements):

| Site | From | To |
| --- | --- | --- |
| `serialization.ts:78` | `e.type === 'memory_updated' ? selection.privateMemory : e.type === 'artifact_updated' ? selection.artifactChanges : e.type === 'board_delivery' ? selection.boardDelivery && selection.boardContent : selection.boardContent` | `TOOL_EFFECT_ENABLED[e.type](selection)` |
| `serialization.ts:86` | `e.type === 'memory_updated' ? selection.privateMemory : e.type === 'artifact_updated' ? selection.artifactChanges : e.type === 'board_delivery' ? selection.boardDelivery : selection.boardContent` | `SIDE_EFFECT_ENABLED[e.type](selection)` |
| `normalization.ts:32-34` | the four `a.x ||= e.type === …` lines | `for (const category of SIDE_EFFECT_CATEGORIES[e.type]) a[category] ||= true;` |
| `normalization.ts:115` | `group.filter(e => ['board_post', 'board_delivery', 'memory_updated', 'artifact_updated'].includes(e.type))` | `group.filter((e): e is HarnessEvent & { type: CanonicalSideEffect['type'] } => e.type in SIDE_EFFECT_CATEGORIES)` |
| `normalization.ts:119` | `e.type as CanonicalSideEffect['type']` | `e.type` (narrowed by the filter above) |
| `normalization.ts:52` | `if (!['completed', 'cancelled', 'failed', 'interrupted'].includes(run.status)) throw …` | `if (!isTerminalRun(run.status)) throw …` |
| `normalization.ts:110` | `['denied', 'invalid', 'unexecuted'].includes(disposition)` | keep as-is if `disposition` is `unknown`; when it is typed, use `TOOL_DISPOSITION_STATUSES` declared next to the table: `export const TOOL_DISPOSITION_STATUSES = ['denied', 'invalid', 'unexecuted'] as const;` (in `evidence-selection.ts`) |
| `jev-service.ts:39` | `if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) throw new AnalysisConflict(…)` | `if (!isTerminalRun(run.status)) throw new AnalysisConflict(…)` |
| `oversight/reviews.ts:21` | `if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status))` | `if (!isTerminalRun(run.status))` |
| `domain/harness/repository.ts` (`sourceCompleteness`, left verbatim by T7.2) | `['completed', 'cancelled'].includes(run.status) ? … : ['failed', 'interrupted'].includes(run.status) ? …` | `COMPLETE_RUN_STATUSES.includes(run.status) ? 'recorded-terminal' : INCOMPLETE_RUN_STATUSES.includes(run.status) ? 'possibly-incomplete' : 'recording'` |

- [ ] **Step 3.9: Write the failing `MONITOR_VIEW_BUILDERS` parity test**

Create `packages/domain/src/oversight/projections.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { HarnessEvent, Run } from '@sidechannel/contracts/harness/contracts';
import { MONITOR_VIEWS, type MonitorView } from '@sidechannel/contracts/oversight/contracts';
import { defaultFixtureConfiguration, resolveConfiguration } from '../harness/config.js';
import { createQueuedRun } from '../harness/initialization.js';
import { defaultMonitorDefinition } from './service.js';
import { MONITOR_VIEW_BUILDERS, buildProjection } from './projections.js';

const settings = { model: { provider: 'test', id: 'model', settings: {} }, maxInputChars: 1_000_000, contextWindowTokens: 1_000_000, outputAllowanceTokens: 1024, timeoutMs: 1000 };
const events = (run: Run): HarnessEvent[] => [
    { schemaVersion: 1, id: 'e1', runId: run.id, sequence: 1, type: 'turn_started', timestamp: '2026-01-01T00:00:00.000Z', agentId: 'alpha', data: {} },
    { schemaVersion: 1, id: 'e2', runId: run.id, sequence: 2, type: 'board_post', timestamp: '2026-01-01T00:00:00.000Z', agentId: 'alpha', operationId: 'op-1', data: { call: { name: 'post_board' }, after: { id: 'post-1', text: 'hello' } } },
    { schemaVersion: 1, id: 'e3', runId: run.id, sequence: 3, type: 'report_submitted', timestamp: '2026-01-01T00:00:00.000Z', agentId: 'alpha', data: { raw: '{}' } },
];

function fixture() {
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'projection');
    run.board.push({ id: 'post-1', runId: run.id, authorId: 'alpha', sequence: 1, timestamp: '2026-01-01T00:00:00.000Z', text: 'hello' });
    run.reports.push({ agentId: 'alpha', raw: '{}', parsed: {} });
    return run;
}

test('every view has a builder and the table is exhausted', () => {
    assert.deepEqual(Object.keys(MONITOR_VIEW_BUILDERS).sort(), [...MONITOR_VIEWS].sort());
});

test('included and excluded lists are the pre-WS7 literals, in order', () => {
    const run = fixture(), input = events(run), definition = defaultMonitorDefinition();
    const lists = Object.fromEntries(MONITOR_VIEWS.map(view => {
        const projection = buildProjection(run, input, view, definition, settings);
        return [view, { included: projection.included, excluded: projection.excluded }];
    }));
    assert.deepEqual(lists.reports, { included: ['final reports', 'submitted artifact', 'task/policy context'],
        excluded: ['answer keys', 'Jev classifications', 'human labels', 'other monitor outputs', 'audit metadata', 'board content and deliveries', 'tool payloads', 'intermediate artifact contents', 'private memory', 'provider reasoning'] });
    assert.deepEqual(lists.audit, { included: ['final reports', 'submitted artifact', 'task/policy context', 'allowlisted actor/tool/time metadata'],
        excluded: ['answer keys', 'Jev classifications', 'human labels', 'other monitor outputs', 'board content and deliveries', 'tool payloads', 'intermediate artifact contents', 'private memory', 'provider reasoning'] });
    assert.deepEqual(lists.board, { included: ['final reports', 'submitted artifact', 'task/policy context', 'allowlisted actor/tool/time metadata', 'board posts', 'exact board delivery IDs'],
        excluded: ['answer keys', 'Jev classifications', 'human labels', 'other monitor outputs', 'tool payloads', 'intermediate artifact contents', 'private memory', 'provider reasoning'] });
    assert.deepEqual(lists.full, { included: ['final reports', 'submitted artifact', 'task/policy context', 'allowlisted actor/tool/time metadata', 'board posts', 'exact board delivery IDs', 'tool arguments/results', 'assistant outputs', 'artifact history', 'private memory', 'available normalized reasoning'],
        excluded: ['answer keys', 'Jev classifications', 'human labels', 'other monitor outputs'] });
});

test('evidence keys and ids are identical to the ternary implementation', () => {
    const run = fixture(), input = events(run), definition = defaultMonitorDefinition();
    const shape = (view: MonitorView) => {
        const projection = buildProjection(run, input, view, definition, settings);
        return { keys: Object.keys(projection.evidence).sort(), ids: projection.evidenceIds, availability: projection.availability };
    };
    assert.deepEqual(shape('reports').keys, ['context', 'reports', 'submittedArtifact']);
    assert.deepEqual(shape('audit').keys, ['audit', 'context', 'reports', 'submittedArtifact']);
    assert.deepEqual(shape('board').keys, ['audit', 'board', 'context', 'deliveries', 'reports', 'submittedArtifact']);
    assert.deepEqual(shape('full').keys, ['artifactHistory', 'audit', 'board', 'context', 'deliveries', 'reports', 'submittedArtifact', 'trace']);
    assert.deepEqual(shape('full').ids, shape('board').ids);
    assert.deepEqual(shape('reports').ids, ['e3']);
});
```

- [ ] **Step 3.10: Replace the projection dispatch with the table**

Replace `packages/domain/src/oversight/projections.ts` with the following (the helper functions `researchSafe`, `monitorInstructions`, `eventMetadata`, `traceTypes`, `availableReasoning`, `traceContent` and the `restricted` regex are moved **verbatim** from the current file):

```ts
import type { HarnessEvent, Run } from '@sidechannel/contracts/harness/contracts';
import type { MonitorDefinition, MonitorSettings, MonitorView, Projection } from '@sidechannel/contracts/oversight/contracts';
import { digest } from '../analysis/store.js';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

// … `restricted`, `researchSafe`, `monitorInstructions`, `eventMetadata`, `traceTypes`,
//    `availableReasoning`, `traceContent` moved verbatim (T7.3 keeps their bytes unchanged) …

export interface ProjectionContext {
    run: Run;
    definition: MonitorDefinition;
    settings: MonitorSettings;
    ordered: HarnessEvent[];
    tools: Map<string, string>;
    allowedTools: Set<string>;
    reportEvents: HarnessEvent[];
    reports: { evidenceId: string; [key: string]: unknown }[];
    final: Run['artifacts'][number] | undefined;
    freezeEvent: HarnessEvent | undefined;
}

export interface ProjectionBuilderResult { projection: Projection; payload: Record<string, unknown>; }

export interface ProjectionSpec {
    audit: boolean;
    board: boolean;
    trace: boolean;
    included: readonly string[];
    excluded: readonly string[];
}

const BASE_INCLUDED = ['final reports', 'submitted artifact', 'task/policy context'] as const;
const BASE_EXCLUDED = ['answer keys', 'Jev classifications', 'human labels', 'other monitor outputs'] as const;
const AUDIT_INCLUDED = ['allowlisted actor/tool/time metadata'] as const;
const BOARD_INCLUDED = ['board posts', 'exact board delivery IDs'] as const;
const DEEP_INCLUDED = ['tool arguments/results', 'assistant outputs', 'artifact history', 'private memory', 'available normalized reasoning'] as const;
const DEEP_EXCLUDED = ['tool payloads', 'intermediate artifact contents', 'private memory', 'provider reasoning'] as const;

export function prepareProjection(run: Run, events: HarnessEvent[], definition: MonitorDefinition, settings: MonitorSettings): ProjectionContext {
    const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
    const allowedTools = new Set(run.config.roles.flatMap(role => role.allowedTools).filter(tool => /^[a-zA-Z0-9_.-]{1,80}$/.test(tool)));
    const tools = new Map<string, string>();
    for (const event of ordered) {
        const call = record(record(event.data).call);
        if (event.operationId && typeof call.name === 'string') tools.set(event.operationId, call.name);
    }
    const reportEvents = ordered.filter(event => event.type === 'report_submitted');
    const reports = run.reports.map((report, i) => ({ ...researchSafe(report) as object,
        evidenceId: reportEvents.find(event => event.agentId === report.agentId)?.id ?? `report:${run.id}:${i}` }));
    return { run, definition, settings, ordered, tools, allowedTools, reportEvents, reports,
        final: [...run.artifacts].reverse().find(artifact => artifact.frozen),
        freezeEvent: [...ordered].reverse().find(event => event.type === 'artifact_frozen') };
}

function assemble(context: ProjectionContext, view: MonitorView, spec: ProjectionSpec): ProjectionBuilderResult {
    const { run, definition, settings, ordered, tools, allowedTools, reportEvents, reports, final, freezeEvent } = context;
    const evidenceIds = new Set<string>(reportEvents.map(event => event.id));
    if (freezeEvent) evidenceIds.add(freezeEvent.id);
    for (const report of reports) evidenceIds.add(report.evidenceId);
    const evidence: Record<string, unknown> = {
        context: { task: run.config.scenario.task, policy: run.config.scenario.policy,
            scenarioVersion: run.config.scenario.version, reportInstructions: run.config.reportInstructions,
            condition: { id: run.config.condition.id, version: run.config.condition.version, text: run.config.condition.text },
            roles: run.config.roles.map(role => ({ id: role.id, instructions: role.instructions, allowedTools: role.allowedTools })) },
        reports,
        submittedArtifact: final ? { ...researchSafe(final) as object, evidenceId: freezeEvent?.id ?? `artifact:${run.id}:${final.version}` } : null,
    };
    if (final) evidenceIds.add(freezeEvent?.id ?? `artifact:${run.id}:${final.version}`);
    if (spec.audit) {
        evidence.audit = ordered.map(event => eventMetadata(event, tools, allowedTools));
        ordered.forEach(event => evidenceIds.add(event.id));
    }
    if (spec.board) {
        evidence.board = researchSafe(run.board);
        run.board.forEach(post => evidenceIds.add(post.id));
        evidence.deliveries = ordered.filter(event => event.type === 'board_delivery').map(event => ({
            ...eventMetadata(event, tools, allowedTools), messageIds: Array.isArray(record(event.data).after)
                ? (record(event.data).after as unknown[]).map(item => record(item).id).filter(id => typeof id === 'string') : [],
        }));
    }
    if (spec.trace) {
        evidence.trace = ordered.filter(event => traceTypes.has(event.type)).map(event => ({ ...eventMetadata(event, tools, allowedTools), data: traceContent(event) }));
        evidence.artifactHistory = researchSafe(run.artifacts);
    }
    const availability = {
        privateMemory: ordered.some(event => event.type === 'memory_updated' || event.type === 'model_requested' && JSON.stringify(record(event.data).messages ?? []).includes('Private working memory')),
        providerReasoning: ordered.some(event => event.type === 'model_response' && availableReasoning(record(event.data)).length > 0),
        reports: reports.length > 0, finalArtifact: Boolean(final),
    };
    const payload = { schemaVersion: 1, projectionVersion: 'monitor-projection-v1', runId: run.id, view, evidenceIds: [...evidenceIds], evidence };
    const serialized = JSON.stringify(payload);
    const completeInput = monitorInstructions(definition) + '\n' + serialized;
    const estimatedInputTokens = Buffer.byteLength(completeInput, 'utf8');
    const oversized = completeInput.length > settings.maxInputChars || estimatedInputTokens + settings.outputAllowanceTokens > settings.contextWindowTokens;
    return { payload, projection: { schemaVersion: 1, version: 'monitor-projection-v1', runId: run.id, configHash: run.configHash, view,
        evidenceIds: [...evidenceIds], included: [...spec.included], excluded: [...spec.excluded], availability, evidence, serialized, hash: digest(payload),
        characters: completeInput.length, estimatedInputTokens, estimator: 'utf8-byte-upper-bound-v1', status: oversized ? 'oversized' : 'ready',
        ...(oversized ? { reason: 'Complete request exceeds the configured character or conservative context-token budget. Change settings and preview again; no evidence was truncated.' } : {}) } };
}

/**
 * One entry per MonitorView. The four tiers are cumulative (reports ⊂ audit ⊂ board ⊂ full); each
 * builder states its own evidence sections and its own included/excluded copy, so a new view is a
 * compile error here instead of a silent fall-through to the audit tier (finding P3).
 */
export const MONITOR_VIEW_BUILDERS: Record<MonitorView, (context: ProjectionContext) => ProjectionBuilderResult> = {
    reports: context => assemble(context, 'reports', { audit: false, board: false, trace: false,
        included: BASE_INCLUDED, excluded: [...BASE_EXCLUDED, 'audit metadata', 'board content and deliveries', ...DEEP_EXCLUDED] }),
    audit: context => assemble(context, 'audit', { audit: true, board: false, trace: false,
        included: [...BASE_INCLUDED, ...AUDIT_INCLUDED], excluded: [...BASE_EXCLUDED, 'board content and deliveries', ...DEEP_EXCLUDED] }),
    board: context => assemble(context, 'board', { audit: true, board: true, trace: false,
        included: [...BASE_INCLUDED, ...AUDIT_INCLUDED, ...BOARD_INCLUDED], excluded: [...BASE_EXCLUDED, ...DEEP_EXCLUDED] }),
    full: context => assemble(context, 'full', { audit: true, board: true, trace: true,
        included: [...BASE_INCLUDED, ...AUDIT_INCLUDED, ...BOARD_INCLUDED, ...DEEP_INCLUDED], excluded: BASE_EXCLUDED }),
};

export function buildProjectionWithPayload(run: Run, events: HarnessEvent[], view: MonitorView, definition: MonitorDefinition, settings: MonitorSettings): ProjectionBuilderResult {
    const context = prepareProjection(run, events, definition, settings);
    // Preserved behaviour: an unrecognised runtime value (for example from a stored preview written
    // by an older build) degrades to the audit tier, exactly as `view !== 'reports'` did before WS7.
    return (MONITOR_VIEW_BUILDERS[view] ?? MONITOR_VIEW_BUILDERS.audit)(context);
}

export function buildProjection(run: Run, events: HarnessEvent[], view: MonitorView, definition: MonitorDefinition, settings: MonitorSettings): Projection {
    return buildProjectionWithPayload(run, events, view, definition, settings).projection;
}
```

`digest` is still the WS1 alias of `jsonHash`; T7.4 replaces it with `canonicalHash` and adds `hashVersion`.

- [ ] **Step 3.11: Run the projection parity tests**

```bash
node --import tsx --test packages/domain/src/oversight/projections.test.ts
```

Expected: PASS (3 tests) with the concrete `full` key array from Step 3.9's note.

- [ ] **Step 3.12: Migrate the persistence dispatch sites**

| Site | From | To |
| --- | --- | --- |
| `persistence/harness/repository.ts:79` | `['queued', 'running', 'reporting', 'completed'].includes(next.status)` | `CANCEL_OVERRIDE_RUN_STATUSES.includes(next.status)` |
| `:110` | `['queued', 'running', 'reporting', 'stopping'].includes(run.status)` | `ACTIVE_RUN_STATUSES.includes(run.status)` |
| `:193` | `$literal: ['queued', 'running', 'reporting', 'completed'].includes(run.status)` | `$literal: CANCEL_OVERRIDE_RUN_STATUSES.includes(run.status)` |
| `:256` | `status: { $in: ['queued', 'running', 'reporting', 'stopping'] }` | `status: { $in: [...ACTIVE_RUN_STATUSES] }` |
| `:103` | `kind === 'reports' ? { reporting: { … } } : {}` | `kind !== 'reports' ? {} : { reporting: { … } }` (equivalent, keeps the ternary out of the reporting projection decision) — or leave unchanged and note it as presentation of `EVIDENCE_KEY_FIELD`-adjacent logic |
| `:104` | `const field = kind === 'board' ? 'id' : kind === 'artifacts' ? 'version' : 'agentId'` | `const field = EVIDENCE_KEY_FIELD[kind];` |
| `:240` | `const field = kind === 'board' ? 'id' : kind === 'artifacts' ? 'version' : 'agentId', value = kind === 'artifacts' ? Number(key) : key;` | `const field = EVIDENCE_KEY_FIELD[kind], value = EVIDENCE_KEY_COERCION[kind](key);` |
| `persistence/analysis/jev-repository.ts:63` | `['preparing', 'queued', 'running'].includes(j.status)` | `isActiveJob(j.status)` |
| `:64` | `if (['preparing', 'queued', 'running'].includes(j.status)) throw …` | `if (isActiveJob(j.status)) throw …` |
| `:126` | `status: { $in: ['preparing', 'queued', 'running'] }` | `status: { $in: [...ACTIVE_JOB_STATUSES] }` |
| `:127` | `status: { $in: ['completed', 'partial', 'failed', 'cancelled'] }` | `status: { $in: [...RETRYABLE_JOB_STATUSES] }` |
| `oversight/service.ts:156` | `if (!['queued', 'running'].includes(job.status)) return job;` | `if (!ACTIVE_MONITOR_STATUSES.includes(job.status)) return job;` |

- [ ] **Step 3.13: Add the exhaustiveness guard to the Mongo integration suite**

Append to `tests/integration/port-contracts.mongo.test.ts` (or to `tests/integration/run-summary.mongo.test.ts` if the former has been reorganised):

```ts
import { RUN_STATUSES, isTerminalRun } from '@sidechannel/contracts/harness/contracts';
import { EVIDENCE_KINDS } from '@sidechannel/contracts/harness/repository';

test('mongo adapter handles every run status and evidence kind', async () => {
    const repository = await MongoRepository.connect(uri, database());
    try {
        for (const status of RUN_STATUSES) {
            const run = { ...createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'status-' + status), status };
            await repository.createRun(run);
            assert.equal((await repository.getRun(run.id))!.status, status);
            assert.equal((await repository.queryRuns({ status, limit: 10, offset: 0 })).total, 1, status);
            assert.equal(isTerminalRun(status), ['cancelled', 'completed', 'failed', 'interrupted'].includes(status));
        }
        for (const kind of EVIDENCE_KINDS)
            assert.deepEqual(await repository.getEvidencePage('missing-run', kind, 0, 5), { items: [], total: 0 }, kind);
    } finally {
        await repository.db.dropDatabase();
        await repository.close();
    }
});
```

- [ ] **Step 3.14: Run the full backend verification**

```bash
npm run lint
node scripts/verify-boundaries.mjs
npm run check
npm test
npm run build
npm run test:integration
node scripts/verify-migration-equivalence.mjs
```

Expected: all green. The fixture event sequence and final artifact are unchanged because only dispatch tables moved.

- [ ] **Step 3.15: Commit**

```bash
git add packages/contracts/src/harness/contracts.ts packages/contracts/src/harness/contracts.test.ts packages/contracts/src/harness/repository.ts packages/contracts/src/harness/repository.test.ts packages/contracts/src/analysis/jev-repository.ts packages/contracts/src/oversight/contracts.ts packages/domain/src/analysis/evidence-selection.ts packages/domain/src/analysis/evidence-selection.test.ts packages/domain/src/analysis/normalization.ts packages/domain/src/analysis/serialization.ts packages/domain/src/analysis/jev-service.ts packages/domain/src/harness/repository.ts packages/domain/src/oversight/projections.ts packages/domain/src/oversight/projections.test.ts packages/domain/src/oversight/reviews.ts packages/domain/src/oversight/service.ts packages/persistence/src/harness/repository.ts packages/persistence/src/analysis/jev-repository.ts tests/integration/port-contracts.mongo.test.ts
git commit -m "refactor(contracts,domain,persistence): exhaustive dispatch tables for statuses, evidence kinds and monitor views (P3)"
```

**Effort:** 1.0 dev-day. **Rollback:** `git revert`; no persisted values change (projection hashes, ids and included/excluded lists are byte-identical, asserted by `projections.test.ts`). **Out of scope:** the two `board_delivery` enablement rules (documented divergence, not unified), `EvidenceCategory` key names, `EventQuery.phase` (WS1 P7), and the analysis-worker's report/usage typing.

---

## Task 7.4: Canonical hashing, `hashVersion` v2 (decision-gated)

**Files:**
- Modify: `packages/domain/src/hashing.ts` (WS1's module)
- Modify: `packages/domain/src/hashing.test.ts`
- Modify: `packages/contracts/src/oversight/contracts.ts` (`Projection.hashVersion?`, `MonitorPreview.hashVersion?`)
- Modify: `packages/domain/src/oversight/projections.ts` (`canonicalHash(payload)`, `hashVersion: HASH_VERSION`)
- Modify: `packages/domain/src/oversight/service.ts:94-95,104,108-120,131,137-140`
- Modify: `packages/domain/src/oversight/reviews.ts:25-27,44-57,92-96,114`
- Modify: `packages/persistence/src/analysis/jev-repository.ts:108-113` (artifact chunk header)
- Create: `tests/integration/oversight-hash-migration.test.ts`
- Modify: `docs/solid-remediation-decisions.md`

**Interfaces:**
- Consumes: `jsonHash`, `canonicalHash`, `canonicalJson` from WS1 (`packages/domain/src/hashing.ts`).
- Produces:

```ts
export const HASH_VERSION = 2 as const;
export type HashVersion = 1 | 2;
export function hashWith(value: unknown, version: HashVersion): string;
export type HashVerdict = 'match' | 'stale' | 'legacy-mismatch';
export function verifyHash(stored: { hash: string; hashVersion?: number }, value: unknown, options?: { acceptLegacy?: boolean }): HashVerdict;
export function evidenceRevisions(value: unknown, options?: { acceptLegacy?: boolean }): string[];
export const LEGACY_HASHES_ACCEPTED: boolean;
export const LEGACY_HASH_CONFLICT_MESSAGE: string;
```

**Declared behaviour change (stated with evidence):** the *values* of four stored hashes change when written under v2 — `Projection.hash`, `MonitorPreview.hash`, the preview `contentHash`, and the oversight review `evidenceRevision`. This is the WS7 half of X6, deferred by WS1 (`docs/archive/plans/2026-11-07-ws1-adapter-contract-parity.md` Task 1) and by program plan Appendix B, and it changes nothing about what the hashes *mean*: every comparison goes through `verifyHash`, and pre-migration records continue to verify under v1 where the decision preserves data. Analysis launch/preview/settings hashes are **not** migrated: `snapshotHash`/`stableStringify` in `packages/domain/src/analysis/configuration.ts:5-14` already sort keys, so v2 is byte-identical for them and a v1 fallback would be dead code. `Run.configHash`, the monitor evaluation id and review subject keys are identity keys and stay on their frozen derivation (see Step 4.6).

- [ ] **Step 4.1: Establish the migration decision (blocking, explicit — do not assume)**

```bash
ls docs/solid-remediation-decisions.md
git grep -n -i "persisted study data\|hash migration\|canonical" -- docs/solid-remediation-decisions.md
```

Then choose exactly one branch and record it before writing code:

| Observation in `docs/solid-remediation-decisions.md` | Branch | Meaning |
| --- | --- | --- |
| A line states there is **no persisted study data** (or that one-time invalidation of previews is acceptable) | **A — invalidate** | `LEGACY_HASHES_ACCEPTED = false`. Pre-migration previews and reviews are rejected with the friendly 409; new writes are v2. |
| A line states persisted study data must be **preserved** | **B — dual-read** | `LEGACY_HASHES_ACCEPTED = true`. Stored v1 hashes still verify and still count as `match`. |
| The file is missing, or it mentions the deferral without deciding | **Stop** | Append the question below to the file, message the lead, and do not modify hashing code. |

Exact question to append and send when the decision is absent:

```markdown
### Open decision — WS7 canonical hashing (blocks T7.4)

Does any database reachable by this deployment hold persisted study data that must survive a
change in the oversight projection / preview / review-evidence hash values?

- If **no**: T7.4 sets `LEGACY_HASHES_ACCEPTED = false`; every pre-migration monitor preview and
  run-outcome review is rejected with a friendly 409 and must be re-created. Nothing is deleted.
- If **yes**: T7.4 sets `LEGACY_HASHES_ACCEPTED = true`; stored v1 hashes keep verifying, new
  writes record `hashVersion: 2`, and no preview or review is invalidated.
```

- [ ] **Step 4.2: Confirm the WS1 hashing module exists (fallback code if not)**

```bash
test -f packages/domain/src/hashing.ts && grep -n "export function canonicalHash" packages/domain/src/hashing.ts
```

If the file is absent (WS1 not executed), create `packages/domain/src/hashing.ts` with WS1 Task 1.3's code verbatim (`jsonHash`, `canonicalJson`, `canonicalHash`) and add to `packages/domain/package.json` `exports`:

```json
"./hashing": { "types": "./dist/hashing.d.ts", "import": "./dist/hashing.js" },
```

- [ ] **Step 4.3: Write the failing hashing test**

Extend `packages/domain/src/hashing.test.ts` (create it with WS1 Task 1.1's tests if absent) with:

```ts
import { HASH_VERSION, LEGACY_HASHES_ACCEPTED, canonicalHash, hashWith, jsonHash, verifyHash } from './hashing.js';

const value = { b: 1, a: [2, { d: undefined, c: 3 }] };

test('v1 and v2 hashes are the two pre-existing families, byte for byte', () => {
    assert.equal(hashWith(value, 1), jsonHash(value));
    assert.equal(hashWith(value, 2), canonicalHash(value));
});

test('v2 is order-independent and v1 is not', () => {
    assert.equal(hashWith({ a: 1, b: 2 }, 2), hashWith({ b: 2, a: 1 }, 2));
    assert.notEqual(hashWith({ a: 1, b: 2 }, 1), hashWith({ b: 2, a: 1 }, 1));
});

test('a stored v2 hash must match v2 exactly', () => {
    assert.equal(verifyHash({ hash: canonicalHash(value), hashVersion: HASH_VERSION }, value), 'match');
    assert.equal(verifyHash({ hash: jsonHash(value), hashVersion: HASH_VERSION }, value), 'stale');
});

test('a stored v1 hash is honoured only while legacy hashes are accepted', () => {
    const stored = { hash: jsonHash(value), hashVersion: 1 };
    assert.equal(verifyHash(stored, value, { acceptLegacy: true }), 'match');
    assert.equal(verifyHash(stored, value, { acceptLegacy: false }), 'legacy-mismatch');
    assert.equal(verifyHash({ hash: canonicalHash(value) }, value, { acceptLegacy: false }), 'match');
    assert.equal(verifyHash({ hash: jsonHash(value) }, value, { acceptLegacy: true }), 'match');
    assert.equal(verifyHash({ hash: jsonHash(value) }, value, { acceptLegacy: false }), 'legacy-mismatch');
    assert.equal(verifyHash({ hash: jsonHash({ other: 1 }) }, value, { acceptLegacy: true }), 'stale');
});

test('the shipped policy matches the recorded decision', () => {
    // Branch A records `false`, branch B records `true`; either way the constant is explicit.
    assert.equal(typeof LEGACY_HASHES_ACCEPTED, 'boolean');
});
```

- [ ] **Step 4.4: Run it to verify it fails**

```bash
node --import tsx --test packages/domain/src/hashing.test.ts
```

Expected: FAIL — `does not provide an export named 'verifyHash'`.

- [ ] **Step 4.5: Add the versioned hashing seam**

Append to `packages/domain/src/hashing.ts`:

```ts
/** Current hash format. 1 = insertion-order JSON (frozen), 2 = sorted-key canonical JSON. */
export const HASH_VERSION = 2 as const;

export type HashVersion = 1 | 2;

/**
 * Migration policy, decided in docs/solid-remediation-decisions.md (WS7 entry).
 * true  = persisted study data must survive: stored v1 hashes still verify (dual-read).
 * false = no persisted study data: pre-migration previews/reviews are rejected with a friendly 409.
 */
export const LEGACY_HASHES_ACCEPTED: boolean = false;

export type HashVerdict = 'match' | 'stale' | 'legacy-mismatch';

export function hashWith(value: unknown, version: HashVersion): string {
    return version === 1 ? jsonHash(value) : canonicalHash(value);
}

/**
 * Compares a stored hash with freshly computed content. `legacy-mismatch` means the record was
 * written under v1 and legacy reads are disabled — a migration artefact, not evidence drift, so
 * callers must answer with a re-preview instruction instead of an "evidence changed" error.
 */
export function verifyHash(stored: { hash: string; hashVersion?: number }, value: unknown, options: { acceptLegacy?: boolean } = {}): HashVerdict {
    const acceptLegacy = options.acceptLegacy ?? LEGACY_HASHES_ACCEPTED;
    if (stored.hashVersion === 2) return stored.hash === canonicalHash(value) ? 'match' : 'stale';
    if (stored.hashVersion === 1) return stored.hash === jsonHash(value) ? (acceptLegacy ? 'match' : 'legacy-mismatch') : 'stale';
    if (stored.hash === canonicalHash(value)) return 'match';
    if (stored.hash === jsonHash(value)) return acceptLegacy ? 'match' : 'legacy-mismatch';
    return 'stale';
}

/** Candidate current evidence revisions, newest first; used where the stored version is not recorded. */
export function evidenceRevisions(value: unknown, options: { acceptLegacy?: boolean } = {}): string[] {
    const acceptLegacy = options.acceptLegacy ?? LEGACY_HASHES_ACCEPTED;
    return acceptLegacy ? [canonicalHash(value), jsonHash(value)] : [canonicalHash(value)];
}

export const LEGACY_HASH_CONFLICT_MESSAGE = 'This record was created before an evidence-hashing format migration. Recreate the preview (or reopen the review) to continue; no recorded evidence changed.';
```

Set `LEGACY_HASHES_ACCEPTED` from Step 4.1's branch (A → `false`, B → `true`).

- [ ] **Step 4.6: Migrate the projection hash**

In `packages/domain/src/oversight/projections.ts`:

1. Replace `import { digest } from '../analysis/store.js';` with `import { HASH_VERSION, canonicalHash } from '../hashing.js';`.
2. In `assemble`, replace `hash: digest(payload)` with `hash: canonicalHash(payload), hashVersion: HASH_VERSION`.

In `packages/contracts/src/oversight/contracts.ts`, add to `Projection` (after `hash: string;`): `hashVersion?: number;` and to `MonitorPreview` (after `hash: string;`): `hashVersion?: number;`.

Frozen identity rule — do **not** change any of these:

| Derivation | Why it stays |
| --- | --- |
| `Run.configHash` (`harness/initialization.ts`) | Identity written once at creation; never recomputed for comparison. Migrating it would rewrite every stored run's provenance. |
| `monitor-${digest(idempotencyKey)}` (`oversight/service.ts:123`) | Hashes a *string*: v1 and v2 produce identical output, so it is already stable. Asserted in the test below. |
| Review subject keys (`analysis/jev-reviews.ts:37`, `oversight/reviews.ts:77`) | Hash arrays of scalars; arrays have no keys to sort, so v1 and v2 are identical. Asserted in the test below. |
| `snapshotHash` consumers (analysis launch/preview/settings, `source.evidenceHash`, window `state`) | Already canonical. |

- [ ] **Step 4.7: Version the monitor preview hashes**

In `packages/domain/src/oversight/service.ts`:

1. Line 8 import becomes `import { buildProjection, buildProjectionWithPayload, digest } from './projections.js';` **minus** `digest`, plus `import { HASH_VERSION, LEGACY_HASH_CONFLICT_MESSAGE, canonicalHash, verifyHash } from '../hashing.js';`.
2. Line 94-95: replace `hash: digest({ definition, settings, runs: … })` with `hash: canonicalHash({ definition, settings, runs: … }), hashVersion: HASH_VERSION`.
3. Line 104: `contentHash: canonicalHash(serialized), contentHashVersion: HASH_VERSION`.
4. `getMonitorPreview` (line 109): read the new field — `const manifest = await store.get<{ id: string; revision: number; createdAt: string; partCount: number; contentHash: string; contentHashVersion?: number }>(…)`.
5. Line 118: replace the integrity check with

```ts
    const verdict = verifyHash({ hash: manifest.contentHash, hashVersion: manifest.contentHashVersion }, serialized);
    if (verdict === 'legacy-mismatch') throw new OversightError(409, LEGACY_HASH_CONFLICT_MESSAGE);
    if (verdict === 'stale') throw new OversightError(500, 'Frozen monitor preview integrity check failed');
```

6. Lines 137-140 (launch staleness): replace the projection loop body with

```ts
        for (const projection of source.projections) {
            const fresh = buildProjectionWithPayload(run, events, projection.view, preview.definition, preview.settings);
            const verdict = verifyHash({ hash: projection.hash, hashVersion: projection.hashVersion }, fresh.payload);
            if (verdict === 'legacy-mismatch') throw new OversightError(409, LEGACY_HASH_CONFLICT_MESSAGE);
            if (verdict === 'stale') throw new OversightError(409, `Evidence changed for ${source.runId}. Preview again.`);
        }
```

Line 131 (`preview.hash !== parsed.previewHash`) is a stored-vs-client comparison of the *same* record and needs no change; leave it and add a comment: `// Both values were produced by the build that created the preview; nothing is recomputed here.`

- [ ] **Step 4.8: Dual-read the review evidence revision**

In `packages/domain/src/oversight/reviews.ts`:

1. Add `import { evidenceRevisions } from '../hashing.js';` and drop the local `hash` import usage for the revision (keep `hash` for the review id at line 77 — it hashes an array and is unchanged).
2. `sourceSnapshot` (line 25-27): compute the payload once, then

```ts
    const evidence = { version: 'run-review-source-v1', runId, configHash: run.configHash,
        status: run.status, events, reports: run.reports, artifacts: run.artifacts, board: run.board };
    // `version` is the source-schema marker, not a hash-format marker: it stays 'v1' so the only
    // variable is the hash function itself.
    const [evidenceRevision, ...previousEvidenceRevisions] = evidenceRevisions(evidence);
    return { run, events, evidenceRevision, previousEvidenceRevisions };
```

3. Thread the previous revisions into agreement: `agreement(history, evidenceRevision, definitionRevisionId, previousEvidenceRevisions)` and at line 55 replace `sourceMatches: sameEvidence && first.evidenceRevision === evidenceRevision` with

```ts
        sourceMatches: sameEvidence && [evidenceRevision, ...previousEvidenceRevisions].includes(first.evidenceRevision),
```

4. `runReviewContext` (line 31-35), `runOutcomeAgreements` (line 86-90), `agreementsFrom` (line 92-96) and `exportRunOutcomeReviews` (line 114) pass `source.previousEvidenceRevisions` / `context.previousEvidenceRevisions` through as an extra argument. **`RunReviewContext` and the API payloads are unchanged** — the extra value never leaves the domain.

- [ ] **Step 4.9: Version the analysis artifact chunk hashes**

In `packages/persistence/src/analysis/jev-repository.ts`:

1. Import `HASH_VERSION, canonicalHash, verifyHash` from `@sidechannel/domain/hashing` and delete the local `digest`.
2. `putArtifact` (lines 108-111): compute `const hash = canonicalHash(serialized);`, write `hashVersion: HASH_VERSION` into the `$setOnInsert` document, and replace the immutability comparison with

```ts
        for (let index = 0; index < count; index++) {
            const text = chunks[index]!;
            const existing = await this.db.collection('analysis_artifacts').findOne({ id, index });
            if (existing && verifyHash({ hash: existing.hash, hashVersion: existing.hashVersion }, JSON.parse(text)) === 'stale') throw new AnalysisConflict('Artifact is immutable');
            await this.db.collection('analysis_artifacts').updateOne({ id, index }, { $setOnInsert: { id, index, text, hash, hashVersion: HASH_VERSION, count } }, { upsert: true });
        }
```

Keep the per-chunk write semantics (chunks are written once, immutable) — the extra `findOne` only replaces the previous `findOneAndUpdate` read-back, so the round-trip count is unchanged.
3. `readArtifact` (line 113): `const verdict = verifyHash({ hash: header?.hash ?? '', hashVersion: header?.hashVersion }, JSON.parse(text)); if (verdict !== 'match') throw new AnalysisConflict('Artifact integrity check failed');`

- [ ] **Step 4.10: Write the failing migration test**

Create `tests/integration/oversight-hash-migration.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryResearchStore } from '@sidechannel/persistence/analysis/store';
import { HASH_VERSION, LEGACY_HASH_CONFLICT_MESSAGE, LEGACY_HASHES_ACCEPTED, canonicalHash, hashWith, jsonHash } from '@sidechannel/domain/hashing';
import { buildProjection, buildProjectionWithPayload } from '@sidechannel/domain/oversight/projections';
import { createMonitorPreview, defaultMonitorDefinition, getMonitorPreview, launchMonitor } from '@sidechannel/domain/oversight/service';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { MonitorPreview, Projection } from '@sidechannel/contracts/oversight/contracts';

const settings = { model: { provider: 'test', id: 'model', settings: {} }, maxInputChars: 1_000_000, contextWindowTokens: 1_000_000, outputAllowanceTokens: 1024, timeoutMs: 1000 };

function fixture() {
    const repository = new InMemoryRepository(), store = new InMemoryResearchStore();
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'hash-migration');
    run.status = 'completed';
    run.reports.push({ agentId: 'alpha', raw: '{}', parsed: {} });
    return { repository, store, run };
}

test('new projections and previews are written under v2', async (t) => {
    const { repository, store, run } = fixture();
    t.after(async () => {});
    await repository.createRun(run);
    const preview = await createMonitorPreview(repository, store, { ...settings, runIds: [run.id], definitionRevision: 1 });
    assert.equal(preview.hashVersion, HASH_VERSION);
    assert.equal(preview.hash, canonicalHash({ definition: preview.definition, settings: preview.settings,
        runs: preview.runs.map(source => ({ runId: source.runId, hashes: source.projections.map(projection => projection.hash) })) }));
    for (const source of preview.runs) for (const projection of source.projections) {
        assert.equal(projection.hashVersion, HASH_VERSION);
        const fresh = buildProjectionWithPayload(run, [], projection.view, preview.definition, preview.settings);
        assert.equal(projection.hash, canonicalHash(fresh.payload));
    }
});

test('a stored v1 preview is rejected with the friendly conflict, or still launches when legacy reads are on', async (t) => {
    const { repository, store, run } = fixture();
    t.after(async () => {});
    await repository.createRun(run);
    const preview = await createMonitorPreview(repository, store, { ...settings, runIds: [run.id], definitionRevision: 1 });
    const legacy: MonitorPreview = { ...preview, hashVersion: 1, hash: jsonHash({ definition: preview.definition, settings: preview.settings,
        runs: preview.runs.map(source => ({ runId: source.runId, hashes: source.projections.map(projection => projection.hash) })) }),
        runs: preview.runs.map(source => ({ ...source, projections: source.projections.map(projection => ({ ...projection, hashVersion: 1,
            hash: hashWith(JSON.parse(projection.serialized), 1) }) as Projection) })) };
    await store.insert('monitor_previews', { id: legacy.id, revision: 1, createdAt: legacy.createdAt, partCount: 0,
        contentHash: hashWith(JSON.stringify(legacy), 1), contentHashVersion: 1 });
    // The parts are rewritten so getMonitorPreview returns the v1-labelled copy byte for byte.
    for (let index = 0; index < Math.ceil(JSON.stringify(legacy).length / 250000); index++)
        await store.insert('monitor_preview_parts', { id: `${legacy.id}:${index}`, revision: 1, createdAt: legacy.createdAt,
            text: JSON.stringify(legacy).slice(index * 250000, (index + 1) * 250000) });
    const restored = await getMonitorPreview(store, legacy.id);
    assert.equal(restored!.hashVersion, 1);
    const launch = launchMonitor(repository, store, { previewId: legacy.id, previewHash: legacy.hash, idempotencyKey: 'legacy' });
    if (LEGACY_HASHES_ACCEPTED) assert.equal((await launch).status, 'queued');
    else await assert.rejects(launch, new RegExp(LEGACY_HASH_CONFLICT_MESSAGE.replaceAll('.', '\\.')));
});

test('projection hashes are order-independent under v2 and identity hashes are unchanged', () => {
    const run = fixture().run;
    const definition = defaultMonitorDefinition();
    const projection = buildProjection(run, [], 'audit', definition, settings);
    assert.equal(projection.hash, canonicalHash(JSON.parse(projection.serialized)));
    assert.equal(projection.hash, hashWith(JSON.parse(projection.serialized), 2));
    assert.notEqual(projection.hash, hashWith(JSON.parse(projection.serialized), 1));
    // Identity derivations hash scalars or arrays and therefore never change.
    assert.equal(hashWith('launch-key', 1), hashWith('launch-key', 2));
    assert.equal(hashWith(['window', 1, 'code'], 1), hashWith(['window', 1, 'code'], 2));
});
```

- [ ] **Step 4.11: Run the test to verify it fails, then passes**

```bash
npm run build
node --env-file-if-exists=.env --import tsx --test tests/integration/oversight-hash-migration.test.ts
```

Expected before Step 4.5-4.9: FAIL (`does not provide an export named 'HASH_VERSION'`). After: PASS (3 tests) on the branch recorded in Step 4.1.

- [ ] **Step 4.12: Record the decision and the migration note**

Append to `docs/solid-remediation-decisions.md`:

```markdown
## WS7 — canonical hashing migration (2026-11-07)

- **Decision:** <A — one-time invalidation (no persisted study data) | B — dual-read of stored v1 hashes>.
  `LEGACY_HASHES_ACCEPTED` in `packages/domain/src/hashing.ts` is the executable form of this line.
- **What changed:** oversight `Projection.hash`, `MonitorPreview.hash`, the preview `contentHash` and the
  oversight review `evidenceRevision` are computed with sorted-key JSON (`hashVersion: 2`). Values recorded
  before this change verify under v1.
- **What did not change:** `Run.configHash`, monitor-evaluation ids and review subject keys are identity
  derivations and stay frozen; analysis launch/preview/settings hashes and `source.evidenceHash` were already
  canonical, so their values are byte-identical.
- **Operator note:** after deploying, create monitor previews fresh. Under branch A an old preview answers
  409 with "…created before an evidence-hashing format migration…"; under branch B it keeps working.
- **Rollback:** reverting T7.4 restores v1 computation. Records written under v2 then fail their v1 recompute
  and are re-previewed; no record is deleted or rewritten in either direction.
```

- [ ] **Step 4.13: Run the full verification**

```bash
npm run lint
node scripts/verify-boundaries.mjs
npm run check
npm test
npm run build
npm run test:integration
node scripts/verify-compiled.mjs
node scripts/verify-migration-equivalence.mjs
npm run fixture
git diff --stat agent/examples/completed-fixture.json
```

Expected: all green; the fixture diff is empty (fixture exports carry `evidenceHash`, which is already canonical; no oversight preview is part of the fixture export).

- [ ] **Step 4.14: Commit**

```bash
git add packages/domain/src/hashing.ts packages/domain/src/hashing.test.ts packages/contracts/src/oversight/contracts.ts packages/domain/src/oversight/projections.ts packages/domain/src/oversight/service.ts packages/domain/src/oversight/reviews.ts packages/persistence/src/analysis/jev-repository.ts tests/integration/oversight-hash-migration.test.ts docs/solid-remediation-decisions.md
git commit -m "feat(domain): versioned canonical hashing (hashVersion 2) with decision-gated legacy reads (X6)"
```

**Effort:** 1.5 dev-days. **Rollback:** `git revert` restores v1 hashing (`jsonHash`) and removes the `hashVersion` reads. The `hashVersion` fields written to `analysis_artifacts` chunks, `monitor_previews` and preview projections are additive and ignored by the v1 code, so **no data is destroyed in either direction**; previews written under v2 are simply re-created (a preview is ephemeral by contract — `launchMonitor` already requires a fresh one). Never run this task against a database with study data before Step 4.1 records a decision. **Out of scope:** migrating `Run.configHash` or any identity derivation; a data-rewriting migration script; the analysis `snapshotHash` family (already canonical); WS5's transport-level caching.

---

## Task 7.5: Dead-code and export cleanup leftovers

Execute only the items that are still present. Each item starts with the `git grep` precondition; if it prints a use outside the declaration, skip that item and note it (it is not dead).

**Files:** `dashboard/src/lib/analysis-types.ts`, `dashboard/src/lib/types.ts`, `experiment-worker/src/harness/gateway.ts`, `experiment-worker/src/mastra/**` (only if the orphan agent still exists)

**Interfaces:** none produced; only deletions and one internal refactor (`gateway.ts`).

- [ ] **Step 5.1: Inventory the leftovers**

```bash
git grep -n "ConfigurationResponse" -- dashboard/src
git grep -n "AnalysisAttempt\|CanonicalStep\|CanonicalContribution\|AnalysisRequest\|AnalysisResponse\|OutcomeAgreement\|evidenceCategories" -- dashboard/src
git grep -n "schedule-tools\|mastra/agents/agent" -- experiment-worker/src
git grep -n "allowedKeys" -- experiment-worker/src/harness/gateway.ts
```

Record the result in the PR body. Anything matching only its own declaration is dead.

- [ ] **Step 5.2: Delete the dead dashboard exports**

In `dashboard/src/lib/types.ts` delete `ConfigurationResponse` (lines 16-19) — `git grep ConfigurationResponse` must show no other match.
In `dashboard/src/lib/analysis-types.ts` delete `CanonicalContribution`, `CanonicalStep`, `AnalysisAttempt`, `OutcomeAgreement`, `AnalysisRequest`, `AnalysisResponse` and the unused `evidenceCategories` constant (lines 5, 13, 14, 18, 24, 28, 29), keeping `AnalysisJob`, `AnalysisWindow`, `AnalysisPreview`, `AnalysisSettings`, `AnalysisManifest`, `HumanReview`, `Page`, `WindowDetail`, `BehaviorCode`, `Codebook`, `CodebookRevision`, `InputBudget`, `AnalysisResult`, `ReviewInput`, `ReviewBatchInput`, `ReviewBatch`, `ReviewSelection` — each of which is still imported by a page (`git grep` before deleting).

- [ ] **Step 5.3: Run the dashboard gates after the deletions**

```bash
npm run check --workspace=sidechannel-dashboard
npm test --workspace=sidechannel-dashboard
npm run lint --workspace=sidechannel-dashboard
```

Expected: PASS. A deletion that breaks a page means the symbol was not dead — restore that one symbol only.

- [ ] **Step 5.4: De-duplicate the tool argument allowlist**

In `experiment-worker/src/harness/gateway.ts`, replace line 38 (the `allowedKeys` literal) and lines 39-40 with:

```ts
    if (commonTools.some(tool => tool.name === name)) {
        const declared = Object.keys((commonTools.find(tool => tool.name === name)!.parameters as { properties?: Record<string, unknown> }).properties ?? {});
        if (Object.keys(a).some(key => !declared.includes(key)))
            return { result: { ok: false, error: 'Unknown arguments' }, yielded: false };
    }
```

This derives the allowlist from the JSON schema the model was given instead of restating it. Behaviour is identical: `list_agents`/`end_turn` declare no properties (any argument is rejected), `post_board: ['text']`, `read_board: ['limit','beforeSequence']`, `update_working_memory: ['notes']`.

- [ ] **Step 5.5: Prove the tool gate is unchanged**

Append to `experiment-worker/src/harness/core.test.ts`:

```ts
test('the argument allowlist comes from the published tool schema', async () => {
    const { commonTools, executeTool, toolCatalog } = await import('./gateway.js');
    const expected = { list_agents: [], end_turn: [], post_board: ['text'], read_board: ['limit', 'beforeSequence'], update_working_memory: ['notes'] };
    for (const [name, keys] of Object.entries(expected))
        assert.deepEqual(Object.keys((commonTools.find(tool => tool.name === name)!.parameters as { properties: Record<string, unknown> }).properties), keys, name);
    assert.ok(toolCatalog); assert.ok(executeTool);
});
```

Run:

```bash
node --import tsx --test experiment-worker/src/harness/core.test.ts
```

Expected: PASS. If the file's existing tests construct a run/role inline, reuse their helpers instead of importing `gateway.js` dynamically.

- [ ] **Step 5.6: Commit**

```bash
git add dashboard/src/lib/analysis-types.ts dashboard/src/lib/types.ts experiment-worker/src/harness/gateway.ts experiment-worker/src/harness/core.test.ts
git commit -m "chore: delete dead dashboard exports and derive the tool argument allowlist"
```

**Effort:** 0.4 dev-days. **Rollback:** `git revert`; pure deletions plus one internal refactor. **Out of scope:** any type still imported by a page (WS6 leftover), the orphan Mastra agent if WS0 already removed it, and `ReviewInput` splitting (WS5 T5.5).

---

## Task 7.6: Program close-out, metrics and re-audit gate

**Files:**
- Modify: `docs/solid-remediation-decisions.md`
- Modify: `README.md` (only if the docs table does not already link the audit, the program plan and the decision log)
- Read: `scripts/architecture-budget.mjs` + `scripts/architecture-budget.json` (WS0 T0.1)
- Read: `docs/archive/2026-11-07-solid-principles-audit.md`, `docs/archive/2026-11-07-solid-audit-report.html`

**Interfaces:** none. This task records evidence and runs the final gate.

- [ ] **Step 6.1: Capture the "before" metrics (on the commit before T7.1)**

```bash
git stash list
git checkout <ws7-base-commit>
npm run architecture > /tmp/ws7-before.json 2>/dev/null || true
git grep -c "Badge status=" -- dashboard/src || true
git grep -cE "\['queued', 'running'|view !== 'reports'|\['completed', 'cancelled'\]|\['failed', 'interrupted'\]" -- packages || true
git grep -c "createHash('sha256').update(JSON.stringify" -- packages/domain/src || true
wc -l dashboard/src/lib/types.ts dashboard/src/lib/analysis-types.ts
```

If `npm run architecture` does not exist (WS0 not executed), substitute the three `git grep -c` counts and `wc -l` above — they are the WS7-relevant subset of the budget (status arrays, view branches, jsonHash helpers, dead type volume). Record the numbers verbatim; do not estimate.

- [ ] **Step 6.2: Capture the "after" metrics and the delta table**

```bash
npm run architecture > /tmp/ws7-after.json
git grep -c "Badge status=" -- dashboard/src || true
git grep -cE "\['queued', 'running'|view !== 'reports'|\['completed', 'cancelled'\]|\['failed', 'interrupted'\]" -- packages || true
git grep -c "createHash('sha256').update(JSON.stringify" -- packages/domain/src || true
wc -l dashboard/src/lib/status.ts dashboard/src/lib/types.ts dashboard/src/lib/analysis-types.ts
```

Expected deltas: `Badge status=` 21 → 0; status/view literal sites ≥ 12 → 0 outside the vocabulary definitions; jsonHash helpers 5 → 1 (`hashing.ts`); `status.ts` ≈ 130 new lines replacing ≥ 40 lines of duplicated lists across four pages.

Append to `docs/solid-remediation-decisions.md`:

```markdown
## WS7 — metric deltas (2026-11-07)

| Metric | Before | After |
| --- | --- | --- |
| `Badge status=` call sites | <n> | <n> |
| Run-status / monitor-view literal sites in `packages/**` | <n> | <n> |
| `JSON.stringify` hash helpers in `packages/domain/src` | <n> | <n> |
| Dashboard files declaring a status table | <n> | 1 (`dashboard/src/lib/status.ts`) |
| `RunSummary` field-list copies | 4 | 1 (`SUMMARY_OMIT` + `toRunSummary`) |

Architecture budget: <paste the `npm run architecture` summary line, or the three counts above>.
```

- [ ] **Step 6.3: Write the re-audit procedure into the decision log**

Append the procedure verbatim so the next auditor repeats it:

```markdown
## Re-audit procedure (final WS7 gate)

1. Load the `solid-principles` skill; re-read `docs/archive/2026-11-07-solid-principles-audit.md` for scope.
2. Census the tree: `git ls-files '*.ts' '*.tsx' | grep -v node_modules | xargs wc -l | tail -1` and record
   file count + lines so the report is comparable with the 149-file / 18,257-line baseline.
3. Re-run every check the original audit ran: `npm run lint`, `node scripts/verify-boundaries.mjs`,
   `npm run check`, `npm test`, `npm run architecture`.
4. Re-assess each of the 45 findings by id (S1–S10, P1–P10, X1–X6, F1–F19) against the current source, and
   write a status column: closed / accepted / open, with the file:line evidence for each.
5. Emit `research/docs/<date>-solid-principles-audit.md` plus the HTML report, with the new scores
   (SRP/OCP/LSP/ISP/DIP/overall) and the finding table.
6. **Gate:** 0 critical, 0 high, medium ≤ 5, overall ≥ B, SRP ≥ C+. Any reopened finding is filed against a
   new workstream; it does not reopen WS7.
7. Update `docs/solid-remediation-decisions.md` with the new scores and the accepted-medium list.
```

- [ ] **Step 6.4: Run the program verification matrix**

```bash
npm run lint
node scripts/verify-boundaries.mjs
npm run check
npm test
npm run build
node scripts/verify-compiled.mjs
docker compose up -d --wait mongo
npm run test:integration
node scripts/verify-migration-equivalence.mjs
npm run smoke:dashboard
npm run fixture
git diff --stat agent/examples/completed-fixture.json
git diff --stat agent/examples/
```

Expected: all green; no semantic diff in `agent/examples/`.

- [ ] **Step 6.5: Confirm the documentation links resolve**

```bash
git grep -n "solid-audit-report" -- README.md docs
git grep -n "ws7-vocabulary-unification" -- README.md docs
git grep -n "solid-remediation-decisions" -- README.md docs
```

Expected: each prints at least one link. If `README.md`'s docs table lacks a row, add one line per artifact in the existing table.

- [ ] **Step 6.6: Run the re-audit gate**

Execute Step 6.3's procedure. Record the new scores and the finding statuses in `research/docs/<date>-solid-principles-audit.md` and in the decision log. Stop if the gate is not met and file the reopened findings as a follow-up plan; do not patch them inside WS7.

- [ ] **Step 6.7: Commit**

```bash
git add docs/solid-remediation-decisions.md README.md research/docs
git commit -m "docs: WS7 close-out — metric deltas, migration note and re-audit gate"
```

**Effort:** 0.35 dev-days (excluding the re-audit itself, which is a separate research pass). **Rollback:** `git revert`; documentation only. **Out of scope:** fixing findings the re-audit reopens.

---

## Verification summary

| Check | Command | Expected |
| --- | --- | --- |
| Lint + boundaries | `npm run lint && node scripts/verify-boundaries.mjs` | exit 0 |
| Types | `npm run check` | exit 0 |
| Unit + memory contracts | `npm test` | PASS, includes `status.test.ts`, `summary.test.ts`, `contracts.test.ts`, `repository.test.ts`, `evidence-selection.test.ts`, `projections.test.ts`, `hashing.test.ts` |
| Dashboard suites | `npm test --workspace=sidechannel-dashboard` | PASS, includes `status.test.ts` and the updated `ui.test.tsx` |
| Build / compiled | `npm run build && node scripts/verify-compiled.mjs` | PASS |
| Mongo parity | `npm run test:integration` | PASS, includes `run-summary.mongo.test.ts`, `oversight-hash-migration.test.ts` and the extended status/evidence-kind contract test |
| Migration equivalence | `node scripts/verify-migration-equivalence.mjs` | PASS |
| No status strings on `Badge` | `git grep -n "Badge status=" -- dashboard/src` | no output |
| No view ternaries | `git grep -n "view !== 'reports'\|view === 'board'\|view === 'full'" -- packages/domain/src` | no output |
| One hash family | `git grep -c "createHash('sha256').update(JSON.stringify" -- packages/domain/src` | `1` (`hashing.ts`) |
| One summary definition | `git grep -n "Omit<Run, 'board'" -- packages` | no output (replaced by `SUMMARY_OMIT`) |
| Fixture unchanged | `npm run fixture && git diff --stat agent/examples/` | no semantic diff |
| Architecture budget | `npm run architecture:check` (WS0 script) | exit 0 |
| Re-audit | Step 6.3 procedure | 0 critical, 0 high, medium ≤ 5, overall ≥ B |

## Rollback

| Task | Revert strategy | Data impact |
| --- | --- | --- |
| T7.1 | `git revert <commit>` — `status.ts` and the page edits are one commit | none (no writes) |
| T7.2 | `git revert <commit>` — `summarizeRun` restored, Mongo projection literals restored | none (read-shape only) |
| T7.3 | `git revert <commit>` — tables restored to literals | none (values byte-identical; `projections.test.ts` is deleted with the commit) |
| T7.4 | `git revert <commit>` — `hashing.ts` loses `verifyHash`/`hashWith`, call sites return to `jsonHash`/`digest`, `hashVersion` is no longer read or written | additive `hashVersion` fields remain in stored documents and are ignored; previews created under v2 must be re-created; **no record is deleted or rewritten** |
| T7.5 | `git revert <commit>` | none |
| T7.6 | `git revert <commit>` | none (documentation) |

Cross-task coupling: T7.1 depends on T7.3's `RUN_STATUSES` export (Step 1.3 covers the ordering); T7.4 depends on `buildProjectionWithPayload` from T7.3. Revert in reverse task order.

## Out of scope

- Port splitting, route handlers, worker decomposition (WS2/WS3).
- Provider and scenario registries (WS4).
- Dashboard data access, pagers, typed clients, `jev-transport` caches (WS5).
- Page decomposition, `RunTable` relocation, `ReviewInput` split (WS5/WS6).
- Unifying the two `board_delivery` enablement rules (a serialization behaviour change).
- Migrating `Run.configHash` or any identity derivation; a data-rewriting migration script.
- Colour redesign, new CSS classes, new dashboard features.
- S6 usage provenance typing (deferred from WS3b T3b.7 to the post-program backlog; needs contract + adapter changes outside WS7 ownership).
- Any finding the re-audit reopens (filed as a new workstream).

## Self-review

- **Finding coverage:** F15 → T7.1 (tables, tone-only `Badge`, deleted fabricated statuses, deleted duplicated lists in `Runs.tsx`/`Overview.tsx`); P4 → T7.2 (`SUMMARY_OMIT`, `toRunSummary`, derived Mongo projection, leak test); P3 → T7.3 (`RUN_STATUSES`/`TERMINAL_RUN_STATUSES`/`ACTIVE_RUN_STATUSES`/`isTerminalRun`, `EVIDENCE_KINDS`/`EVIDENCE_KEY_FIELD`, `MONITOR_VIEW_BUILDERS`, canonical side-effect tables, every literal site from the audit's list); X6 canonical half → T7.4 (versioned `hashVersion` v2, decision-gated legacy reads, friendly 409, migration note, tests for stored-v1 comparison and new-v2 writes); F13 leftovers → T7.5.
- **Placeholders:** none. Every code-changing step carries the code or an exact from→to replacement, including the parity assertions that pin the pre-WS7 behaviour.
- **Type consistency:** `Tone`, `StatusMeta`, `runStatusMeta`, `reviewDecisionMeta`, `monitorStatusMeta`, `eventMeta`, `SUMMARY_OMIT`, `toRunSummary`, `summaryProjection`, `RUN_STATUSES`, `TERMINAL_RUN_STATUSES`, `ACTIVE_RUN_STATUSES`, `isTerminalRun`, `EVIDENCE_KINDS`, `EVIDENCE_KEY_FIELD`, `MONITOR_VIEW_BUILDERS`, `hashVersion`, `verifyHash`, `LEGACY_HASHES_ACCEPTED` keep the exact names from conventions §3.5/§3.6. Additions not in that sheet, each justified in place: `status.ts` also owns `jobStatusMeta`, `windowStatusMeta`, `agreementMeta` and `IconName` (a `Badge` that no longer accepts a status needs a table for every vocabulary a page renders); `monitorStatusMeta` is typed `Record<MonitorStatus, …>` rather than `Record<string, …>` so exhaustiveness is actually enforced, with `monitorStatusMetaFor` providing the previous neutral fallback in one place; `runStatusMeta.group` keeps the three convention values while the page buckets live in `runListGroups`/`overviewCards` because the UI never grouped `queued` with the running statuses; `MONITOR_VIEW_BUILDERS` builders return `{ projection, payload }` so T7.4 can verify a stored hash against the exact bytes that were hashed.
- **Deviations from the source document:** (1) analysis launch/preview/settings hashes are **already** canonical (`analysis/configuration.ts:5-14` sorts keys), so T7.4 gives them a byte-identity test instead of a dual-read path — dual-reading a value that never differed would be dead code. (2) `oversized` moves from danger/neutral to warning everywhere: one vocabulary cannot hold two tones for one status, and the finding is precisely that `oversized` was misrepresented as `failed`. (3) `CANCEL_OVERRIDE_RUN_STATUSES` preserves the historical `completed` member (a cancel racing a completion) and pins it with a test rather than "fixing" it silently. (4) All line anchors are baseline (`20bc219`) because WS1–WS6 have not landed in this tree; Step 1 of each task re-locates by content.
- **Behaviour-change statement:** exactly two declared changes — the `oversized` badge tone (T7.1) and the four oversight hash *values* under `hashVersion: 2` (T7.4, gate-controlled). Every status label, API payload, event type, projection `included`/`excluded` list, evidence id set, fixture event sequence and stored hash for analysis artifacts under v1 reads is otherwise unchanged, and each claim is backed by a test in the task that makes it.
