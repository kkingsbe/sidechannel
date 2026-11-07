import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration, resolveConfiguration, resolvePair } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';

test('Mongo researcher revisions, launch conflicts, atomic matched pairs and filtered projections', async () => {
    const database = 'sidechannel_researcher_test_' + randomUUID().replaceAll('-', '');
    const repository = await MongoRepository.connect(process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0', database);
    try {
        await repository.saveDraft('draft', { label: 'invalid draft' }, undefined, { notes: 'preserve' });
        const writes = await Promise.allSettled([repository.saveDraft('draft', {}, 1), repository.saveDraft('draft', { label: 'other' }, 1)]);
        assert.equal(writes.filter(write => write.status === 'fulfilled').length, 1);
        assert.equal((await repository.getDraft('draft'))!.revision, 2);
        assert.equal((await repository.getDraft('draft'))!.notes, 'preserve');
        const config = resolveConfiguration(defaultFixtureConfiguration());
        const launch = () => repository.createRun(createQueuedRun(config, 'same-key'));
        const [first, repeated] = await Promise.all([launch(), launch()]);
        assert.equal(first.id, repeated.id);
        await assert.rejects(repository.createRun(createQueuedRun({ ...config, label: 'changed' }, 'same-key')), /Idempotency/);
        const pair = () => resolvePair(config).map((configuration, pairPosition) => ({ ...createQueuedRun(configuration, `pair-key:${pairPosition}`, 'paired'), pairingSeed: 7, pairPosition }));
        const [one, two] = await Promise.all([repository.createPair(pair()), repository.createPair(pair())]);
        assert.deepEqual(one.map(run => run.id), two.map(run => run.id));
        const mismatched = pair(); mismatched[0]!.config.scheduler.rounds = 99;
        await assert.rejects(repository.createPair(mismatched), /differ outside condition/);
        assert.equal((await repository.listRuns()).length, 3);
        await repository.appendEvent({ runId: first.id, type: 'model_response', invocationId: `${first.id}:report:alpha`, data: {}, agentId: 'alpha' });
        await repository.appendEvent({ runId: first.id, type: 'tool_result', invocationId: `${first.id}:turn:1:step:0`, data: {}, agentId: 'beta' });
        assert.equal((await repository.queryEvents(first.id, { phase: 'report' })).length, 1);
        assert.equal((await repository.queryEvents(first.id, { phase: 'action', actor: 'beta' })).length, 1);
        const listing = await repository.queryRuns({ designation: 'fixture', condition: 'reviewed', offset: 0, limit: 1 });
        assert.equal(listing.total, 2); assert.equal(listing.items.length, 1);
        assert.equal('artifacts' in listing.items[0]!, false);
        assert.equal('assets' in listing.items[0]!.config.scenario, false);
        const artifact = await repository.getEvidencePage(first.id, 'artifacts', 0, 1);
        assert.equal(artifact.total, 1); assert.equal(artifact.items.length, 1);
        assert.equal((await repository.getEvidenceItem(first.id, 'artifacts', '0') as { version: number }).version, 0);
        assert.equal(await repository.getEvidenceItem(first.id, 'artifacts', '100'), null);
        const reports = await repository.getEvidencePage(first.id, 'reports', 0, 1);
        assert.equal(reports.reporting!.instructions, config.reportInstructions);
    } finally { await repository.db.dropDatabase(); await repository.close(); }
});