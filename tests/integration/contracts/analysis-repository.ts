import test from 'node:test';
import assert from 'node:assert/strict';
import type { AnalysisAttempt, AnalysisRepository } from '@sidechannel/contracts/analysis/jev-repository';
import { analysisAttempt, analysisJob, analysisWindow } from './fixtures.js';

export interface AnalysisRepositoryHarness {
    name: string;
    fixture(): Promise<{ repository: AnalysisRepository; dispose(): Promise<void> }>;
}

/** Lease liveness is compared against the real clock, so tests must use real timestamps. */
const now = () => new Date().toISOString();

export function analysisRepositoryContract(harness: AnalysisRepositoryHarness): void {
    test(`${harness.name}: unknown analysis reads return null or empty pages`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        assert.equal(await repository.getJob('missing'), null);
        assert.equal(await repository.getWindow('missing', 'window-1'), null);
        assert.deepEqual((await repository.listWindows('missing')).items, []);
        assert.deepEqual(await repository.resultsForWindows('missing', ['window-1']), []);
    });

    test(`${harness.name}: job reservation is idempotent per launch key`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        assert.equal((await repository.reserveJob(analysisJob('job-1'))).created, true);
        assert.equal((await repository.reserveJob(analysisJob('job-1'))).created, false);
        await assert.rejects(repository.reserveJob({ ...analysisJob('job-1'), launchHash: 'other' }), /different configuration/);
    });

    test(`${harness.name}: fenced writes reject stale leases and tolerate missing windows`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        await repository.reserveJob(analysisJob('job-2'));
        await repository.putWindow(analysisWindow('job-2'));
        const claimed = await repository.claim('owner-a', now(), 30_000);
        assert.ok(claimed);
        const lease = claimed!.lease;
        assert.equal(await repository.heartbeat(lease, now(), 30_000), true);
        assert.equal(await repository.heartbeat({ ...lease, fence: lease.fence + 1 }, now(), 30_000), false);
        // A live lease may target a window that is absent: documented no-op, still true.
        assert.equal(await repository.updateWindow(lease, 'missing-window', { status: 'completed' }), true);
        assert.equal(await repository.updateWindow({ ...lease, fence: lease.fence + 1 }, 'window-1', { status: 'completed' }), false);
        assert.equal(await repository.updateWindow(lease, 'window-1', { status: 'running' }), true);
        assert.equal((await repository.getWindow('job-2', 'window-1'))!.status, 'running');
    });

    test(`${harness.name}: attempts enforce the 1 MiB metadata bound on start and finish`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        await repository.reserveJob(analysisJob('job-3'));
        const claimed = await repository.claim('owner-b', now(), 30_000);
        const lease = claimed!.lease;
        const oversized = { ...analysisAttempt('job-3'), usage: { blob: 'x'.repeat(1_048_577) } as unknown as AnalysisAttempt['usage'] };
        await assert.rejects(repository.startAttempt(lease, oversized), /exceeds 1 MiB/);
        await assert.rejects(repository.finishAttempt(lease, oversized, []), /exceeds 1 MiB/);
        const small = analysisAttempt('job-3');
        assert.equal(await repository.startAttempt(lease, small), true);
        assert.equal(await repository.finishAttempt(lease, { ...small, status: 'succeeded' }, [{ id: 'result-1', jobId: 'job-3', windowId: 'window-1', codeId: 'code-1', probability: 0.5, attemptId: small.id, createdAt: now() }]), true);
    });

    test(`${harness.name}: artifacts are immutable and integrity-checked`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        await repository.putArtifact('artifact-1', { value: 1 });
        assert.deepEqual(await repository.readArtifact('artifact-1'), { value: 1 });
        await assert.rejects(repository.putArtifact('artifact-1', { value: 2 }), /immutable/);
        await assert.rejects(repository.readArtifact('artifact-missing'), /not found/i);
    });

    test(`${harness.name}: cancel and retry follow the job state machine`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        await repository.reserveJob(analysisJob('job-4'));
        const cancelled = await repository.cancel('job-4');
        assert.equal(cancelled!.status, 'cancelled');
        assert.equal(cancelled!.cancelRequested, true);
        const retried = await repository.retry('job-4');
        assert.equal(retried!.status, 'queued');
        assert.equal(retried!.cancelRequested, false);
        assert.equal(await repository.cancel('missing'), null);
    });
}
