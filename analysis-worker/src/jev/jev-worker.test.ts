import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { emptyCounters } from '@sidechannel/domain/analysis/jev-repository';
import type { AnalysisAttempt, AnalysisResult, JobCounters, WindowRecord } from '@sidechannel/contracts/analysis/jev-repository';
import { AnalysisWorker } from './jev-worker.js';
import { LeaseKeeper } from './lease-keeper.js';
import { ProgressLedger, type ProgressPorts } from './progress-ledger.js';

const window = (id: string, status: WindowRecord['status']): WindowRecord => ({
    id, index: Number(id.slice(1)), startOrdinal: 0, endOrdinal: 0, stepIds: [], eventIds: [], partial: false, incomplete: false,
    jobId: 'job', ordinal: Number(id.slice(1)), status, inputRef: `input-${id}`, inputHash: 'hash', inputBytes: 1, estimatedTokens: 1,
    diagnostics: [], batches: [],
});

/** A ledger over stored state only: windows/results/attempts are the inputs `pages()` walks. */
function ledger(windows: WindowRecord[], options: { results?: AnalysisResult[]; attempts?: AnalysisAttempt[]; latest?: WindowRecord } = {}) {
    let updated: JobCounters | undefined;
    const port: ProgressPorts = {
        async updateCounters(_lease, counters) { updated = counters; return true; },
        async getWindow(jobId, windowId) { const found = options.latest; return found && found.jobId === jobId && found.id === windowId ? found : null; },
        async listWindows() { return { items: windows, nextCursor: null }; },
        async listResults(_jobId, page) { return { items: (options.results ?? []).filter(result => !page?.windowId || result.windowId === page.windowId), nextCursor: null }; },
        async listAttempts(_jobId, page) { return { items: (options.attempts ?? []).filter(attempt => !page?.windowId || attempt.windowId === page.windowId), nextCursor: null }; },
        async finishAttempt() { return true; },
    };
    return { ledger: new ProgressLedger(port), updated: () => updated };
}

test('counters count oversized windows as skipped and exclude them from expected answers', async () => {
    const { ledger: progress } = ledger([window('w1', 'completed'), window('w2', 'oversized'), window('w3', 'skipped'), window('w4', 'failed')]);
    assert.deepEqual(await progress.counters('job', 2), {
        preparedWindows: 4, submittedWindows: 0, finishedWindows: 1, failedWindows: 1, skippedWindows: 2, returnedAnswers: 0, expectedAnswers: 4,
    });
});

test('settling a window that became oversized swaps a failed delta for a skipped delta', async () => {
    const prior = window('w1', 'failed');
    const { ledger: progress, updated } = ledger([], { latest: window('w1', 'oversized') });
    const counters = { ...emptyCounters(), failedWindows: 1 };
    await progress.settle({ jobId: 'job', owner: 'owner', fence: 1 }, 'job', prior, counters, { answers: 0, submitted: false });
    assert.equal(counters.failedWindows, 0);
    assert.equal(counters.skippedWindows, 1);
    assert.equal(updated()!.skippedWindows, 1);
});

test('a job that scored nothing only because every window was oversized still fails', async () => {
    const { ledger: progress } = ledger([window('w1', 'oversized')]);
    assert.equal(await progress.finalStatus('job', emptyCounters(), false), 'failed');
    assert.equal(await progress.finalStatus('job', emptyCounters(), true), 'cancelled');
});

test('oversized windows do not stop a fully scored remainder from completing', async () => {
    const { ledger: progress } = ledger([window('w1', 'completed'), window('w2', 'oversized')]);
    const counters = { ...emptyCounters(), preparedWindows: 2, submittedWindows: 1, finishedWindows: 1, skippedWindows: 1, returnedAnswers: 2, expectedAnswers: 2 };
    assert.equal(await progress.finalStatus('job', counters, false), 'completed');
});


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
