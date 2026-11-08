import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createResearcherServer } from '../api/dist/server/index.js';
import { HarnessScheduler } from '../experiment-worker/dist/harness/scheduler.js';
import { ScriptedAdapter, fixtureScript } from '../experiment-worker/dist/harness/scripted-adapter.js';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { buildMetadata } from '@sidechannel/domain/harness/provenance';

// Exercise emitted ESM without tsx, credentials, a database, or live inference.
const repository = new InMemoryRepository();
const metadata = await buildMetadata();
assert.match(metadata.revision, /^source-sha256:[a-f0-9]{64}$/);
const server = createResearcherServer(repository, {
    buildMetadata: metadata,
    dashboardDirectory: fileURLToPath(new URL('../dashboard/dist', import.meta.url)),
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const memoryRows = new Map();
const memory = {
    async load(runId, agentId) { return structuredClone(memoryRows.get(`${runId}:${agentId}`) ?? { version: 0, notes: '', messages: [] }); },
    async save(runId, agentId, value) { memoryRows.set(`${runId}:${agentId}`, structuredClone(value)); },
};
try {
    const body = { config: defaultFixtureConfiguration(), idempotencyKey: 'compiled-fixture', pairingSeed: 42 };
    const submit = () => fetch(base + '/api/pairs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const response = await submit();
    assert.equal(response.status, 202, await response.clone().text());
    const pair = await response.json();
    const repeated = await (await submit()).json();
    assert.deepEqual(pair.map(run => run.id), repeated.map(run => run.id));
    for (const run of pair) {
        const completed = await new HarnessScheduler({ runState: repository, events: repository, memory, adapter: new ScriptedAdapter(fixtureScript) }).run(run.id);
        assert.equal(completed.status, 'completed', completed.failureReason);
        assert.equal(completed.reports.length, 2);
        assert.equal(completed.config.build.revision, metadata.revision);
        const exported = await (await fetch(`${base}/api/runs/${run.id}/export`)).json();
        assert.equal(exported.scope, 'complete-source-evidence');
        assert.ok(exported.events.length > 0);
    }
    const index = await (await fetch(base + '/')).text();
    assert.match(index, /id="root"/);
    assert.equal(await (await fetch(base + '/oversight')).text(), index);
    const asset = index.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(asset);
    assert.equal((await fetch(new URL(asset, base))).status, 200);
    console.log('Compiled ESM smoke passed: API matched-pair submission, idempotency, scripted worker execution, provenance, exports, SPA deep links, and assets.');
} finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
