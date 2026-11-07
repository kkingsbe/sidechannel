import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage } from 'node:http';
import { MemoryReviewStore } from '@sidechannel/persistence/analysis/review-repository';
import { ReviewService } from '@sidechannel/domain/analysis/jev-reviews';
import type { Review, ReviewContext, ReviewQueueFilter } from '@sidechannel/contracts/analysis/jev-reviews';
import { analysisJob } from './contracts/fixtures.js';
import { createReviewRouteHandler } from '../../api/src/routes/review-routes.js';

const context: ReviewContext = { analysisId: 'large-analysis', runId: 'source', definitionRevision: 'definition', evidenceRevision: 'frozen-source', codeIds: ['supply', 'challenge'],
    windows: Array.from({ length: 180 }, (_, index) => ({ id: `w${index}`, eventIds: [`e${index}`], stepIds: [`s${index}`], probabilities: { supply: 0.1 } })) };

const input = (subjectId: string, patch: Record<string, unknown> = {}) => ({ subjectId, scope: 'window', codeId: 'supply', definitionRevision: context.definitionRevision,
    evidenceRevision: context.evidenceRevision, reviewer: 'alice', decision: 'present', rationale: 'A human decision supported by source evidence.', eventIds: [], stepIds: [], predictionsVisible: false, ...patch });

function fixture() { return new ReviewService(new MemoryReviewStore(), async () => structuredClone(context)); }

async function selected(service: ReviewService, batchId: string, filter: ReviewQueueFilter, reviewer = 'alice') {
    const windows: string[] = []; let after: string | undefined;
    do { const page = await service.getBatch(context.analysisId, batchId, { filter, reviewer, limit: 2, after }); windows.push(...page.items.map(item => String(item.windowId))); after = page.nextCursor ?? undefined; } while (after);
    return windows.sort();
}

test('subject and reviewer filters with latest=true select the current revision before pagination across more than 100 records', async () => {
    const service = fixture();
    for (let index = 0; index < 160; index++) await service.save(context.analysisId, input(`w${index}`));
    await service.save(context.analysisId, input('e159', { scope: 'event', decision: 'uncertain', eventIds: ['e159'] }));
    const revised = await service.save(context.analysisId, input('e159', { scope: 'event', expectedRevision: 1, eventIds: ['e159'] }));
    await service.save(context.analysisId, input('w159', { reviewer: 'bob', decision: 'absent' }));
    const page = await service.list(context.analysisId, undefined, 1, { windowId: 'w159', reviewer: 'alice', scope: 'event', subjectId: 'e159', codeId: 'supply', latest: true });
    assert.equal(page.items.length, 1); assert.equal(page.items[0]!.id, revised.id); assert.equal(page.items[0]!.revision, 2); assert.equal(page.nextCursor, null);
    const history: Review[] = []; let after: string | undefined;
    do { const page = await service.list(context.analysisId, after, 1, { windowId: 'w159' }); history.push(...page.items); after = page.nextCursor ?? undefined; } while (after);
    assert.equal(history.length, 4);
    assert.ok(history.every(review => review.subjectId === 'w159' || review.subjectId === 'e159'));
    assert.equal(new Set(history.map(review => review.id)).size, 4);
});

test('queue state filters cover the whole frozen population and use current decisions instead of historical disagreement', async () => {
    const service = fixture();
    const batch = await service.createBatch(context.analysisId, { seed: 'whole-population', randomSize: 180, mode: 'blind' });
    for (let index = 0; index < 150; index++) await service.save(context.analysisId, input(`w${index}`));
    // Historic uncertainty has been resolved and must not remain in the uncertainty queue.
    await service.save(context.analysisId, input('w170', { decision: 'uncertain' }));
    await service.save(context.analysisId, input('w170', { expectedRevision: 1 }));
    await service.save(context.analysisId, input('w171', { decision: 'uncertain' }));
    await service.save(context.analysisId, input('w172'));
    await service.save(context.analysisId, input('w172', { reviewer: 'bob', decision: 'absent' }));
    await service.save(context.analysisId, input('w173'));
    await service.save(context.analysisId, input('w173', { reviewer: 'bob', decision: 'absent' }));
    await service.save(context.analysisId, input('w173', { reviewer: 'bob', expectedRevision: 1 }));
    // A different event annotation is not a disagreement with a window-level annotation.
    await service.save(context.analysisId, input('w174'));
    await service.save(context.analysisId, input('e174', { scope: 'event', eventIds: ['e174'], reviewer: 'bob', decision: 'absent' }));
    await service.save(context.analysisId, input('e175', { scope: 'event', eventIds: ['e175'], decision: 'uncertain' }));
    assert.deepEqual(await selected(service, batch.id, 'uncertain'), ['w171', 'w175']);
    assert.deepEqual(await selected(service, batch.id, 'disagreement'), ['w172']);
    const unreviewed = await selected(service, batch.id, 'unreviewed');
    assert.equal(unreviewed.length, 24);
    assert.ok(unreviewed.includes('w179')); assert.ok(!unreviewed.includes('w175'));
    assert.equal((await selected(service, batch.id, 'all')).length, 180);
    const initialBob = await service.getBatch(context.analysisId, batch.id, { reviewer: 'carol', limit: 500, filter: 'uncertain' });
    assert.ok(initialBob.items.every(item => !('reasons' in item) && !('order' in item)));
    const reviewedAlice = await service.getBatch(context.analysisId, batch.id, { reviewer: 'alice', limit: 500, filter: 'uncertain' });
    assert.ok(reviewedAlice.items.every(item => Array.isArray(item.reasons)), 'an event judgment also completes initial review for its containing window');
});

test('filtered review and queue routes validate filters and apply the service semantics before returning pages', async () => {
    const service = fixture();
    await service.save(context.analysisId, input('e179', { scope: 'event', eventIds: ['e179'], decision: 'uncertain' }));
    const batch = await service.createBatch(context.analysisId, { seed: 'route-filter', randomSize: 180 });
    const repository = { getJob: async () => analysisJob(context.analysisId) };
    const handler = createReviewRouteHandler(service, repository);
    const get = (path: string) => handler({ method: 'GET' } as IncomingMessage, new URL(`http://local/api/analyses/${context.analysisId}/${path}`));
    const history = await get('reviews?windowId=w179&subjectId=e179&scope=event&codeId=supply&reviewer=alice&latest=true&limit=1');
    assert.equal(history!.status, 200); assert.equal((history!.body as { items: Review[] }).items[0]!.subjectId, 'e179');
    const queue = await get(`review-batches/${batch.id}?filter=uncertain&limit=1&reviewer=alice`);
    assert.equal(queue!.status, 200); assert.equal((queue!.body as unknown as { items: { windowId: string }[] }).items[0]!.windowId, 'w179');
    assert.equal((await get('reviews?latest=unexpected'))!.status, 400);
    assert.equal((await get('reviews?scope=unexpected'))!.status, 400);
    assert.equal((await get(`review-batches/${batch.id}?filter=unknown`))!.status, 400);
    assert.equal((await get(`review-batches/${batch.id}?filter=unreviewed`))!.status, 400);
});