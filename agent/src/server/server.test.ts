import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { InMemoryRepository } from '../harness/repository.js';
import { defaultFixtureConfiguration } from '../harness/config.js';
import { createResearcherServer } from './index.js';
test('researcher API freezes queued configurations, deduplicates launch, polls cursors, exports and cancels', async () => {
    const repository = new InMemoryRepository();
    const server = createResearcherServer(repository, { buildMetadata: { revision: 'actual-revision', packages: { test: '1.0.0' } } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const post = async (path: string, value: unknown) => { const response = await fetch(base + '/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); assert.equal(response.status < 300, true, await response.clone().text()); return response.json(); };
    try {
        const config = defaultFixtureConfiguration();
        const malformed = await post('/config/validate', { config: { roles: [null] } });
        assert.equal(malformed.valid, false);
        const preview = await post('/config/validate', { config });
        assert.equal(preview.config.build.revision, 'actual-revision');
        const first = await post('/runs', { config, idempotencyKey: 'launch-test' });
        assert.equal(first.config.build.revision, 'actual-revision');
        config.label = 'edited';
        const duplicate = await post('/runs', { config, idempotencyKey: 'launch-test' });
        assert.equal(first.id, duplicate.id);
        assert.equal(duplicate.config.label, 'Development fixture');
        assert.equal((await repository.listRuns()).length, 1);
        assert.equal(duplicate.status, 'queued');
        await repository.appendEvent({ runId: first.id, type: 'fixture', data: { payload: 'complete' } });
        const page = await (await fetch(base + `/api/runs/${first.id}/events?after=0&limit=1`)).json();
        assert.equal(page.events.length, 1);
        assert.equal(page.nextCursor, 1);
        const next = await (await fetch(base + `/api/runs/${first.id}/events?after=1`)).json();
        assert.equal(next.events.length, 0);
        const evidence = await (await fetch(base + `/api/runs/${first.id}/export`)).json();
        assert.equal(evidence.events[0].data.payload, 'complete');
        assert.equal(evidence.run.config.label, 'Development fixture');
        const cancelled = await post(`/runs/${first.id}/cancel`, {});
        assert.equal(cancelled.status, 'cancelled');
        const pair = await post('/pairs', { config, idempotencyKey: 'pair-test', pairingSeed: 7 });
        const repeated = await post('/pairs', { config, idempotencyKey: 'pair-test', pairingSeed: 7 });
        assert.deepEqual(pair.map((r: {
            id: string;
        }) => r.id), repeated.map((r: {
            id: string;
        }) => r.id));
        assert.equal(pair[0].pairingSeed, 7);
        assert.equal(pair[1].pairPosition, 1);
        const html = await (await fetch(base)).text();
        assert.match(html, /Research console/);
    }
    finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
test('hosted API requires header authentication and rejects cross-origin writes', async () => {
    assert.throws(() => createResearcherServer(new InMemoryRepository(), { host: '0.0.0.0' }), /token/);
    const server = createResearcherServer(new InMemoryRepository(), { host: '0.0.0.0', token: 'test-secret' });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    try {
        assert.equal((await fetch(base + '/api/runs?token=test-secret')).status, 401);
        assert.equal((await fetch(base + '/api/runs', { headers: { Authorization: 'Bearer test-secret' } })).status, 200);
        assert.equal((await fetch(base + '/api/runs', { method: 'POST', headers: { Authorization: 'Bearer test-secret', Origin: 'https://elsewhere.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    }
    finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
