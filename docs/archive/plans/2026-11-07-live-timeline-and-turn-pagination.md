# Live Timeline and Turn-Based Paging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The run Timeline and Model & traces tabs show one continuous, turn-aligned list of events that follows new events live while a run is active, replacing the fixed 50-event pager.

**Architecture:** The API gains opt-in turn-snapped paging (`snap=turn`), backward paging (`before=`), a per-run turn index (`GET /runs/:id/turns`) and a server-sent-events stream (`GET /runs/:id/events/stream`). The stream loop always reads through `queryEvents`; a Mongo change stream (or an in-memory emitter) only wakes it early, so there is no backlog/tail race and a standalone Mongo still works through the poll interval. The dashboard replaces the paged `useApi` call with one `useRunEvents` hook (a gap-free window of whole turns, plus SSE follow with a polling fallback) and a `RunEventsView` component with a turn navigator, load-earlier/later controls and follow-scroll. Estimated: 7 tasks, 5–7 dev-days.

**Tech Stack:** Node `^22.18.0 || >=24.11.0`, `node:http` server (no framework), `mongodb` 7.7.0 change streams (compose already runs `mongod --replSet rs0`), React 19.3.1, react-router-dom 7.18.5, vitest 5.1.0 + Testing Library, `node:test` + `assert/strict`, nx via `node scripts/nx.mjs`.

## Global Constraints

- **Behaviour changes are limited to the ones this plan names:** the timeline/traces pager is replaced; the "Live · <time>" progress badge in the timeline heading becomes a stream status badge; the traces description reads "in the loaded turns" instead of "on this page"; finished runs stop re-polling events. Every existing `/events` request without `snap`/`before` returns byte-identical payloads (the existing test `filtered run summaries, event cursor pagination…` must pass unchanged).
- **Every task ships tests.** Backend persistence changes also run the Mongo integration suite.
- **Verification (repo root):** `npm run lint`, `node scripts/verify-boundaries.mjs`, `npm run check`, `npm test`, `npm run build`, `npm run test:integration` (Mongo required).
- **Test runner facts:** `scripts/test.mjs <dir>` collects `*.test.ts`; with `--mongo` only `*.mongo.test.ts`. Helper modules must not end in `.test.ts`. nx `test` targets depend on `^build`, so workspace imports resolve to `dist/` — run tests through `node scripts/nx.mjs run <project>:test`, which builds dependencies first. Mongo URI comes from `TEST_MONGODB_URI` (local default `mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0`). Unit tests use `node:test`; dashboard tests use vitest + Testing Library.
- **Boundary rules stay intact.** The dashboard imports only `@sidechannel/contracts/browser` / `testing`. The API imports contracts and domain, never persistence.
- **Run nx gates in a normal developer shell.** A sandbox that blocks process creation reports `spawn EPERM` for every nx task; that is an environment error.
- **Dependencies are frozen.** No new packages.
- **No destructive DB migrations.** The Mongo changes are query, aggregate and change-stream reads only.

---

## Relationship to the SOLID remediation program

`docs/archive/plans/2026-11-07-plan-conventions.md` §4 gives WS2/WS3a/WS3c/WS5/WS6 ownership of files this plan edits (`api/src/server/index.ts`, `packages/persistence/src/harness/repository.ts`, `packages/contracts/src/server/contracts.ts`, `dashboard/src/pages/Runs.tsx`). None of those workstreams has started (no `dashboard/src/lib/clients/` exists; HEAD is `deae91d`). This plan is written to land **before** the program starts, and keeps its edits to those shared files small and additive so the program plans rebase onto them:

| Shared file | This plan's edit | Program workstream that rebases |
| --- | --- | --- |
| `packages/contracts/src/server/contracts.ts` | adds `listTurns`, optional `subscribeEvents` | WS2 T2.1 moves them onto `EvidenceReader` |
| `packages/persistence/src/harness/repository.ts` | `before`/`order`, `listTurns`, `subscribeEvents`; in-memory matcher imported from domain | WS2/WS3c split |
| `api/src/server/index.ts` | two route blocks; stream logic lives in new `event-stream.ts` | WS3a T3a.1 snapshot must include `/turns` and `snap`/`before` |
| `dashboard/src/pages/Runs.tsx` | swaps the events `useApi` + `Pager` for `useRunEvents` + `RunEventsView` | WS6 T6.5 (`useRunEvidence`) absorbs `useRunEvents` |

If the program has started by the time this executes, stop and re-sequence: this plan then lands after WS3a and WS5, and Task 5's hook moves to `dashboard/src/lib/clients/` per conventions §3.4.

## File structure

| File | Status | Responsibility |
| --- | --- | --- |
| `packages/contracts/src/harness/repository.ts` | modify | `EventQuery.before`/`order`; `TurnSummary` DTO |
| `packages/contracts/src/browser.ts` | modify | export `TurnSummary` to the dashboard |
| `packages/contracts/src/server/contracts.ts` | modify | `listTurns`, optional `subscribeEvents` on `ResearcherRepository` |
| `packages/domain/src/harness/event-pages.ts` | create | pure turn key, turn snapping, event matching, turn summaries |
| `packages/domain/src/harness/event-pages.test.ts` | create | unit tests for the above |
| `packages/domain/package.json` | modify | `./harness/event-pages` export |
| `packages/persistence/src/harness/repository.ts` | modify | backward queries, `listTurns`, `subscribeEvents` (memory emitter, Mongo change stream) |
| `packages/persistence/src/harness/event-log.test.ts` | create | in-memory event-log tests |
| `tests/integration/event-stream.mongo.test.ts` | create | Mongo parity for the same three capabilities |
| `api/src/server/index.ts` | modify | `snap`/`before` on `/events`; `/turns`; stream route |
| `api/src/server/event-stream.ts` | create | SSE loop for one run |
| `api/src/server/event-pages.test.ts` | create | API tests for snapped/backward pages and `/turns` |
| `api/src/server/event-stream.test.ts` | create | API tests for the SSE stream |
| `dashboard/src/lib/event-window.ts` | create | pure window merge/evict |
| `dashboard/src/lib/event-window.test.ts` | create | tests |
| `dashboard/src/lib/use-run-events.ts` | create | data hook: initial load, load earlier/later, SSE follow, polling fallback |
| `dashboard/src/lib/use-run-events.test.tsx` | create | hook tests |
| `dashboard/src/testing/fake-event-source.ts` | create | jsdom `EventSource` stand-in (test helper, not a test file) |
| `dashboard/src/pages/runs/TimelinePanel.tsx` | modify | `live` prop; pending model-call row |
| `dashboard/src/pages/runs/TimelinePanel.test.tsx` | modify | pending-row tests |
| `dashboard/src/pages/runs/timeline-panel.css` | modify | pending-row styles |
| `dashboard/src/pages/runs/use-follow-scroll.ts` | create | stick-to-end scrolling and unseen count |
| `dashboard/src/pages/runs/TurnNavigator.tsx` | create | turn jump select |
| `dashboard/src/pages/runs/RunEventsView.tsx` | create | navigator + list + load controls + new-events pill + stream badge |
| `dashboard/src/pages/runs/run-events.css` | create | styles for the view |
| `dashboard/src/pages/runs/RunEventsView.test.tsx` | create | navigator and follow-scroll tests |
| `dashboard/src/pages/runs/RunTimelineLive.test.tsx` | create | page-level tests through `Runs` |
| `dashboard/src/pages/Runs.tsx` | modify | wire hook + view; remove events pager |

## Tasks

### Task 1: Turn paging primitives in contracts and domain

**Files:**
- Modify: `packages/contracts/src/harness/repository.ts:18` (`EventQuery`)
- Modify: `packages/contracts/src/browser.ts`
- Create: `packages/domain/src/harness/event-pages.ts`
- Create: `packages/domain/src/harness/event-pages.test.ts`
- Modify: `packages/domain/package.json` (`exports`)

**Interfaces:**
- Consumes: `HarnessEvent` (`packages/contracts/src/harness/contracts.ts:197`).
- Produces:
  - `EventQuery { after?; before?: number; order?: 'asc' | 'desc'; offset?; limit?; actor?; phase?; type?; from?; to? }`
  - `TurnSummary { agentId: string; round?: number; turn: number; firstSequence: number; lastSequence: number; eventCount: number; modelCalls: number; failures: number }`
  - `@sidechannel/domain/harness/event-pages`: `TURN_SNAP_SLACK: 400`, `turnKey(e): string | null`, `snapForward(rows, limit, slack?): SnappedPage`, `snapBackward(rowsDesc, limit, slack?): SnappedPage`, `eventPhase(e): string`, `matchesEventQuery(e, q): boolean`, `summarizeTurns(events): TurnSummary[]`, `SnappedPage { events: HarnessEvent[]; hasMore: boolean }`.

- [ ] **Step 1: Add the contract types**

In `packages/contracts/src/harness/repository.ts` replace the `EventQuery` line with:

```ts
/** `after`/`before` are exclusive sequence bounds; `order: 'desc'` returns newest first (used with `before`). */
export interface EventQuery { after?: number; before?: number; order?: 'asc' | 'desc'; offset?: number; limit?: number; actor?: string; phase?: string; type?: string; from?: number; to?: number }

/** One agent turn in a run's event log, for timeline navigation. Run-level events (no agent or turn 0) belong to no turn. */
export interface TurnSummary { agentId: string; round?: number; turn: number; firstSequence: number; lastSequence: number; eventCount: number; modelCalls: number; failures: number }
```

In `packages/contracts/src/browser.ts` add after the `harness/contracts.js` export line:

```ts
export type { TurnSummary } from './harness/repository.js';
```

- [ ] **Step 2: Write the failing domain test**

Create `packages/domain/src/harness/event-pages.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { HarnessEvent } from '@sidechannel/contracts/harness/contracts';
import { matchesEventQuery, snapBackward, snapForward, summarizeTurns, turnKey } from './event-pages.js';

let sequence = 0;
const event = (extra: Partial<HarnessEvent> = {}): HarnessEvent => ({ schemaVersion: 1, id: `e${++sequence}`, runId: 'run', sequence, type: 'step', timestamp: '2026-11-07T00:00:00.000Z', data: {}, ...extra });

/** seq 1 run-level; turn 1 (alpha) = 2–4; turn 2 (beta) = 5–7; turn 3 (alpha) = 8–10. */
function log(): HarnessEvent[] {
    sequence = 0;
    return [event(), ...[1, 2, 3].flatMap(turn => [0, 1, 2].map(index => event({
        agentId: turn === 2 ? 'beta' : 'alpha', round: 1, turn, invocationId: `inv-${turn}`,
        type: index === 0 ? 'model_requested' : index === 2 ? 'tool_failed' : 'step',
    })))];
}
const seqs = (events: HarnessEvent[]) => events.map(e => e.sequence);

test('turn keys match the dashboard grouping and leave run-level events ungrouped', () => {
    const [runLevel, first] = log();
    assert.equal(turnKey(runLevel!), null);
    assert.equal(turnKey(first!), 'alpha|1|1');
    assert.equal(turnKey({ agentId: 'alpha', turn: 0 }), null);
});

test('forward pages extend to the end of the turn the limit would cut', () => {
    assert.deepEqual(seqs(snapForward(log(), 2).events), [1, 2, 3, 4]);
    assert.equal(snapForward(log(), 2).hasMore, true);
    assert.deepEqual(seqs(snapForward(log(), 1).events), [1], 'run-level events never extend a page');
    assert.deepEqual(seqs(snapForward(log(), 2, 1).events), [1, 2, 3], 'slack caps an oversized turn');
    assert.deepEqual(snapForward(log(), 100), { events: log(), hasMore: false });
});

test('backward pages take newest-first rows, extend to the turn start and return oldest first', () => {
    const page = snapBackward([...log()].reverse(), 1);
    assert.deepEqual(seqs(page.events), [8, 9, 10]);
    assert.equal(page.hasMore, true);
});

test('event matching honours exclusive bounds and the report phase', () => {
    const [runLevel, first] = log();
    assert.equal(matchesEventQuery(first!, { before: 2 }), false);
    assert.equal(matchesEventQuery(first!, { before: 3, after: 1 }), true);
    assert.equal(matchesEventQuery({ ...runLevel!, invocationId: 'run:report:alpha' }, { phase: 'report' }), true);
    assert.equal(matchesEventQuery(first!, { phase: 'report' }), false);
});

test('turn summaries count events, distinct model calls and failures per turn', () => {
    assert.deepEqual(summarizeTurns(log()), [
        { agentId: 'alpha', round: 1, turn: 1, firstSequence: 2, lastSequence: 4, eventCount: 3, modelCalls: 1, failures: 1 },
        { agentId: 'beta', round: 1, turn: 2, firstSequence: 5, lastSequence: 7, eventCount: 3, modelCalls: 1, failures: 1 },
        { agentId: 'alpha', round: 1, turn: 3, firstSequence: 8, lastSequence: 10, eventCount: 3, modelCalls: 1, failures: 1 },
    ]);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node scripts/nx.mjs run @sidechannel/domain:test`
Expected: FAIL — `Cannot find module './event-pages.js'`.

- [ ] **Step 4: Implement the domain module**

Create `packages/domain/src/harness/event-pages.ts`:

```ts
/** Pure helpers for paging, filtering and indexing a run's event log by agent turn. No I/O. */
import type { HarnessEvent } from '@sidechannel/contracts/harness/contracts';
import type { EventQuery, TurnSummary } from '@sidechannel/contracts/harness/repository';

/** Extra events a turn-snapped page may take beyond `limit` so it does not cut a turn in half. */
export const TURN_SNAP_SLACK = 400;

const FAILURE = /denied|error|fail/;

/** Same grouping as the dashboard timeline: one key per agent turn; run-level events have none. */
export function turnKey(event: Pick<HarnessEvent, 'agentId' | 'round' | 'turn'>): string | null {
    return !event.turn || !event.agentId ? null : `${event.agentId}|${event.round ?? ''}|${event.turn}`;
}

export interface SnappedPage { events: HarnessEvent[]; hasMore: boolean }

/**
 * `rows` are in request order and were fetched with `limit + slack + 1`. Keeps `limit` rows, then keeps
 * taking rows of the same turn as the last kept row, up to `limit + slack`. Run-level events never extend.
 */
function snap(rows: HarnessEvent[], limit: number, slack: number): SnappedPage {
    let end = Math.min(limit, rows.length);
    const key = end > 0 ? turnKey(rows[end - 1]!) : null;
    while (key !== null && end < rows.length && end < limit + slack && turnKey(rows[end]!) === key) end++;
    return { events: rows.slice(0, end), hasMore: rows.length > end };
}

/** `rows` are oldest first. */
export function snapForward(rows: HarnessEvent[], limit: number, slack = TURN_SNAP_SLACK): SnappedPage {
    return snap(rows, limit, slack);
}

/** `rowsDesc` are newest first; the returned events are oldest first. */
export function snapBackward(rowsDesc: HarnessEvent[], limit: number, slack = TURN_SNAP_SLACK): SnappedPage {
    const page = snap(rowsDesc, limit, slack);
    return { events: [...page.events].reverse(), hasMore: page.hasMore };
}

export function eventPhase(event: HarnessEvent): string {
    return (event.data as { phase?: string } | null)?.phase ?? (event.type.startsWith('report') || event.invocationId?.includes(':report:') ? 'report' : 'action');
}

export function matchesEventQuery(event: HarnessEvent, query: EventQuery): boolean {
    return event.sequence > (query.after ?? 0)
        && (query.before === undefined || event.sequence < query.before)
        && (!query.actor || event.agentId === query.actor)
        && (!query.type || event.type === query.type)
        && (!query.phase || eventPhase(event) === query.phase)
        && (query.from === undefined || event.sequence >= query.from)
        && (query.to === undefined || event.sequence <= query.to);
}

/** Turns in first-sequence order. A model call is a distinct `invocationId` on a `model_requested` event. */
export function summarizeTurns(events: readonly HarnessEvent[]): TurnSummary[] {
    const turns = new Map<string, TurnSummary & { calls: Set<string> }>();
    for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
        const key = turnKey(event);
        if (key === null) continue;
        let turn = turns.get(key);
        if (!turn) {
            turn = { agentId: event.agentId!, ...(event.round === undefined ? {} : { round: event.round }), turn: event.turn!, firstSequence: event.sequence, lastSequence: event.sequence, eventCount: 0, modelCalls: 0, failures: 0, calls: new Set() };
            turns.set(key, turn);
        }
        turn.lastSequence = event.sequence;
        turn.eventCount++;
        if (event.type === 'model_requested' && event.invocationId) turn.calls.add(event.invocationId);
        if (FAILURE.test(event.type)) turn.failures++;
    }
    return [...turns.values()].map(({ calls, ...turn }) => ({ ...turn, modelCalls: calls.size }));
}
```

In `packages/domain/package.json` `exports`, add after the `"./harness/config"` entry:

```json
    "./harness/event-pages": {
      "types": "./dist/harness/event-pages.d.ts",
      "import": "./dist/harness/event-pages.js"
    },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node scripts/nx.mjs run @sidechannel/domain:test`
Expected: PASS, including the 5 new tests.

- [ ] **Step 6: Type-check the contracts change**

Run: `node scripts/nx.mjs run-many -t check -p @sidechannel/contracts @sidechannel/domain`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/harness/repository.ts packages/contracts/src/browser.ts packages/domain/src/harness/event-pages.ts packages/domain/src/harness/event-pages.test.ts packages/domain/package.json
git commit -m "Add turn paging primitives for the run event log"
```

---

### Task 2: Event-log capabilities in both repositories

**Files:**
- Modify: `packages/contracts/src/server/contracts.ts:3` (import) and `ResearcherRepository`
- Modify: `packages/persistence/src/harness/repository.ts` — lines 21–23 (`eventPhase`, `matchesEvent`), `InMemoryRepository.appendEvent` (line 95), `queryEvents` (108), `MongoRepository.queryEvents` (247)
- Create: `packages/persistence/src/harness/event-log.test.ts`
- Create: `tests/integration/event-stream.mongo.test.ts`

**Interfaces:**
- Consumes: Task 1's `EventQuery`, `TurnSummary`, `matchesEventQuery`, `summarizeTurns`.
- Produces on `ResearcherRepository`:
  - `listTurns(runId: string): Promise<TurnSummary[]>`
  - `subscribeEvents?(runId: string, onAppend: () => void): () => void` (returns unsubscribe; callers must still poll)
  - `queryEvents` honours `before` and `order: 'desc'`.

- [ ] **Step 1: Write the failing in-memory test**

Create `packages/persistence/src/harness/event-log.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRepository } from './repository.js';

test('in-memory event log pages backward, indexes turns and notifies subscribers of its own run', async () => {
    const repo = new InMemoryRepository();
    for (const turn of [1, 2]) for (let index = 0; index < 2; index++) await repo.appendEvent({ runId: 'run', type: 'step', agentId: 'alpha', round: 1, turn, data: {} });
    await repo.appendEvent({ runId: 'other', type: 'step', data: {} });
    assert.deepEqual((await repo.queryEvents('run', { before: 4, order: 'desc', limit: 2 })).map(e => e.sequence), [3, 2]);
    assert.deepEqual((await repo.queryEvents('run', { before: 3 })).map(e => e.sequence), [1, 2]);
    assert.deepEqual((await repo.listTurns('run')).map(t => [t.turn, t.firstSequence, t.lastSequence, t.eventCount]), [[1, 1, 2, 2], [2, 3, 4, 2]]);
    let calls = 0;
    const unsubscribe = repo.subscribeEvents('run', () => { calls++; });
    await repo.appendEvent({ runId: 'run', type: 'step', data: {} });
    await repo.appendEvent({ runId: 'other', type: 'step', data: {} });
    unsubscribe();
    await repo.appendEvent({ runId: 'run', type: 'step', data: {} });
    assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/nx.mjs run @sidechannel/persistence:test`
Expected: FAIL — `repo.listTurns is not a function` (or a type error on `subscribeEvents`).

- [ ] **Step 3: Extend the contract**

In `packages/contracts/src/server/contracts.ts`, add `TurnSummary` to the type import from `'../harness/repository.js'` (line 3), and add these members to `ResearcherRepository` after `getEvent`:

```ts
    listTurns(runId: string): Promise<TurnSummary[]>;
    /** Calls `onAppend` after an event is appended to `runId`; returns an unsubscribe function. A wake-up hint only: callers must still poll. */
    subscribeEvents?(runId: string, onAppend: () => void): () => void;
```

- [ ] **Step 4: Implement the in-memory side**

In `packages/persistence/src/harness/repository.ts`:

1. Add imports at the top:

```ts
import { EventEmitter } from 'node:events';
import { matchesEventQuery, summarizeTurns } from '@sidechannel/domain/harness/event-pages';
```

and add `type TurnSummary` to the existing `@sidechannel/contracts/harness/repository` import.

2. Delete the module functions `eventPhase` (line 21) and `matchesEvent` (line 23); they have no other callers.

3. In `InMemoryRepository`, add a field after `private claims = new Set<string>();`:

```ts
    private appended = new EventEmitter().setMaxListeners(0);
```

4. Replace `InMemoryRepository.appendEvent` with:

```ts
    async appendEvent(event: NewEvent) {
        const record: HarnessEvent = { ...clone(event), schemaVersion: 1, id: randomUUID(), timestamp: new Date().toISOString(), sequence: this.events.filter(e => e.runId === event.runId).length + 1 };
        this.events.push(record);
        this.appended.emit(event.runId);
        return clone(record);
    }
```

5. Replace `InMemoryRepository.queryEvents` with these three methods:

```ts
    async queryEvents(id: string, query: EventQuery) {
        const offset = query.offset ?? 0;
        const rows = this.events.filter(event => event.runId === id && matchesEventQuery(event, query));
        if (query.order === 'desc') rows.reverse();
        return clone(rows.slice(offset, offset + (query.limit ?? 200)));
    }
    async listTurns(runId: string): Promise<TurnSummary[]> { return summarizeTurns(this.events.filter(event => event.runId === runId)); }
    subscribeEvents(runId: string, onAppend: () => void) { this.appended.on(runId, onAppend); return () => { this.appended.off(runId, onAppend); }; }
```

- [ ] **Step 5: Run the in-memory test to verify it passes**

Run: `node scripts/nx.mjs run @sidechannel/persistence:test`
Expected: PASS (new test and the existing `repository.test.ts`).

- [ ] **Step 6: Write the failing Mongo test**

Create `tests/integration/event-stream.mongo.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoRepository } from '@sidechannel/persistence/harness/repository';

test('Mongo event log pages backward, indexes turns like the in-memory log and wakes change-stream subscribers', async () => {
    const database = 'sidechannel_event_stream_test_' + randomUUID().replaceAll('-', '');
    const repository = await MongoRepository.connect(process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0', database);
    let unsubscribe: (() => void) | undefined;
    try {
        await repository.appendEvent({ runId: 'run', type: 'run_started', data: {} });
        for (const turn of [1, 2]) for (const type of ['model_requested', 'tool_failed']) await repository.appendEvent({ runId: 'run', type, agentId: 'alpha', round: 1, turn, invocationId: `inv-${turn}`, data: {} });
        assert.deepEqual((await repository.queryEvents('run', { before: 5, order: 'desc', limit: 2 })).map(e => e.sequence), [4, 3]);
        assert.deepEqual(await repository.listTurns('run'), [
            { agentId: 'alpha', round: 1, turn: 1, firstSequence: 2, lastSequence: 3, eventCount: 2, modelCalls: 1, failures: 1 },
            { agentId: 'alpha', round: 1, turn: 2, firstSequence: 4, lastSequence: 5, eventCount: 2, modelCalls: 1, failures: 1 },
        ]);
        let woke = false;
        unsubscribe = repository.subscribeEvents('run', () => { woke = true; });
        // The change stream opens asynchronously; keep appending until the first notification arrives.
        for (let attempt = 0; attempt < 50 && !woke; attempt++) {
            await repository.appendEvent({ runId: 'run', type: 'step', data: {} });
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(woke, true);
    } finally { unsubscribe?.(); await repository.db.dropDatabase(); await repository.close(); }
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm run build && npm run test:integration`
Expected: FAIL in `event-stream.mongo.test.ts` — `repository.listTurns is not a function`.

- [ ] **Step 8: Implement the Mongo side**

In `MongoRepository.queryEvents`, replace the first line with:

```ts
        const filter: Document = { runId, sequence: { $gt: query.after ?? 0, ...(query.before === undefined ? {} : { $lt: query.before }), ...(query.from === undefined ? {} : { $gte: query.from }), ...(query.to === undefined ? {} : { $lte: query.to }) } };
```

and in its `return` change `.sort({ sequence: 1 })` to `.sort({ sequence: query.order === 'desc' ? -1 : 1 })`.

Add after `getEvent` in `MongoRepository`:

```ts
    async listTurns(runId: string): Promise<TurnSummary[]> {
        const rows = await this.db.collection('events').aggregate<{ _id: { agentId: string; round?: number | null; turn: number }; firstSequence: number; lastSequence: number; eventCount: number; calls: (string | null)[]; failures: number }>([
            { $match: { runId, agentId: { $nin: [null, ''] }, turn: { $gt: 0 } } },
            { $group: {
                _id: { agentId: '$agentId', round: '$round', turn: '$turn' },
                firstSequence: { $min: '$sequence' },
                lastSequence: { $max: '$sequence' },
                eventCount: { $sum: 1 },
                calls: { $addToSet: { $cond: [{ $eq: ['$type', 'model_requested'] }, { $ifNull: ['$invocationId', null] }, null] } },
                failures: { $sum: { $cond: [{ $regexMatch: { input: '$type', regex: 'denied|error|fail' } }, 1, 0] } },
            } },
            { $sort: { firstSequence: 1 } },
        ]).toArray();
        return rows.map(({ _id, calls, ...counts }) => ({ agentId: _id.agentId, ...(_id.round == null ? {} : { round: _id.round }), turn: _id.turn, ...counts, modelCalls: calls.filter(call => call !== null).length }));
    }
    /** Wake-up hint from a change stream. On a standalone server the stream errors and callers fall back to polling. */
    subscribeEvents(runId: string, onAppend: () => void) {
        const stream = this.db.collection('events').watch([{ $match: { operationType: 'insert', 'fullDocument.runId': runId } }]);
        stream.on('change', () => onAppend());
        stream.on('error', () => { /* the consumer's poll interval keeps delivering events */ });
        return () => { void stream.close().catch(() => undefined); };
    }
```

- [ ] **Step 9: Run both suites to verify they pass**

Run: `npm run build && node scripts/nx.mjs run @sidechannel/persistence:test && npm run test:integration`
Expected: PASS, including `researcher.mongo.test.ts` (its `phase` queries now go through the unchanged Mongo filter).

- [ ] **Step 10: Commit**

```bash
git add packages/contracts/src/server/contracts.ts packages/persistence/src/harness/repository.ts packages/persistence/src/harness/event-log.test.ts tests/integration/event-stream.mongo.test.ts
git commit -m "Add backward event queries, a turn index and append notifications to both repositories"
```

---

### Task 3: Turn-snapped and backward event pages, turn index route

**Files:**
- Modify: `api/src/server/index.ts:187` (route regex), `:193` (after `progress`), `:194-201` (`events`/`memory` block), imports
- Create: `api/src/server/event-pages.test.ts`

**Interfaces:**
- Consumes: `snapForward`, `snapBackward`, `TURN_SNAP_SLACK` (Task 1); `listTurns`, `queryEvents` with `before`/`order` (Task 2).
- Produces (HTTP, used by Task 5):
  - `GET /api/runs/:id/events?snap=turn&limit=L[&after=N | &before=N][&actor&phase&type&from&to]` → `{ events, items, nextCursor, hasMore, previousCursor? }`. Events are always oldest first. `hasMore` means more events exist in the direction of the request. `previousCursor` (first returned sequence) is present only with `before`. `after` together with `before` → 400.
  - `GET /api/runs/:id/turns` → `{ turns: TurnSummary[] }`.

- [ ] **Step 1: Write the failing API test**

Create `api/src/server/event-pages.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createResearcherServer } from './index.js';

async function setup() {
    const repository = new InMemoryRepository();
    const directory = await mkdtemp(join(tmpdir(), 'event-pages-'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>t</title>');
    const server = createResearcherServer(repository, { dashboardDirectory: directory });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}/api`;
    const get = async (path: string) => { const response = await fetch(base + path); assert(response.ok, await response.clone().text()); return response.json(); };
    const status = async (path: string) => (await fetch(base + path)).status;
    const post = async (path: string, body: unknown) => (await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    const close = async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); };
    return { repository, get, status, post, close };
}
const seqs = (page: { events: { sequence: number }[] }) => page.events.map(e => e.sequence);

test('turn-snapped pages never split a turn, page backward from the newest event, and the turn index matches', async () => {
    const app = await setup();
    try {
        const run = await app.post('/runs', { config: defaultFixtureConfiguration(), idempotencyKey: 'turns' });
        // seq 1 run-level; turn 1 alpha = 2–6; turn 2 beta = 7–11; turn 3 alpha = 12–16
        await app.repository.appendEvent({ runId: run.id, type: 'run_started', data: {} });
        for (const [turn, agentId] of [[1, 'alpha'], [2, 'beta'], [3, 'alpha']] as const)
            for (let index = 0; index < 5; index++) await app.repository.appendEvent({ runId: run.id, type: index === 4 ? 'tool_failed' : 'turn_step', agentId, round: 1, turn, data: {} });

        const first = await app.get(`/runs/${run.id}/events?snap=turn&limit=3`);
        assert.deepEqual(seqs(first), [1, 2, 3, 4, 5, 6]);
        assert.equal(first.hasMore, true); assert.equal(first.nextCursor, 6); assert.equal(first.previousCursor, undefined);
        assert.deepEqual(seqs(await app.get(`/runs/${run.id}/events?snap=turn&limit=3&after=6`)), [7, 8, 9, 10, 11]);

        const newest = await app.get(`/runs/${run.id}/events?snap=turn&limit=2&before=${Number.MAX_SAFE_INTEGER}`);
        assert.deepEqual(seqs(newest), [12, 13, 14, 15, 16]);
        assert.equal(newest.hasMore, true); assert.equal(newest.previousCursor, 12);
        assert.deepEqual(seqs(await app.get(`/runs/${run.id}/events?snap=turn&limit=1&before=12`)), [7, 8, 9, 10, 11]);
        assert.deepEqual(seqs(await app.get(`/runs/${run.id}/events?limit=3&before=12`)), [9, 10, 11], 'unsnapped backward pages are exact');
        assert.equal(await app.status(`/runs/${run.id}/events?before=5&after=1`), 400);

        assert.deepEqual((await app.get(`/runs/${run.id}/turns`)).turns, [
            { agentId: 'alpha', round: 1, turn: 1, firstSequence: 2, lastSequence: 6, eventCount: 5, modelCalls: 0, failures: 1 },
            { agentId: 'beta', round: 1, turn: 2, firstSequence: 7, lastSequence: 11, eventCount: 5, modelCalls: 0, failures: 1 },
            { agentId: 'alpha', round: 1, turn: 3, firstSequence: 12, lastSequence: 16, eventCount: 5, modelCalls: 0, failures: 1 },
        ]);
        assert.equal(await app.status('/runs/missing/turns'), 404);
    } finally { await app.close(); }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/nx.mjs run @sidechannel/api:test`
Expected: FAIL in `event-pages.test.ts` — the first `deepEqual` gets `[1, 2, 3]`.

- [ ] **Step 3: Implement the routes**

In `api/src/server/index.ts` add the import:

```ts
import { snapBackward, snapForward, TURN_SNAP_SLACK } from '@sidechannel/domain/harness/event-pages';
```

Change the run route regex (line 187) to include `turns`:

```ts
                const match = path.match(/^\/runs\/([^/]+)(?:\/(progress|events|turns|export|cancel|board|memory|artifacts|reports))?$/);
```

After the `if (op === 'progress') …` line add:

```ts
                    if (op === 'turns') return send(200, { turns: await repository.listTurns(id) });
```

Replace the whole `if (op === 'events' || op === 'memory') { … }` block with:

```ts
                    if (op === 'events' || op === 'memory') {
                        const after = cursor(query.get('after'), 0), limit = cursor(query.get('limit'), 200, 1000); if (!limit) throw new HttpError(400, 'limit must be positive');
                        if (query.has('phase') && !['action', 'report'].includes(query.get('phase')!)) throw new HttpError(400, 'phase must be action or report');
                        const backward = op === 'events' && query.has('before'), snapped = op === 'events' && query.get('snap') === 'turn';
                        if (backward && query.has('after')) throw new HttpError(400, 'Use either after or before, not both');
                        const before = backward ? cursor(query.get('before'), 0) : undefined;
                        const filter: EventQuery = { after, limit: limit + (snapped ? TURN_SNAP_SLACK : 0) + 1, ...(before === undefined ? {} : { before, order: 'desc' as const }), ...(query.get('actor') ? { actor: query.get('actor')! } : {}), ...(query.get('phase') ? { phase: query.get('phase')! } : {}), ...(query.get('type') ? { type: query.get('type')! } : {}), ...(query.has('from') ? { from: cursor(query.get('from'), 0) } : {}), ...(query.has('to') ? { to: cursor(query.get('to'), 0) } : {}) };
                        if (op === 'memory') { filter.type = query.get('type') ?? 'memory_updated'; filter.offset = cursor(query.get('offset'), 0); }
                        const rows = await repository.queryEvents(id, filter);
                        const page = snapped ? (backward ? snapBackward(rows, limit) : snapForward(rows, limit)) : { events: backward ? rows.slice(0, limit).reverse() : rows.slice(0, limit), hasMore: rows.length > limit };
                        const events = page.events;
                        return send(200, { events, items: events, nextCursor: events.at(-1)?.sequence ?? after, ...(before === undefined ? {} : { previousCursor: events[0]?.sequence ?? before }), hasMore: page.hasMore, ...(op === 'memory' ? { nextOffset: rows.length > limit ? (filter.offset ?? 0) + limit : null } : {}) });
                    }
```

For `memory` and for `events` without `snap`/`before`, `filter`, `rows.slice(0, limit)`, `hasMore` and `nextOffset` are computed exactly as before.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/nx.mjs run @sidechannel/api:test`
Expected: PASS. The existing `server.test.ts` test `filtered run summaries, event cursor pagination…` passes unchanged.

- [ ] **Step 5: Commit**

```bash
git add api/src/server/index.ts api/src/server/event-pages.test.ts
git commit -m "Serve turn-snapped and backward event pages and a per-run turn index"
```

---

### Task 4: Server-sent event stream

**Files:**
- Create: `api/src/server/event-stream.ts`
- Modify: `api/src/server/index.ts` (options interface, imports, route before the `eventLink` match at line 175)
- Create: `api/src/server/event-stream.test.ts`

**Interfaces:**
- Consumes: `queryEvents`, `getRunSummary`, optional `subscribeEvents` (Task 2).
- Produces:
  - `EventStreamTiming { pollMs: number; heartbeatMs: number }`, `DEFAULT_EVENT_STREAM_TIMING = { pollMs: 2000, heartbeatMs: 15000 }`, `streamRunEvents(res, repository, runId, query, timing?)`.
  - `ResearcherServerOptions.eventStream?: EventStreamTiming`.
  - HTTP `GET /api/runs/:id/events/stream?after=N[&actor&phase&type&from]` → `text/event-stream`. Frames: `retry: 3000`; `id: <sequence>` + `event: harness_event` + `data: <HarnessEvent>`; `: ping` comments; final `event: end` + `data: {"status": <RunStatus|"missing">}`; on failure `event: stream_error`. A `Last-Event-ID` header overrides `after`. `to` or `before` → 400; unknown run → 404.

- [ ] **Step 1: Write the failing stream test**

Create `api/src/server/event-stream.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createResearcherServer } from './index.js';

interface Frame { event: string; id?: string; data?: unknown }

function sseReader(response: Response) {
    const reader = response.body!.getReader(), decoder = new TextDecoder(), frames: Frame[] = [];
    let buffer = '';
    const until = async (done: (all: Frame[]) => boolean, timeoutMs = 3000) => {
        const deadline = Date.now() + timeoutMs;
        while (!done(frames)) {
            if (Date.now() > deadline) throw new Error('SSE timeout; frames so far: ' + JSON.stringify(frames));
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
                const frame: Frame = { event: 'message' };
                for (const line of buffer.slice(0, end).split('\n')) {
                    if (line.startsWith(':')) frame.event = 'comment';
                    else if (line.startsWith('event: ')) frame.event = line.slice(7);
                    else if (line.startsWith('id: ')) frame.id = line.slice(4);
                    else if (line.startsWith('data: ')) frame.data = JSON.parse(line.slice(6));
                }
                buffer = buffer.slice(end + 2);
                frames.push(frame);
            }
        }
        return frames;
    };
    return { until };
}
const harness = (frames: Frame[]) => frames.filter(frame => frame.event === 'harness_event');

test('the event stream replays the backlog, follows appends, sends heartbeats, resumes from Last-Event-ID and ends with the run', async () => {
    const repository = new InMemoryRepository();
    const directory = await mkdtemp(join(tmpdir(), 'event-stream-'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>t</title>');
    const server = createResearcherServer(repository, { dashboardDirectory: directory, eventStream: { pollMs: 20, heartbeatMs: 40 } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}/api`;
    try {
        const run = await (await fetch(base + '/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: defaultFixtureConfiguration(), idempotencyKey: 'stream' }) })).json();
        await repository.appendEvent({ runId: run.id, type: 'alpha', data: {} });
        await repository.appendEvent({ runId: run.id, type: 'beta', data: {} });

        const response = await fetch(`${base}/runs/${run.id}/events/stream?after=0`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
        const live = sseReader(response);
        assert.deepEqual(harness(await live.until(f => harness(f).length >= 2)).map(f => f.id), ['1', '2']);
        await repository.appendEvent({ runId: run.id, type: 'alpha', data: {} });
        assert.equal(harness(await live.until(f => harness(f).length >= 3))[2]!.id, '3');
        await live.until(f => f.some(frame => frame.event === 'comment'));
        await repository.saveRun({ ...(await repository.getRun(run.id))!, status: 'completed' });
        const end = (await live.until(f => f.some(frame => frame.event === 'end'))).find(frame => frame.event === 'end')!;
        assert.deepEqual(end.data, { status: 'completed' });

        const resumed = sseReader(await fetch(`${base}/runs/${run.id}/events/stream?type=alpha`, { headers: { 'Last-Event-ID': '1' } }));
        assert.deepEqual(harness(await resumed.until(f => f.some(frame => frame.event === 'end'))).map(f => f.id), ['3']);

        assert.equal((await fetch(`${base}/runs/${run.id}/events/stream?to=3`)).status, 400);
        assert.equal((await fetch(`${base}/runs/missing/events/stream`)).status, 404);
    } finally {
        server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
    }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/nx.mjs run @sidechannel/api:test`
Expected: FAIL — status `404` (the path matches the `events/:eventId` route and finds no event called `stream`), or a type error for `eventStream`.

- [ ] **Step 3: Implement the stream module**

Create `api/src/server/event-stream.ts`:

```ts
/** Server-sent events for one run's event log: the backlog after a cursor, then appends as they happen, then `end`. */
import type { ServerResponse } from 'node:http';
import type { RunStatus } from '@sidechannel/contracts/harness/contracts';
import type { EventQuery } from '@sidechannel/contracts/harness/repository';
import type { ResearcherRepository } from '@sidechannel/contracts/server/contracts';

export interface EventStreamTiming {
    /** Re-query interval when no change notification arrives (also the whole mechanism on a standalone Mongo). */
    pollMs: number;
    /** Comment-frame interval; Cloudflare closes idle connections after about 100 s. */
    heartbeatMs: number;
}
export const DEFAULT_EVENT_STREAM_TIMING: EventStreamTiming = { pollMs: 2000, heartbeatMs: 15000 };

export type EventStreamSource = Pick<ResearcherRepository, 'queryEvents' | 'getRunSummary' | 'subscribeEvents'>;
export type StreamQuery = Pick<EventQuery, 'after' | 'actor' | 'phase' | 'type' | 'from'>;

const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>(['completed', 'cancelled', 'failed', 'interrupted']);
const BATCH = 200;

async function frame(res: ServerResponse, event: string, data: unknown, id?: number) {
    if (res.destroyed) return;
    const flushed = res.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (!flushed) await new Promise<void>(resolve => { const done = () => { res.off('drain', done); res.off('close', done); resolve(); }; res.once('drain', done); res.once('close', done); });
}

/**
 * Every event is read through `queryEvents(after: cursor)`. `subscribeEvents` only wakes the loop early, so
 * there is no race between the backlog and new events, and nothing is lost if notifications are unavailable.
 * The run's status is checked whenever the backlog is drained; once it is terminal the loop drains once more
 * (events written just before the status change) and then sends `end`.
 */
export async function streamRunEvents(res: ServerResponse, repository: EventStreamSource, runId: string, query: StreamQuery, timing: EventStreamTiming = DEFAULT_EVENT_STREAM_TIMING): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    let closed = false, pending = false;
    let wake: (() => void) | undefined;
    const nudge = () => { if (wake) { const resolve = wake; wake = undefined; resolve(); } else pending = true; };
    const onClose = () => { closed = true; nudge(); };
    res.on('close', onClose);
    const unsubscribe = repository.subscribeEvents?.(runId, nudge);
    const heartbeat = setInterval(() => { if (!closed && !res.destroyed) res.write(': ping\n\n'); }, timing.heartbeatMs);
    let after = query.after ?? 0;
    let finishing: RunStatus | 'missing' | undefined;
    try {
        while (!closed) {
            pending = false;
            const rows = await repository.queryEvents(runId, { ...query, after, limit: BATCH });
            for (const event of rows) { if (closed) break; await frame(res, 'harness_event', event, event.sequence); after = event.sequence; }
            if (rows.length === BATCH) continue;
            if (finishing) { await frame(res, 'end', { status: finishing }); break; }
            const summary = await repository.getRunSummary(runId);
            if (!summary || TERMINAL.has(summary.status)) { finishing = summary?.status ?? 'missing'; continue; }
            if (pending) continue;
            await new Promise<void>(resolve => {
                const timer = setTimeout(() => { wake = undefined; resolve(); }, timing.pollMs);
                wake = () => { clearTimeout(timer); resolve(); };
            });
        }
    } catch (error) {
        await frame(res, 'stream_error', { error: error instanceof Error ? error.message : 'Event stream failed' }).catch(() => undefined);
    } finally {
        clearInterval(heartbeat);
        unsubscribe?.();
        res.off('close', onClose);
        if (!res.destroyed) res.end();
    }
}
```

- [ ] **Step 4: Wire the route**

In `api/src/server/index.ts`:

1. Add the import:

```ts
import { DEFAULT_EVENT_STREAM_TIMING, streamRunEvents, type EventStreamTiming } from './event-stream.js';
```

2. Add to `ResearcherServerOptions`:

```ts
    /** Live event stream timing; tests shorten it. */
    eventStream?: EventStreamTiming;
```

3. Immediately **before** `const eventLink = path.match(/^\/runs\/([^/]+)\/events\/([^/]+)$/);` insert:

```ts
                const streamLink = path.match(/^\/runs\/([^/]+)\/events\/stream$/);
                if (streamLink && method === 'GET') {
                    const id = decodeURIComponent(streamLink[1]!);
                    if (!await repository.getRunSummary(id)) throw new HttpError(404, 'Run not found');
                    if (query.has('to') || query.has('before')) throw new HttpError(400, 'A live stream has no upper sequence bound; use the paged events endpoint');
                    if (query.has('phase') && !['action', 'report'].includes(query.get('phase')!)) throw new HttpError(400, 'phase must be action or report');
                    const resume = req.headers['last-event-id'];
                    const after = cursor(typeof resume === 'string' && resume ? resume : query.get('after'), 0);
                    return streamRunEvents(res, repository, id, { after, ...(query.get('actor') ? { actor: query.get('actor')! } : {}), ...(query.get('phase') ? { phase: query.get('phase')! } : {}), ...(query.get('type') ? { type: query.get('type')! } : {}), ...(query.has('from') ? { from: cursor(query.get('from'), 0) } : {}) }, options.eventStream ?? DEFAULT_EVENT_STREAM_TIMING);
                }
```

The existing CSP (`connect-src 'self'`) already allows a same-origin `EventSource`. The top-level `Cache-Control: no-store` header stays.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node scripts/nx.mjs run @sidechannel/api:test`
Expected: PASS (new stream test, Task 3 test, existing `server.test.ts`).

- [ ] **Step 6: Check the stream by hand against Mongo**

Run in two shells: `npm run dev:api`, then `curl -N http://127.0.0.1:4310/api/runs/<an active run id>/events/stream`.
Expected: the backlog arrives, new `harness_event` frames appear within about a second of the worker writing them, `: ping` every 15 s, and `event: end` when the run finishes.

- [ ] **Step 7: Commit**

```bash
git add api/src/server/event-stream.ts api/src/server/index.ts api/src/server/event-stream.test.ts
git commit -m "Stream run events over server-sent events"
```

---

### Task 5: Dashboard event window and `useRunEvents` hook

**Files:**
- Create: `dashboard/src/lib/event-window.ts`, `dashboard/src/lib/event-window.test.ts`
- Create: `dashboard/src/lib/use-run-events.ts`, `dashboard/src/lib/use-run-events.test.tsx`
- Create: `dashboard/src/testing/fake-event-source.ts`

**Interfaces:**
- Consumes: HTTP from Task 3 (`snap=turn`, `before`, `after`, `hasMore`) and Task 4 (`harness_event`, `end`); `api()` from `dashboard/src/lib/api.ts`.
- Produces:
  - `event-window.ts`: `WINDOW_CAP = 1500`, `EventWindow { events; hasEarlier; hasLater }`, `emptyWindow`, `appendLater(w, incoming, hasLater, cap?)`, `prependEarlier(w, incoming, hasEarlier, cap?)`.
  - `use-run-events.ts`: `LATEST_SEQUENCE`, `EVENT_PAGE_SIZE = 50`, `EventFilters`, `EventStart = 'first' | 'latest' | number`, `StreamStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'polling' | 'ended'`, `RunEvents`, `filterQuery(filters): string`, `useRunEvents(runId, filters, { start, follow, enabled }): RunEvents`.
  - `fake-event-source.ts`: `FakeEventSource` with `instances`, `open()`, `emit(type, data)`, `reset()`.

- [ ] **Step 1: Write the failing window test**

Create `dashboard/src/lib/event-window.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import { appendLater, emptyWindow, prependEarlier } from './event-window';

const ev = (sequence: number) => ({ schemaVersion: 1, id: `e${sequence}`, runId: 'r', sequence, type: 't', timestamp: '', data: {} }) as HarnessEvent;
const seqs = (events: HarnessEvent[]) => events.map(e => e.sequence);

describe('event window', () => {
  it('merges by id and keeps sequence order', () => {
    const w = appendLater({ events: [ev(1), ev(2)], hasEarlier: false, hasLater: true }, [ev(2), ev(4), ev(3)], false);
    expect(seqs(w.events)).toEqual([1, 2, 3, 4]);
    expect(w.hasLater).toBe(false);
  });
  it('evicts the oldest past the cap when appending and records that earlier events exist', () => {
    const w = appendLater({ ...emptyWindow, events: [ev(1), ev(2), ev(3)] }, [ev(4)], false, 3);
    expect(seqs(w.events)).toEqual([2, 3, 4]);
    expect(w.hasEarlier).toBe(true);
  });
  it('evicts the newest past the cap when prepending and records that later events exist', () => {
    const w = prependEarlier({ ...emptyWindow, events: [ev(3), ev(4)] }, [ev(1), ev(2)], false, 3);
    expect(seqs(w.events)).toEqual([1, 2, 3]);
    expect(w).toMatchObject({ hasEarlier: false, hasLater: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd dashboard && npx vitest run src/lib/event-window.test.ts`
Expected: FAIL — cannot resolve `./event-window`.

- [ ] **Step 3: Implement the window**

Create `dashboard/src/lib/event-window.ts`:

```ts
/** Pure merge/evict rules for the gap-free slice of a run's events the timeline holds in memory. */
import type { HarnessEvent } from '@sidechannel/contracts/browser';

export const WINDOW_CAP = 1500;

export interface EventWindow {
  /** Oldest first, unique by id. */
  events: HarnessEvent[];
  hasEarlier: boolean;
  hasLater: boolean;
}

export const emptyWindow: EventWindow = { events: [], hasEarlier: false, hasLater: false };

function merge(a: readonly HarnessEvent[], b: readonly HarnessEvent[]): HarnessEvent[] {
  const byId = new Map<string, HarnessEvent>();
  for (const event of a) byId.set(event.id, event);
  for (const event of b) byId.set(event.id, event);
  return [...byId.values()].sort((x, y) => x.sequence - y.sequence);
}

/** Adds events after the window's end; past the cap the oldest are evicted. */
export function appendLater(w: EventWindow, incoming: readonly HarnessEvent[], hasLater: boolean, cap = WINDOW_CAP): EventWindow {
  const events = merge(w.events, incoming);
  const overflow = Math.max(0, events.length - cap);
  return { events: events.slice(overflow), hasEarlier: w.hasEarlier || overflow > 0, hasLater };
}

/** Adds events before the window's start; past the cap the newest are evicted. */
export function prependEarlier(w: EventWindow, incoming: readonly HarnessEvent[], hasEarlier: boolean, cap = WINDOW_CAP): EventWindow {
  const events = merge(incoming, w.events);
  const overflow = Math.max(0, events.length - cap);
  return { events: events.slice(0, events.length - overflow), hasEarlier, hasLater: w.hasLater || overflow > 0 };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd dashboard && npx vitest run src/lib/event-window.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the EventSource test double**

Create `dashboard/src/testing/fake-event-source.ts`:

```ts
/** Minimal EventSource stand-in for jsdom tests (jsdom has none). Install with `vi.stubGlobal('EventSource', FakeEventSource)`. */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((message: { data: string }) => void)[]>();
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, listener: (message: { data: string }) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  open() { this.readyState = FakeEventSource.OPEN; this.onopen?.(); }
  emit(type: string, data: unknown) { for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) }); }
  close() { this.readyState = FakeEventSource.CLOSED; }
  static reset() { FakeEventSource.instances = []; }
}
```

- [ ] **Step 6: Write the failing hook test**

Create `dashboard/src/lib/use-run-events.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import { FakeEventSource } from '../testing/fake-event-source';
import { useRunEvents } from './use-run-events';

const ev = (sequence: number) => ({ schemaVersion: 1, id: `e${sequence}`, runId: 'run-1', sequence, type: 'step', timestamp: '2026-11-07T12:00:00Z', agentId: 'alpha', round: 1, turn: 1, data: {} }) as HarnessEvent;
function mockPages(page: (path: string) => unknown) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const path = String(input).replace(/^\/api/, '');
    calls.push(path);
    return new Response(JSON.stringify(page(path)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}

beforeEach(() => { FakeEventSource.reset(); vi.stubGlobal('EventSource', FakeEventSource); });
afterEach(() => vi.unstubAllGlobals());

describe('useRunEvents', () => {
  it('opens at the newest turn, then follows the stream until the run ends', async () => {
    const calls = mockPages(() => ({ events: [ev(4), ev(5)], hasMore: true }));
    const { result } = renderHook(() => useRunEvents('run-1', { actor: 'alpha' }, { start: 'latest', follow: true, enabled: true }));
    await waitFor(() => expect(result.current.events.map(e => e.sequence)).toEqual([4, 5]));
    expect(result.current.hasEarlier).toBe(true);
    expect(calls[0]).toContain('before=9007199254740991');
    expect(calls[0]).toContain('snap=turn');
    expect(calls[0]).toContain('actor=alpha');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe('/api/runs/run-1/events/stream?actor=alpha&after=5');
    act(() => source.open());
    expect(result.current.status).toBe('live');
    act(() => source.emit('harness_event', ev(6)));
    await waitFor(() => expect(result.current.events.at(-1)?.sequence).toBe(6));
    act(() => source.emit('end', { status: 'completed' }));
    expect(result.current.status).toBe('ended');
  });

  it('opens at an anchor without streaming and loads earlier turns on request', async () => {
    const calls = mockPages(path => path.includes('before=20') ? { events: [ev(18), ev(19)], hasMore: false } : { events: [ev(20), ev(21)], hasMore: false });
    const { result } = renderHook(() => useRunEvents('run-1', {}, { start: 20, follow: false, enabled: true }));
    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(calls[0]).toContain('after=19');
    expect(result.current.hasEarlier).toBe(true);
    let added = 0;
    await act(async () => { added = await result.current.loadEarlier(); });
    expect(added).toBe(2);
    expect(result.current.events.map(e => e.sequence)).toEqual([18, 19, 20, 21]);
    expect(result.current.hasEarlier).toBe(false);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('falls back to polling when the stream is closed by the browser', async () => {
    mockPages(() => ({ events: [ev(1)], hasMore: false }));
    const { result } = renderHook(() => useRunEvents('run-1', {}, { start: 'latest', follow: true, enabled: true }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0]!;
    act(() => { source.readyState = FakeEventSource.CLOSED; source.onerror?.(); });
    expect(result.current.status).toBe('polling');
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd dashboard && npx vitest run src/lib/use-run-events.test.tsx`
Expected: FAIL — cannot resolve `./use-run-events`.

- [ ] **Step 8: Implement the hook**

Create `dashboard/src/lib/use-run-events.ts`:

```ts
/**
 * One gap-free window of a run's events, loaded in whole turns (`snap=turn`), that can follow new
 * events over server-sent events with a polling fallback. Replaces the timeline's page/cursor state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HarnessEvent } from '@sidechannel/contracts/browser';
import { api } from './api';
import { appendLater, emptyWindow, prependEarlier, type EventWindow } from './event-window';

/** `before` value meaning "from the newest event". */
export const LATEST_SEQUENCE = Number.MAX_SAFE_INTEGER;
export const EVENT_PAGE_SIZE = 50;
const FLUSH_MS = 250;
const POLL_MS = 3000;
const MAX_STREAM_ERRORS = 3;

export interface EventFilters { actor?: string; phase?: string; type?: string; from?: string; to?: string }
/** Where the window starts: the run's first event, its newest turn, or the given sequence. */
export type EventStart = 'first' | 'latest' | number;
export type StreamStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'polling' | 'ended';

export interface RunEvents extends EventWindow {
  loading: boolean;
  error: Error | undefined;
  status: StreamStatus;
  /** Each resolves to the number of events the page returned. */
  loadEarlier: () => Promise<number>;
  loadLater: () => Promise<number>;
  reload: () => void;
}

interface EventPage { events?: HarnessEvent[]; hasMore?: boolean }

export function filterQuery(filters: EventFilters): string {
  const query = new URLSearchParams();
  for (const name of ['actor', 'phase', 'type', 'from', 'to'] as const) if (filters[name]) query.set(name, filters[name]!);
  return query.toString();
}

export function useRunEvents(runId: string | undefined, filters: EventFilters, options: { start: EventStart; follow: boolean; enabled: boolean }): RunEvents {
  const { start, follow, enabled } = options;
  const filterString = filterQuery(filters);
  const [nonce, setNonce] = useState(0);
  const key = runId && enabled ? `${runId}?${filterString}@${start}#${nonce}` : null;
  const [win, setWin] = useState<EventWindow>(emptyWindow);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<Error>();
  const [pageError, setPageError] = useState<Error>();
  const [status, setStatus] = useState<StreamStatus>('idle');
  const windowRef = useRef(win);
  windowRef.current = win;
  const generation = useRef(0);

  const fetchPage = useCallback(async (params: Record<string, string>) => {
    const query = new URLSearchParams(filterString);
    query.set('snap', 'turn');
    query.set('limit', String(EVENT_PAGE_SIZE));
    for (const [name, value] of Object.entries(params)) query.set(name, value);
    const page = await api<EventPage>(`/runs/${encodeURIComponent(runId ?? '')}/events?${query}`);
    return { events: page.events ?? [], hasMore: !!page.hasMore };
  }, [runId, filterString]);

  // Initial window: re-runs whenever the run, filters, start or reload nonce change (all encoded in `key`).
  useEffect(() => {
    const current = ++generation.current;
    setWin(emptyWindow); setLoadError(undefined); setPageError(undefined); setStatus('idle');
    if (!key) { setLoading(false); return; }
    setLoading(true);
    const initial = start === 'latest'
      ? fetchPage({ before: String(LATEST_SEQUENCE) }).then(page => ({ events: page.events, hasEarlier: page.hasMore, hasLater: false }))
      : start === 'first'
        ? fetchPage({ after: '0' }).then(page => ({ events: page.events, hasEarlier: false, hasLater: page.hasMore }))
        : fetchPage({ after: String(start - 1) }).then(page => ({ events: page.events, hasEarlier: start > 1, hasLater: page.hasMore }));
    initial
      .then(next => { if (current === generation.current) setWin(next); }, (error: unknown) => { if (current === generation.current) setLoadError(error as Error); })
      .finally(() => { if (current === generation.current) setLoading(false); });
  }, [key, fetchPage, start]);

  // Once the caller stops following (run finished, or the reader jumped elsewhere), a stream that was running reads as ended.
  useEffect(() => { if (!follow) setStatus(previous => (previous === 'idle' ? previous : 'ended')); }, [follow]);

  const following = !!key && follow && !loading && !loadError;
  useEffect(() => {
    if (!following) return;
    const current = generation.current;
    let buffer: HarnessEvent[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let source: EventSource | undefined;
    let errors = 0;
    const newest = () => Math.max(windowRef.current.events.at(-1)?.sequence ?? 0, ...buffer.map(event => event.sequence));
    const flush = () => {
      flushTimer = undefined;
      if (current !== generation.current || !buffer.length) return;
      const batch = buffer;
      buffer = [];
      setWin(w => appendLater(w, batch, false));
    };
    // Model calls write four events in a burst; batching keeps TimelinePanel from rebuilding per event.
    const push = (events: HarnessEvent[]) => { if (!events.length) return; buffer.push(...events); flushTimer ??= setTimeout(flush, FLUSH_MS); };
    const poll = () => {
      setStatus('polling');
      pollTimer = setInterval(() => { fetchPage({ after: String(newest()) }).then(page => push(page.events), () => undefined); }, POLL_MS);
    };
    if (typeof EventSource === 'undefined') poll();
    else {
      const query = new URLSearchParams(filterString);
      query.set('after', String(newest()));
      source = new EventSource(`/api/runs/${encodeURIComponent(runId ?? '')}/events/stream?${query}`);
      setStatus('connecting');
      source.onopen = () => { errors = 0; setStatus('live'); };
      source.addEventListener('harness_event', message => push([JSON.parse((message as MessageEvent<string>).data) as HarnessEvent]));
      source.addEventListener('end', () => { source?.close(); flush(); setStatus('ended'); });
      source.onerror = () => {
        if (!source) return;
        if (source.readyState === EventSource.CLOSED || ++errors >= MAX_STREAM_ERRORS) { source.close(); source = undefined; poll(); }
        else setStatus('reconnecting');
      };
    }
    return () => { source?.close(); clearInterval(pollTimer); if (flushTimer) clearTimeout(flushTimer); };
  }, [following, filterString, runId, fetchPage]);

  const loadEarlier = useCallback(async () => {
    const first = windowRef.current.events[0];
    if (!first || !key) return 0;
    const current = generation.current;
    try {
      const page = await fetchPage({ before: String(first.sequence) });
      if (current !== generation.current) return 0;
      setPageError(undefined);
      // While following, never evict the live end.
      setWin(w => prependEarlier(w, page.events, page.hasMore, follow ? Number.POSITIVE_INFINITY : undefined));
      return page.events.length;
    } catch (error) { if (current === generation.current) setPageError(error as Error); return 0; }
  }, [key, fetchPage, follow]);

  const loadLater = useCallback(async () => {
    const last = windowRef.current.events.at(-1);
    if (!last || !key) return 0;
    const current = generation.current;
    try {
      const page = await fetchPage({ after: String(last.sequence) });
      if (current !== generation.current) return 0;
      setPageError(undefined);
      setWin(w => appendLater(w, page.events, page.hasMore));
      return page.events.length;
    } catch (error) { if (current === generation.current) setPageError(error as Error); return 0; }
  }, [key, fetchPage]);

  const reload = useCallback(() => setNonce(n => n + 1), []);
  return { ...win, loading, error: loadError ?? pageError, status, loadEarlier, loadLater, reload };
}
```

- [ ] **Step 9: Run the hook tests to verify they pass**

Run: `cd dashboard && npx vitest run src/lib/use-run-events.test.tsx src/lib/event-window.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 10: Commit**

```bash
git add dashboard/src/lib/event-window.ts dashboard/src/lib/event-window.test.ts dashboard/src/lib/use-run-events.ts dashboard/src/lib/use-run-events.test.tsx dashboard/src/testing/fake-event-source.ts
git commit -m "Add a turn-aligned live event window hook for the dashboard"
```

---

### Task 6: Show the model call that is still waiting for a response

**Files:**
- Modify: `dashboard/src/pages/runs/TimelinePanel.tsx` (props at 14–23, component at 146, `renderCallRow` at 209–230)
- Modify: `dashboard/src/pages/runs/TimelinePanel.test.tsx` (append a `describe`)
- Modify: `dashboard/src/pages/runs/timeline-panel.css` (append)

**Interfaces:**
- Consumes: `ModelCall.response`, `ModelCall.sequenceRange`, `ModelCall.request`, `ModelCall.startedAt` (`dashboard/src/lib/model-calls.ts:45-71`).
- Produces: `TimelinePanelProps.live?: boolean`. When true, the folded call row whose call has no `model_response` **and** whose last event is the newest event shown displays "Waiting for model response · Ns".

- [ ] **Step 1: Write the failing tests**

Append to `dashboard/src/pages/runs/TimelinePanel.test.tsx`:

```tsx
describe('TimelinePanel live mode', () => {
  function pendingLog(): HarnessEvent[] {
    seq = 0;
    const inv = { invocationId: 'inv-9' };
    return [
      ev('turn_started', { allowance: 8 }),
      ev('context_accounted', { estimated: 10, phase: 'action' }, inv),
      ev('model_requested', { phase: 'action' }, inv),
    ];
  }
  it('marks the newest unanswered model call as waiting while live', () => {
    render(<TimelinePanel events={pendingLog()} provider="adaption" live onInspect={vi.fn()} onOpenTraces={vi.fn()} />);
    expect(screen.getByText(/Waiting for model response/)).toBeTruthy();
  });
  it('shows no waiting state when not live, or once later events exist', () => {
    const events = pendingLog();
    render(<TimelinePanel events={events} provider="adaption" onInspect={vi.fn()} onOpenTraces={vi.fn()} />);
    expect(screen.queryByText(/Waiting for model response/)).toBeNull();
    cleanup();
    render(<TimelinePanel events={[...events, ev('turn_ended', { remainingAllowance: 8 })]} provider="adaption" live onInspect={vi.fn()} onOpenTraces={vi.fn()} />);
    expect(screen.queryByText(/Waiting for model response/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd dashboard && npx vitest run src/pages/runs/TimelinePanel.test.tsx`
Expected: FAIL — `Unable to find an element with the text: /Waiting for model response/` (plus a TS error for the unknown `live` prop).

- [ ] **Step 3: Implement the pending row**

In `TimelinePanel.tsx`:

1. Add to `TimelinePanelProps`:

```ts
  /** The run is being followed live: the newest unanswered model call shows a waiting state. */
  live?: boolean;
```

2. Change the signature to `export function TimelinePanel({ events, provider, live = false, onInspect, onOpenTraces }: TimelinePanelProps) {` and add after the `segments` memo:

```ts
  const lastSequence = sorted.at(-1)?.sequence;
  const isPending = (call: ModelCall) => live && !call.response && call.sequenceRange[1] === lastSequence;
```

3. In `renderCallRow`, replace `<ModelCallMeta call={call} />` with:

```tsx
          <ModelCallMeta call={call} />
          {isPending(call) && <PendingResponse since={call.request?.timestamp ?? call.startedAt} />}
```

4. Add below `OpenButton`:

```tsx
function PendingResponse({ since }: { since: string }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  // The ticking counter is hidden from assistive tech so it is not announced every second.
  return (
    <p className="tl-pending">
      <span className="tl-pending-dot" aria-hidden="true" />
      Waiting for model response <span aria-hidden="true">· {seconds}s</span>
    </p>
  );
}
```

5. Append to `timeline-panel.css`:

```css
.tl-pending { display: flex; align-items: center; gap: 8px; margin: 6px 0 0; color: var(--muted); font-size: 13px; }
.tl-pending-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary); animation: tl-pending-pulse 1.2s ease-in-out infinite; }
@keyframes tl-pending-pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .tl-pending-dot { animation: none; } }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd dashboard && npx vitest run src/pages/runs/TimelinePanel.test.tsx`
Expected: PASS (existing tests plus 2 new).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/runs/TimelinePanel.tsx dashboard/src/pages/runs/TimelinePanel.test.tsx dashboard/src/pages/runs/timeline-panel.css
git commit -m "Show the model call that is still waiting for a response on a live timeline"
```

---

### Task 7: Turn navigator, follow-scroll and run page wiring

**Files:**
- Create: `dashboard/src/pages/runs/use-follow-scroll.ts`
- Create: `dashboard/src/pages/runs/TurnNavigator.tsx`
- Create: `dashboard/src/pages/runs/RunEventsView.tsx`, `dashboard/src/pages/runs/run-events.css`
- Create: `dashboard/src/pages/runs/RunEventsView.test.tsx`
- Create: `dashboard/src/pages/runs/RunTimelineLive.test.tsx`
- Modify: `dashboard/src/pages/Runs.tsx` — imports (39–56), `RunDetail` state (215–240, 268–271, 293–300, 312–314), timeline/traces card (470–577)

**Interfaces:**
- Consumes: `useRunEvents`, `RunEvents`, `EventStart`, `StreamStatus` (Task 5); `TimelinePanel` `live` (Task 6); `TurnSummary` (Task 1); `GET /runs/:id/turns` (Task 3).
- Produces:
  - `useFollowScroll(endRef, events, follow): { unseen: number; arrived: number; jump: () => void }`
  - `TurnNavigator({ turns, start, onJump })`, `turnLabel(turn)`
  - `RunEventsView(props: RunEventsViewProps)`, `StreamBadge({ status })`
  - URL contract: `?at=<sequence>` opens the window at that sequence; `?at=end` opens at the newest turn; no `at` opens at the newest turn if the run was active when the page opened, otherwise at the first event. The run is followed live only while it is active, the window starts at the newest turn, and "Sequence through" is empty.

- [ ] **Step 1: Write the failing component tests**

Create `dashboard/src/pages/runs/RunEventsView.test.tsx`:

```tsx
// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { HarnessEvent, TurnSummary } from '@sidechannel/contracts/browser';
import { TurnNavigator } from './TurnNavigator';
import { useFollowScroll } from './use-follow-scroll';

afterEach(cleanup);
const ev = (sequence: number) => ({ schemaVersion: 1, id: `e${sequence}`, runId: 'r', sequence, type: 't', timestamp: '', data: {} }) as HarnessEvent;
const turns: TurnSummary[] = [
  { agentId: 'alpha', round: 1, turn: 1, firstSequence: 2, lastSequence: 6, eventCount: 5, modelCalls: 1, failures: 1 },
  { agentId: 'beta', round: 1, turn: 2, firstSequence: 7, lastSequence: 9, eventCount: 3, modelCalls: 1, failures: 0 },
];

describe('TurnNavigator', () => {
  it('selects the turn containing the start, labels turns and jumps to a turn or the newest events', () => {
    const onJump = vi.fn();
    render(<TurnNavigator turns={turns} start={8} onJump={onJump} />);
    const select = screen.getByLabelText('Jump to turn') as HTMLSelectElement;
    expect(select.value).toBe('7');
    expect(screen.getByRole('option', { name: 'Round 1 · Turn 1 · alpha · 5 events · 1 failed' })).toBeTruthy();
    expect(screen.getByText('2 turns · 8 events in turns')).toBeTruthy();
    fireEvent.change(select, { target: { value: '2' } });
    expect(onJump).toHaveBeenLastCalledWith(2);
    fireEvent.change(select, { target: { value: 'end' } });
    expect(onJump).toHaveBeenLastCalledWith('end');
  });
});

describe('useFollowScroll', () => {
  it('keeps the end in view while pinned and counts arrivals once the reader scrolls up', () => {
    const end = document.createElement('div');
    document.body.append(end);
    const scrollIntoView = vi.fn();
    end.scrollIntoView = scrollIntoView;
    let bottom = 0;
    end.getBoundingClientRect = () => ({ bottom }) as DOMRect;
    const ref = { current: end };
    const { result, rerender } = renderHook(({ events }) => useFollowScroll(ref, events, true), { initialProps: { events: [ev(1)] } });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    rerender({ events: [ev(1), ev(2)] });
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(result.current.unseen).toBe(0);
    bottom = 5000;
    act(() => { window.dispatchEvent(new Event('scroll')); });
    rerender({ events: [ev(1), ev(2), ev(3), ev(4)] });
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(result.current.unseen).toBe(2);
    act(() => result.current.jump());
    expect(result.current.unseen).toBe(0);
    end.remove();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd dashboard && npx vitest run src/pages/runs/RunEventsView.test.tsx`
Expected: FAIL — cannot resolve `./TurnNavigator`.

- [ ] **Step 3: Implement follow-scroll and the navigator**

Create `dashboard/src/pages/runs/use-follow-scroll.ts`:

```ts
/** Keeps the end of a growing list in view while the reader is at the end; otherwise counts what arrived below. */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { HarnessEvent } from '@sidechannel/contracts/browser';

const PIN_SLACK_PX = 80;
const isPinned = (end: HTMLElement | null) => !end || end.getBoundingClientRect().bottom <= window.innerHeight + PIN_SLACK_PX;

export function useFollowScroll(endRef: RefObject<HTMLElement | null>, events: readonly HarnessEvent[], follow: boolean) {
  const [unseen, setUnseen] = useState(0);
  const [arrived, setArrived] = useState(0);
  const pinned = useRef(true);
  const newest = useRef<number | undefined>(undefined);
  useEffect(() => {
    const onScroll = () => { pinned.current = isPinned(endRef.current); if (pinned.current) setUnseen(0); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [endRef]);
  const last = events.at(-1)?.sequence;
  useLayoutEffect(() => {
    const before = newest.current;
    newest.current = last;
    if (!follow || last === undefined) return;
    // First load of a followed window: start at the end. jsdom has no scrollIntoView, hence the optional call.
    if (before === undefined) { endRef.current?.scrollIntoView?.({ block: 'end' }); return; }
    if (last <= before) return;
    const count = events.filter(event => event.sequence > before).length;
    setArrived(count);
    if (pinned.current) endRef.current?.scrollIntoView?.({ block: 'end' });
    else setUnseen(n => n + count);
  }, [last, follow, endRef, events]);
  const jump = () => { endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' }); pinned.current = true; setUnseen(0); };
  return { unseen, arrived, jump };
}
```

Create `dashboard/src/pages/runs/TurnNavigator.tsx`:

```tsx
import type { TurnSummary } from '@sidechannel/contracts/browser';
import { Select } from '../../components/ui';
import type { EventStart } from '../../lib/use-run-events';

export function turnLabel(turn: TurnSummary): string {
  return `Round ${turn.round ?? '—'} · Turn ${turn.turn} · ${turn.agentId} · ${turn.eventCount} event${turn.eventCount === 1 ? '' : 's'}${turn.failures ? ` · ${turn.failures} failed` : ''}`;
}

export function TurnNavigator({ turns, start, onJump }: { turns: TurnSummary[] | undefined; start: EventStart; onJump: (at: number | 'end') => void }) {
  if (!turns?.length) return null;
  const containing = typeof start === 'number' ? turns.find(turn => start >= turn.firstSequence && start <= turn.lastSequence) : undefined;
  const value = start === 'latest' ? 'end' : containing ? String(containing.firstSequence) : '';
  const total = turns.reduce((sum, turn) => sum + turn.eventCount, 0);
  return (
    <div className="turn-nav">
      <Select aria-label="Jump to turn" value={value} onChange={event => onJump(event.target.value === 'end' ? 'end' : Number(event.target.value))}>
        {value === '' && <option value="">Jump to a turn…</option>}
        <option value="end">Newest events</option>
        {turns.map(turn => <option key={turn.firstSequence} value={turn.firstSequence}>{turnLabel(turn)}</option>)}
      </Select>
      <span className="helper">{turns.length} turns · {total} events in turns</span>
    </div>
  );
}
```

- [ ] **Step 4: Run the component tests to verify they pass**

Run: `cd dashboard && npx vitest run src/pages/runs/RunEventsView.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement the view**

Create `dashboard/src/pages/runs/run-events.css`:

```css
.run-events { position: relative; }
.run-events-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 0 0 12px; }
.turn-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; min-width: 0; }
.turn-nav select { max-width: min(100%, 440px); }
.run-events-more { margin: 8px 0; }
.run-events-pill {
  position: sticky; bottom: 16px; display: block; margin: 8px auto 0; padding: 6px 14px;
  border: 1px solid var(--border); border-radius: 999px; background: var(--card); color: var(--foreground);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.12); font-size: 13px; cursor: pointer;
}
.run-events-pill:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
```

Create `dashboard/src/pages/runs/RunEventsView.tsx`:

```tsx
/** The Timeline / Model & traces body: turn navigator, turn-aligned event window, load controls and live follow. */
import * as React from 'react';
import type { TurnSummary } from '@sidechannel/contracts/browser';
import { Badge, Button, Empty, ErrorState, Loading } from '../../components/ui';
import type { EventStart, RunEvents, StreamStatus } from '../../lib/use-run-events';
import { TimelinePanel } from './TimelinePanel';
import { TracesPanel } from './TracesPanel';
import { TurnNavigator } from './TurnNavigator';
import { useFollowScroll } from './use-follow-scroll';
import './run-events.css';

const STATUS_LABEL: Record<StreamStatus, string> = {
  idle: 'Browsing', connecting: 'Connecting…', live: '● Live', reconnecting: 'Reconnecting…', polling: '● Live (polling)', ended: 'Run ended',
};

export function StreamBadge({ status }: { status: StreamStatus }) {
  return <Badge status={status === 'live' || status === 'polling' ? 'running' : status === 'reconnecting' ? 'stopping' : ''}>{STATUS_LABEL[status]}</Badge>;
}

export interface RunEventsViewProps {
  tab: 'timeline' | 'traces';
  runEvents: RunEvents;
  follow: boolean;
  turns: TurnSummary[] | undefined;
  start: EventStart;
  provider: string;
  focusCall: string | null;
  onInspect: (eventId: string, sequence?: number) => void;
  onOpenTraces: (invocationId: string) => void;
  onJump: (at: number | 'end') => void;
}

export function RunEventsView({ tab, runEvents, follow, turns, start, provider, focusCall, onInspect, onOpenTraces, onJump }: RunEventsViewProps) {
  const endRef = React.useRef<HTMLDivElement>(null);
  const { unseen, arrived, jump } = useFollowScroll(endRef, runEvents.events, follow);
  // Keep the reader's place when earlier turns are inserted above (Safari has no overflow-anchor).
  const heightBefore = React.useRef<number | null>(null);
  const firstId = runEvents.events[0]?.id;
  React.useLayoutEffect(() => {
    if (heightBefore.current === null) return;
    window.scrollBy(0, document.documentElement.scrollHeight - heightBefore.current);
    heightBefore.current = null;
  }, [firstId]);
  const loadEarlier = async () => {
    heightBefore.current = document.documentElement.scrollHeight;
    if (!(await runEvents.loadEarlier())) heightBefore.current = null;
  };
  return (
    <div className="run-events">
      <div className="run-events-bar">
        <TurnNavigator turns={turns} start={start} onJump={onJump} />
      </div>
      {runEvents.error && <ErrorState error={runEvents.error} retry={runEvents.reload} />}
      {runEvents.loading ? (
        <Loading label="Loading events…" />
      ) : runEvents.events.length ? (
        <>
          {runEvents.hasEarlier && <Button variant="secondary" size="sm" className="run-events-more" onClick={() => void loadEarlier()}>Load earlier turns</Button>}
          {tab === 'timeline' ? (
            <TimelinePanel events={runEvents.events} provider={provider} live={follow} onInspect={onInspect} onOpenTraces={onOpenTraces} />
          ) : (
            <TracesPanel events={runEvents.events} provider={provider} onInspect={onInspect} focusInvocationId={focusCall} />
          )}
          {runEvents.hasLater && <Button variant="secondary" size="sm" className="run-events-more" onClick={() => void runEvents.loadLater()}>Load later turns</Button>}
        </>
      ) : (
        <Empty title="No matching events" description="New recorded evidence will appear here without changing your selected object." />
      )}
      <div ref={endRef} aria-hidden="true" />
      {unseen > 0 && <button type="button" className="run-events-pill" onClick={jump}>{unseen} new event{unseen === 1 ? '' : 's'} ↓</button>}
      <p className="sr-only" aria-live="polite">{follow && arrived ? `${arrived} new event${arrived === 1 ? '' : 's'}` : ''}</p>
    </div>
  );
}
```

- [ ] **Step 6: Write the failing page test**

Create `dashboard/src/pages/runs/RunTimelineLive.test.tsx`:

```tsx
// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { defaultFixtureConfiguration } from '@sidechannel/contracts/testing';
import { FakeEventSource } from '../../testing/fake-event-source';
import Runs from '../Runs';

const config = defaultFixtureConfiguration();
const runOf = (status: string) => ({ id: 'run-1', config, configHash: 'abcdef0123456789', status, round: 1, turn: 1, createdAt: '2026-11-07T12:00:00Z', updatedAt: '2026-11-07T12:00:00Z', artifacts: [], reports: [], board: [] });
const event = (sequence: number, type = 'turn_started') => ({ schemaVersion: 1, id: `e${sequence}`, runId: 'run-1', sequence, type, timestamp: '2026-11-07T12:00:00Z', agentId: 'alpha', round: 1, turn: 1, data: {} });
const turns = [{ agentId: 'alpha', round: 1, turn: 1, firstSequence: 2, lastSequence: 5, eventCount: 4, modelCalls: 0, failures: 0 }];

function mockApi(status: string) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const path = String(input).replace(/^\/api/, '');
    calls.push(path);
    const body = path === '/runs/run-1' || path === '/runs/run-1/progress' ? runOf(status)
      : path.startsWith('/runs/run-1/events?') ? { events: [event(4), event(5)], hasMore: true, nextCursor: 5 }
        : path === '/runs/run-1/turns' ? { turns }
          : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return calls;
}
const open = (entry = '/run-1') => render(<MemoryRouter initialEntries={[entry]}><Runs /></MemoryRouter>);

beforeEach(() => { FakeEventSource.reset(); vi.stubGlobal('EventSource', FakeEventSource); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

it('opens an active run at its newest turn and appends streamed events', async () => {
  const calls = mockApi('running');
  open();
  await waitFor(() => expect(calls.some(p => p.startsWith('/runs/run-1/events?') && p.includes('before=9007199254740991') && p.includes('snap=turn'))).toBe(true));
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  const source = FakeEventSource.instances[0]!;
  expect(source.url).toContain('after=5');
  act(() => source.open());
  expect(await screen.findByText('● Live')).toBeTruthy();
  act(() => source.emit('harness_event', event(6, 'board_posted')));
  expect(await screen.findByText('board posted')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Load earlier turns' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
});

it('opens a finished run at its first event without streaming, and jumps to a turn from the navigator', async () => {
  const calls = mockApi('completed');
  open();
  expect(await screen.findByRole('button', { name: 'Load later turns' })).toBeTruthy();
  expect(calls.some(p => p.startsWith('/runs/run-1/events?') && p.includes('after=0'))).toBe(true);
  expect(FakeEventSource.instances).toHaveLength(0);
  fireEvent.change(await screen.findByLabelText('Jump to turn'), { target: { value: '2' } });
  await waitFor(() => expect(calls.some(p => p.startsWith('/runs/run-1/events?') && p.includes('after=1'))).toBe(true));
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd dashboard && npx vitest run src/pages/runs/RunTimelineLive.test.tsx`
Expected: FAIL — the first `waitFor` times out (requests still use `limit=50&after=0` with no `snap`).

- [ ] **Step 8: Wire the run page**

In `dashboard/src/pages/Runs.tsx`:

1. Imports: delete `import { TimelinePanel } from "./runs/TimelinePanel";` and `import { TracesPanel } from "./runs/TracesPanel";` and add:

```tsx
import type { TurnSummary } from "@sidechannel/contracts/browser";
import { useRunEvents, type EventStart } from "../lib/use-run-events";
import { RunEventsView, StreamBadge } from "./runs/RunEventsView";
```

2. Add at module level, above `function RunDetail()`:

```tsx
const ACTIVE_STATUSES = ["queued", "running", "reporting", "stopping"];
```

3. In `RunDetail`, replace everything from `const [page, setPage] = useState(0);` through the end of the `const events = useApi<…>(…, 4000);` call (lines 220–240) with:

```tsx
  const [page, setPage] = useState(0);
  const eventTabs = tab === "timeline" || tab === "traces";
  // Guard against the previous run's data during a route change: useApi clears data only after render.
  const status =
    run.data?.id === id
      ? (progress.data?.id === id ? progress.data?.status : undefined) ?? run.data.status
      : undefined;
  const runActive = !!status && ACTIVE_STATUSES.includes(status);
  // Whether the run was active when this page opened decides the default start, so a run that finishes
  // while you watch keeps its window instead of jumping back to the first event.
  const [opened, setOpened] = useState<{ id: string; active: boolean }>();
  const openedActive = opened?.id === id ? opened.active : undefined;
  useEffect(() => {
    if (id && openedActive === undefined && status) setOpened({ id, active: runActive });
  }, [id, openedActive, status, runActive]);
  const at = params.get("at");
  const start: EventStart =
    at === "end"
      ? "latest"
      : at && Number.isSafeInteger(Number(at)) && Number(at) > 0
        ? Number(at)
        : openedActive
          ? "latest"
          : "first";
  const follow = runActive && start === "latest" && !to;
  const runEvents = useRunEvents(
    id,
    { actor, phase, type: eventType, from, to },
    { start, follow, enabled: eventTabs && openedActive !== undefined },
  );
  const turns = useApi<{ turns: TurnSummary[] }>(
    eventTabs ? "/runs/" + id + "/turns" : null,
    follow ? 10000 : 0,
  );
  const jumpTo = (target: number | "end") =>
    setParams((prev) => {
      prev.set("at", String(target));
      return prev;
    });
```

4. Replace the reset effect (lines 268–271) with:

```tsx
  useEffect(() => {
    setPage(0);
  }, [tab, actor, phase, eventType, from, to, id]);
```

5. Replace `selectedEvent.data ?? events.data?.events.find((e) => e.id === selected);` with `selectedEvent.data ?? runEvents.events.find((e) => e.id === selected);`, and replace `const traceEvents = events.data?.events ?? [];` with `const traceEvents = runEvents.events;`.

6. Replace `const active = ["queued", "running", "reporting", "stopping"].includes(data.status);` (lines 312–314) with `const active = ACTIVE_STATUSES.includes(data.status);`.

7. Replace the timeline/traces branch, from `) : ["timeline", "traces"].includes(tab) ? (` through its closing `</Card>` (lines 470–577), with the block below. The `<div className="filter-bar">…</div>` element (lines 490–535) moves over unchanged:

```tsx
        ) : ["timeline", "traces"].includes(tab) ? (
          <Card>
            <CardHeading
              title={
                tab === "timeline" ? "Execution timeline" : "Model invocations"
              }
              description={
                tab === "timeline"
                  ? "Proposed requests, admitted actions, side effects, and results remain distinct."
                  : "One card per model call in the loaded turns: what it reasoned, what it said, and what it proposed."
              }
              actions={<StreamBadge status={runEvents.status} />}
            />
            {/* existing <div className="filter-bar">…</div>, unchanged */}
            <RunEventsView
              tab={tab === "timeline" ? "timeline" : "traces"}
              runEvents={runEvents}
              follow={follow}
              turns={turns.data?.turns}
              start={start}
              provider={data.config.model.provider}
              focusCall={focusCall}
              onInspect={inspect}
              onOpenTraces={openTraces}
              onJump={jumpTo}
            />
          </Card>
```

(Write the moved `filter-bar` element in place of the JSX comment; do not leave the comment in the source.)

`Pager` stays imported: the board/artifacts/memory/reports tabs still use it with `page`.

- [ ] **Step 9: Run the page test and the whole dashboard suite**

Run: `cd dashboard && npx vitest run src/pages/runs/RunTimelineLive.test.tsx && npm test`
Expected: PASS, including `workflows.test.tsx` (its board test still makes no `/events` request) and `RunsOversight.test.tsx`.

- [ ] **Step 10: Check it in the browser**

Start the stack (`npm run dev:api`, `npm run dev:experiment`, `npm run dev:dashboard`), launch the development fixture, open its run page and confirm:
1. The page opens at the newest turn with "● Live" in the heading, and new rows appear within about a second without a reload.
2. The newest model call shows "Waiting for model response · Ns" until its response lands.
3. Scrolling up stops auto-scroll and shows "N new events ↓"; clicking it returns to the end.
4. "Load earlier turns" adds turns above without moving the row you were reading.
5. "Jump to turn" opens that turn, the badge reads "Browsing", and `?at=` is in the URL; reloading keeps the position; "Newest events" returns to live.
6. When the run finishes the badge reads "Run ended" and the list stays where it was.
7. At 375px wide the navigator and buttons wrap with no horizontal scroll.

- [ ] **Step 11: Commit**

```bash
git add dashboard/src/pages/runs/use-follow-scroll.ts dashboard/src/pages/runs/TurnNavigator.tsx dashboard/src/pages/runs/RunEventsView.tsx dashboard/src/pages/runs/run-events.css dashboard/src/pages/runs/RunEventsView.test.tsx dashboard/src/pages/runs/RunTimelineLive.test.tsx dashboard/src/pages/Runs.tsx
git commit -m "Replace the timeline pager with a live, turn-aligned event view"
```

## Verification summary

| Command (repo root unless noted) | Expected |
| --- | --- |
| `node scripts/nx.mjs run @sidechannel/domain:test` | event-pages tests pass |
| `node scripts/nx.mjs run @sidechannel/persistence:test` | event-log + existing repository tests pass |
| `node scripts/nx.mjs run @sidechannel/api:test` | event-pages, event-stream and unchanged `server.test.ts` pass |
| `npm run build && npm run test:integration` | `event-stream.mongo.test.ts` and all existing Mongo suites pass |
| `cd dashboard && npm test` | all dashboard suites pass |
| `npm run lint` / `node scripts/verify-boundaries.mjs` | clean; the API imports domain/contracts only, the dashboard imports contracts/browser only |
| `npm run check` / `npm run build` | clean |
| Manual (Task 4 Step 6, Task 7 Step 10) | stream and UI behave as listed |

## Rollback

- **Task 7:** revert the commit. The new hook and endpoints stay unused; the pager comes back.
- **Task 6:** revert; `live` is an optional prop with no other callers.
- **Task 5:** revert; nothing outside the dashboard depends on it once Task 7 is reverted.
- **Task 4:** revert; the stream route is the only consumer of `event-stream.ts`. Clients fall back to polling if only the route is removed.
- **Task 3:** revert; `snap`/`before`/`/turns` are opt-in and no existing caller sends them.
- **Task 2:** revert. No data is written; the in-memory matcher returns to its local copy.
- **Task 1:** revert last; additive types and a new module.

No step migrates or rewrites stored data.

## Out of scope

- **Token-by-token model output.** Events are written only when a model call finishes; streaming partial output needs the worker to publish deltas on a separate short-lived channel.
- **Moving `/progress` polling into the stream.** `end` carries the final status, but the 3.5 s progress poll stays.
- **Header-authenticated streams.** `EventSource` cannot send `Authorization`. `rawApi` sends none today either, so behaviour behind `RESEARCHER_TOKEN` is unchanged (both fail the same way). If header auth is added to the dashboard, replace `EventSource` in `use-run-events.ts` with a `fetch` reader of the same frames.
- **One change stream per viewer.** Each open stream holds one Mongo change-stream cursor. That suits a research workspace with a handful of viewers; a shared fan-out is future work.
- **Out-of-order commits.** `appendEvent` takes a sequence from `counters` and then inserts, in two steps. The scheduler appends one at a time (`experiment-worker/src/harness/scheduler.ts:44`), so commit order equals sequence order. If appends ever run concurrently, the stream cursor must advance only through contiguous sequences.
- **Highlighting newly arrived rows**, virtualization, and moving the hook under `dashboard/src/lib/clients/` (WS5/WS6).

## Self-review

- **Spec coverage.** Live stream: Task 4 (server) and Task 5 (client, polling fallback, batching, resume through `Last-Event-ID`). Follow-scroll, new-events pill, screen-reader announcements: Task 7. Pending model call: Task 6. Paging problems: turns split across pages → Tasks 1/3 (`snap=turn`); forward-only with no position → `/turns` and the navigator (Tasks 3/7); position lost on reload → `?at=` (Task 7); polling after the run ends → no polling unless following (Task 5); the `length === 50` guess → the server sends `hasMore` on every snapped page (Task 3); deep link not opening where the event is → `?at=` start (Task 7). Load earlier/later with scroll compensation: Task 7. Memory cap: Task 5 `WINDOW_CAP`.
- **Placeholder scan.** Every code step shows full code or an exact replacement with line anchors. The one JSX comment in Task 7 Step 8 is an explicit move of an existing element, with an instruction not to commit the comment.
- **Type consistency.** `TurnSummary` and `EventQuery` (Task 1) are used unchanged in Tasks 2, 3 and 7. `subscribeEvents(runId, onAppend): () => void` is the same in contract, both repositories and `event-stream.ts`. The SSE event names `harness_event`, `end` and `stream_error` match between Task 4 and Task 5. `EventStart`, `StreamStatus` and `RunEvents` (Task 5) are the types `TurnNavigator`, `RunEventsView` and `Runs.tsx` use. `loadEarlier` resolves to a number in both the hook and the view.
- **Behaviour-change statement.** Changed on purpose: the timeline/traces pager, the heading badge, the traces description copy, and polling of finished runs. Unchanged: `/events` without `snap`/`before`, `/memory`, every other route, event types and stored data.
- **Deviations from the source.** In-memory and Mongo phase matching already differed slightly: an event with `data.phase: 'action'` and a `report*` type counts as action in memory and as report in Mongo. The domain `eventPhase` keeps the in-memory rule, and the stream uses the same `queryEvents` as each backend, so this plan neither fixes nor widens the difference.
