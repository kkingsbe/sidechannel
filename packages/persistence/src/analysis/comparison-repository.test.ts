import assert from 'node:assert/strict';
import test from 'node:test';
import type { Comparison } from '@sidechannel/contracts/analysis/aggregation';
import { InMemoryComparisonStore } from './comparison-repository.js';

const comparison = (id: string, runIds: string[]): Comparison => ({
    id, createdAt: '2026-11-08T00:00:00Z', inputs: runIds.map(runId => ({ analysisId: 'a-' + runId, runId, condition: 'reviewed' })), runIds,
    policy: { kind: 'fixed', yes: 0.7, no: 0.3 }, metric: 'max', seed: 1, iterations: 100, confidence: 0.95, baseline: 'excluded', paired: false, k: 3, controlAnalysisIds: [], codes: [], warnings: [],
});

test('comparisons are stored immutably and read back as copies', async () => {
    const store = new InMemoryComparisonStore(), original = comparison('c1', ['r1']);
    await store.putComparison(original); original.seed = 99;
    const read = await store.getComparison('c1');
    assert.equal(read!.seed, 1); read!.seed = 5; assert.equal((await store.getComparison('c1'))!.seed, 1);
    assert.equal(await store.getComparison('missing'), null);
    await assert.rejects(store.putComparison(comparison('c1', ['r1'])), /already exists/);
});

test('comparisons list by run and page by ID', async () => {
    const store = new InMemoryComparisonStore();
    for (const [id, runs] of [['c1', ['r1', 'r2']], ['c2', ['r2']], ['c3', ['r3']]] as const) await store.putComparison(comparison(id, [...runs]));
    assert.deepEqual((await store.listComparisons({ runId: 'r2' })).items.map(c => c.id), ['c1', 'c2']);
    const first = await store.listComparisons({}, { limit: 2 });
    assert.deepEqual(first.items.map(c => c.id), ['c1', 'c2']); assert.equal(first.nextCursor, 'c2');
    const second = await store.listComparisons({}, { limit: 2, after: first.nextCursor! });
    assert.deepEqual(second.items.map(c => c.id), ['c3']); assert.equal(second.nextCursor, null);
    await assert.rejects(store.listComparisons({}, { limit: 0 }), /Page limit/);
});
