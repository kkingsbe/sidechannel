import assert from 'node:assert/strict';
import type { ReviewMember, ReviewBatch } from '@sidechannel/contracts/analysis/jev-reviews';
import { previewPartKey, type ResearchStore } from '@sidechannel/contracts/analysis/store';
import { reviewRevisionKey, type ReviewStore } from '@sidechannel/contracts/analysis/review-repository';
import type { MonitorEvaluation } from '@sidechannel/contracts/oversight/contracts';

/** Compile-time: the value type is chosen by the caller, so domain code never downcasts. */
export async function assertTypedStores(store: ResearchStore, reviews: ReviewStore): Promise<void> {
    const job: MonitorEvaluation | null = await store.get<MonitorEvaluation>('monitor_evaluations', 'missing');
    assert.equal(job, null);
    const batch: ReviewBatch | null = (await reviews.get<ReviewBatch>('batches', 'partition', 'missing'))?.value ?? null;
    assert.equal(batch, null);
    const members = await reviews.page<ReviewMember>('members', 'partition', '', 5);
    assert.deepEqual(members.items, []);
    assert.equal(previewPartKey('preview-1', 2), 'preview-1:2');
    assert.equal(reviewRevisionKey('identity', 3), 'identity:0000000003');
}
