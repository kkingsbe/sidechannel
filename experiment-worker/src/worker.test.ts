import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { MemorySnapshot, Run } from '@sidechannel/contracts/harness/contracts';
import type { ModelInput, PrivateMemory } from '@sidechannel/contracts/harness/server';
import { runWorker, type WorkerDeps } from './worker.js';
import { HarnessScheduler } from './harness/scheduler.js';
import { ScriptedAdapter, fixtureScript } from './harness/scripted-adapter.js';
import { workerConcurrency } from './harness/worker-lease.js';

class TestMemory implements PrivateMemory {
    values = new Map<string, MemorySnapshot>();
    async load(r: string, a: string) { return structuredClone(this.values.get(`${r}/${a}`) ?? { version: 0, notes: '', messages: [] }); }
    async save(r: string, a: string, s: MemorySnapshot) { this.values.set(`${r}/${a}`, structuredClone(s)); }
}

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (!await condition()) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
        await sleep(5);
    }
}

/** Queued fixture runs, created one millisecond apart so queue order is unambiguous. */
async function queue(repo: InMemoryRepository, count: number, label = 'lane') {
    const runs: Run[] = [];
    for (let index = 0; index < count; index++) {
        const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), `${label}-${index}`);
        run.createdAt = new Date(Date.UTC(2026, 10, 7, 12, 0, 0, index)).toISOString();
        runs.push(await repo.createRun(run));
    }
    return runs;
}

const deps = (repo: InMemoryRepository, scheduler: WorkerDeps['scheduler']): WorkerDeps => ({
    queue: repo, guard: repo, runState: repo, events: repo, scheduler, flush: async () => { }, close: async () => { },
});

test('WORKER_CONCURRENCY defaults to four lanes and rejects values outside 1-16', () => {
    assert.equal(workerConcurrency({}), 4);
    assert.equal(workerConcurrency({ WORKER_CONCURRENCY: '1' }), 1);
    assert.equal(workerConcurrency({ WORKER_CONCURRENCY: '16' }), 16);
    for (const bad of ['0', '17', '2.5', 'four', '-1'])
        assert.throws(() => workerConcurrency({ WORKER_CONCURRENCY: bad }), /WORKER_CONCURRENCY/);
});

test('the worker fills every lane in queue order, never exceeds its lanes and records them on the lease', async () => {
    const repo = new InMemoryRepository();
    const runs = await queue(repo, 6);
    const started: string[] = [];
    const release = new Map<string, () => void>();
    let inFlight = 0, peak = 0;
    const scheduler = () => ({
        async run(id: string) {
            assert.ok(await repo.claimRun(id, 'test'));
            started.push(id);
            peak = Math.max(peak, ++inFlight);
            await new Promise<void>(resolve => release.set(id, resolve));
            inFlight--;
            const run = (await repo.getRun(id))!;
            run.status = 'completed';
            await repo.saveRun(run);
            return run;
        },
    });
    const stop = new AbortController();
    const worker = runWorker(deps(repo, scheduler), { owner: 'lanes', leaseMs: 30_000, concurrency: 4, signal: stop.signal });
    await until(() => started.length === 4);
    await sleep(600); // more than one poll: no fifth run starts while four lanes are busy
    assert.deepEqual(started, runs.slice(0, 4).map(run => run.id), 'the oldest four start first');
    assert.equal((await repo.workerStatus()).capacity, 4);
    release.get(runs[1]!.id)!();
    await until(() => started.length === 5);
    assert.equal(started[4], runs[4]!.id, 'a freed lane takes the next queued run');
    for (const id of started) release.get(id)?.();
    await until(() => started.length === 6);
    release.get(runs[5]!.id)!();
    await until(async () => (await repo.listRuns()).every(run => run.status === 'completed'));
    stop.abort();
    await worker;
    assert.equal(peak, 4);
    assert.equal(await repo.workerLease(), null, 'stopping releases the lease');
});

test('stopping cancels every active lane and waits for each run to finish cancelling', async () => {
    const repo = new InMemoryRepository();
    await queue(repo, 3);
    const scheduler = () => ({
        async run(id: string) {
            await repo.claimRun(id, 'test');
            await until(async () => Boolean((await repo.getRun(id))?.cancelRequested));
            await sleep(20);
            const run = (await repo.getRun(id))!;
            run.status = 'cancelled';
            await repo.saveRun(run);
            return run;
        },
    });
    const stop = new AbortController();
    const worker = runWorker(deps(repo, scheduler), { owner: 'stopper', leaseMs: 30_000, concurrency: 4, signal: stop.signal });
    await until(async () => (await repo.listRuns()).every(run => run.status === 'running'));
    stop.abort();
    await worker;
    const finished = await repo.listRuns();
    assert.deepEqual(finished.map(run => run.status), ['cancelled', 'cancelled', 'cancelled'], 'the worker returned only after every lane reached a terminal state');
});

/** Everything a run's evidence says, minus identities and clock readings. */
async function evidence(repo: InMemoryRepository, memory: TestMemory, run: Run) {
    const saved = (await repo.getRun(run.id))!;
    const events = await repo.listEvents(run.id);
    return {
        status: saved.status,
        board: saved.board.map(({ authorId, sequence, text }) => ({ authorId, sequence, text })),
        artifacts: saved.artifacts.map(({ version, authorId, value, frozen }) => ({ version, authorId, value, frozen })),
        reports: saved.reports.map(report => ({ agentId: report.agentId, parsed: report.parsed })),
        events: events.map(event => [event.sequence, event.type, event.agentId ?? null, event.round ?? null, event.turn ?? null]),
        memory: saved.config.roles.map(role => memory.values.get(`${run.id}/${role.id}`)?.notes ?? null),
        foreign: { board: saved.board.filter(message => message.runId !== run.id).length, events: events.filter(event => event.runId !== run.id).length },
    };
}

async function executeFixtures(concurrency: number) {
    const repo = new InMemoryRepository();
    const memory = new TestMemory();
    const runs = await queue(repo, 4, `isolation-${concurrency}`);
    let inFlight = 0, peak = 0;
    // Random delays interleave the lanes' model calls, board posts and memory writes.
    const adapter = new ScriptedAdapter(async (input: ModelInput) => {
        peak = Math.max(peak, ++inFlight);
        await sleep(Math.floor(Math.random() * 4));
        inFlight--;
        return fixtureScript(input);
    });
    const scheduler = () => new HarnessScheduler({ runState: repo, events: repo, memory, adapter });
    const stop = new AbortController();
    const worker = runWorker(deps(repo, scheduler), { owner: `isolation-${concurrency}`, leaseMs: 30_000, concurrency, signal: stop.signal });
    await until(async () => (await repo.listRuns()).every(run => run.status === 'completed' || run.status === 'failed'), 30_000);
    stop.abort();
    await worker;
    return { results: await Promise.all(runs.map(run => evidence(repo, memory, run))), peak };
}

test('runs executed in parallel lanes record exactly the evidence they record one at a time', async () => {
    const serial = await executeFixtures(1);
    const parallel = await executeFixtures(4);
    assert.equal(serial.peak, 1);
    assert.ok(parallel.peak > 1, 'lanes actually overlapped');
    for (const result of [...serial.results, ...parallel.results]) {
        assert.equal(result.status, 'completed');
        assert.ok(result.board.length > 0 && result.artifacts.length > 1 && result.reports.length === 2, 'the fixture produced evidence to compare');
        assert.deepEqual(result.foreign, { board: 0, events: 0 }, 'no board message or event crosses runs');
    }
    assert.deepEqual(parallel.results, serial.results);
});
