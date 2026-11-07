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
