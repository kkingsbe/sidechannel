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
