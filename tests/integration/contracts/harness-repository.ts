import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResearcherRepository } from '@sidechannel/contracts/server/contracts';
import { queuedRun } from './fixtures.js';

export interface RepositoryHarness {
    name: string;
    fixture(): Promise<{ repository: ResearcherRepository; dispose(): Promise<void> }>;
}

export function harnessRepositoryContract(harness: RepositoryHarness): void {
    test(`${harness.name}: unknown runs yield empty evidence, null items and null summaries`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);

        assert.deepEqual(await repository.getEvidencePage('missing', 'board', 0, 10), { items: [], total: 0 });
        assert.equal(await repository.getEvidenceItem('missing', 'board', 'message-1'), null);
        assert.equal(await repository.getRun('missing'), null);
        assert.equal(await repository.getRunSummary('missing'), null);
        assert.deepEqual(await repository.listEvents('missing'), []);
    });

    test(`${harness.name}: duplicate launch returns the original run`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);

        const run = queuedRun('launch');
        const created = await repository.createRun(run);
        assert.equal((await repository.createRun(queuedRun('launch'))).id, created.id);

        const changed = structuredClone(run);
        changed.config.label = 'Different configuration';
        await assert.rejects(repository.createRun(changed), /different launch configuration/);
    });

    test(`${harness.name}: claim is exclusive and visible as running`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        const run = await repository.createRun(queuedRun('claim'));
        assert.deepEqual(await Promise.all([repository.claimRun(run.id, 'one'), repository.claimRun(run.id, 'two')]), [true, false]);
        assert.equal((await repository.getRun(run.id))!.status, 'running');
        assert.equal(await repository.claimRun('missing', 'one'), false);
    });

    test(`${harness.name}: saveRun preserves immutable fields and cancel write-through`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        const run = await repository.createRun(queuedRun('immutable'));
        const stale = (await repository.getRun(run.id))!;
        await repository.requestCancel(run.id);
        stale.config.label = 'illegal change';
        stale.status = 'completed';
        await repository.saveRun(stale);
        const saved = (await repository.getRun(run.id))!;
        assert.equal(saved.config.label, run.config.label);
        assert.equal(saved.cancelRequested, true);
        assert.equal(saved.status, 'stopping');
    });

    test(`${harness.name}: events get monotonic sequences and phase classification is report-first`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        const run = await repository.createRun(queuedRun('events'));
        const turn = await repository.appendEvent({ runId: run.id, type: 'turn_started', data: { phase: 'action' } });
        const report = await repository.appendEvent({ runId: run.id, type: 'report_submitted', data: { phase: 'action' } });
        const board = await repository.appendEvent({ runId: run.id, type: 'board_post', data: {}, agentId: 'alpha' });
        assert.deepEqual([turn.sequence, report.sequence, board.sequence], [1, 2, 3]);
        assert.deepEqual((await repository.queryEvents(run.id, { phase: 'report' })).map(event => event.id), [report.id]);
        assert.deepEqual((await repository.queryEvents(run.id, { phase: 'action' })).map(event => event.id), [turn.id, board.id]);
        assert.deepEqual((await repository.queryEvents(run.id, { actor: 'alpha' })).map(event => event.id), [board.id]);
        assert.deepEqual((await repository.queryEvents(run.id, { type: 'report_submitted' })).map(event => event.id), [report.id]);
        assert.deepEqual((await repository.queryEvents(run.id, { from: 2, to: 2 })).map(event => event.id), [report.id]);
    });

    test(`${harness.name}: drafts use optimistic revisions`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        const first = await repository.saveDraft('draft-1', { label: 'first' });
        assert.equal(first.revision, 1);
        await assert.rejects(repository.saveDraft('draft-1', { label: 'stale' }, 0), /Draft changed/);
        const second = await repository.saveDraft('draft-1', { label: 'second' }, 1);
        assert.equal(second.revision, 2);
        assert.deepEqual((await repository.listDrafts()).map(draft => draft.id), ['draft-1']);
        assert.deepEqual((await repository.getDraft('draft-1'))!.config, { label: 'second' });
    });

    test(`${harness.name}: run queries apply status, designation and queue ordering`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        const later = await repository.createRun(queuedRun('queue-a', { createdAt: '2026-01-01T00:00:00.000Z', pairPosition: 1 }));
        const earlier = await repository.createRun(queuedRun('queue-b', { createdAt: '2026-01-01T00:00:00.000Z', pairPosition: 0 }));
        const queued = await repository.queryRuns({ order: 'queue', limit: 10, offset: 0 });
        assert.deepEqual(queued.items.map(run => run.id), [earlier.id, later.id]);
        assert.equal(queued.total, 2);
        assert.equal((await repository.queryRuns({ status: 'queued', limit: 10, offset: 0 })).total, 2);
        assert.equal((await repository.queryRuns({ status: 'completed', limit: 10, offset: 0 })).total, 0);
        assert.equal((await repository.queryRuns({ designation: 'fixture', limit: 10, offset: 0 })).total, 2);
    });

    test(`${harness.name}: worker status is the documented shape`, async (t) => {
        const { repository, dispose } = await harness.fixture();
        t.after(dispose);
        const status = await repository.workerStatus();
        assert.equal(status.capacity, 1);
        assert.equal(status.available, null);
        assert.ok(status.status === 'registered' || status.status === 'unknown');
        if (status.startedAt !== undefined) assert.equal(typeof status.startedAt, 'string');
    });
}
