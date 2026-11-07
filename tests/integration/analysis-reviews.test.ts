import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryReviewStore } from '@sidechannel/persistence/analysis/review-repository';
import { ReviewService, adjudicate } from '@sidechannel/domain/analysis/jev-reviews';
import type { ReviewContext } from '@sidechannel/contracts/analysis/jev-reviews';

const context: ReviewContext = { analysisId: 'a', runId: 'r', definitionRevision: 'defs-1', evidenceRevision: 'source-1', codeIds: ['supply'], windows: Array.from({ length: 8 }, (_, i) => ({ id: 'w' + i, eventIds: ['e' + i], stepIds: ['s' + i], probabilities: { supply: i === 7 ? 0.95 : 0.1 } })) };

const input = { subjectId: 'w7', codeId: 'supply', definitionRevision: 'defs-1', evidenceRevision: 'source-1', reviewer: 'alice', decision: 'present', rationale: 'The posted fragment supports this judgment.', eventIds: ['e7'], predictionsVisible: false };

test('reviews retain immutable predictions/history, reject stale edits and out-of-subject citations', async () => {
    const service = new ReviewService(new MemoryReviewStore(), async () => structuredClone(context));
    const first = await service.save('a', input);
    assert.equal(first.identityVerified, false);
    await assert.rejects(service.save('a', input), /conflict/);
    const second = await service.save('a', { ...input, expectedRevision: 1, decision: 'uncertain' });
    assert.equal(second.revision, 2);
    assert.deepEqual((await service.allReviews('a')).map(r => r.decision), ['present', 'uncertain']);
    assert.equal(context.windows[7]!.probabilities.supply, 0.95);
    await assert.rejects(service.save('a', { ...input, reviewer: 'bob', eventIds: ['e1'] }), /outside/);
    await assert.rejects(service.save('a', { ...input, reviewer: 'bob', evidenceRevision: 'old' }), /stale/);
});

test('frozen random queues include low scores, union selection reasons and hide blind ordering cues', async () => {
    const service = new ReviewService(new MemoryReviewStore(), async () => structuredClone(context));
    const batch = await service.createBatch('a', { seed: 'pilot', randomSize: 8, threshold: 0.8, mode: 'blind' });
    const initial = await service.getBatch('a', batch.id, { reviewer: 'alice' });
    assert.equal(initial.items.length, 8);
    assert.equal('threshold' in initial.batch, false);
    assert.ok(initial.items.every(m => !('reasons' in m) && !('order' in m)));
    assert.deepEqual(await service.getBatch('a', batch.id, { reviewer: 'alice' }), initial);
    const provenance = await service.getBatch('a', batch.id, { provenance: true });
    assert.deepEqual(provenance.items.find(m => m.windowId === 'w7')!.reasons, ['flagged', 'random']);
    await service.save('a', input);
    const reviewed = await service.getBatch('a', batch.id, { reviewer: 'alice' });
    assert.deepEqual(reviewed.items.find(m => m.windowId === 'w7')!.reasons, ['flagged', 'random']);
});

test('two distinct reviewers finalize outcomes; a revision reopens disagreement and uncertainty stays nonbinary', async () => {
    const service = new ReviewService(new MemoryReviewStore(), async () => context);
    const outcome = { runId: 'r', definitionRevision: 'monitor-v1', evidenceRevision: 'source-1', outcomeIds: ['concealment'], eventIds: ['e7'], stepIds: [] };
    const base = { ...input, codeId: 'concealment', definitionRevision: 'monitor-v1' };
    const evaluate = async () => adjudicate(await service.allReviews('run:r'), 'monitor-v1', 'source-1', 'concealment');
    await service.saveRunOutcome(outcome, base);
    assert.equal((await evaluate()).status, 'provisional');
    await service.saveRunOutcome(outcome, { ...base, reviewer: 'bob' });
    assert.equal((await evaluate()).status, 'agreed');
    await service.saveRunOutcome(outcome, { ...base, expectedRevision: 1, decision: 'uncertain' });
    assert.equal((await evaluate()).status, 'disagreement');
    await service.saveRunOutcome(outcome, { ...base, reviewer: 'bob', expectedRevision: 1, decision: 'uncertain' });
    assert.equal((await evaluate()).binaryReference, false);
});

test('review queue pagination counts selected tasks without empty eligible-population pages', async () => {
    const service = new ReviewService(new MemoryReviewStore(), async () => structuredClone(context));
    const batch = await service.createBatch('a', { seed: 'pilot', randomSize: 0, threshold: 0.8 });
    const queue = await service.getBatch('a', batch.id, { limit: 1 });
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0]!.windowId, 'w7');
    assert.equal(queue.nextCursor, null);
    assert.equal(batch.populationSize, 8);
});