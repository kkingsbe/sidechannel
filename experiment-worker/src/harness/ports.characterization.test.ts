import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import type { MemorySnapshot } from '@sidechannel/contracts/harness/contracts';
import type { PrivateMemory } from '@sidechannel/contracts/harness/server';
import { HarnessScheduler } from './scheduler.js';
import { ScriptedAdapter, fixtureScript } from './scripted-adapter.js';

/**
 * The committed fixture export is the recorded baseline for a scripted fixture run.
 * Ports must be substitutable without moving a single event, so the ordered sequence
 * is pinned here and compared verbatim after every refactor in WS2/WS3.
 *
 * EVIDENCE DRIFT (recorded in `docs/solid-remediation-decisions.md`, "WS2 — fixture
 * export evidence drift"): `agent/examples/completed-fixture.json` is a 103-event
 * export authored before `5a31bf7` added the accounting events (`context_accounted`,
 * `model_usage`). The current scheduler emits 123 events, so this suite pins the
 * current-code recording instead of the stale export and deliberately leaves the
 * committed research artifact untouched (regenerating evidence requires its own
 * approved refresh task). `committedTypes` is asserted separately so any future
 * change to that artifact is a visible, reviewed diff rather than silent drift.
 * EVIDENCE CHANGE (integration P1, port of main `0d96464` "Make the final report a submit_report
 * tool call"): the report phase now records `tool_requested` and `tool_result` for the accepted
 * `submit_report` call before `report_submitted`, so the fixture recording gains exactly those
 * four events (123 → 127). This is the authorized re-record for that behaviour change; the
 * committed 103-event `agent/examples/completed-fixture.json` remains untouched.
 */
const committedExport = JSON.parse(readFileSync(new URL('../../../agent/examples/completed-fixture.json', import.meta.url), 'utf8')) as { events: { type: string }[] };

/** Current-code recording (2026-11-07 tree, re-recorded by the approved integration-P1 submit_report port). */
const recordedTypes = [
    'run_started', 'turn_started', 'context_accounted', 'model_requested', 'model_response', 'model_usage',
    'tool_requested', 'tool_requested', 'tool_requested', 'tool_admitted', 'tool_result', 'tool_admitted',
    'board_post', 'tool_result', 'tool_admitted', 'memory_updated', 'tool_result', 'turn_ended',
    'turn_started', 'context_accounted', 'model_requested', 'model_response', 'model_usage', 'tool_requested',
    'tool_requested', 'tool_requested', 'tool_admitted', 'tool_result', 'tool_admitted', 'board_post',
    'tool_result', 'tool_admitted', 'memory_updated', 'tool_result', 'turn_ended', 'turn_started',
    'context_accounted', 'model_requested', 'model_response', 'model_usage', 'tool_requested', 'tool_requested',
    'tool_admitted', 'board_delivery', 'tool_result', 'tool_admitted', 'tool_result', 'context_accounted',
    'model_requested', 'model_response', 'model_usage', 'tool_requested', 'tool_admitted', 'artifact_updated',
    'tool_result', 'turn_ended', 'turn_started', 'context_accounted', 'model_requested', 'model_response',
    'model_usage', 'tool_requested', 'tool_requested', 'tool_admitted', 'board_delivery', 'tool_result',
    'tool_admitted', 'tool_result', 'context_accounted', 'model_requested', 'model_response', 'model_usage',
    'tool_requested', 'tool_admitted', 'artifact_updated', 'tool_result', 'turn_ended', 'turn_started',
    'context_accounted', 'model_requested', 'model_response', 'model_usage', 'tool_requested', 'tool_requested',
    'tool_requested', 'tool_admitted', 'memory_updated', 'tool_result', 'tool_admitted', 'board_delivery',
    'tool_result', 'tool_admitted', 'tool_result', 'turn_ended', 'turn_started', 'context_accounted',
    'model_requested', 'model_response', 'model_usage', 'tool_requested', 'tool_requested', 'tool_requested',
    'tool_admitted', 'memory_updated', 'tool_result', 'tool_admitted', 'board_delivery', 'tool_result',
    'tool_admitted', 'tool_result', 'turn_ended', 'artifact_frozen', 'context_accounted', 'model_requested',
    'model_response', 'model_usage', 'tool_requested', 'tool_result', 'report_submitted', 'context_accounted',
    'model_requested', 'model_response', 'model_usage', 'tool_requested', 'tool_result', 'report_submitted',
    'run_completed',
];

class TestMemory implements PrivateMemory {
    private rows = new Map<string, MemorySnapshot>();
    async load(runId: string, agentId: string) { return structuredClone(this.rows.get(`${runId}:${agentId}`) ?? { version: 0, notes: '', messages: [] }); }
    async save(runId: string, agentId: string, snapshot: MemorySnapshot) { this.rows.set(`${runId}:${agentId}`, structuredClone(snapshot)); }
}

test('fixture run emits the recorded event-type sequence in memory', async () => {
    const repository = new InMemoryRepository();
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'characterization');
    await repository.createRun(run);
    const completed = await new HarnessScheduler({ runState: repository, events: repository, memory: new TestMemory(), adapter: new ScriptedAdapter(fixtureScript) }).run(run.id);
    assert.equal(completed.status, 'completed', completed.failureReason ?? 'fixture must complete');
    const actual = (await repository.listEvents(run.id, 0, 10_000)).map(event => event.type);
    assert.deepEqual(actual, recordedTypes);
});

test('the committed fixture export is still the stale 103-event artifact', () => {
    // Tripwire, not convenience: refreshing this evidence is a separate approved task.
    assert.equal(committedExport.events.length, 103);
    assert.notDeepEqual(committedExport.events.map(event => event.type), recordedTypes);
});
