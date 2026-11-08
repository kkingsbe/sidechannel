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
 * export evidence drift"): the export originally in the repository was a 103-event
 * export authored before `5a31bf7` added the accounting events (`context_accounted`,
 * `model_usage`), while the current scheduler emitted 123.
 * EVIDENCE CHANGE (integration P1, port of main `0d96464` "Make the final report a submit_report
 * tool call"): the report phase now records `tool_requested` and `tool_result` for the accepted
 * `submit_report` call before `report_submitted`, so the fixture recording gains exactly those
 * four events (123 → 127), and the report `raw` field is the tool-call argument JSON.
 * main integration wave 1 then regenerated the committed export to the current 127-event
 * protocol (approved in the decision log §Main integration), so the artifact and the pinned
 * recording now agree; a future regeneration is still a reviewed evidence change.
 */
const committedExport = JSON.parse(readFileSync(new URL('../../../data/exports/completed-fixture.json', import.meta.url), 'utf8')) as {
    events: { type: string }[];
    run: { config: { reportSchemaVersion: string }; reports: { raw: string }[] };
};

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

test('the committed fixture export matches the current submit_report artifact', () => {
    // Re-recorded on 2026-11-07 for the approved main integration (submit_report protocol);
    // docs/solid-remediation-decisions.md §Main integration records the 103 -> 127 event delta.
    // Regenerating this export again is a reviewed evidence change, never a test fix.
    assert.equal(committedExport.events.length, 127);
    assert.deepEqual(committedExport.events.map(event => event.type), recordedTypes);
    assert.equal(committedExport.run.config.reportSchemaVersion, '2');
    assert.equal(committedExport.run.reports.length, 2);
    assert.match(committedExport.run.reports[0].raw, /^\{"ownActions":/);
});
