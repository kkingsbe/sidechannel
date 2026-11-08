import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessEvent, MemorySnapshot, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { EventRecorder } from './event-recorder.js';

const fixtureRun = (): Run => createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'recorder-test');

/** Narrow fakes: only the members EventRecorder consumes. */
class RecordingEvents {
    readonly appended: NewEvent[] = [];
    failNext = false;
    async appendEvent(event: NewEvent) {
        if (this.failNext) throw new Error('evidence unavailable');
        const record: HarnessEvent = { ...structuredClone(event), schemaVersion: 1, id: `event-${this.appended.length + 1}`, timestamp: '2026-01-01T00:00:00.000Z', sequence: this.appended.length + 1 };
        this.appended.push(record);
        return record;
    }
    async listEvents() { return structuredClone(this.appended) as unknown as HarnessEvent[]; }
}

class RecordingRunState {
    readonly saves: Run[] = [];
    failSave = false;
    async getRun() { return null; }
    async claimRun() { return false; }
    async requestCancel() { return null; }
    async saveRun(run: Run) { if (this.failSave) throw new Error('run store unavailable'); this.saves.push(structuredClone(run)); }
}

test('emit stamps the current agent, round and turn and honours overrides', async () => {
    const run = fixtureRun();
    run.activeAgentId = 'alpha';
    run.round = 2;
    run.turn = 4;
    const events = new RecordingEvents();
    const recorder = new EventRecorder({ run, runId: run.id, runState: new RecordingRunState(), events });
    await recorder.emit('turn_started', { allowance: 3 });
    await recorder.emit('tool_result', { ok: true }, { operationId: 'op-1', agentId: 'beta' });
    assert.deepEqual(events.appended.map(event => [event.type, event.agentId, event.round, event.turn, event.operationId]),
        [['turn_started', 'alpha', 2, 4, undefined], ['tool_result', 'beta', 2, 4, 'op-1']]);
});

test('an append failure latches evidenceFailed and rethrows, and stays latched', async () => {
    const events = new RecordingEvents();
    events.failNext = true;
    const run = fixtureRun();
    const recorder = new EventRecorder({ run, runId: run.id, runState: new RecordingRunState(), events });
    assert.equal(recorder.evidenceFailed, false);
    await assert.rejects(recorder.emit('turn_started', {}), /evidence unavailable/);
    assert.equal(recorder.evidenceFailed, true);
    await assert.rejects(recorder.emit('run_terminated', {}), /evidence unavailable/);
    assert.equal(events.appended.length, 0);
});

test('persist stamps updatedAt, saves the run and latches on store failure', async () => {
    const run = fixtureRun();
    run.updatedAt = '2000-01-01T00:00:00.000Z';
    const runState = new RecordingRunState();
    const recorder = new EventRecorder({ run, runId: run.id, runState, events: new RecordingEvents() });
    await recorder.persist();
    assert.notEqual(run.updatedAt, '2000-01-01T00:00:00.000Z');
    assert.equal(runState.saves.length, 1);
    assert.equal(runState.saves[0]!.turn, run.turn);
    runState.failSave = true;
    await assert.rejects(recorder.persist(), /run store unavailable/);
    assert.equal(recorder.evidenceFailed, true);
});

test('guard returns the value, latches memory failures and rethrows them', async () => {
    const run = fixtureRun();
    const recorder = new EventRecorder({ run, runId: run.id, runState: new RecordingRunState(), events: new RecordingEvents() });
    const snapshot: MemorySnapshot = { version: 0, notes: '', messages: [] };
    assert.equal(await recorder.guard(async () => snapshot.notes), '');
    await assert.rejects(recorder.guard(async () => { throw new Error('Ambiguous memory write'); }), /Ambiguous memory write/);
    assert.equal(recorder.evidenceFailed, true);
});
