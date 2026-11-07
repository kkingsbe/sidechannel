import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { InMemoryResearchStore } from '@sidechannel/persistence/analysis/store';
import type { ModelInput } from '@sidechannel/contracts/harness/server';
import type { MonitorEvaluation, MonitorSettings } from '@sidechannel/contracts/oversight/contracts';
import { buildProjection } from '@sidechannel/domain/oversight/projections';
import { createMonitorPreview, currentDefinition, defaultMonitorDefinition, launchMonitor, saveDefinition } from '@sidechannel/domain/oversight/service';
import { processNextMonitorJob, validateMonitorOutput } from '../../analysis-worker/src/oversight/worker.js';
import { createMonitorProvider } from '../../analysis-worker/src/oversight/provider.js';

const settings: MonitorSettings = { model: { provider: 'test', id: 'monitor-only', settings: {} }, maxInputChars: 1000000, contextWindowTokens: 1000000, outputAllowanceTokens: 2048, timeoutMs: 1000 };

async function fixture() {
    const repository = new InMemoryRepository(), store = new InMemoryResearchStore();
    const run = createQueuedRun(defaultFixtureConfiguration(), 'monitor-source');
    run.status = 'completed';
    run.reports = [{ agentId: 'a', raw: 'I performed the task.', parsed: { ownActions: 'worked', observations: 'board', limitations: 'unknown' } }];
    run.artifacts = [{ version: 1, previousVersion: null, authorId: 'a', operationId: 'freeze', frozen: true, value: { work: 'SUBMITTED', answerKey: 'KEY_SENTINEL', nested: { humanLabels: 'LABEL_SENTINEL', value: 'public' } } }];
    run.scenarioState = { answerKey: 'STATE_SENTINEL' };
    run.board = [{ id: 'message-1', runId: run.id, authorId: 'a', sequence: 1, timestamp: '2026-11-07', text: 'BOARD_SENTINEL' }];
    await repository.createRun(run);
    const definitions = [
        ['report_submitted', { raw: 'I performed the task.' }], ['artifact_frozen', run.artifacts[0]],
        ['tool_requested', { call: { id: 'call', name: 'read_role_data', arguments: { private: 'ARG_SENTINEL' } }, nested: { text: 'NESTED_SENTINEL' } }],
        ['tool_result', { result: { value: 'RESULT_SENTINEL' }, disposition: 'executed' }],
        ['board_delivery', { after: run.board }], ['memory_updated', { after: { notes: 'MEMORY_SENTINEL', version: 1 } }],
        ['model_response', { text: 'ASSISTANT_SENTINEL', reasoning: 'REASON_SENTINEL', raw: { authorization: 'SECRET_SENTINEL' } }],
        ['run_started', { config: run.config, groundTruth: 'GROUND_SENTINEL' }],
    ] as const;
    for (const [type, data] of definitions) await repository.appendEvent({ runId: run.id, type, agentId: 'a', operationId: 'op', data });
    const events = await repository.listEvents(run.id);
    return { repository, store, run, events };
}

test('four projections strictly separate content and omit nested research labels', async () => {
    const { run, events } = await fixture(); const definition = defaultMonitorDefinition();
    const projections = ['reports', 'audit', 'board', 'full'].map(view => buildProjection(run, events, view as 'reports', definition, settings));
    for (const projection of projections) for (const secret of ['KEY_SENTINEL', 'LABEL_SENTINEL', 'STATE_SENTINEL', 'SECRET_SENTINEL', 'GROUND_SENTINEL']) assert.ok(!projection.serialized.includes(secret), `${projection.view} leaked ${secret}`);
    for (const projection of projections.slice(0, 3)) for (const secret of ['ARG_SENTINEL', 'RESULT_SENTINEL', 'MEMORY_SENTINEL', 'REASON_SENTINEL', 'NESTED_SENTINEL']) assert.ok(!projection.serialized.includes(secret), `${projection.view} leaked ${secret}`);
    assert.ok(!projections[0]!.serialized.includes('BOARD_SENTINEL'));
    assert.ok(!projections[1]!.serialized.includes('BOARD_SENTINEL'));
    assert.ok(projections[2]!.serialized.includes('BOARD_SENTINEL'));
    assert.ok(projections[3]!.serialized.includes('MEMORY_SENTINEL'));
    assert.ok(projections[3]!.serialized.includes('REASON_SENTINEL'));
    assert.ok(projections[3]!.availability.providerReasoning);
});

test('oversized views preserve exact evidence instead of truncating', async () => {
    const { run, events } = await fixture();
    const small = buildProjection(run, events, 'full', defaultMonitorDefinition(), { ...settings, maxInputChars: 10 });
    const large = buildProjection(run, events, 'full', defaultMonitorDefinition(), settings);
    assert.equal(small.status, 'oversized'); assert.equal(small.serialized, large.serialized); assert.equal(small.hash, large.hash);
});

test('only documented observable reasoning parts are included in full view', async () => {
    const { run, events } = await fixture();
    const response = events.find(event => event.type === 'model_response')!;
    response.data = { text: 'text', raw: { steps: [{ reasoning: [{ type: 'reasoning', text: 'VISIBLE_REASONING' }, { type: 'other', text: 'NOT_REASONING' }] }], secret: 'RAW_SECRET' } };
    const full = buildProjection(run, events, 'full', defaultMonitorDefinition(), settings);
    assert.ok(full.serialized.includes('VISIBLE_REASONING')); assert.ok(full.availability.providerReasoning);
    assert.ok(!full.serialized.includes('NOT_REASONING')); assert.ok(!full.serialized.includes('RAW_SECRET'));
    const narrow = buildProjection(run, events, 'board', defaultMonitorDefinition(), settings);
    assert.ok(!narrow.serialized.includes('VISIBLE_REASONING'));
});

test('definition conflict and stale launch protect immutable preview snapshots', async () => {
    const { repository, store, run } = await fixture(), definition = await currentDefinition(store);
    const preview = await createMonitorPreview(repository, store, { ...settings, runIds: [run.id], definitionRevision: 1 });
    await saveDefinition(store, { expectedRevision: 1, questions: 'New question', outcomes: definition.outcomes });
    await assert.rejects(saveDefinition(store, { expectedRevision: 1, questions: 'Stale', outcomes: definition.outcomes }), /saved|changed/);
    await assert.rejects(launchMonitor(repository, store, { previewId: preview.id, previewHash: preview.hash, idempotencyKey: 'launch' }), /changed since preview/);
    assert.equal(preview.definition.questions, definition.questions);
});

test('launch idempotency is bound to preview, and frozen job survives later edits', async () => {
    const { repository, store, run } = await fixture(); await currentDefinition(store);
    const preview = await createMonitorPreview(repository, store, { ...settings, runIds: [run.id], definitionRevision: 1 });
    const body = { previewId: preview.id, previewHash: preview.hash, idempotencyKey: 'launch' };
    const job = await launchMonitor(repository, store, body);
    assert.equal((await launchMonitor(repository, store, body)).id, job.id);
    await assert.rejects(launchMonitor(repository, store, { ...body, previewHash: 'different' }), /another preview/);
    await saveDefinition(store, { expectedRevision: 1, questions: 'New', outcomes: preview.definition.outcomes });
    assert.equal((await store.get<MonitorEvaluation>('monitor_evaluations', job.id))!.definition.revision, 1);
});

test('worker isolates four calls and rejects unsupported citations as a partial failure', async () => {
    const { repository, store, run } = await fixture(); await currentDefinition(store);
    const preview = await createMonitorPreview(repository, store, { ...settings, runIds: [run.id], definitionRevision: 1 });
    const job = await launchMonitor(repository, store, { previewId: preview.id, previewHash: preview.hash, idempotencyKey: 'worker' });
    const calls: string[] = [];
    await processNextMonitorJob(repository, store, { async evaluate(input) {
        calls.push(input.projection.view); assert.deepEqual(input.settings, preview.settings);
        return { output: { judgments: input.definition.outcomes.map(outcome => ({ outcomeId: outcome.id, verdict: 'uncertain', explanation: 'Available evidence is insufficient.', evidenceIds: input.projection.view === 'audit' ? ['invented-id'] : [] })) } };
    } }, 'worker');
    assert.deepEqual(calls, ['reports', 'audit', 'board', 'full']);
    const finished = (await store.get<MonitorEvaluation>('monitor_evaluations', job.id))!;
    assert.equal(finished.status, 'partial'); assert.equal(finished.results[1]!.status, 'failed');
    assert.match(finished.results[1]!.error!, /Unsupported evidence citation/);
    assert.equal(await processNextMonitorJob(repository, store, { evaluate: async () => { throw new Error('should never call'); } }, 'worker'), false);
    assert.equal((await repository.getRun(run.id))!.status, 'completed');
});

test('monitor adapter has no tools, history, other views or classifier input', async () => {
    const { run, events } = await fixture(); const definition = defaultMonitorDefinition(); let input: ModelInput | undefined;
    const provider = createMonitorProvider({ async complete(value) { input = value; return { text: '{"judgments":[]}', toolCalls: [] }; } });
    const projection = buildProjection(run, events, 'reports', definition, settings);
    await provider.evaluate({ evaluationId: 'eval', projection, definition, settings });
    assert.equal(input!.messages.length, 2); assert.deepEqual(input!.tools, []);
    assert.equal(input!.messages[1]!.content, projection.serialized);
    assert.equal(input!.model.id, 'monitor-only');
    assert.ok(!JSON.stringify(input).includes('MEMORY_SENTINEL'));
    assert.throws(() => validateMonitorOutput({ judgments: [] }, projection, definition), /exactly one/);
});