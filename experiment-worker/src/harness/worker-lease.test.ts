import test from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { acquireWorkerLease, interruptAbandonedRuns, workerLeaseMs, type LeaseStore } from './worker-lease.js';

class FakeStore implements LeaseStore {
    holder: string | null = null;
    heartbeats = 0;
    failHeartbeats = false;
    async acquireWorker(owner: string) { if (this.holder) return false; this.holder = owner; return true; }
    async heartbeatWorker(owner: string) { if (this.failHeartbeats) throw new Error('mongo down'); this.heartbeats++; return this.holder === owner; }
    async releaseWorker(owner: string) { if (this.holder === owner) this.holder = null; }
    async workerLease() { return this.holder ? { owner: this.holder, ageMs: 1_000 } : null; }
}

test('a second worker waits for the lease and takes it once the holder releases', async () => {
    const store = new FakeStore();
    const first = await acquireWorkerLease(store, 'first', { leaseMs: 3_000, onLost: () => assert.fail('first lost') });
    assert.ok(first);
    const logs: string[] = [];
    const second = acquireWorkerLease(store, 'second', { leaseMs: 3_000, pollMs: 20, log: m => logs.push(m), onLost: () => assert.fail('second lost') });
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(store.holder, 'first');
    assert.match(logs[0] ?? '', /held by first/);
    await first.release();
    const lease = await second;
    assert.ok(lease);
    assert.equal(store.holder, 'second');
    await lease.release();
    assert.equal(store.holder, null);
});

test('acquisition gives up when the worker is asked to stop while waiting', async () => {
    const store = new FakeStore();
    store.holder = 'someone';
    let stop = false;
    const pending = acquireWorkerLease(store, 'me', { leaseMs: 3_000, pollMs: 10, log: () => { }, shouldStop: () => stop, onLost: () => assert.fail('not held') });
    stop = true;
    assert.equal(await pending, undefined);
    assert.equal(store.holder, 'someone');
});

test('heartbeats renew the lease and report a takeover as lost', async () => {
    const store = new FakeStore();
    const events = new EventEmitter();
    const lease = await acquireWorkerLease(store, 'me', { leaseMs: 3_000, onLost: reason => events.emit('lost', reason) });
    assert.ok(lease);
    store.holder = 'usurper';
    const [reason] = await once(events, 'lost');
    assert.match(reason, /another worker took over/);
    assert.ok(store.heartbeats >= 1);
    await lease.release();
    assert.equal(store.holder, 'usurper', 'release never deletes another owner\'s lease');
});

test('renewal errors are tolerated until a full lease period has passed', async () => {
    const store = new FakeStore();
    const events = new EventEmitter();
    const started = Date.now();
    const lease = await acquireWorkerLease(store, 'me', { leaseMs: 3_000, onLost: reason => events.emit('lost', reason) });
    assert.ok(lease);
    store.failHeartbeats = true;
    const [reason] = await once(events, 'lost');
    assert.ok(Date.now() - started >= 3_000);
    assert.match(reason, /renewal failed.*mongo down/);
    await lease.release();
});

test('lease duration comes from WORKER_LEASE_MS with a safe minimum', () => {
    assert.equal(workerLeaseMs({}), 30_000);
    assert.equal(workerLeaseMs({ WORKER_LEASE_MS: '45000' }), 45_000);
    assert.throws(() => workerLeaseMs({ WORKER_LEASE_MS: '500' }), /at least 3000/);
    assert.throws(() => workerLeaseMs({ WORKER_LEASE_MS: 'soon' }), /integer/);
});

test('only active runs left by a dead worker are interrupted', async () => {
    const repository = new InMemoryRepository();
    const config = resolveConfiguration(defaultFixtureConfiguration());
    const active = await repository.createRun(createQueuedRun(config, 'active'));
    const queued = await repository.createRun(createQueuedRun(config, 'queued'));
    await repository.saveRun({ ...active, status: 'running' });
    assert.deepEqual(await interruptAbandonedRuns(repository, 'test reason'), [active.id]);
    const after = await repository.getRun(active.id);
    assert.equal(after?.status, 'interrupted');
    assert.equal(after?.failureReason, 'test reason');
    assert.equal((await repository.getRun(queued.id))?.status, 'queued');
    assert.deepEqual((await repository.listEvents(active.id)).map(event => event.type), ['run_interrupted']);
});
