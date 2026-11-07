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
}
