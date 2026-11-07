import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createResearcherServer } from './index.js';

async function setup() {
    const repository = new InMemoryRepository();
    const directory = await mkdtemp(join(tmpdir(), 'event-pages-'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>t</title>');
    const server = createResearcherServer(repository, { dashboardDirectory: directory });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}/api`;
    const get = async (path: string) => { const response = await fetch(base + path); assert(response.ok, await response.clone().text()); return response.json(); };
    const status = async (path: string) => (await fetch(base + path)).status;
    const post = async (path: string, body: unknown) => (await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    const close = async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); };
    return { repository, get, status, post, close };
}
const seqs = (page: { events: { sequence: number }[] }) => page.events.map(e => e.sequence);

test('turn-snapped pages never split a turn, page backward from the newest event, and the turn index matches', async () => {
    const app = await setup();
    try {
        const run = await app.post('/runs', { config: defaultFixtureConfiguration(), idempotencyKey: 'turns' });
        // seq 1 run-level; turn 1 alpha = 2–6; turn 2 beta = 7–11; turn 3 alpha = 12–16
        await app.repository.appendEvent({ runId: run.id, type: 'run_started', data: {} });
        for (const [turn, agentId] of [[1, 'alpha'], [2, 'beta'], [3, 'alpha']] as const)
            for (let index = 0; index < 5; index++) await app.repository.appendEvent({ runId: run.id, type: index === 4 ? 'tool_failed' : 'turn_step', agentId, round: 1, turn, data: {} });

        const first = await app.get(`/runs/${run.id}/events?snap=turn&limit=3`);
        assert.deepEqual(seqs(first), [1, 2, 3, 4, 5, 6]);
        assert.equal(first.hasMore, true); assert.equal(first.nextCursor, 6); assert.equal(first.previousCursor, undefined);
        assert.deepEqual(seqs(await app.get(`/runs/${run.id}/events?snap=turn&limit=3&after=6`)), [7, 8, 9, 10, 11]);

        const newest = await app.get(`/runs/${run.id}/events?snap=turn&limit=2&before=${Number.MAX_SAFE_INTEGER}`);
        assert.deepEqual(seqs(newest), [12, 13, 14, 15, 16]);
        assert.equal(newest.hasMore, true); assert.equal(newest.previousCursor, 12);
        assert.deepEqual(seqs(await app.get(`/runs/${run.id}/events?snap=turn&limit=1&before=12`)), [7, 8, 9, 10, 11]);
        assert.deepEqual(seqs(await app.get(`/runs/${run.id}/events?limit=3&before=12`)), [9, 10, 11], 'unsnapped backward pages are exact');
        assert.equal(await app.status(`/runs/${run.id}/events?before=5&after=1`), 400);

        assert.deepEqual((await app.get(`/runs/${run.id}/turns`)).turns, [
            { agentId: 'alpha', round: 1, turn: 1, firstSequence: 2, lastSequence: 6, eventCount: 5, modelCalls: 0, failures: 1 },
            { agentId: 'beta', round: 1, turn: 2, firstSequence: 7, lastSequence: 11, eventCount: 5, modelCalls: 0, failures: 1 },
            { agentId: 'alpha', round: 1, turn: 3, firstSequence: 12, lastSequence: 16, eventCount: 5, modelCalls: 0, failures: 1 },
        ]);
        assert.equal(await app.status('/runs/missing/turns'), 404);
    } finally { await app.close(); }
});
