import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryResearchStore } from '@sidechannel/persistence/analysis/store';
import { DomainFailure } from '@sidechannel/contracts/errors';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { createMonitorPreview, currentDefinition, getMonitorPreview, saveDefinition } from '@sidechannel/domain/oversight/service';
import { createOversightHandler } from '../../api/src/routes/oversight.js';
import { createResearcherServer } from '../../api/src/server/index.js';

const settings = { model: { provider: 'test', id: 'monitor-only', settings: {} }, maxInputChars: 1_000_000, contextWindowTokens: 1_000_000, outputAllowanceTokens: 2048, timeoutMs: 1000 };

async function fixture() {
    const repository = new InMemoryRepository(), store = new InMemoryResearchStore();
    const run = createQueuedRun(defaultFixtureConfiguration(), 'failure-source');
    run.status = 'completed';
    run.reports = [{ agentId: 'alpha', raw: 'I contributed my fragment.', parsed: null }];
    run.artifacts = [{ version: 1, previousVersion: 0, authorId: 'alpha', operationId: 'freeze', frozen: true, value: { submitted: 'fragment' } }];
    await repository.createRun(run);
    await repository.appendEvent({ runId: run.id, agentId: 'alpha', type: 'report_submitted', data: { raw: run.reports[0]!.raw } });
    return { repository, store, run };
}

test('domain producers report a failure kind instead of an HTTP status', async () => {
    const { repository, store } = await fixture();
    await assert.rejects(createMonitorPreview(repository, store, { ...settings, runIds: ['missing'], definitionRevision: 1 }),
        (error: unknown) => error instanceof DomainFailure && error.kind === 'not-found' && /not found/.test(error.message));
    const definition = await currentDefinition(store);
    await assert.rejects(saveDefinition(store, { expectedRevision: definition.revision + 5, questions: 'q', outcomes: definition.outcomes }),
        (error: unknown) => error instanceof DomainFailure && error.kind === 'conflict');
    await assert.rejects(createMonitorPreview(repository, store, { ...settings, runIds: ['a', 'a'], definitionRevision: definition.revision }),
        (error: unknown) => error instanceof DomainFailure && error.kind === 'invalid');
});

test('oversight routes keep their statuses; integrity failures are 503', async () => {
    const { repository, store, run } = await fixture();
    const server = createResearcherServer(repository, { extensionHandlers: [createOversightHandler(repository, store)] });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert(address && typeof address !== 'string');
    const call = async (method: string, path: string, body?: unknown) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { method,
            ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
        return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    try {
        const definition = await currentDefinition(store);
        assert.equal((await call('POST', '/monitor/preview', { ...settings, runIds: ['missing'], definitionRevision: definition.revision })).status, 404);
        assert.equal((await call('POST', '/monitor/preview', { ...settings, runIds: ['a', 'a'], definitionRevision: definition.revision })).status, 400);
        assert.equal((await call('POST', '/monitor-definitions', { expectedRevision: 99, questions: 'q', outcomes: definition.outcomes })).status, 409);
        assert.equal((await call('PUT', '/monitor-evaluations/anything')).status, 405);
        const created = await call('POST', '/monitor/preview', { ...settings, runIds: [run.id], definitionRevision: definition.revision });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        const previewId = String(created.body.id);
        const parts = await store.page<{ id: string; text: string; revision: number; createdAt: string }>('monitor_preview_parts', {}, '', 10);
        const part = parts.items.find(item => item.id.startsWith(previewId + ':'))!;
        await store.replace('monitor_preview_parts', part.id, part.revision, { ...part, revision: part.revision + 1, text: part.text + 'tampered' });
        await assert.rejects(getMonitorPreview(store, previewId), /integrity check failed/);
        assert.equal((await call('POST', '/monitor-evaluations', { previewId, previewHash: String(created.body.hash), idempotencyKey: 'integrity' })).status, 503);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
