import test from 'node:test';
import assert from 'node:assert/strict';
import type { Codebook, CodebookRevision } from '@sidechannel/contracts/analysis/evidence-contracts';
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

    test(`${harness.name}: codebook archive filter and write guard`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        const book = (id: string): Codebook => ({ id, name: id, currentRevisionId: `${id}-r1`, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
        const revision = (id: string): CodebookRevision => ({ id: `${id}-r1`, codebookId: id, revision: 1, definitions: [], createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'tester' });
        await repository.saveCodebook(book('one'), revision('one'));
        await repository.saveCodebook(book('two'), revision('two'));

        assert.deepEqual((await repository.listCodebooks()).items.map(codebook => codebook.id), ['one', 'two']);
        assert.deepEqual((await repository.listCodebooks(undefined, { archived: 'include' })).items.map(codebook => codebook.id), ['one', 'two']);
        assert.deepEqual((await repository.listCodebooks(undefined, { archived: 'only' })).items, []);

        await assert.rejects(repository.setCodebookArchived('missing', 'missing-r1', { archivedAt: now(), archivedBy: 'tester' }), /not found/);
        await assert.rejects(repository.setCodebookArchived('one', 'stale-r0', { archivedAt: now(), archivedBy: 'tester' }), /revision changed/);

        const archive = { archivedAt: '2026-01-02T00:00:00.000Z', archivedBy: 'tester' };
        const archived = await repository.setCodebookArchived('one', 'one-r1', archive);
        assert.equal(archived.archivedAt, archive.archivedAt);
        assert.equal(archived.archivedBy, 'tester');
        assert.deepEqual((await repository.listCodebooks()).items.map(codebook => codebook.id), ['two'], 'the default filter excludes archived codebooks');
        assert.deepEqual((await repository.listCodebooks(undefined, { archived: 'only' })).items.map(codebook => codebook.id), ['one']);
        assert.deepEqual((await repository.listCodebooks(undefined, { archived: 'include' })).items.map(codebook => codebook.id), ['one', 'two']);

        await assert.rejects(repository.setCodebookArchived('one', 'one-r1', archive), /revision changed/, 'an already archived codebook cannot be archived again');
        await assert.rejects(repository.saveCodebook({ ...book('one'), updatedAt: now() }, { ...revision('one-r2'), codebookId: 'one', revision: 2 }, 'one-r1'), /revision changed/, 'an archived codebook accepts no new revision');

        const restored = await repository.setCodebookArchived('one', 'one-r1', null);
        assert.equal(restored.archivedAt, undefined);
        assert.equal(restored.archivedBy, undefined);
        assert.deepEqual((await repository.listCodebooks()).items.map(codebook => codebook.id), ['one', 'two']);
    });
}
