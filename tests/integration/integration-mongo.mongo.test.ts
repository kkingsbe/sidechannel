import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { MongoRepository } from '@sidechannel/persistence/harness/repository';
import { createMongoMemory } from '../../experiment-worker/src/harness/mastra-adapter.js';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { HarnessScheduler } from '../../experiment-worker/src/harness/scheduler.js';
import { fixtureScript, ScriptedAdapter } from '../../experiment-worker/src/harness/scripted-adapter.js';
import { createResearcherServer } from '../../api/src/server/index.js';

test('Mongo-backed API launch survives dashboard disconnect, exports six turns and isolated Mastra memory', async () => {
    const uri = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';
    const dbName = 'sidechannel_test_' + randomUUID().replaceAll('-', '');
    const repo = await MongoRepository.connect(uri, dbName);
    const memory = createMongoMemory(uri, dbName + '_mastra');
    let server = createResearcherServer(repo);
    async function start() { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; }
    async function close() { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    try {
        let base = await start();
        const config = resolveConfiguration(defaultFixtureConfiguration());
        const payload = { config, idempotencyKey: 'mongo-launch' };
        const launch = () => fetch(base + '/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json());
        const [first, duplicate] = await Promise.all([launch(), launch()]);
        assert.equal(first.id, duplicate.id);
        assert.equal(first.status, 'queued');
        assert.equal(await repo.acquireWorker('first'), true);
        assert.equal(await repo.acquireWorker('second'), false);
        await close();
        const result = await new HarnessScheduler({ runState: repo, events: repo, memory, adapter: new ScriptedAdapter(fixtureScript) }).run(first.id);
        assert.equal(result.status, 'completed', result.failureReason ?? 'fixture must complete');
        assert.equal(result.turn, 6);
        assert.equal(result.artifacts.at(-1)?.frozen, true);
        assert.equal((result.artifacts.at(-1)?.value as unknown[]).length, 2);
        assert.equal(result.reports.length, 2);
        assert.ok(result.reports.every(report => report.parsed));
        server = createResearcherServer(repo);
        base = await start();
        const exported = await fetch(base + `/api/runs/${first.id}/export`).then(r => r.json());
        assert.equal(exported.run.status, 'completed');
        assert.equal(exported.events.filter((e: any) => e.type === 'turn_started').length, 6);
        assert.ok(exported.events.some((e: any) => e.type === 'memory_updated'));
        assert.ok(exported.events.some((e: any) => e.type === 'board_delivery'));
        assert.ok(exported.events.every((event: any, index: number) => event.sequence === index + 1));
        const reconnect = createMongoMemory(uri, dbName + '_mastra');
        try {
            assert.ok((await reconnect.load(first.id, 'alpha')).messages.length > 0);
            assert.equal((await reconnect.load('fresh-run', 'alpha')).messages.length, 0);
            assert.equal((await reconnect.load(first.id, 'other-role')).messages.length, 0);
        }
        finally {
            await reconnect.storage.close();
        }
        const pairPayload = { config, idempotencyKey: 'pair-launch', pairingSeed: 99 };
        const pairs = await Promise.all([0, 1].map(() => fetch(base + '/api/pairs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pairPayload) }).then(r => r.json())));
        assert.deepEqual(pairs[0].map((r: any) => r.id), pairs[1].map((r: any) => r.id));
        assert.equal(pairs[0].length, 2);
        assert.notEqual(pairs[0][0].config.condition.id, pairs[0][1].config.condition.id);
        assert.deepEqual(pairs[0][0].config.scheduler.order, pairs[0][1].config.scheduler.order);
        const pending = pairs[0][0];
        await repo.claimRun(pending.id, 'test');
        const stale = (await repo.getRun(pending.id))!;
        await repo.requestCancel(pending.id);
        stale.status = 'completed';
        stale.config.label = 'illegal';
        await repo.saveRun(stale);
        const cancelled = (await repo.getRun(pending.id))!;
        assert.equal(cancelled.status, 'stopping');
        assert.equal(cancelled.cancelRequested, true);
        assert.equal(cancelled.config.label, config.label);
    }
    finally {
        if (server.listening)
            await close();
        await memory.storage.close();
        // Only these randomly named databases, created by this test, are removed.
        await repo.client.db(dbName + '_mastra').dropDatabase();
        await repo.db.dropDatabase();
        await repo.close();
    }
});