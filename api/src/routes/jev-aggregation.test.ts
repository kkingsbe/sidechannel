import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnalysisJob, AnalysisResult, WindowRecord } from '@sidechannel/contracts/analysis/jev-repository';
import { DomainFailure } from '@sidechannel/contracts/errors';
import { AnalysisAggregationService } from '@sidechannel/domain/analysis/aggregation-service';
import { InMemoryComparisonStore } from '@sidechannel/persistence/analysis/comparison-repository';
import { createAggregationRouteHandler, policyFromQuery } from './jev-aggregation.js';

const definitions = [{ id: 'd', code: 'd', name: 'D', definition: '', inclusionCriteria: [], exclusionCriteria: [], examples: [], counterexamples: [], qualifyingEvidenceTypes: [], enabled: true, archived: false, color: '#000' }];

function build() {
    const specs: Record<string, { run: string; condition: string; scores: number[] }> = {
        a1: { run: 'r1', condition: 'excluded', scores: [0.2, 0.4] }, a2: { run: 'r2', condition: 'reviewed', scores: [0.8, 0.9] }, c1: { run: 'r3', condition: 'excluded', scores: [0.1, 0.2, 0.3, 0.4, 0.5] },
    };
    const job = (id: string) => ({ id, runId: specs[id]!.run, status: 'completed', updatedAt: 'u', counters: { finishedWindows: 1, returnedAnswers: 1 }, manifest: { codebook: { id: 'rev', definitions }, settings: { model: 'm' } } }) as unknown as AnalysisJob;
    const service = new AnalysisAggregationService({
        jobs: { getJob: async id => specs[id] ? job(id) : null },
        windows: { listWindows: async id => ({ items: specs[id]!.scores.map((_, i) => ({ id: `${id}-${i}`, jobId: id, ordinal: i + 1, endOrdinal: i + 1, status: 'completed' }) as unknown as WindowRecord), nextCursor: null }) },
        results: { listResults: async id => ({ items: specs[id]!.scores.map((p, i) => ({ id: `${id}-r${i}`, jobId: id, windowId: `${id}-${i}`, codeId: 'd', probability: p, attemptId: 'a', createdAt: '' }) as AnalysisResult), nextCursor: null }) },
        runs: { getRun: async id => { const spec = Object.values(specs).find(s => s.run === id); return spec ? { id, config: { condition: { id: spec.condition } } } as never : null; } },
        comparisons: new InMemoryComparisonStore(),
    });
    return createAggregationRouteHandler(service);
}

const request = (method: string, path: string, query = '', body: Record<string, unknown> = {}) => ({ method, path, query: new URLSearchParams(query), body: async () => body });

test('unrelated paths fall through so the main Jev extension can answer', async () => {
    const handler = build();
    assert.equal(await handler(request('GET', '/jev/codebooks')), null);
    assert.equal(await handler(request('GET', '/jev/analyses/a1')), null);
    assert.equal(await handler(request('DELETE', '/jev/comparisons')), null);
    assert.equal(await handler(request('GET', '/runs')), null);
});

test('GET summary defaults to the fixed policy and accepts named or JSON policies', async () => {
    const handler = build();
    const fixed = await handler(request('GET', '/jev/analyses/a2/summary'));
    assert.equal(fixed!.status, 200);
    const summary = fixed!.data as { policy: unknown; codes: { metrics: { countAbove: number } }[] };
    assert.deepEqual(summary.policy, { kind: 'fixed', yes: 0.7, no: 0.3 }); assert.equal(summary.codes[0]!.metrics.countAbove, 2);
    const named = await handler(request('GET', '/jev/analyses/a2/summary', 'policy=fixed&yes=0.85&no=0.2')), json = await handler(request('GET', '/jev/analyses/a2/summary', 'policy=' + encodeURIComponent('{"kind":"fixed","yes":0.85,"no":0.2}')));
    assert.equal((named!.data as typeof summary).codes[0]!.metrics.countAbove, 1); assert.deepEqual((named!.data as typeof summary).policy, (json!.data as typeof summary).policy);
    const control = await handler(request('GET', '/jev/analyses/a2/summary', 'policy=control-percentile&percentile=0.5&control=c1'));
    assert.deepEqual((control!.data as { controlAnalysisIds: string[] }).controlAnalysisIds, ['c1']);
    assert.equal((control!.data as { codes: { threshold: { yes: number; source: string } }[] }).codes[0]!.threshold.yes, 0.3);
});

test('the policy query encodings parse and reject bad input', () => {
    assert.deepEqual(policyFromQuery(new URLSearchParams('policy=validated&yes=0.8&no=0.2')), { kind: 'validated', fallback: { yes: 0.8, no: 0.2 } });
    assert.deepEqual(policyFromQuery(new URLSearchParams('policy=control-percentile&percentile=0.9&control=a,b&control=c&no=0.1')), { kind: 'control-percentile', percentile: 0.9, controlAnalysisIds: ['a', 'b', 'c'], no: 0.1 });
    for (const bad of ['policy=nope', 'policy=fixed&yes=x', 'policy=control-percentile&percentile=0.9', 'policy={bad', 'policy=fixed&yes=0.2&no=0.5']) assert.throws(() => policyFromQuery(new URLSearchParams(bad)), DomainFailure, bad);
});

test('summary errors surface as domain failures', async () => {
    const handler = build();
    await assert.rejects(handler(request('GET', '/jev/analyses/nope/summary')), /not found/);
    await assert.rejects(handler(request('GET', '/jev/analyses/a1/summary', 'k=0')), /k must be/);
    await assert.rejects(handler(request('GET', '/jev/analyses/a1/summary', 'policy=control-percentile&percentile=0.9&control=ghost')), /not found/);
});

test('POST creates a comparison; it can be fetched by ID and listed by run', async () => {
    const handler = build();
    const created = await handler(request('POST', '/jev/comparisons', '', { analysisIds: ['a1', 'a2'], policy: { kind: 'fixed', yes: 0.7, no: 0.3 }, seed: 3, iterations: 100 }));
    assert.equal(created!.status, 201);
    const comparison = created!.data as { id: string; seed: number; runIds: string[]; codes: { differences: { interval: { estimate: number } }[] }[] };
    assert.equal(comparison.seed, 3); assert.ok(Math.abs(comparison.codes[0]!.differences[0]!.interval.estimate - 0.5) < 1e-9); // run maxima 0.9 against 0.4
    const fetched = await handler(request('GET', '/jev/comparisons/' + comparison.id));
    assert.deepEqual(fetched!.data, comparison);
    const listed = await handler(request('GET', '/jev/comparisons', 'runId=r2')), none = await handler(request('GET', '/jev/comparisons', 'runId=zzz'));
    assert.equal((listed!.data as { items: unknown[] }).items.length, 1); assert.equal((none!.data as { items: unknown[] }).items.length, 0);
    await assert.rejects(handler(request('GET', '/jev/comparisons/missing')), /not found/);
    await assert.rejects(handler(request('GET', '/jev/comparisons', 'limit=0')), /Limit/);
    await assert.rejects(handler(request('POST', '/jev/comparisons', '', { analysisIds: [] })), /analysisIds/);
});
