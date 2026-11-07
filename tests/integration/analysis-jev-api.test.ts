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