import assert from 'node:assert/strict';
import test from 'node:test';
import { harnessRepositoryContract } from './contracts/harness-repository.js';
import { analysisRepositoryContract } from './contracts/analysis-repository.js';
import { researchStoreContract } from './contracts/research-store.js';
import { blobStoreContract } from './contracts/blob-store.js';
import { assertTypedStores } from './contracts/typed-store.js';
import { queuedRun, analysisJob } from './contracts/fixtures.js';
import type { AnalysisWorkerStore } from '@sidechannel/contracts/analysis/jev-repository';
import type { DraftStore, EvidenceReader, RunQueries, WorkerSupervisor } from '@sidechannel/contracts/server/contracts';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { MemoryReviewStore } from '@sidechannel/persistence/analysis/review-repository';
import { InMemoryResearchStore } from '@sidechannel/persistence/analysis/store';

harnessRepositoryContract({
    name: 'memory',
    fixture: async () => ({ repository: new InMemoryRepository(), dispose: async () => {} }),
});

analysisRepositoryContract({
    name: 'memory',
    fixture: async () => ({ repository: new InMemoryAnalysisRepository(), dispose: async () => {} }),
});

researchStoreContract({
    name: 'memory',
    fixture: async () => ({ store: new InMemoryResearchStore(), dispose: async () => {} }),
});

blobStoreContract({
    name: 'memory',
    fixture: async () => ({ store: new InMemoryResearchStore(), dispose: async () => {} }),
});

test('researcher capability slices are satisfied by one adapter instance independently', async () => {
    const repository = new InMemoryRepository();
    const run = await repository.createRun(queuedRun('slices'));
    const queries: Pick<RunQueries, 'getRunSummary'> = repository;
    const drafts: Pick<DraftStore, 'getDraft'> = repository;
    const evidence: Pick<EvidenceReader, 'getEvidencePage' | 'queryEvents'> = repository;
    const supervisor: Pick<WorkerSupervisor, 'workerStatus'> = repository;
    assert.equal((await queries.getRunSummary(run.id))!.id, run.id);
    assert.equal(await drafts.getDraft('missing'), null);
    assert.deepEqual(await evidence.getEvidencePage(run.id, 'board', 0, 10), { items: [], total: 0 });
    assert.deepEqual(await evidence.queryEvents(run.id, {}), []);
    assert.equal((await supervisor.workerStatus()).capacity, 1);
});

test('the analysis worker port does not require codebook operations', async () => {
    const repository = new InMemoryAnalysisRepository();
    // Compile-time proof: a worker-shaped store is assembled from four slices only.
    const workerStore: AnalysisWorkerStore = {
        reserveJob: repository.reserveJob.bind(repository), getJob: repository.getJob.bind(repository),
        listJobs: repository.listJobs.bind(repository), listAllJobs: repository.listAllJobs.bind(repository),
        claim: repository.claim.bind(repository), heartbeat: repository.heartbeat.bind(repository),
        updateCounters: repository.updateCounters.bind(repository), finishJob: repository.finishJob.bind(repository),
        cancel: repository.cancel.bind(repository), retry: repository.retry.bind(repository),
        putWindow: repository.putWindow.bind(repository), getWindow: repository.getWindow.bind(repository),
        listWindows: repository.listWindows.bind(repository), updateWindow: repository.updateWindow.bind(repository),
        putArtifact: repository.putArtifact.bind(repository), readArtifact: repository.readArtifact.bind(repository),
        artifactChunks: repository.artifactChunks.bind(repository),
        startAttempt: repository.startAttempt.bind(repository), finishAttempt: repository.finishAttempt.bind(repository),
        listResults: repository.listResults.bind(repository), resultsForWindows: repository.resultsForWindows.bind(repository),
        listAttempts: repository.listAttempts.bind(repository),
    };
    await repository.reserveJob(analysisJob('slice-job'));
    assert.equal((await workerStore.getJob('slice-job'))!.id, 'slice-job');
    assert.ok(!('readyJob' in workerStore));
});

test('memory stores are usable through the typed ports', async () => {
    await assertTypedStores(new InMemoryResearchStore(), new MemoryReviewStore());
});
