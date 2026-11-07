import assert from 'node:assert/strict';
import test from 'node:test';
import { harnessRepositoryContract } from './contracts/harness-repository.js';
import { analysisRepositoryContract } from './contracts/analysis-repository.js';
import { researchStoreContract } from './contracts/research-store.js';
import { queuedRun } from './contracts/fixtures.js';
import type { DraftStore, EvidenceReader, RunQueries, WorkerSupervisor } from '@sidechannel/contracts/server/contracts';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
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
