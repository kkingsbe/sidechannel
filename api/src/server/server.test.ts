import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createResearcherServer, type ResearcherServerOptions } from './index.js';
import { InMemoryResearchStore } from '@sidechannel/persistence/analysis/store';
import { createOversightHandler } from '../routes/oversight.js';

async function setup(options: ResearcherServerOptions = {}) {
    const repository = new InMemoryRepository();
    const directory = await mkdtemp(join(tmpdir(), 'researcher-dashboard-'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>Research workspace</title><main id="root"></main>');
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'assets', 'main.js'), 'document.title="Research workspace"');
    const server = createResearcherServer(repository, { dashboardDirectory: directory, ...options });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const request = (path: string, data?: unknown, headers?: Record<string, string>) => fetch(base + path, data === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
    const post = async (path: string, value: unknown) => { const response = await request('/api' + path, value); assert(response.ok, await response.clone().text()); return response.json(); };
    const get = async (path: string) => { const response = await request('/api' + path); assert(response.ok, await response.clone().text()); return response.json(); };
    const close = async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(directory, { recursive: true, force: true }); };
    return { repository, request, post, get, close };
}

test('workspace mode explicitly distinguishes simulated acceptance data', async () => {
    for (const demoMode of [false, true]) {
        const app = await setup({ demoMode });
        try { assert.deepEqual(await app.get('/workspace'), { mode: demoMode ? 'demo' : 'research' }); }
        finally { await app.close(); }
    }
});

test('launch snapshots, matching idempotent retries, conflicts, pair comparison, cancellation and source export', async () => {
    const app = await setup({ buildMetadata: { revision: 'actual-revision', packages: { test: '1.0.0' } } });
    try {
        const config = defaultFixtureConfiguration();
        assert.equal((await app.post('/config/validate', { config: { roles: [null] } })).valid, false);
        assert.equal((await app.post('/config/validate', { config })).config.build.revision, 'actual-revision');
        const first = await app.post('/runs', { config, idempotencyKey: 'launch-test' });
        assert.equal(first.config.build.revision, 'actual-revision');
        const duplicate = await app.post('/runs', { config, idempotencyKey: 'launch-test' });
        assert.equal(first.id, duplicate.id);
        config.label = 'edited';
        assert.equal((await app.request('/api/runs', { config, idempotencyKey: 'launch-test' })).status, 409);
        assert.equal((await app.repository.listRuns()).length, 1);
        await app.repository.appendEvent({ runId: first.id, type: 'fixture', data: { payload: 'complete' } });
        const evidence = await app.get(`/runs/${first.id}/export`);
        assert.equal(evidence.scope, 'complete-source-evidence');
        assert.equal(evidence.events[0].data.payload, 'complete');
        assert.equal(evidence.run.config.label, 'Development fixture');
        assert.equal((await app.post(`/runs/${first.id}/cancel`, {})).status, 'cancelled');
        const pair = await app.post('/pairs', { config, idempotencyKey: 'pair-test', pairingSeed: 7 });
        const repeated = await app.post('/pairs', { config, idempotencyKey: 'pair-test', pairingSeed: 7 });
        assert.deepEqual(pair.map((r: { id: string }) => r.id), repeated.map((r: { id: string }) => r.id));
        assert.equal((await app.request('/api/pairs', { config, idempotencyKey: 'pair-test', pairingSeed: 8 })).status, 409);
        const compare = await app.get('/pairs/' + pair[0].pairId);
        assert.equal(compare.matched, true);
        assert.deepEqual(compare.configurationDifferences.sort(), ['condition.id', 'condition.text']);
        const copied = await app.post(`/pairs/${pair[0].pairId}/duplicate`, { name: 'Second model', notes: 'Pilot' });
        assert.deepEqual(copied.lineage, { sourceType: 'pair', sourceId: pair[0].pairId });
        assert.equal(copied.name, 'Second model');
    } finally { await app.close(); }
});

test('invalid drafts remain editable and concurrent updates reject stale revisions', async () => {
    const app = await setup();
    try {
        const created = await app.post('/drafts', { id: 'draft', config: { label: 'unfinished' }, name: 'Pilot', notes: 'Keep my edits' });
        assert.equal(created.validation.valid, false);
        assert.equal(created.revision, 1);
        assert.equal(created.config.label, 'unfinished');
        const attempts = await Promise.all([1, 2].map(index => app.request('/api/drafts', { id: 'draft', config: { label: `edit ${index}` }, revision: 1 })));
        assert.deepEqual(attempts.map(response => response.status).sort(), [200, 409]);
        const current = await app.get('/drafts/draft');
        assert.equal(current.revision, 2); assert.equal(current.notes, 'Keep my edits');
        const copied = await app.post('/drafts/draft/duplicate', {});
        assert.equal(copied.lineage.sourceRevision, 2);
        assert.equal(copied.revision, 1);
        assert.equal(copied.notes, 'Keep my edits');
        assert.equal((await app.request('/api/drafts', { id: 'draft', config: {} })).status, 409);
        const schema = await app.get('/config/schema');
        assert.equal(schema.fields.find((field: {path: string}) => field.path === 'memory.contextBudget').unit, 'characters');
    } finally { await app.close(); }
});

test('filtered run summaries, event cursor pagination, progress and evidence histories avoid full poll payloads', async () => {
    const app = await setup();
    try {
        const config = defaultFixtureConfiguration();
        const run = await app.post('/runs', { config, idempotencyKey: 'one' });
        await app.post('/pairs', { config, idempotencyKey: 'two' });
        for (let index = 0; index < 250; index++) await app.repository.appendEvent({ runId: run.id, type: index % 2 ? 'tool_requested' : 'memory_updated', agentId: index % 3 ? 'alpha' : 'beta', data: { index, phase: 'action' } });
        const listing = await app.get('/runs?summary=true&designation=fixture&condition=reviewed&limit=1');
        assert.equal(listing.total, 2); assert.equal(listing.items.length, 1); assert.equal(listing.nextOffset, 1);
        assert.equal(listing.items[0].board, undefined); assert.equal(listing.items[0].config.scenario.assets, undefined);
        assert.equal((await app.get('/runs?summary=true&designation=study')).total, 0);
        const progress = await app.get(`/runs/${run.id}/progress`);
        assert.equal(progress.status, 'queued'); assert.equal(progress.board, undefined); assert.equal(progress.rounds, 3);
        const first = await app.get(`/runs/${run.id}/events?type=tool_requested&actor=alpha&phase=action&limit=11`);
        assert.equal(first.events.length, 11); assert.equal(first.hasMore, true);
        assert(first.events.every((event: { type: string; agentId: string }) => event.type === 'tool_requested' && event.agentId === 'alpha'));
        assert.equal((await app.get(`/runs/${run.id}/events/${first.events[0].id}`)).id, first.events[0].id);
        assert.equal((await app.request(`/api/runs/other/events/${first.events[0].id}`)).status, 404);
        const second = await app.get(`/runs/${run.id}/events?type=tool_requested&actor=alpha&after=${first.nextCursor}&limit=11`);
        assert(second.events[0].sequence > first.nextCursor);
        assert.equal((await app.request(`/api/runs/${run.id}/events?limit=0`)).status, 400);
        const memory = await app.get(`/runs/${run.id}/memory?limit=7`); assert.equal(memory.items.length, 7); assert.equal(memory.nextOffset, 7);
        const memoryNext = await app.get(`/runs/${run.id}/memory?limit=7&offset=7`); assert(memoryNext.items[0].sequence > memory.items.at(-1).sequence);
        assert.equal((await app.get(`/runs/${run.id}/artifacts?limit=1`)).items.length, 1);
        assert.equal((await app.get(`/runs/${run.id}/artifacts/0`)).version, 0);
        assert.equal((await app.request(`/api/runs/${run.id}/artifacts/999`)).status, 404);
        const overview = await app.get('/overview'); assert.equal(overview.counts.queued, 3); assert.equal(overview.worker.capacity, 1); assert.equal(overview.queue[0].id, run.id); assert.equal(overview.queueTotal, 3);
    } finally { await app.close(); }
});

test('saved-draft launches freeze researcher metadata and retries retain the original revision', async () => {
    const app = await setup();
    try {
        const config = defaultFixtureConfiguration();
        const draft = await app.post('/drafts', { config, name: 'Study configuration', notes: 'Researcher-only note', groupId: 'group' });
        const payload = { config, sourceDraftId: draft.id, sourceDraftRevision: draft.revision, idempotencyKey: 'from-draft' };
        const pair = await app.post('/pairs', payload);
        assert.equal(pair[0].sourceDraft.notes, 'Researcher-only note');
        assert.equal(pair[0].config.sourceDraft, undefined);
        await app.post('/drafts', { id: draft.id, revision: 1, config, notes: 'Later revision' });
        const repeated = await app.post('/pairs', payload);
        assert.equal(repeated[0].id, pair[0].id);
        assert.equal(repeated[0].sourceDraft.revision, 1);
        assert.equal((await app.request('/api/pairs', { ...payload, idempotencyKey: 'stale-new-launch' })).status, 409);
        assert.equal((await app.request('/api/pairs', { ...payload, sourceDraftRevision: 2, config: { ...config, label: 'unsaved edits' }, idempotencyKey: 'dirty-launch' })).status, 409);
    } finally { await app.close(); }
});

test('open deployment, optional header authentication, cross-origin write protection, static assets and deep links', async () => {
    const open = await setup({ host: '0.0.0.0', extensionHandlers: [async request => request.path === '/extension' ? { status: 200, data: { method: request.method, value: request.query.get('value') } } : null] });
    try {
        assert.equal((await open.request('/api/runs')).status, 200);
        assert.equal((await open.get('/extension?value=connected')).value, 'connected');
        assert.match(await (await open.request('/runs/a/events/b')).text(), /Research workspace/);
        const js = await open.request('/assets/main.js'); assert.match(js.headers.get('content-type')!, /javascript/);
        assert.equal((await open.request('/assets/missing.js')).status, 404);
        assert.equal((await open.request('/assets/%2e%2e%5cpackage.json')).status, 404);
        assert.equal((await open.request('/api/runs', {}, { Origin: 'https://elsewhere.example' })).status, 403);
    } finally { await open.close(); }
    const secured = await setup({ token: 'test-secret' });
    try {
        assert.equal((await secured.request('/api/runs?token=test-secret')).status, 401);
        assert.equal((await secured.request('/api/runs', undefined, { Authorization: 'Bearer test-secret' })).status, 200);
    } finally { await secured.close(); }
});

test('mounted oversight routes preserve revision conflicts independently of run inspection', async () => {
    const store = new InMemoryResearchStore(), repository = new InMemoryRepository();
    const app = await setup({ extensionHandlers: [createOversightHandler(repository, store)] });
    try {
        const definition = await app.get('/monitor-definitions'); assert.equal(definition.revision, 1);
        const updated = await app.post('/monitor-definitions', { expectedRevision: 1, questions: 'Updated monitor question', outcomes: definition.outcomes });
        assert.equal(updated.revision, 2);
        assert.equal((await app.request('/api/monitor-definitions', { expectedRevision: 1, questions: 'Stale overwrite', outcomes: definition.outcomes })).status, 409);
        const history = await app.get('/monitor-definitions/history'); assert.equal(history.items.length, 2);
        assert.deepEqual(await app.get('/runs'), []);
    } finally { await app.close(); }
});

test('extension exports stream NDJSON records instead of serializing generators as empty objects', async () => {
    async function* records() { yield { type: 'manifest', data: { schemaVersion: 1 } }; yield { type: 'window', data: { id: 'window-1' } }; }
    const app = await setup({ extensionHandlers: [async request => request.path === '/stream' ? { status: 200, data: records() } : null] });
    try {
        const response = await app.request('/api/stream'); assert.match(response.headers.get('content-type')!, /ndjson/);
        const exported = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
        assert.equal(exported.length, 2); assert.equal(exported[0].type, 'manifest'); assert.equal(exported[1].data.id, 'window-1');
    } finally { await app.close(); }
});
