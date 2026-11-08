import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { MongoMastraRunPurger } from '@sidechannel/persistence/harness/mastra-purge';
import { MongoHealthcareCatalog } from '@sidechannel/persistence/healthcare/catalog';
import { MongoResearchStore } from '@sidechannel/persistence/analysis/store';
import { healthcareRunPurger, createRunDependencyReader, RunLifecycleService } from '@sidechannel/domain/harness/run-lifecycle';
import { RunHasDependents } from '@sidechannel/contracts/harness/run-lifecycle';
import { queuedRun } from './contracts/fixtures.js';

const uri = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';
const database = () => 'sidechannel_lifecycle_' + randomUUID().replaceAll('-', '');
const thread = (runId: string, agentId: string) => 'experiment-thread:' + JSON.stringify([runId, agentId]);
const resource = (runId: string, agentId: string) => 'experiment-resource:' + JSON.stringify([runId, agentId]);
const agent = (runId: string, agentId: string) => 'experiment-' + JSON.stringify([runId, agentId]);

test('mongo: deleting a run cascades through harness, healthcare and Mastra storage and leaves other runs alone', async t => {
    const repository = await MongoRepository.connect(uri, database());
    const mastra = repository.client.db(database());
    t.after(async () => { await repository.db.dropDatabase(); await mastra.dropDatabase(); await repository.close(); });
    const catalog = new MongoHealthcareCatalog(repository.client, repository.db);
    await catalog.initialize();
    const research = new MongoResearchStore(repository.db);
    await research.initialize();

    const doomed = await repository.createRun(queuedRun('cascade-doomed'));
    // A run whose ID is a prefix-lookalike must not lose its rows.
    const sibling = await repository.createRun(queuedRun('cascade-sibling'));
    for (const run of [doomed, sibling]) {
        await repository.appendEvent({ runId: run.id, type: 'step', data: {} });
        await repository.saveRun({ ...(await repository.getRun(run.id))!, operations: { op: { fingerprint: 'f', result: null } } });
        await repository.db.collection('healthcare_evaluator_references').insertOne({ runId: run.id });
        await repository.db.collection('healthcare_evaluations').insertOne({ runId: run.id, artifactVersion: 1, evaluatorVersion: 'v' });
        for (const agentId of ['alpha', 'beta']) {
            await mastra.collection('mastra_threads').insertOne({ id: thread(run.id, agentId), resourceId: resource(run.id, agentId) });
            await mastra.collection('mastra_messages').insertOne({ id: thread(run.id, agentId) + ':message:0', thread_id: thread(run.id, agentId) });
            await mastra.collection('mastra_ai_spans').insertOne({ traceId: randomUUID(), spanId: randomUUID(), rootEntityId: agent(run.id, agentId) });
        }
    }
    await repository.db.collection('mastra_threads_unrelated').insertOne({ id: 'x' });
    await repository.requestCancel(doomed.id);
    await repository.requestCancel(sibling.id);
    assert.equal(await repository.db.collection('operations').countDocuments({ runId: doomed.id }), 1);
    assert.equal(await repository.db.collection('counters').countDocuments({ runId: doomed.id }), 1);

    const service = new RunLifecycleService({ runs: repository, dependencies: createRunDependencyReader({ research }), purgers: [healthcareRunPurger(catalog), new MongoMastraRunPurger(mastra)] });
    const outcome = await service.delete(doomed.id);
    assert.deepEqual(outcome.purged, { healthcare_evaluator_references: 1, healthcare_evaluations: 1, mastra_threads: 2, mastra_messages: 2, mastra_resources: 0, mastra_ai_spans: 2 });

    const gone = { runId: doomed.id };
    for (const collection of ['events', 'counters', 'operations', 'healthcare_evaluator_references', 'healthcare_evaluations'])
        assert.equal(await repository.db.collection(collection).countDocuments(gone), 0, collection);
    assert.equal(await repository.getRunByLaunchKey('cascade-doomed'), null);
    for (const collection of ['mastra_threads', 'mastra_messages', 'mastra_ai_spans'])
        assert.equal(await mastra.collection(collection).countDocuments({}), 2, collection + ' keeps only the sibling run');
    for (const collection of ['events', 'counters', 'operations', 'healthcare_evaluator_references', 'healthcare_evaluations'])
        assert.equal(await repository.db.collection(collection).countDocuments({ runId: sibling.id }), 1, collection + ' sibling');
    assert.equal(await repository.db.collection('mastra_threads_unrelated').countDocuments({}), 1);
    assert.equal((await repository.createRun(queuedRun('cascade-doomed'))).status, 'queued');
});

test('mongo: a run cited by a monitor evaluation is refused before anything is purged', async t => {
    const repository = await MongoRepository.connect(uri, database());
    const mastra = repository.client.db(database());
    t.after(async () => { await repository.db.dropDatabase(); await mastra.dropDatabase(); await repository.close(); });
    const research = new MongoResearchStore(repository.db);
    await research.initialize();
    const run = await repository.createRun(queuedRun('cited'));
    await repository.requestCancel(run.id);
    await mastra.collection('mastra_threads').insertOne({ id: thread(run.id, 'alpha') });
    await research.insert('monitor_evaluations', { id: 'evaluation-1', revision: 1, createdAt: 'now', runIds: [run.id] } as never);

    const service = new RunLifecycleService({ runs: repository, dependencies: createRunDependencyReader({ research }), purgers: [new MongoMastraRunPurger(mastra)] });
    await assert.rejects(service.delete(run.id), (error: unknown) => error instanceof RunHasDependents && error.dependents.monitorEvaluations[0] === 'evaluation-1');
    assert.ok(await repository.getRun(run.id));
    assert.equal(await mastra.collection('mastra_threads').countDocuments({}), 1);
});
