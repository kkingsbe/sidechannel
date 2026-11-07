import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryRepository } from '../harness/repository.js';
import { defaultFixtureConfiguration } from '../harness/config.js';
import { createQueuedRun } from '../harness/scheduler.js';
import { InMemoryResearchStore, allRecords, type ResearchRecord } from '../analysis/store.js';
import { createOversightHandler } from './api.js';
import { createMonitorPreview, currentDefinition, launchMonitor, saveDefinition } from './service.js';
import { runOutcomeAgreements, runReviewContext, saveRunOutcomeReview, type RunOutcomeReview } from './reviews.js';
import { processNextMonitorJob } from './worker.js';

async function fixture(store = new InMemoryResearchStore()) {
    const repository = new InMemoryRepository();
    const run = createQueuedRun(defaultFixtureConfiguration(), 'reference-source'); run.status = 'completed';
    await repository.createRun(run);
    const event = await repository.appendEvent({ runId: run.id, type: 'model_response', agentId: 'alpha', invocationId: 'one', data: { text: 'A recorded contribution.', toolCalls: [] } });
    const context = await runReviewContext(repository, store, run.id);
    const input = { reviewer: 'Alice', outcomeId: context.definition.outcomes[0]!.id,
        definitionRevisionId: context.definition.id, evidenceRevision: context.evidenceRevision,
        decision: 'present' as const, rationale: 'The linked recorded contribution satisfies the criterion.', eventIds: [event.id] };
    return { repository, store, run, event, context, input };
}
test('independent run reviews require two people and editing an agreed label requires reconfirmation even for the same verdict', async () => {
    const f = await fixture();
    const alice = await saveRunOutcomeReview(f.repository, f.store, f.run.id, f.input);
    assert.equal(alice.identityVerified, false);
    assert.equal((await runOutcomeAgreements(f.repository, f.store, f.run.id))[0]!.state, 'provisional');
    const bob = await saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, reviewer: 'Bob' });
    let outcome = (await runOutcomeAgreements(f.repository, f.store, f.run.id))[0]!;
    assert.equal(outcome.state, 'agreed'); assert.equal(outcome.decision, 'present');
    assert.equal(outcome.sourceMatches, true); assert.equal(outcome.definitionCurrent, true);
    const revisedAlice = await saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, supersedesId: alice.id });
    outcome = (await runOutcomeAgreements(f.repository, f.store, f.run.id))[0]!;
    assert.equal(outcome.state, 'provisional'); assert.equal(outcome.decision, null);
    assert.equal(outcome.agreementEpoch, 2);
    assert.equal(revisedAlice.revision, 2);
    const reconfirmedBob = await saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, reviewer: 'Bob', supersedesId: bob.id });
    outcome = (await runOutcomeAgreements(f.repository, f.store, f.run.id))[0]!;
    assert.equal(outcome.state, 'agreed'); assert.deepEqual(outcome.reviewIds.sort(), [revisedAlice.id, reconfirmedBob.id].sort());
    const history = await allRecords<RunOutcomeReview>(f.store, 'run_outcome_reviews', { runId: f.run.id });
    assert.equal(history.length, 4);
    assert.equal(history.find(review => review.id === alice.id)!.revision, 1);
    assert.equal((await f.store.page('analysis_jobs')).items.length, 0, 'run references never require a Jev analysis');
});

test('disagreement remains visible in history and agreed uncertainty stays a distinct reference outcome', async () => {
    const f = await fixture();
    const alice = await saveRunOutcomeReview(f.repository, f.store, f.run.id, f.input);
    const bob = await saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, reviewer: 'Bob', decision: 'absent', eventIds: [] });
    let outcome = (await runOutcomeAgreements(f.repository, f.store, f.run.id))[0]!;
    assert.equal(outcome.state, 'disagreement'); assert.equal(outcome.decision, null);
    await saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, reviewer: 'Bob', supersedesId: bob.id, decision: 'uncertain', eventIds: [] });
    await saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, supersedesId: alice.id, decision: 'uncertain', eventIds: [] });
    outcome = (await runOutcomeAgreements(f.repository, f.store, f.run.id))[0]!;
    assert.equal(outcome.state, 'agreed'); assert.equal(outcome.decision, 'uncertain');
    const history = await allRecords<RunOutcomeReview>(f.store, 'run_outcome_reviews', { runId: f.run.id });
    assert.ok(history.some(review => review.decision === 'present'));
    assert.ok(history.some(review => review.decision === 'absent'));
});

test('reviewer spelling variants cannot supply the second claimed reviewer or bypass stale revision checks', async () => {
    const f = await fixture(), original = await saveRunOutcomeReview(f.repository, f.store, f.run.id, f.input);
    await assert.rejects(saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, reviewer: ' alice ' }), /supersedesId/);
    const revised = await saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, reviewer: 'ＡＬＩＣＥ', supersedesId: original.id });
    assert.equal(revised.reviewerKey, 'alice');
    assert.equal((await runOutcomeAgreements(f.repository, f.store, f.run.id))[0]!.state, 'provisional');
    await assert.rejects(saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, supersedesId: original.id }), /latest review/);
    await assert.rejects(saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, reviewer: 'Bob', supersedesId: original.id }), /does not match/);
});

test('real source snapshots, citations and terminal state are validated and old references are flagged after evidence changes', async () => {
    const f = await fixture();
    await assert.rejects(saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, eventIds: ['another-run-event'] }), /this source run/);
    await assert.rejects(saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, eventIds: [] }), /requires supporting/);
    await saveRunOutcomeReview(f.repository, f.store, f.run.id, f.input);
    await saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, reviewer: 'Bob' });
    await f.repository.appendEvent({ runId: f.run.id, type: 'late_evidence', data: { additional: 'evidence' } });
    await assert.rejects(saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, reviewer: 'Carol' }), /Source evidence changed/);
    assert.notEqual((await runReviewContext(f.repository, f.store, f.run.id)).evidenceRevision, f.context.evidenceRevision);
    assert.equal((await runOutcomeAgreements(f.repository, f.store, f.run.id))[0]!.sourceMatches, false);
    const run = (await f.repository.getRun(f.run.id))!; run.status = 'running'; await f.repository.saveRun(run);
    await assert.rejects(runReviewContext(f.repository, f.store, f.run.id), /terminal source run/);
});

test('definition snapshots and outcome identities remain explicit across revisions', async () => {
    const f = await fixture();
    await assert.rejects(saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, definitionRevisionId: 'definition:999' }), /named immutable definition/);
    await assert.rejects(saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, outcomeId: 'missing' }), /named immutable definition/);
    const original = await saveRunOutcomeReview(f.repository, f.store, f.run.id, f.input), definition = await currentDefinition(f.store);
    const next = await saveDefinition(f.store, { expectedRevision: definition.revision, questions: 'New question', outcomes: definition.outcomes.map(outcome => ({ ...outcome, archived: outcome.id === f.input.outcomeId })) });
    await assert.rejects(saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, reviewer: 'Bob', definitionRevisionId: next.id }), /named immutable definition/);
    const bob = await saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, reviewer: 'Bob' });
    assert.deepEqual(bob.outcomeDefinition, original.outcomeDefinition);
    const outcome = (await runOutcomeAgreements(f.repository, f.store, f.run.id))[0]!;
    assert.equal(outcome.state, 'agreed'); assert.equal(outcome.definitionCurrent, false);
    assert.equal(outcome.definitionRevisionId, definition.id);
});

test('simultaneous saves publish one immutable sequence and reject the competing branch', async () => {
    class ConcurrentStore extends InMemoryResearchStore {
        private arrived = 0; private resume!: () => void;
        private barrier = new Promise<void>(resolve => { this.resume = resolve; });
        override async insert<T extends ResearchRecord>(collection: string, record: T) {
            if (collection === 'run_outcome_reviews') { this.arrived++; if (this.arrived === 2) this.resume(); await this.barrier; }
            return super.insert(collection, record);
        }
    }
    const f = await fixture(new ConcurrentStore());
    const results = await Promise.allSettled([
        saveRunOutcomeReview(f.repository, f.store, f.run.id, f.input),
        saveRunOutcomeReview(f.repository, f.store, f.run.id, f.input),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.match(String(rejected.reason), /concurrent review/);
    assert.equal((await allRecords<RunOutcomeReview>(f.store, 'run_outcome_reviews', { runId: f.run.id })).length, 1);
});

test('API exposes independent context, paginated history and outcomes without accepting a finalization override', async () => {
    const f = await fixture(), handler = createOversightHandler(f.repository, f.store), prefix = `/runs/${f.run.id}`;
    const call = (method: string, suffix: string, body: unknown = {}, query = new URLSearchParams()) => handler({ method, path: prefix + suffix, body, query });
    assert.equal((await call('GET', '/reviews/context'))!.status, 200);
    assert.equal((await call('POST', '/reviews', { ...f.input, finalized: true }))!.status, 400);
    assert.equal((await call('POST', '/reviews', f.input))!.status, 201);
    assert.equal((await call('POST', '/reviews', { ...f.input, reviewer: 'Bob' }))!.status, 201);
    const page = (await call('GET', '/reviews', {}, new URLSearchParams({ limit: '1' })))!.data as { items: RunOutcomeReview[]; nextCursor: string | null };
    assert.equal(page.items.length, 1); assert.ok(page.nextCursor);
    const next = (await call('GET', '/reviews', {}, new URLSearchParams({ limit: '1', after: page.nextCursor! })))!.data as typeof page;
    assert.equal(next.items.length, 1); assert.notEqual(next.items[0]!.id, page.items[0]!.id);
    const outcomes = (await call('GET', '/outcomes'))!.data as { state: string }[];
    assert.equal(outcomes[0]!.state, 'agreed');
    assert.equal(await handler({ method: 'GET', path: '/unrelated', body: {}, query: new URLSearchParams() }), null);
});

test('comparison endpoint joins independent agreed references to monitor abstentions with explicit denominators', async () => {
    const f = await fixture(), handler = createOversightHandler(f.repository, f.store);
    await saveRunOutcomeReview(f.repository, f.store, f.run.id, f.input);
    await saveRunOutcomeReview(f.repository, f.store, f.run.id, { ...f.input, reviewer: 'Bob' });
    const preview = await createMonitorPreview(f.repository, f.store, {
        runIds: [f.run.id], definitionRevision: f.context.definition.revision,
        model: { provider: 'test', id: 'independent-monitor', settings: {} },
        maxInputChars: 1000000, contextWindowTokens: 1000000, outputAllowanceTokens: 2048, timeoutMs: 1000,
    });
    const evaluation = await launchMonitor(f.repository, f.store, { previewId: preview.id, previewHash: preview.hash, idempotencyKey: 'reference-comparison' });
    await processNextMonitorJob(f.repository, f.store, { async evaluate(input) {
        return { output: { judgments: input.definition.outcomes.map(outcome => ({ outcomeId: outcome.id, verdict: 'uncertain', evidenceIds: [], explanation: 'Insufficient supplied evidence.' })) } };
    } }, 'comparison-worker');
    const response = await handler({ method: 'GET', path: `/monitor-evaluations/${evaluation.id}/comparison`, body: {}, query: new URLSearchParams() });
    assert.equal(response!.status, 200);
    const data = response!.data as { evaluationId: string; definitionRevisionId: string; comparisons: { outcome: { id: string }; metrics: { referencePositive: number; monitorUncertain: number; detectionRate: number | null; falsePositiveRate: number | null }[] }[] };
    assert.equal(data.evaluationId, evaluation.id); assert.equal(data.definitionRevisionId, f.context.definition.id);
    const outcome = data.comparisons.find(comparison => comparison.outcome.id === f.input.outcomeId)!;
    assert.equal(outcome.metrics.length, 4);
    assert.ok(outcome.metrics.every(metric => metric.referencePositive === 1 && metric.monitorUncertain === 1 && metric.detectionRate === 0 && metric.falsePositiveRate === null));
});
