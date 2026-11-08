import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { SUMMARY_OMIT } from '@sidechannel/domain/harness/repository';

const uri = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';

const runWithEvidence = () => {
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'summary-' + randomUUID());
    run.board.push({ id: 'post-1', runId: run.id, authorId: 'alpha', sequence: 1, timestamp: '2026-01-01T00:00:00.000Z', text: 'recorded' });
    run.reports.push({ agentId: 'alpha', raw: '{"ownActions":"x"}', parsed: { ownActions: 'x' } });
    return run;
};

/** BSON stores an absent optional field as null, so adapter parity compares field content, not absent-vs-null encoding. */
const encode = (value: unknown): string => JSON.stringify(value, (_key, item) => item === undefined ? null : item);

test('mongo and memory summaries are identical and carry no heavy field', async (t) => {
    const database = 'sidechannel_summary_' + randomUUID().replaceAll('-', '');
    const mongo = await MongoRepository.connect(uri, database);
    const memory = new InMemoryRepository();
    t.after(async () => { await mongo.db.dropDatabase(); await mongo.close(); });
    const run = runWithEvidence();
    await mongo.createRun(run);
    await memory.createRun(run);
    for (const repository of [mongo, memory]) {
        const { items } = await repository.queryRuns({ limit: 10, offset: 0 });
        assert.equal(items.length, 1);
        for (const field of SUMMARY_OMIT) assert.equal(field in items[0]!, false, field);
        assert.equal('assets' in items[0]!.config.scenario, false);
        assert.equal(encode(await repository.getRunSummary(run.id)), encode(await memory.getRunSummary(run.id)));
    }
});
