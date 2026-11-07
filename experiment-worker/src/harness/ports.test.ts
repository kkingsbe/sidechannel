import assert from 'node:assert/strict';
import test from 'node:test';
import type { EventLog, RunQueue, RunStateStore, WorkerGuard } from '@sidechannel/contracts/harness/server';

test('the harness port slices are structurally independent', () => {
    const runState: RunStateStore = { getRun: async () => null, saveRun: async () => {}, claimRun: async () => false, requestCancel: async () => null };
    const events: EventLog = { appendEvent: async event => ({ ...event, schemaVersion: 1, id: '1', timestamp: 'now', sequence: 1 }), listEvents: async () => [] };
    const queue: RunQueue = { createRun: async run => run, createPair: async runs => runs, listRuns: async () => [] };
    const guard: WorkerGuard = { acquireWorker: async () => true, releaseWorker: async () => {} };
    assert.deepEqual(Object.keys(runState).sort(), ['claimRun', 'getRun', 'requestCancel', 'saveRun']);
    assert.deepEqual(Object.keys(events).sort(), ['appendEvent', 'listEvents']);
    assert.deepEqual(Object.keys(queue).sort(), ['createPair', 'createRun', 'listRuns']);
    assert.deepEqual(Object.keys(guard).sort(), ['acquireWorker', 'releaseWorker']);
});
