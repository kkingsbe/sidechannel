import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { MongoRepository } from '@sidechannel/persistence/harness/repository';

test('Mongo worker lease blocks a live holder, expires a dead one and takes over legacy guards', async () => {
    const uri = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';
    const repo = await MongoRepository.connect(uri, 'sidechannel_test_' + randomUUID().replaceAll('-', ''));
    const guard = repo.db.collection('worker_guard');
    try {
        assert.deepEqual(await repo.workerStatus(), { capacity: 1, available: false, status: 'stopped', note: 'No experiment worker holds the lease.' });

        assert.equal(await repo.acquireWorker('first', 1_000), true);
        assert.equal(await repo.acquireWorker('second', 1_000), false, 'a live lease blocks other workers');
        assert.equal((await repo.workerStatus(1_000)).status, 'active');
        assert.equal((await repo.workerLease())?.owner, 'first');

        assert.equal(await repo.heartbeatWorker('second'), false, 'only the holder can renew');
        assert.equal(await repo.heartbeatWorker('first'), true);

        await sleep(1_200);
        assert.equal((await repo.workerStatus(1_000)).available, false);
        assert.equal(await repo.acquireWorker('second', 1_000), true, 'an expired lease is taken over');
        assert.equal(await repo.heartbeatWorker('first'), false, 'the old holder learns it lost the lease');
        await repo.releaseWorker('first');
        assert.equal((await repo.workerLease())?.owner, 'second', 'a stale holder cannot release the new lease');
        assert.equal(await guard.countDocuments(), 1);

        await repo.releaseWorker('second');
        assert.equal(await guard.countDocuments(), 0);

        // Guards written before heartbeats existed (the production failure) are treated as expired.
        await guard.insertOne({ key: 'single-worker', owner: 'legacy', startedAt: '2026-11-07T18:13:01.161Z' });
        assert.equal((await repo.workerLease())?.ageMs, null);
        assert.equal((await repo.workerStatus()).status, 'stale');
        assert.equal(await repo.acquireWorker('fresh'), true);
        assert.equal((await repo.workerLease())?.owner, 'fresh');
        assert.equal(await guard.countDocuments(), 1);
    }
    finally {
        await repo.db.dropDatabase();
        await repo.close();
    }
});
