import assert from 'node:assert/strict';
import test from 'node:test';
import type { Comparison, ComparisonStore } from '@sidechannel/contracts/analysis/aggregation';
import type { AnalysisJob, AnalysisResult, WindowRecord } from '@sidechannel/contracts/analysis/jev-repository';
import { AnalysisAggregationService, type AggregationPorts } from './aggregation-service.js';

const definitions = [{ id: 'd', code: 'd', name: 'D', definition: '', inclusionCriteria: [], exclusionCriteria: [], examples: [], counterexamples: [], qualifyingEvidenceTypes: [], enabled: true, archived: false, color: '#000' }];

/** An analysis with one window per score; window n ends at ordinal n. */
function analysis(id: string, runId: string, scores: number[], extra: { status?: AnalysisJob['status']; revision?: string; model?: string } = {}) {
    const job = { id, runId, status: extra.status ?? 'completed', updatedAt: 'u1', counters: { finishedWindows: scores.length, returnedAnswers: scores.length },
        manifest: { codebook: { id: extra.revision ?? 'rev', definitions }, settings: { model: extra.model ?? 'm' } } } as unknown as AnalysisJob;
    const windows = scores.map((_, i) => ({ id: `${id}-w${i + 1}`, index: i, startOrdinal: i + 1, endOrdinal: i + 1, ordinal: i + 1, jobId: id, status: 'completed' }) as unknown as WindowRecord);
    const results = scores.map((p, i) => ({ id: `${id}-r${i + 1}`, jobId: id, windowId: `${id}-w${i + 1}`, codeId: 'd', probability: p, attemptId: 'a', createdAt: '' }) as AnalysisResult);
    return { job, windows, results };
}

function harness(analyses: ReturnType<typeof analysis>[], runs: Record<string, { condition: string; pairId?: string }>) {
    const byId = new Map(analyses.map(a => [a.job.id, a])), calls = { results: 0 }, stored = new Map<string, Comparison>();
    const comparisons: ComparisonStore = {
        async putComparison(c) { stored.set(c.id, structuredClone(c)); }, async getComparison(id) { return structuredClone(stored.get(id) ?? null); },
        async listComparisons(filter = {}) { return { items: [...stored.values()].filter(c => !filter.runId || c.runIds.includes(filter.runId)), nextCursor: null }; },
    };
    const ports: AggregationPorts = {
        jobs: { getJob: async id => byId.get(id)?.job ?? null },
        windows: { listWindows: async id => ({ items: byId.get(id)?.windows ?? [], nextCursor: null }) },
        results: { listResults: async id => { calls.results++; return { items: byId.get(id)?.results ?? [], nextCursor: null }; } },
        runs: { getRun: async id => runs[id] ? { id, pairId: runs[id]!.pairId, config: { condition: { id: runs[id]!.condition } } } as never : null },
        comparisons, now: () => new Date('2026-11-08T00:00:00Z'), newId: (() => { let n = 0; return () => `cmp-${++n}`; })(),
    };
    return { service: new AnalysisAggregationService(ports), calls, byId, stored };
}

test('summary loads through the ports, applies the policy, and caches by analysis and policy', async () => {
    const { service, calls } = harness([analysis('a1', 'r1', [0.2, 0.9, 0.7])], { r1: { condition: 'reviewed' } });
    const first = await service.summary('a1');
    assert.equal(first.codes[0]!.metrics!.countAbove, 2); assert.equal(first.computedAt, '2026-11-08T00:00:00.000Z');
    await service.summary('a1');
    assert.equal(calls.results, 1); // cached
    const lenient = await service.summary('a1', { kind: 'fixed', yes: 0.2, no: 0.1 });
    assert.equal(lenient.codes[0]!.metrics!.countAbove, 3); assert.equal(calls.results, 2); // a different policy is a different key
});

test('cache entries are invalidated when the job changes and never kept for active jobs', async () => {
    const { service, calls, byId } = harness([analysis('a1', 'r1', [0.2, 0.9])], { r1: { condition: 'reviewed' } });
    await service.summary('a1'); byId.get('a1')!.job.updatedAt = 'u2'; await service.summary('a1');
    assert.equal(calls.results, 2);
    byId.get('a1')!.job.status = 'running'; await service.summary('a1'); await service.summary('a1');
    assert.equal(calls.results, 4);
});

test('control-percentile summaries draw per-code thresholds from the named control analyses', async () => {
    const { service } = harness([analysis('a1', 'r1', [0.2, 0.9]), analysis('c1', 'r2', [0.1, 0.2, 0.3]), analysis('c2', 'r3', [0.4, 0.5])], {});
    const summary = await service.summary('a1', { kind: 'control-percentile', percentile: 0.95, controlAnalysisIds: ['c2', 'c1'] });
    const d = summary.codes[0]!;
    assert.ok(Math.abs(d.threshold!.yes - 0.48) < 1e-9); assert.equal(d.threshold!.source, 'control-percentile'); assert.equal(d.threshold!.controlWindows, 5);
    assert.deepEqual(summary.controlAnalysisIds, ['c1', 'c2']); assert.equal(d.metrics!.countAbove, 1);
});

test('control analyses must be finished and share the codebook revision and model', async () => {
    const { service } = harness([analysis('a1', 'r1', [0.2]), analysis('c1', 'r2', [0.1], { status: 'running' }), analysis('c2', 'r3', [0.1], { revision: 'other' }), analysis('c3', 'r4', [0.1], { model: 'x' })], {});
    for (const id of ['c1', 'c2', 'c3']) await assert.rejects(service.summary('a1', { kind: 'control-percentile', percentile: 0.9, controlAnalysisIds: [id] }), /Control analysis/);
    await assert.rejects(service.summary('missing'), /not found/);
});

test('validated policy asks the injected source and marks fallbacks', async () => {
    const h = harness([analysis('a1', 'r1', [0.2, 0.9])], {});
    const service = new AnalysisAggregationService({ ...(h.service as unknown as { ports: AggregationPorts }).ports, validated: async () => ({ d: { yes: 0.5, no: 0.1 } }) });
    assert.equal((await service.summary('a1', { kind: 'validated', fallback: { yes: 0.7, no: 0.3 } })).codes[0]!.threshold!.source, 'validated');
    assert.equal((await h.service.summary('a1', { kind: 'validated', fallback: { yes: 0.7, no: 0.3 } })).usedFallback, true);
});

const runs = {
    r1: { condition: 'excluded', pairId: 'p1' }, r2: { condition: 'reviewed', pairId: 'p1' }, r3: { condition: 'excluded', pairId: 'p2' }, r4: { condition: 'reviewed', pairId: 'p2' },
};
const four = () => [analysis('a1', 'r1', [0.1, 0.2]), analysis('a2', 'r2', [0.5, 0.9, 0.3]), analysis('a3', 'r3', [0.3, 0.4]), analysis('a4', 'r4', [0.7, 0.8])];

test('a comparison tags analyses from their runs, differences run-level maxima, stores itself and lists by run', async () => {
    const { service, stored } = harness(four(), runs);
    const comparison = await service.createComparison({ analysisIds: ['a1', 'a2', 'a3', 'a4'], policy: { kind: 'fixed', yes: 0.7, no: 0.3 }, seed: 9, iterations: 200, paired: true, creator: 'tester' });
    assert.equal(comparison.id, 'cmp-1'); assert.deepEqual(comparison.inputs.map(i => [i.condition, i.pairId]), [['excluded', 'p1'], ['reviewed', 'p1'], ['excluded', 'p2'], ['reviewed', 'p2']]);
    assert.equal(comparison.seed, 9); assert.equal(comparison.baseline, 'excluded'); assert.equal(comparison.metric, 'max'); assert.deepEqual(comparison.runIds, ['r1', 'r2', 'r3', 'r4']);
    const diff = comparison.codes[0]!.differences[0]!; // reviewed max: 0.9, 0.8 -> 0.85; excluded: 0.2, 0.4 -> 0.3
    assert.ok(Math.abs(diff.interval!.estimate - 0.55) < 1e-9); assert.equal(diff.baselineRuns, 2); assert.equal(diff.conditionRuns, 2);
    assert.ok(Math.abs(diff.paired!.estimate - 0.55) < 1e-9); // pairs: 0.9-0.2 = 0.7 and 0.8-0.4 = 0.4 -> 0.55
    assert.ok(comparison.warnings.some(w => w.code === 'few-runs'));
    assert.deepEqual(stored.get('cmp-1'), comparison);
    assert.equal((await service.getComparison('cmp-1')).creator, 'tester');
    assert.equal((await service.listComparisons('r2')).items.length, 1); assert.equal((await service.listComparisons('nope')).items.length, 0);
    await assert.rejects(service.getComparison('missing'), /not found/);
});

test('a comparison with the same seed reproduces and records its seed', async () => {
    const { service } = harness(four(), runs);
    const request = { analysisIds: ['a1', 'a2', 'a3', 'a4'], policy: { kind: 'fixed' as const, yes: 0.7, no: 0.3 }, iterations: 200 };
    const [x, y, z] = [await service.createComparison({ ...request, seed: 4 }), await service.createComparison({ ...request, seed: 4 }), await service.createComparison({ ...request, seed: 5 })];
    assert.deepEqual(x.codes, y.codes); assert.equal(x.seed, 4); assert.equal(z.seed, 5); // two runs per side admit few distinct resamples, so only the recorded seed is compared
});

test('comparison input is validated', async () => {
    const { service } = harness(four().concat(analysis('a5', 'r1', [0.1])), runs);
    const policy = { kind: 'fixed' as const, yes: 0.7, no: 0.3 };
    await assert.rejects(service.createComparison({ analysisIds: [], policy }), /analysisIds/);
    await assert.rejects(service.createComparison({ analysisIds: ['a1', 'a1'], policy }), /repeat/);
    await assert.rejects(service.createComparison({ analysisIds: ['a1', 'a5'], policy }), /Each run may appear once/);
    await assert.rejects(service.createComparison({ analysisIds: ['a1', 'a2'], policy, iterations: 5 }), /iterations/);
    await assert.rejects(service.createComparison({ analysisIds: ['a1', 'a2'], policy, confidence: 1.5 }), /confidence/);
    await assert.rejects(service.createComparison({ analysisIds: ['a1', 'a2'], policy, metric: 'bogus' as never }), /metric/);
    await assert.rejects(service.createComparison({ analysisIds: ['a1', 'a9'], policy }), /not found/);
});
