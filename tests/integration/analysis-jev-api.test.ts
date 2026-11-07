import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createResearcherServer } from '../../api/src/server/index.js';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { AnalysisService } from '@sidechannel/domain/analysis/jev-service';
import { AnalysisWorker } from '../../analysis-worker/src/jev/jev-worker.js';
import { MemoryReviewStore } from '@sidechannel/persistence/analysis/review-repository';
import { createReviewService } from '../../api/src/routes/review-routes.js';
import { createJevRouteExtension } from '../../api/src/routes/jev-extension.js';

test('researcher HTTP extension previews, queues, scores, reviews and streams complete reproducible exports', async () => {
    const source = new InMemoryRepository(), repository = new InMemoryAnalysisRepository();
    const service = new AnalysisService(repository, source), reviews = createReviewService(repository, new MemoryReviewStore());
    const run = createQueuedRun(defaultFixtureConfiguration(), 'api-fixture'); run.status = 'completed'; await source.createRun(run);
    await source.appendEvent({ runId: run.id, type: 'model_requested', invocationId: 'inv', agentId: 'alpha', data: { phase: 'action' } });
    await source.appendEvent({ runId: run.id, type: 'model_response', invocationId: 'inv', agentId: 'alpha', data: { text: 'Let us ask for authorization.', toolCalls: [] } });
    const server = createResearcherServer(source, { extensionHandlers: [createJevRouteExtension(service, reviews)] });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}/api/jev`;
    async function request(path: string, body?: object) {
        const response = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
        assert.ok(response.ok, await response.clone().text()); return response.json();
    }
    try {
        const books = await request('/codebooks'); assert.equal(books.items.length, 1);
        const codebookId = books.items[0].id, preview = await request(`/runs/${run.id}/analyses/preview`, { codebookId });
        const job = await request(`/runs/${run.id}/analyses`, { codebookId, previewHash: preview.previewHash, idempotencyKey: 'first', creator: 'test' });
        assert.equal(job.status, 'queued');
        await new AnalysisWorker(repository, { provider: { async classify(request) { return { requestedModel: request.model!, returnedModel: request.model!, usage: { inputTokens: null, outputTokens: null }, attempts: [], answers: request.questions.map(q => ({ codeId: q.codeId, probability: 0.6 })) }; } } }).runOnce();
        assert.equal((await request('/analyses/' + job.id)).status, 'completed');
        const windows = await request(`/analyses/${job.id}/windows`), windowId = windows.items[0].id;
        const detail = await request(`/analyses/${job.id}/windows/${encodeURIComponent(windowId)}`);
        assert.equal(detail.results.items.length, 9);
        const review = await request(`/analyses/${job.id}/reviews`, { subjectId: windowId, codeId: 'comply', definitionRevision: job.manifest.codebook.id, evidenceRevision: job.manifest.source.evidenceHash, reviewer: 'reviewer', decision: 'present', rationale: 'Requests authorization.', predictionsVisible: false });
        assert.equal(review.identityVerified, false);
        const batch = await request(`/analyses/${job.id}/review-batches`, { seed: 'pilot', randomSize: 1, mode: 'blind' });
        const queue = await request(`/analyses/${job.id}/review-batches/${batch.id}?reviewer=second`);
        assert.equal('reasons' in queue.items[0], false);
        const response = await fetch(base + `/analyses/${job.id}/export`);
        assert.match(response.headers.get('content-type')!, /ndjson/);
        const records = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
        for (const type of ['manifest', 'window', 'result', 'attempt', 'artifact_chunk', 'reviews', 'batches', 'review_batch_member']) assert.ok(records.some(r => r.type === type), type);
        const invalid = await fetch(base + `/runs/${run.id}/analyses/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codebookId, settings: { window: { size: 2, stride: 4 } } }) });
        assert.equal(invalid.status, 400);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
test('codebook archive endpoints list, archive, restore and map errors while existing analyses stay reviewable', async () => {
    const source = new InMemoryRepository(), repository = new InMemoryAnalysisRepository();
    const service = new AnalysisService(repository, source), reviews = createReviewService(repository, new MemoryReviewStore());
    const run = createQueuedRun(defaultFixtureConfiguration(), 'api-archive-fixture'); run.status = 'completed'; await source.createRun(run);
    await source.appendEvent({ runId: run.id, type: 'model_requested', invocationId: 'inv', agentId: 'alpha', data: { phase: 'action' } });
    await source.appendEvent({ runId: run.id, type: 'model_response', invocationId: 'inv', agentId: 'alpha', data: { text: 'Let us ask for authorization.', toolCalls: [] } });
    const server = createResearcherServer(source, { extensionHandlers: [createJevRouteExtension(service, reviews)] });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}/api/jev`;
    const call = async (path: string, body?: object) => { const response = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined); return { status: response.status, body: await response.json() as any }; };
    try {
        const listed = await call('/codebooks'), id = listed.body.items[0].id as string, revisionId = listed.body.items[0].currentRevisionId as string;
        const job = (await call(`/runs/${run.id}/analyses`, { codebookId: id, previewHash: (await call(`/runs/${run.id}/analyses/preview`, { codebookId: id })).body.previewHash, idempotencyKey: 'first', creator: 'test' })).body;
        await new AnalysisWorker(repository, { provider: { async classify(request) { return { requestedModel: request.model!, returnedModel: request.model!, usage: { inputTokens: null, outputTokens: null }, attempts: [], answers: request.questions.map(q => ({ codeId: q.codeId, probability: 0.6 })) }; } } }).runOnce();

        const archived = await call(`/codebooks/${id}/archive`, { expectedRevisionId: revisionId, actor: 'curator' });
        assert.equal(archived.status, 200); assert.equal(archived.body.codebook.id, id); assert.equal(archived.body.codebook.archivedBy, 'curator'); assert.ok(archived.body.codebook.archivedAt);
        assert.equal((await call('/codebooks')).body.items.length, 0); assert.equal((await call('/codebooks?archived=exclude')).body.items.length, 0);
        assert.equal((await call('/codebooks?archived=only')).body.items.length, 1); assert.equal((await call('/codebooks?archived=include')).body.items.length, 1);
        assert.equal((await call('/codebooks?archived=bogus')).status, 400);
        assert.equal((await call(`/codebooks/${id}`)).body.archivedAt, archived.body.codebook.archivedAt);
        assert.equal((await call(`/codebooks/${id}/revisions/${revisionId}`)).status, 200);

        assert.equal((await call(`/codebooks/${id}/archive`, { expectedRevisionId: revisionId, actor: 'curator' })).status, 409);
        assert.equal((await call(`/codebooks/${id}/archive`, { expectedRevisionId: revisionId })).status, 400);
        assert.equal((await call(`/codebooks/missing/archive`, { expectedRevisionId: revisionId, actor: 'curator' })).status, 404);
        assert.equal((await call(`/codebooks/missing/restore`, { expectedRevisionId: revisionId, actor: 'curator' })).status, 404);
        assert.equal((await call(`/codebooks/${id}/restore`, { expectedRevisionId: 'stale', actor: 'curator' })).status, 409);
        assert.equal((await call(`/codebooks/${id}/restore`, { expectedRevisionId: revisionId, actor: '' })).status, 400);
        const patch = await fetch(base + `/codebooks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevisionId: revisionId, creator: 'e', definitions: [] }) });
        assert.equal(patch.status, 409);
        assert.equal((await call(`/runs/${run.id}/analyses/preview`, { codebookId: id })).status, 409);
        assert.equal((await call(`/runs/${run.id}/analyses`, { codebookId: id, previewHash: 'x', idempotencyKey: 'second', creator: 'test' })).status, 409);

        assert.equal((await call('/analyses/' + job.id)).body.status, 'completed');
        const windowId = (await call(`/analyses/${job.id}/windows`)).body.items[0].id;
        assert.equal((await call(`/analyses/${job.id}/reviews`, { subjectId: windowId, codeId: 'comply', definitionRevision: job.manifest.codebook.id, evidenceRevision: job.manifest.source.evidenceHash, reviewer: 'reviewer', decision: 'present', rationale: 'Still reviewable.', predictionsVisible: false })).status, 201);
        assert.equal((await fetch(base + `/analyses/${job.id}/export`)).status, 200);

        const restored = await call(`/codebooks/${id}/restore`, { expectedRevisionId: revisionId, actor: 'curator' });
        assert.equal(restored.status, 200); assert.equal('archivedAt' in restored.body.codebook, false);
        assert.equal((await call(`/codebooks/${id}/restore`, { expectedRevisionId: revisionId, actor: 'curator' })).status, 409);
        assert.equal((await call('/codebooks')).body.items.length, 1); assert.equal((await call('/codebooks?archived=only')).body.items.length, 0);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
