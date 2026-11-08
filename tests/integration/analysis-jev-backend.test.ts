import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { AnalysisConflict, AnalysisValidation, type AnalysisAttempt } from '@sidechannel/contracts/analysis/jev-repository';
import { AnalysisService } from '@sidechannel/domain/analysis/jev-service';
import { AnalysisWorker } from '../../analysis-worker/src/jev/jev-worker.js';
import { createAnalysisRouteHandler } from '../../api/src/routes/jev-routes.js';
import { JevProviderError, type JevProvider, type JevRequest, type JevResponse } from '@sidechannel/contracts/analysis/jev-provider';
import type { AnalysisConfigurationInput } from '@sidechannel/contracts/analysis/evidence-contracts';

const response = (r: JevRequest): JevResponse => ({ requestedModel: r.model!, returnedModel: r.model!, usage: { inputTokens: 50, outputTokens: 2 }, answers: r.questions.map(q => ({ codeId: q.codeId, probability: 0.75 })), attempts: [] });

async function fixture(steps = 3, settings: AnalysisConfigurationInput = {}) {
    const source = new InMemoryRepository(), repository = new InMemoryAnalysisRepository(), service = new AnalysisService(repository, source);
    const run = createQueuedRun(defaultFixtureConfiguration(), 'source'); run.status = 'completed'; await source.createRun(run);
    for (let i = 0; i < steps; i++) {
        await source.appendEvent({ runId: run.id, invocationId: `inv-${i}`, agentId: 'agent-1', type: 'model_requested', data: { phase: 'action', messages: [] } });
        await source.appendEvent({ runId: run.id, invocationId: `inv-${i}`, agentId: 'agent-1', type: 'model_response', data: { text: `Current output ${i}`, toolCalls: [] } });
    }
    const seed = await service.seedCodebook(), seedRevision = (await repository.getRevision(seed.id, seed.currentRevisionId))!;
    const { codebook } = await service.createCodebook({ name: 'Test codes', creator: 'Researcher', definitions: seedRevision.definitions.slice(0, 2) });
    const input = { codebookId: codebook.id, settings }, preview = await service.preview(run.id, input);
    const launch = { ...input, previewHash: preview.previewHash, idempotencyKey: 'launch', creator: 'Researcher' }, job = await service.launch(run.id, launch);
    return { source, repository, service, run, codebook, preview, launch, job };
}

test('preview freezes exact source and codebook; launch keys conflict on different settings', async () => {
    const f = await fixture(); assert.equal((await f.service.launch(f.run.id, f.launch)).id, f.job.id);
    await assert.rejects(f.service.launch(f.run.id, { ...f.launch, creator: 'Different' }), AnalysisConflict);
    const p = await f.service.preview(f.run.id, { codebookId: f.codebook.id });
    await f.source.appendEvent({ runId: f.run.id, type: 'late_event', data: {} });
    await assert.rejects(f.service.launch(f.run.id, { ...f.launch, previewHash: p.previewHash, idempotencyKey: 'new' }), /changed since preview/);
    assert.equal((await f.repository.getJob(f.job.id))!.manifest.source.eventCount, 6);
});

test('revisions prevent silent overwrite and historical definitions remain frozen', async () => {
    const f = await fixture(), old = (await f.repository.getRevision(f.codebook.id, f.codebook.currentRevisionId))!;
    const definitions = structuredClone(old.definitions); definitions[0]!.definition = 'Changed definition';
    await f.service.reviseCodebook(f.codebook.id, { creator: 'editor', definitions, expectedRevisionId: old.id });
    await assert.rejects(f.service.reviseCodebook(f.codebook.id, { creator: 'stale', definitions, expectedRevisionId: old.id }), AnalysisConflict);
    assert.notEqual((await f.repository.getJob(f.job.id))!.manifest.codebook.definitions[0]!.definition, 'Changed definition');
    await assert.rejects(f.service.launch(f.run.id, { ...f.launch, idempotencyKey: 'after-edit' }), /changed/);
});

test('concurrent seed calls create one codebook identity', async () => {
    const source = new InMemoryRepository(), repo = new InMemoryAnalysisRepository(), service = new AnalysisService(repo, source);
    const books = await Promise.all(Array.from({ length: 8 }, () => service.seedCodebook()));
    assert.equal(new Set(books.map(b => b.id)).size, 1); assert.equal((await repo.listCodebooks()).items.length, 1);
});

test('interrupted preparation publishes no stranded job and the same launch resumes safely', async () => {
    const f = await fixture(), original = f.repository.putWindow.bind(f.repository); let interrupt = true;
    f.repository.putWindow = async window => { if (interrupt) { interrupt = false; throw new Error('API interrupted during preparation'); } await original(window); };
    const input = { ...f.launch, idempotencyKey: 'interrupted' };
    await assert.rejects(f.service.launch(f.run.id, input), /API interrupted/);
    assert.equal((await f.repository.listJobs(f.run.id)).items.length, 1, 'only the earlier fixture job is visible');
    const resumed = await f.service.launch(f.run.id, input); assert.equal(resumed.status, 'queued'); assert.equal(resumed.ready, true);
    await assert.rejects(f.service.launch(f.run.id, { ...input, creator: 'conflicting actor' }), AnalysisConflict);
    assert.equal((await f.repository.getJob(resumed.id))!.manifest.creator, 'Researcher');
});

test('partial answers survive retry and only missing codes are resubmitted', async () => {
    const f = await fixture(), calls: string[][] = []; let first = true;
    const provider: JevProvider = { classify: async r => { calls.push(r.questions.map(q => q.codeId)); const v = response(r); if (first) { first = false; v.answers = v.answers.slice(0, 1); } return v; } };
    const worker = new AnalysisWorker(f.repository, { provider }); await worker.runOnce();
    let job = (await f.repository.getJob(f.job.id))!; assert.equal(job.status, 'partial'); assert.equal(job.counters.returnedAnswers, 1);
    const original = (await f.repository.listResults(job.id)).items[0]!;
    await f.service.retry(job.id); await worker.runOnce(); job = (await f.repository.getJob(job.id))!;
    assert.equal(job.status, 'completed'); assert.equal(job.counters.returnedAnswers, 2); assert.equal(calls[1]!.length, 1); assert.notEqual(calls[1]![0], original.codeId);
    assert.deepEqual((await f.repository.listResults(job.id)).items.find(r => r.codeId === original.codeId), original);
    assert.equal((await f.source.getRun(f.run.id))!.status, 'completed'); assert.equal((await f.source.listEvents(f.run.id)).length, 6);
});

test('aggregate usage counts internal provider attempts once instead of duplicating response usage', async () => {
    const f = await fixture(), now = new Date().toISOString();
    const provider: JevProvider = { classify: async r => ({ ...response(r), usage: { inputTokens: 999, outputTokens: 999 }, attempts: [10, 20].map(inputTokens => ({ attempt: inputTokens / 10, startedAt: now, finishedAt: now, requestedModel: r.model!, returnedModel: r.model!, usage: { inputTokens, outputTokens: 1 } })) }) };
    await new AnalysisWorker(f.repository, { provider }).runOnce();
    assert.deepEqual((await f.repository.getJob(f.job.id))!.usage, { inputTokens: 30, outputTokens: 2, knownInputTokens: 30, knownOutputTokens: 2, providerAttempts: 2, unresolvedAttempts: 0 });
});

test('aggregate usage preserves known subtotals and marks partial provider usage unknown', async () => {
    const f = await fixture(2, { window: { size: 1, stride: 1 } }); let call = 0;
    const provider: JevProvider = { classify: async r => ({ ...response(r), usage: ++call === 1 ? { inputTokens: 50, outputTokens: 3 } : { inputTokens: null, outputTokens: 2 } }) };
    await new AnalysisWorker(f.repository, { provider }).runOnce();
    assert.deepEqual((await f.repository.getJob(f.job.id))!.usage, { inputTokens: null, outputTokens: 5, knownInputTokens: 50, knownOutputTokens: 5, providerAttempts: 2, unresolvedAttempts: 1 });
});

test('out-of-order windows stay bounded and counters describe complete coverage', async () => {
    const f = await fixture(6, { window: { size: 2, stride: 2 }, concurrency: 2 }); let active = 0, maximum = 0;
    const provider: JevProvider = { classify: async r => { maximum = Math.max(maximum, ++active); await new Promise(resolve => setTimeout(resolve, String(r.state).includes('Current output 0') ? 25 : 1)); active--; return response(r); } };
    await new AnalysisWorker(f.repository, { provider }).runOnce(); const j = (await f.repository.getJob(f.job.id))!;
    assert.equal(maximum, 2); assert.equal(j.status, 'completed'); assert.deepEqual(j.counters, { preparedWindows: 3, submittedWindows: 3, finishedWindows: 3, failedWindows: 0, skippedWindows: 0, returnedAnswers: 6, expectedAnswers: 6 });
});

test('repository failure drains sibling responses before finalizing partial work', async () => {
    const f = await fixture(2, { window: { size: 1, stride: 1 }, concurrency: 2 });
    const original = f.repository.putArtifact.bind(f.repository); let siblingStarted = false;
    f.repository.putArtifact = async (id, value) => {
        if (id.includes(':request:') && JSON.stringify(value).includes('Current output 0')) { while (!siblingStarted) await new Promise(resolve => setTimeout(resolve, 1)); throw new Error('Injected storage error'); }
        await original(id, value);
    };
    const provider: JevProvider = { classify: async r => { siblingStarted = true; await new Promise(resolve => setTimeout(resolve, 15)); return response(r); } };
    await new AnalysisWorker(f.repository, { provider }).runOnce();
    const job = (await f.repository.getJob(f.job.id))!; assert.equal(job.status, 'partial'); assert.equal((await f.repository.listResults(job.id)).items.length, 2); assert.match(job.error!, /Injected storage error/);
});

test('oversized input stays intact and no-evidence input is skipped without false zero scores', async () => {
    const oversized = await fixture(3, { inputLimits: { singleQuestionTokens: 20, combinedQuestionTokens: 30, headroomTokens: 1 } }); let calls = 0;
    const provider: JevProvider = { classify: async r => { calls++; return response(r); } };
    await new AnalysisWorker(oversized.repository, { provider }).runOnce(); assert.equal(calls, 0);
    const oversizedJob = (await oversized.repository.getJob(oversized.job.id))!;
    assert.equal(oversizedJob.status, 'failed');
    // Oversized windows are unscored and never retried: they count as skipped, not failed or expected.
    assert.deepEqual(oversizedJob.counters, { preparedWindows: 1, submittedWindows: 0, finishedWindows: 0, failedWindows: 0, skippedWindows: 1, returnedAnswers: 0, expectedAnswers: 0 });
    const w = (await oversized.repository.listWindows(oversized.job.id)).items[0]!; assert.equal(w.status, 'oversized'); assert.ok((await oversized.service.getWindow(oversized.job.id, w.id)).input.state.includes('Current output 2'));
    const empty = await fixture(1, { evidence: { assistantText: false } }); await new AnalysisWorker(empty.repository, { provider }).runOnce(); assert.equal(calls, 0); assert.equal((await empty.repository.listResults(empty.job.id)).items.length, 0);
    const emptyJob = (await empty.repository.getJob(empty.job.id))!;
    assert.equal(emptyJob.status, 'completed');
    assert.deepEqual(emptyJob.counters, { preparedWindows: 1, submittedWindows: 0, finishedWindows: 0, failedWindows: 0, skippedWindows: 1, returnedAnswers: 0, expectedAnswers: 0 });
});

test('lease fences reject stale writes and cancelled abandoned work is recoverable', async () => {
    const f = await fixture(), now = new Date().toISOString(), first = (await f.repository.claim('dead', now, 1))!;
    await f.repository.cancel(f.job.id); await new Promise(resolve => setTimeout(resolve, 5));
    const second = (await f.repository.claim('recovery', new Date().toISOString(), 30_000))!; assert.equal(second.lease.fence, first.lease.fence + 1);
    const a: AnalysisAttempt = { id: 'stale', jobId: f.job.id, windowId: 'x', codeIds: [], requestRef: 'x', startedAt: now, status: 'running', requestedModel: 'jev-1.14.0' };
    assert.equal(await f.repository.startAttempt(first.lease, a), false);
    assert.equal(await f.repository.finishJob(first.lease, 'completed', f.job.counters), false);
    await f.repository.finishJob(second.lease, 'cancelled', f.job.counters); assert.equal((await f.repository.getJob(f.job.id))!.status, 'cancelled');
});

test('worker finalizes cancelled reclaimed lease without credentials or requests', async () => {
    const f = await fixture(); await f.repository.claim('dead', new Date().toISOString(), 1); await f.service.cancel(f.job.id); await new Promise(resolve => setTimeout(resolve, 5));
    let constructed = false; await new AnalysisWorker(f.repository, { providerFactory: () => { constructed = true; throw new Error('must not construct'); } }).runOnce();
    assert.equal(constructed, false); assert.equal((await f.repository.getJob(f.job.id))!.status, 'cancelled');
});

test('provider initialization failure is recorded and does not crash the worker loop', async () => {
    const f = await fixture(); await new AnalysisWorker(f.repository, { providerFactory: () => { throw new JevProviderError({ kind: 'authentication', message: 'Missing test key', retryable: false }); } }).runOnce();
    const j = (await f.repository.getJob(f.job.id))!; assert.equal(j.status, 'failed'); assert.match(j.error!, /Missing test key/); assert.equal(j.lease, undefined);
});

test('cancellation stops scheduling after in-flight windows and retains their attempt history', async () => {
    const f = await fixture(6, { window: { size: 1, stride: 1 }, concurrency: 2 }); let calls = 0;
    const provider: JevProvider = { classify: async r => { calls++; await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 80); r.signal!.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('cancelled')); }, { once: true }); }); return response(r); } };
    const work = new AnalysisWorker(f.repository, { provider, leaseMs: 100, heartbeatMs: 10 }).runOnce();
    while (calls < 2) await new Promise(resolve => setTimeout(resolve, 1)); await f.service.cancel(f.job.id); await work;
    const j = (await f.repository.getJob(f.job.id))!; assert.equal(j.status, 'cancelled'); assert.equal(calls, 2); assert.equal((await f.repository.listAttempts(j.id)).items.length, 2);
    assert.ok((await f.repository.listAttempts(j.id)).items.every(a => a.status === 'failed' && a.responseRef));
});

test('recovery records abandoned attempts and completed retries never call the provider again', async () => {
    const f = await fixture(), claimed = (await f.repository.claim('dead', new Date().toISOString(), 10))!, window = (await f.repository.listWindows(f.job.id)).items[0]!;
    await f.repository.putArtifact('abandoned-request', { request: 'possibly sent before crash' });
    await f.repository.startAttempt(claimed.lease, { id: 'abandoned', jobId: f.job.id, windowId: window.id, codeIds: ['propose'], requestRef: 'abandoned-request', requestedModel: 'jev-1.14.0', startedAt: new Date().toISOString(), status: 'running' });
    await new Promise(resolve => setTimeout(resolve, 15)); let calls = 0;
    const worker = new AnalysisWorker(f.repository, { provider: { classify: async r => { calls++; return response(r); } } }); await worker.runOnce();
    const old = (await f.repository.listAttempts(f.job.id)).items.find(a => a.id === 'abandoned')!; assert.equal(old.status, 'failed'); assert.match(old.error!, /lease expired/);
    await f.service.retry(f.job.id); await worker.runOnce(); assert.equal(calls, 1); assert.equal((await f.repository.getJob(f.job.id))!.status, 'completed');
});

test('malformed answer envelopes cannot commit unexpected or duplicate keys', async () => {
    const f = await fixture(); const provider: JevProvider = { classify: async r => { const v = response(r); v.answers.push({ codeId: 'unexpected', probability: 0.9 }); return v; } };
    await new AnalysisWorker(f.repository, { provider }).runOnce(); assert.equal((await f.repository.listResults(f.job.id)).items.length, 0); assert.equal((await f.repository.getJob(f.job.id))!.status, 'failed');
});

test('provider context rejection preserves membership and is never retried unchanged', async () => {
    const f = await fixture(); let calls = 0;
    const worker = new AnalysisWorker(f.repository, { provider: { classify: async () => { calls++; throw new JevProviderError({ kind: 'context', message: 'max_tokens_exceeded', retryable: false }); } } });
    const before = (await f.repository.listWindows(f.job.id)).items[0]!; await worker.runOnce(); const after = (await f.repository.listWindows(f.job.id)).items[0]!;
    assert.equal(after.status, 'oversized'); assert.deepEqual(after.stepIds, before.stepIds); await f.service.retry(f.job.id); await worker.runOnce(); assert.equal(calls, 1);
});

test('export contains exact inputs, source and provider requests with Unicode-safe chunks', async () => {
    const f = await fixture(); await new AnalysisWorker(f.repository, { provider: { classify: async r => response(r) } }).runOnce();
    const records = []; for await (const r of f.service.exportAnalysis(f.job.id)) records.push(r);
    assert.equal(records.filter(r => r.type === 'result').length, 2); const chunks = records.filter(r => r.type === 'artifact_chunk').map(r => r.data as { id: string; index: number; text: string });
    const source = chunks.filter(c => c.id === f.job.manifest.sourceArtifact).sort((a, b) => a.index - b.index).map(c => c.text).join(''); assert.equal(JSON.parse(source).events.length, 6);
    const value = { text: 'x'.repeat(65526) + '😀' + 'z'.repeat(65536) }; await f.repository.putArtifact('unicode', value);
    const unicode = []; for await (const c of f.repository.artifactChunks('unicode')) unicode.push(Buffer.from(c.text).toString()); assert.deepEqual(JSON.parse(unicode.join('')), value);
});

test('backend validation and routes expose paginated windows and reproducible stream export', async () => {
    const f = await fixture(), handler = createAnalysisRouteHandler(f.service);
    const call = (path: string, method = 'GET', value?: unknown) => { const url = new URL('http://localhost' + path); return handler({ method, path: url.pathname, query: url.searchParams, body: async () => (value as Record<string, unknown>) ?? {} }); };
    await assert.rejects(f.service.preview(f.run.id, { codebookId: f.codebook.id, settings: { window: { size: 0 } } }), AnalysisValidation);
    await assert.rejects(call(`/analyses/${f.job.id}/windows?limit=0`), AnalysisValidation);
    const windows = await call(`/analyses/${f.job.id}/windows?limit=1`); assert.equal(windows!.status, 200);
    const exported = await call(`/analyses/${f.job.id}/export`); assert.equal(exported!.headers!['Content-Type'], 'application/x-ndjson; charset=utf-8');
    const overview = await call('/analyses?limit=1'); assert.equal((overview!.data as { items: unknown[] }).items.length, 1);
    const revisions = await call(`/codebooks/${f.codebook.id}/revisions`); assert.equal((revisions!.data as { items: unknown[] }).items.length, 1);
    const window = (await f.repository.listWindows(f.job.id)).items[0]!;
    const previewed = await call(`/runs/${f.run.id}/analyses/preview/windows/${window.id}`, 'POST', { codebookId: f.codebook.id, previewHash: f.preview.previewHash });
    assert.equal((previewed!.data as { input: { hash: string } }).input.hash, window.inputHash);
    await assert.rejects(f.service.previewWindow(f.run.id, window.id, { codebookId: f.codebook.id, previewHash: 'stale' }), AnalysisConflict);
    assert.equal(await call(`/analyses/${f.job.id}/cancel/extra`, 'POST'), null);
    await assert.rejects(call('/analyses/%ZZ'), AnalysisValidation);
    await new AnalysisWorker(f.repository, { provider: { classify: async r => response(r) } }).runOnce();
    const joined = await call(`/analyses/${f.job.id}/windows?withResults=true&limit=1`);
    const item = (joined!.data as { items: { results: unknown[]; input?: unknown }[] }).items[0]!; assert.equal(item.results.length, 2); assert.equal(item.input, undefined);
});