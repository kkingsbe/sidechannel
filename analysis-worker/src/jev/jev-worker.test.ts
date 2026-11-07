import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { AnalysisWorker } from './jev-worker.js';
import { LeaseKeeper } from './lease-keeper.js';

test('the lease keeper reports a lost lease and stops scheduling', async () => {
    const keeper = new LeaseKeeper(
        { async heartbeat() { return false; }, async getJob() { return null; } },
        { jobId: 'job-1', owner: 'owner', fence: 1 },
        { id: 'job-1', cancelRequested: false },
        { leaseMs: 30, heartbeatMs: 10 });
    keeper.start();
    await keeper.beat();
    keeper.stop();
    assert.equal(keeper.leaseLost, true);
    assert.equal(keeper.stopping, true);
});

test('the lease keeper aborts registered controllers when a beat observes cancellation', async () => {
    const keeper = new LeaseKeeper(
        { async heartbeat() { return true; }, async getJob() { return { id: 'job-1', cancelRequested: true }; } },
        { jobId: 'job-1', owner: 'owner', fence: 1 },
        { id: 'job-1', cancelRequested: false },
        { leaseMs: 30, heartbeatMs: 10 });
    const controller = new AbortController();
    keeper.register(controller);
    await keeper.beat();
    assert.equal(controller.signal.aborted, true);
    assert.equal(keeper.cancelling, true);
});

test('an empty queue leaves the worker idle', async () => {
    assert.equal(await new AnalysisWorker(new InMemoryAnalysisRepository()).runOnce(), false);
});
