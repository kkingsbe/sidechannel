import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoReviewStore } from '@sidechannel/persistence/analysis/review-repository';
import { ReviewService } from '@sidechannel/domain/analysis/jev-reviews';
import type { ReviewContext } from '@sidechannel/contracts/analysis/jev-reviews';

test('Mongo review filters collapse latest subjects before pagination and filter stored queues over the full population', async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0', { serverSelectionTimeoutMS: 5000 });
    const db = client.db(`review_filter_test_${randomUUID().replaceAll('-', '')}`);
    let connected = false;
    try {
        await client.connect(); connected = true;
        const store = new MongoReviewStore(db); await store.initialize();
        const context: ReviewContext = { analysisId: 'analysis', runId: 'source', definitionRevision: 'defs', evidenceRevision: 'evidence', codeIds: ['supply'],
            windows: Array.from({ length: 130 }, (_, index) => ({ id: `w${index}`, eventIds: [`e${index}`], stepIds: [`s${index}`], probabilities: { supply: 0.2 } })) };
        const service = new ReviewService(store, async () => context);
        const input = (subjectId: string, patch: Record<string, unknown> = {}) => ({ subjectId, scope: 'window', codeId: 'supply', definitionRevision: 'defs', evidenceRevision: 'evidence',
            reviewer: 'alice', decision: 'present', rationale: 'A review grounded in the source.', predictionsVisible: false, eventIds: [], stepIds: [], ...patch });
        for (let index = 0; index < 125; index++) await service.save('analysis', input(`w${index}`));
        await service.save('analysis', input('e129', { scope: 'event', eventIds: ['e129'] }));
        const revised = await service.save('analysis', input('e129', { scope: 'event', eventIds: ['e129'], expectedRevision: 1, decision: 'uncertain' }));
        await service.save('analysis', input('e129', { scope: 'event', eventIds: ['e129'], reviewer: 'bob', decision: 'absent' }));
        const own = await service.list('analysis', undefined, 1, { windowId: 'w129', reviewer: 'alice', scope: 'event', subjectId: 'e129', codeId: 'supply', latest: true });
        assert.equal(own.items[0]!.id, revised.id); assert.equal(own.items[0]!.revision, 2); assert.equal(own.nextCursor, null);
        const batch = await service.createBatch('analysis', { seed: 'mongo', randomSize: 130, mode: 'blind' });
        for (const filter of ['uncertain', 'disagreement'] as const) {
            const queue = await service.getBatch('analysis', batch.id, { reviewer: 'alice', filter, limit: 1 });
            assert.equal(queue.items[0]!.windowId, 'w129'); assert.equal(queue.nextCursor, null);
        }
        const first = await service.getBatch('analysis', batch.id, { reviewer: 'alice', filter: 'unreviewed', limit: 2 });
        assert.equal(first.items.length, 2); assert.ok(first.nextCursor);
        const second = await service.getBatch('analysis', batch.id, { reviewer: 'alice', filter: 'unreviewed', limit: 2, after: first.nextCursor! });
        assert.equal(second.nextCursor, null);
        assert.deepEqual([...first.items, ...second.items].map(item => item.windowId).sort(), ['w125', 'w126', 'w127', 'w128']);
        assert.ok([...first.items, ...second.items].every(item => !('reasons' in item)));
    } finally { try { if (connected) await db.dropDatabase(); } finally { await client.close(); } }
});