import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { DomainFailure, type FailureKind } from '@sidechannel/contracts/errors';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { createResearcherServer } from './index.js';

const failing: ResearchRouteHandler = async request => {
    if (!request.path.startsWith('/fail/')) return null;
    const kind = request.path.slice('/fail/'.length);
    if (kind === 'untyped') throw new Error('conflict: stale and not found');
    throw new DomainFailure(kind as FailureKind, `failure: ${kind}`);
};

/** A route that never reads its body: its own status must outrank malformed JSON. */
const lazy: ResearchRouteHandler = async request => request.method === 'POST' && request.path === '/lazy' ? { status: 202, data: { accepted: true } } : null;

async function setup() {
    const server = createResearcherServer(new InMemoryRepository(), { extensionHandlers: [failing, lazy] });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { base, post, close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}

test('the error boundary returns 400/404/409/413/503 for domain failure kinds', async () => {
    const app = await setup();
    try {
        for (const [kind, status] of [['invalid', 400], ['not-found', 404], ['conflict', 409], ['too-large', 413], ['unavailable', 503]] as const) {
            const response = await fetch(`${app.base}/fail/${kind}`);
            assert.equal(response.status, status, kind);
            assert.deepEqual(await response.json(), { error: `failure: ${kind}` });
        }
    } finally { await app.close(); }
});

test('route failures keep their documented status codes', async () => {
    const app = await setup();
    try {
        const config = defaultFixtureConfiguration();
        assert.equal((await app.post('/runs', { config })).status, 400);
        assert.equal((await fetch(`${app.base}/runs/missing`)).status, 404);
        assert.equal((await app.post('/drafts', { id: 'stale', config, revision: 5 })).status, 409);
        assert.equal((await app.post('/runs', { config, idempotencyKey: 'x'.repeat(2_000_001) })).status, 413);
    } finally { await app.close(); }
});

test('untyped errors are 400: message text never selects a status', async () => {
    const app = await setup();
    try {
        const response = await fetch(`${app.base}/fail/untyped`);
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: 'conflict: stale and not found' });
    } finally { await app.close(); }
});

test('an unread malformed body does not force 400', async () => {
    const app = await setup();
    try {
        const response = await fetch(`${app.base}/lazy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
        assert.equal(response.status, 202);
        assert.deepEqual(await response.json(), { accepted: true });
    } finally { await app.close(); }
});
