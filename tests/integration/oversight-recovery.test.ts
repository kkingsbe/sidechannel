import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { InMemoryResearchStore } from '@sidechannel/persistence/analysis/store';
import { allRecords } from '@sidechannel/domain/analysis/store';
import type { ResearchRecord } from '@sidechannel/contracts/analysis/store';
import type { MonitorDefinition, MonitorEvaluation, MonitorSettings } from '@sidechannel/contracts/oversight/contracts';
import type { MonitorProvider } from '@sidechannel/contracts/oversight/server';
import { cancelMonitor, createMonitorPreview, currentDefinition, getMonitorPreview, launchMonitor, saveDefinition } from '@sidechannel/domain/oversight/service';
import { processNextMonitorJob } from '../../analysis-worker/src/oversight/worker.js';

const settings: MonitorSettings = {
    model: { provider: 'test', id: 'independent-monitor', settings: {} },
    maxInputChars: 1_000_000, contextWindowTokens: 1_000_000,
    outputAllowanceTokens: 2048, timeoutMs: 1000,
};

async function fixture(assistantText = 'A recorded action.') {
    const repository = new InMemoryRepository(), store = new InMemoryResearchStore();
    const run = createQueuedRun(defaultFixtureConfiguration(), 'oversight-recovery');
    run.status = 'completed';
    run.reports = [{ agentId: 'alpha', raw: 'I contributed my fragment.', parsed: null }];
    run.artifacts = [{ version: 1, previousVersion: 0, authorId: 'alpha', operationId: 'freeze', frozen: true, value: { submitted: 'fragment' } }];
    await repository.createRun(run);
    await repository.appendEvent({ runId: run.id, agentId: 'alpha', type: 'report_submitted', data: { raw: run.reports[0]!.raw } });
    await repository.appendEvent({ runId: run.id, type: 'artifact_frozen', data: run.artifacts[0] });
    await repository.appendEvent({ runId: run.id, agentId: 'alpha', type: 'model_response', invocationId: 'action:1', data: { text: assistantText, toolCalls: [] } });
    return { repository, store, run };
}

const uncertainty: MonitorProvider = {
    async evaluate(input) {
        return { output: { judgments: input.definition.outcomes.filter(outcome => !outcome.archived).map(outcome => ({
            outcomeId: outcome.id, verdict: 'uncertain', evidenceIds: [], explanation: 'This evidence view does not establish the outcome.',
        })) } };
    },
};

async function launch(f: Awaited<ReturnType<typeof fixture>>, key: string) {
    const definition = await currentDefinition(f.store);
    const preview = await createMonitorPreview(f.repository, f.store, { ...settings, runIds: [f.run.id], definitionRevision: definition.revision });
    const job = await launchMonitor(f.repository, f.store, { previewId: preview.id, previewHash: preview.hash, idempotencyKey: key });
    return { preview, job };
}

test('a preview larger than 14 MB remains lossless and runs its three fitting views', async () => {
    const largeText = `BEGIN_LARGE_${'x'.repeat(7_100_000)}_END_LARGE`;
    const f = await fixture(largeText), { preview, job } = await launch(f, 'large-preview');
    assert.ok(Buffer.byteLength(JSON.stringify(preview)) > 14_000_000);
    const restored = await getMonitorPreview(f.store, preview.id);
    assert.ok(restored);
    assert.equal(restored.hash, preview.hash);
    const full = restored.runs[0]!.projections.find(projection => projection.view === 'full')!;
    assert.equal(full.status, 'oversized');
    assert.equal(full.serialized, preview.runs[0]!.projections.find(projection => projection.view === 'full')!.serialized);
    assert.ok(full.serialized.includes(largeText));
    const parts = await allRecords<ResearchRecord & { text: string }>(f.store, 'monitor_preview_parts');
    assert.ok(parts.length > 50);
    assert.ok(parts.every(part => part.text.length <= 250000));
    const calls: string[] = [];
    await processNextMonitorJob(f.repository, f.store, { async evaluate(input) { calls.push(input.projection.view); return uncertainty.evaluate(input); } }, 'large-worker');
    assert.deepEqual(calls, ['reports', 'audit', 'board']);
    const completed = (await f.store.get<MonitorEvaluation>('monitor_evaluations', job.id))!;
    assert.equal(completed.status, 'partial');
    assert.deepEqual(completed.results.map(result => result.status), ['completed', 'completed', 'completed', 'oversized']);
    assert.equal((await f.repository.getRun(f.run.id))!.status, 'completed');
});

test('lease takeover during an invocation rejects the stale response and keeps the worker recoverable', async () => {
    const f = await fixture(), { job } = await launch(f, 'lease-takeover');
    const replacementOwner = 'replacement-owner'; let calls = 0;
    const handled = await processNextMonitorJob(f.repository, f.store, {
        async evaluate(input) {
            calls++;
            const current = (await f.store.get<MonitorEvaluation>('monitor_evaluations', job.id))!;
            assert.ok(current.workerOwner);
            await f.store.release('monitor', job.id, current.workerOwner);
            assert.equal(await f.store.claim('monitor', job.id, replacementOwner, 60000), true);
            const replacementJudgments = input.definition.outcomes.map(outcome => ({
                outcomeId: outcome.id, verdict: 'absent' as const, evidenceIds: [], explanation: 'Saved by the replacement owner with limited evidence.',
            }));
            assert.equal(await f.store.replace('monitor_evaluations', job.id, current.revision, {
                ...current, revision: current.revision + 1, workerOwner: replacementOwner,
                results: current.results.map(result => result.view === 'reports' ? { ...result, status: 'completed', judgments: replacementJudgments } : result),
            }), true);
            return { output: { judgments: input.definition.outcomes.map(outcome => ({
                outcomeId: outcome.id, verdict: 'present', evidenceIds: [input.projection.evidenceIds[0]!], explanation: 'A stale response that must not replace the new owner.',
            })) } };
        },
    }, 'stale-worker');
    assert.equal(handled, true);
    assert.equal(calls, 1);
    const protectedJob = (await f.store.get<MonitorEvaluation>('monitor_evaluations', job.id))!;
    assert.equal(protectedJob.workerOwner, replacementOwner);
    assert.equal(protectedJob.results[0]!.judgments[0]!.verdict, 'absent');
    assert.equal(protectedJob.status, 'running');
    assert.equal(await f.store.renew('monitor', job.id, replacementOwner, 60000), true, 'stale cleanup must not release the new owner');
    await f.store.release('monitor', job.id, replacementOwner);
    const recoveredCalls: string[] = [];
    assert.equal(await processNextMonitorJob(f.repository, f.store, { async evaluate(input) { recoveredCalls.push(input.projection.view); return uncertainty.evaluate(input); } }, 'recovery-worker'), true);
    assert.deepEqual(recoveredCalls, ['audit', 'board', 'full']);
    const recovered = (await f.store.get<MonitorEvaluation>('monitor_evaluations', job.id))!;
    assert.equal(recovered.status, 'completed');
    assert.equal(recovered.results[0]!.judgments[0]!.verdict, 'absent');
});

test('cancellation accounts for an in-flight response, preserves earlier views, and skips remaining calls', async () => {
    const f = await fixture(), { job } = await launch(f, 'cancel-between-views');
    const calls: string[] = [];
    await processNextMonitorJob(f.repository, f.store, { async evaluate(input) {
        calls.push(input.projection.view);
        if (input.projection.view === 'audit') await cancelMonitor(f.store, job.id);
        return uncertainty.evaluate(input);
    } }, 'cancel-worker');
    assert.deepEqual(calls, ['reports', 'audit']);
    const cancelled = (await f.store.get<MonitorEvaluation>('monitor_evaluations', job.id))!;
    assert.equal(cancelled.status, 'cancelled');
    assert.deepEqual(cancelled.results.map(result => result.status), ['completed', 'completed', 'cancelled', 'cancelled']);
    assert.ok(cancelled.results[0]!.judgments.length);
    assert.ok(cancelled.results[1]!.judgments.length);
    assert.equal(await processNextMonitorJob(f.repository, f.store, uncertainty, 'next-worker'), false);
});

test('outcome IDs survive archival and historical and launched definitions remain immutable', async () => {
    const f = await fixture(), { preview, job } = await launch(f, 'definition-history');
    const original = await currentDefinition(f.store), archivedId = original.outcomes[0]!.id;
    await assert.rejects(saveDefinition(f.store, { expectedRevision: original.revision, questions: original.questions, outcomes: original.outcomes.slice(1) }), /Archive existing outcomes/);
    const revision = await saveDefinition(f.store, {
        expectedRevision: original.revision, questions: 'Revised questions for new work.',
        outcomes: original.outcomes.map(outcome => ({ ...outcome, archived: outcome.id === archivedId })),
    });
    assert.equal(revision.outcomes.find(outcome => outcome.id === archivedId)!.archived, true);
    assert.equal((await f.store.get<MonitorDefinition>('monitor_definitions', original.id))!.outcomes[0]!.archived, false);
    await assert.rejects(saveDefinition(f.store, { expectedRevision: revision.revision, questions: revision.questions, outcomes: revision.outcomes.filter(outcome => outcome.id !== archivedId) }), /Archive existing outcomes/);
    const frozenJob = (await f.store.get<MonitorEvaluation>('monitor_evaluations', job.id))!;
    assert.equal(frozenJob.definition.revision, original.revision);
    assert.equal(frozenJob.definition.outcomes[0]!.archived, false);
    assert.equal((await getMonitorPreview(f.store, preview.id))!.definition.questions, original.questions);
});

test('corrupted frozen preview parts fail integrity validation before they can reach a monitor', async () => {
    const f = await fixture(), { preview } = await launch(f, 'integrity');
    const id = `${preview.id}:0`, part = (await f.store.get<ResearchRecord & { text: string }>('monitor_preview_parts', id))!;
    assert.equal(await f.store.replace('monitor_preview_parts', id, part.revision, { ...part, revision: part.revision + 1, text: part.text + 'tampered' }), true);
    await assert.rejects(getMonitorPreview(f.store, preview.id), /integrity check failed/);
});

test('a corrupt queued preview fails only its evaluation and the worker can process subsequent jobs', async () => {
    const f = await fixture(), { preview, job } = await launch(f, 'corrupt-worker');
    const id = `${preview.id}:0`, part = (await f.store.get<ResearchRecord & { text: string }>('monitor_preview_parts', id))!;
    await f.store.replace('monitor_preview_parts', id, part.revision, { ...part, revision: part.revision + 1, text: part.text + 'corrupt' });
    let calls = 0;
    assert.equal(await processNextMonitorJob(f.repository, f.store, { async evaluate(input) { calls++; return uncertainty.evaluate(input); } }, 'resilient-worker'), true);
    assert.equal(calls, 0);
    const failed = (await f.store.get<MonitorEvaluation>('monitor_evaluations', job.id))!;
    assert.equal(failed.status, 'failed');
    assert.ok(failed.results.every(result => result.status === 'failed' && result.error?.includes('integrity check failed')));
    const next = await launch(f, 'healthy-after-corrupt');
    assert.equal(await processNextMonitorJob(f.repository, f.store, uncertainty, 'resilient-worker'), true);
    assert.equal((await f.store.get<MonitorEvaluation>('monitor_evaluations', next.job.id))!.status, 'completed');
});