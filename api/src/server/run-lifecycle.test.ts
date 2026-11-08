import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { RunStatus } from '@sidechannel/contracts/harness/contracts';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryResearchStore } from '@sidechannel/persistence/analysis/store';
import { MemoryReviewStore } from '@sidechannel/persistence/analysis/review-repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createRunDependencyReader } from '@sidechannel/domain/harness/run-lifecycle';
import { createResearcherServer, type ResearcherServerOptions } from './index.js';

async function setup(options: ResearcherServerOptions = {}) {
    const repository = new InMemoryRepository();
    const research = new InMemoryResearchStore();
    const reviews = new MemoryReviewStore();
    const jobs = new Map<string, string[]>();
    const purged: string[] = [];
    const runDependencies = createRunDependencyReader({
        analyses: { listJobs: async runId => ({ items: (jobs.get(runId) ?? []).map(id => ({ id }) as never), nextCursor: null }) },
        reviews, research,
    });
    const server = createResearcherServer(repository, { runDependencies, runPurgers: [{ async purgeRunRecords(runId) { purged.push(runId); return { mastra_threads: 2 }; } }], ...options });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
        fetch(base + path, { method, headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = async (response: Response) => ({ status: response.status, body: await response.json() as any });
    const launch = async (key: string, status: RunStatus = 'cancelled') => {
        const created = (await json(await call('POST', '/runs', { config: defaultFixtureConfiguration(), idempotencyKey: key }))).body;
        if (status === 'cancelled') await repository.requestCancel(created.id);
        else if (status !== 'queued') { const run = (await repository.getRun(created.id))!; run.status = status; await repository.saveRun(run); }
        return created.id as string;
    };
    const close = async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); };
    return { repository, research, reviews, jobs, purged, call, json, launch, close };
}

test('archiving hides a terminal run everywhere by default, keeps it retrievable, and never frees its launchKey', async () => {
    const app = await setup();
    try {
        const id = await app.launch('archive-key');
        const queued = await app.launch('still-queued', 'queued');
        assert.equal((await app.json(await app.call('POST', `/runs/${id}/archive`, {}))).body.action, 'archive');
        const archivedAt = (await app.repository.getRun(id))!.archivedAt;
        assert.ok(archivedAt);
        assert.equal((await app.json(await app.call('POST', `/runs/${id}/archive`, {}))).body.archivedAt, archivedAt, 'archiving twice is idempotent');

        assert.deepEqual((await app.json(await app.call('GET', '/runs?limit=50'))).body.items.map((run: { id: string }) => run.id), [queued]);
        assert.deepEqual((await app.json(await app.call('GET', '/runs?archived=include&limit=50'))).body.items.map((run: { id: string }) => run.id).sort(), [id, queued].sort());
        assert.deepEqual((await app.json(await app.call('GET', '/runs?archived=only'))).body.items.map((run: { id: string }) => run.id), [id]);
        assert.deepEqual((await app.json(await app.call('GET', '/runs'))).body.map((run: { id: string }) => run.id), [queued], 'the unfiltered list hides archived runs too');
        assert.equal((await app.json(await app.call('GET', '/runs?archived=sometimes'))).status, 400);
        assert.equal((await app.json(await app.call('GET', `/runs/${id}`))).body.archivedAt, archivedAt, 'archived runs stay retrievable by ID');

        const overview = (await app.json(await app.call('GET', '/overview'))).body;
        assert.equal(overview.counts.cancelled, 0);
        assert.deepEqual(overview.attention, []);
        assert.deepEqual(overview.recent, []);

        const relaunch = (await app.json(await app.call('POST', '/runs', { config: defaultFixtureConfiguration(), idempotencyKey: 'archive-key' }))).body;
        assert.equal(relaunch.id, id, 'the launchKey stays bound to the archived run');

        assert.equal((await app.json(await app.call('POST', `/runs/${id}/unarchive`, {}))).status, 200);
        assert.equal((await app.repository.getRun(id))!.archivedAt, undefined);
        assert.equal((await app.json(await app.call('GET', '/overview'))).body.counts.cancelled, 1);
    } finally { await app.close(); }
});

test('only terminal runs can be archived or deleted; worker-owned runs get a 409 and are left untouched', async () => {
    const app = await setup();
    try {
        for (const status of ['queued', 'running', 'reporting', 'stopping'] as const) {
            const id = await app.launch('active-' + status, status);
            const archive = await app.json(await app.call('POST', `/runs/${id}/archive`, {}));
            assert.equal(archive.status, 409, status);
            assert.match(archive.body.error, /worker owns active runs/);
            assert.equal((await app.json(await app.call('DELETE', `/runs/${id}`, { confirm: true }))).status, 409, status);
            assert.ok(await app.repository.getRun(id), status + ' run survives');
        }
        for (const status of ['completed', 'failed', 'cancelled', 'interrupted'] as const) {
            const id = await app.launch('terminal-' + status, status);
            assert.equal((await app.json(await app.call('POST', `/runs/${id}/archive`, {}))).status, 200, status);
        }
        assert.equal((await app.json(await app.call('POST', '/runs/missing/archive', {}))).status, 404);
    } finally { await app.close(); }
});

test('delete needs explicit confirmation, removes every run-keyed record and frees the launchKey', async () => {
    const app = await setup();
    try {
        const id = await app.launch('delete-key', 'failed');
        await app.repository.appendEvent({ runId: id, type: 'fixture', data: {} });
        await app.repository.appendEvent({ runId: id, type: 'fixture', data: {} });
        const other = await app.launch('keep-me', 'failed');
        await app.repository.appendEvent({ runId: other, type: 'fixture', data: {} });

        assert.equal((await app.json(await app.call('DELETE', `/runs/${id}`, {}))).status, 400, 'no confirm flag');
        assert.equal((await app.json(await app.call('DELETE', `/runs/${id}`, { confirm: 'yes' }))).status, 400, 'confirm must be literally true');
        assert.ok(await app.repository.getRun(id));

        const deleted = await app.json(await app.call('DELETE', `/runs/${id}`, { confirm: true }));
        assert.equal(deleted.status, 200);
        assert.deepEqual({ id: deleted.body.id, action: deleted.body.action, launchKey: deleted.body.launchKey, purged: deleted.body.purged }, { id, action: 'delete', launchKey: 'delete-key', purged: { mastra_threads: 2 } });
        assert.deepEqual(app.purged, [id]);
        assert.equal(await app.repository.getRun(id), null);
        assert.equal(await app.repository.getRunByLaunchKey('delete-key'), null);
        assert.deepEqual(await app.repository.listEvents(id), []);
        assert.equal((await app.repository.listEvents(other)).length, 1, 'other runs keep their events');
        assert.equal((await app.json(await app.call('GET', `/runs/${id}`))).status, 404);
        assert.equal((await app.json(await app.call('DELETE', `/runs/${id}`, { confirm: true }))).status, 404);

        const relaunched = (await app.json(await app.call('POST', '/runs', { config: defaultFixtureConfiguration(), idempotencyKey: 'delete-key' }))).body;
        assert.notEqual(relaunched.id, id);
        assert.equal(relaunched.status, 'queued');
    } finally { await app.close(); }
});

test('deleting is refused with the dependents listed while analyses, reviews or monitor evaluations cite the run', async () => {
    const app = await setup();
    try {
        const id = await app.launch('cited', 'completed');
        app.jobs.set(id, ['analysis-1', 'analysis-2']);
        await app.research.insert('monitor_evaluations', { id: 'evaluation-1', revision: 1, createdAt: 'now', runIds: [id, 'someone-else'] } as never);
        await app.research.insert('run_outcome_reviews', { id: 'review-1', revision: 1, createdAt: 'now', runId: id } as never);
        await app.reviews.insert('reviews', 'run:' + id, 'subject:0001', { scope: 'run' });

        const refused = await app.json(await app.call('DELETE', `/runs/${id}`, { confirm: true }));
        assert.equal(refused.status, 409);
        assert.deepEqual(refused.body.dependents, { analyses: ['analysis-1', 'analysis-2'], monitorEvaluations: ['evaluation-1'], outcomeReviews: 1, runReviews: 1 });
        assert.match(refused.body.error, /2 Jev analyses \(analysis-1, analysis-2\), 1 monitor evaluation \(evaluation-1\), 1 outcome review, 1 Jev run review/);
        assert.ok(await app.repository.getRun(id), 'refused delete leaves the run');
        assert.deepEqual(app.purged, [], 'refused delete purges nothing');

        const unrelated = await app.launch('uncited', 'completed');
        assert.equal((await app.json(await app.call('DELETE', `/runs/${unrelated}`, { confirm: true }))).status, 200, 'citations of other runs do not block');
        assert.equal((await app.json(await app.call('POST', `/runs/${id}/archive`, {}))).status, 200, 'a cited run can still be archived');
    } finally { await app.close(); }
});

test('bulk actions report each run separately and never act on a refused run', async () => {
    const app = await setup();
    try {
        const failed = await app.launch('bulk-failed', 'failed');
        const interrupted = await app.launch('bulk-interrupted', 'interrupted');
        const running = await app.launch('bulk-running', 'running');
        const cited = await app.launch('bulk-cited', 'completed');
        app.jobs.set(cited, ['analysis-1']);

        const archive = (await app.json(await app.call('POST', '/runs/bulk', { action: 'archive', ids: [failed, interrupted, running, 'missing', failed] }))).body;
        assert.deepEqual(archive.results.map((result: { id: string; ok: boolean; status?: number }) => [result.id, result.ok, result.status]), [[failed, true, undefined], [interrupted, true, undefined], [running, false, 409], ['missing', false, 404]], 'duplicates collapse');
        assert.deepEqual([archive.succeeded, archive.failed], [2, 2]);

        assert.equal((await app.json(await app.call('POST', '/runs/bulk', { action: 'delete', ids: [failed] }))).status, 400, 'bulk delete needs confirm too');
        const removed = (await app.json(await app.call('POST', '/runs/bulk', { action: 'delete', confirm: true, ids: [failed, interrupted, running, cited] }))).body;
        assert.deepEqual(removed.results.map((result: { id: string; ok: boolean; status?: number }) => [result.ok, result.status]), [[true, undefined], [true, undefined], [false, 409], [false, 409]]);
        assert.deepEqual(removed.results[3].dependents.analyses, ['analysis-1']);
        assert.equal(await app.repository.getRun(failed), null);
        assert.ok(await app.repository.getRun(running));
        assert.ok(await app.repository.getRun(cited));

        for (const body of [{ action: 'archive', ids: [] }, { action: 'archive' }, { action: 'explode', ids: ['x'] }, { action: 'archive', ids: [1] }, { action: 'archive', ids: Array.from({ length: 101 }, (_, i) => 'r' + i) }])
            assert.equal((await app.json(await app.call('POST', '/runs/bulk', body))).status, 400, JSON.stringify(body).slice(0, 60));
    } finally { await app.close(); }
});

test('lifecycle writes follow the write-route conventions: token and same-origin checks', async () => {
    const app = await setup({ token: 'secret' });
    try {
        const auth = { Authorization: 'Bearer secret' };
        const created = await app.json(await app.call('POST', '/runs', { config: defaultFixtureConfiguration(), idempotencyKey: 'auth' }, auth));
        await app.repository.requestCancel(created.body.id);
        assert.equal((await app.call('DELETE', `/runs/${created.body.id}`, { confirm: true })).status, 401);
        assert.equal((await app.call('POST', `/runs/${created.body.id}/archive`, {})).status, 401);
        assert.equal((await app.call('POST', '/runs/bulk', { action: 'archive', ids: [created.body.id] })).status, 401);
        const foreign = { ...auth, Origin: 'https://elsewhere.example' };
        assert.equal((await app.call('DELETE', `/runs/${created.body.id}`, { confirm: true }, foreign)).status, 403);
        assert.equal((await app.call('POST', `/runs/${created.body.id}/archive`, {}, foreign)).status, 403);
        assert.ok(await app.repository.getRun(created.body.id));
        assert.equal((await app.call('DELETE', `/runs/${created.body.id}`, { confirm: true }, auth)).status, 200);
    } finally { await app.close(); }
});
