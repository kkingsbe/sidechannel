import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnalysisSummary, ComparisonInput, ComparisonRunValue } from '@sidechannel/contracts/analysis/aggregation';
import type { BehaviorDefinition } from '@sidechannel/contracts/analysis/evidence-contracts';
import type { AnalysisReliability, AnalysisResult, WindowRecord } from '@sidechannel/contracts/analysis/jev-repository';
import {
    bootstrapDifference, classifyWindows, compareSummaries, deriveSeed, pairedBootstrap, parseThresholdPolicy, percentile, policyKey, resolveThresholds, scoreMetrics, summarize, windowScoreSeries,
    type AggregationData,
} from './aggregation.js';

const close = (actual: number | null | undefined, expected: number, message?: string) => assert.ok(actual !== null && actual !== undefined && Math.abs(actual - expected) < 1e-9, `${message ?? ''} expected ${expected}, got ${actual}`);

const definition = (id: string, extra: Partial<BehaviorDefinition> = {}): BehaviorDefinition => ({
    id, code: id, name: id.toUpperCase(), definition: '', inclusionCriteria: [], exclusionCriteria: [], examples: [], counterexamples: [], qualifyingEvidenceTypes: [], enabled: true, archived: false, color: '#000', ...extra,
});

const window = (n: number, status: WindowRecord['status'] = 'completed'): WindowRecord => ({
    id: `w${n}`, index: n - 1, startOrdinal: n, endOrdinal: n, stepIds: [], eventIds: [], partial: false, incomplete: false,
    jobId: 'job', ordinal: n, status, inputRef: '', inputHash: '', inputBytes: 0, estimatedTokens: 0, diagnostics: [], batches: [],
});

let counter = 0;
const noul = (windowId: string, codeId: string, probability: number, extra: Partial<AnalysisResult> = {}): AnalysisResult => ({ id: `r${++counter}`, jobId: 'job', windowId, codeId, probability, answer: { type: 'noul', probability }, attemptId: 'a', createdAt: '', ...extra });

const definitions = [
    definition('d'), definition('a', { kind: 'audit' }), definition('act', { scope: 'actor' }),
    definition('ch', { question: { type: 'choice', options: [{ label: 'x', description: '' }, { label: 'y', description: '' }], allowNone: false } }),
    definition('sc', { question: { type: 'score', levels: ['low', 'high'] } }),
];

/**
 * Eight windows. w1 w2 w3 w4 w9 completed; w4 is excluded by the audit code (0.7 is at the threshold); w5 oversized, w6 skipped, w7 failed, w8 pending.
 * Included windows are w1 w2 w3 w9, with end ordinals 1, 2, 3, 9.
 */
function fixture(): AggregationData {
    const windows = [window(1), window(2), window(3), window(4), window(5, 'oversized'), window(6, 'skipped'), window(7, 'failed'), window(8, 'pending'), window(9)];
    const results: AnalysisResult[] = [
        noul('w1', 'd', 0.2), noul('w2', 'd', 0.9), noul('w3', 'd', 0.7), noul('w4', 'd', 0.95), noul('w9', 'd', 0.4), noul('w1', 'd', 0.99, { probe: true }),
        noul('w1', 'a', 0.1), noul('w2', 'a', 0.2), noul('w3', 'a', 0.3), noul('w4', 'a', 0.7), noul('w9', 'a', 0.69),
        noul('w1', 'act', 0.8, { actorId: 'A' }), noul('w1', 'act', 0.1, { actorId: 'B' }), noul('w2', 'act', 0.3, { actorId: 'A' }), noul('w2', 'act', 0.6, { actorId: 'B' }), noul('w3', 'act', 0.75, { actorId: 'B' }),
        { ...noul('w1', 'ch', 0), probability: null, answer: { type: 'choice', choice: 'x', probabilities: { x: 0.6, y: 0.4 }, confidence: 0.6, optionOrder: ['x', 'y'] } },
        { ...noul('w2', 'ch', 0), probability: null, answer: { type: 'choice', choice: 'y', probabilities: { x: 0.3, y: 0.7 }, confidence: 0.7, optionOrder: ['y', 'x'] } },
        { ...noul('w3', 'ch', 0), probability: null, answer: { type: 'choice', choice: 'x', probabilities: { x: 0.9, y: 0.1 }, confidence: 0.9, optionOrder: ['x', 'y'] } },
        { ...noul('w1', 'sc', 0), probability: null, answer: { type: 'score', score: 1.5, probabilities: { low: 0.5, high: 0.5 }, confidence: 0.5 } },
        { ...noul('w2', 'sc', 0), probability: null, answer: { type: 'score', score: 2, probabilities: { low: 0, high: 1 }, confidence: 1 } },
    ];
    return { windows, results, definitions };
}

const context = { analysisId: 'job', runId: 'run', codebookRevisionId: 'rev', model: 'm', computedAt: 't' };
const fixed = { kind: 'fixed', yes: 0.7, no: 0.3 } as const;
const summaryOf = (data = fixture(), k?: number) => summarize(data, { ...context, policy: fixed, thresholds: resolveThresholds(fixed, data.definitions), ...(k ? { k } : {}) });
const code = (summary: AnalysisSummary, id: string) => summary.codes.find(c => c.codeId === id)!;

test('coverage: audit exclusion is inclusive at 0.7, gaps are oversized, skipped and failed, pending is unfinished', () => {
    const { coverage } = classifyWindows(fixture());
    assert.deepEqual(coverage, { totalWindows: 9, scoredWindows: 4, excludedByAudit: 1, oversized: 1, skipped: 1, failed: 1, unfinished: 1, gapWindowIds: ['w5', 'w6', 'w7'], excludedWindowIds: ['w4'] });
});

test('a custom audit threshold changes the exclusion count', () => {
    assert.equal(classifyWindows(fixture(), 0.69).coverage.excludedByAudit, 2); // w9 scores 0.69
    assert.equal(classifyWindows(fixture(), 0.8).coverage.excludedByAudit, 0);
});

test('noul run metrics match hand-computed values, ignore probes and audit-excluded windows', () => {
    const m = code(summaryOf(), 'd').metrics!; // scores 0.2 0.9 0.7 0.4 at ends 1 2 3 9
    assert.equal(m.windows, 4); assert.equal(m.max, 0.9); close(m.mean, 0.55);
    assert.equal(m.countAbove, 2); assert.equal(m.fractionAbove, 0.5); assert.equal(m.firstOccurrenceOrdinal, 2);
    assert.equal(m.kStrikes, false); assert.equal(m.undecided, 0);
});

test('k-strikes triggers at exactly k windows at or above the threshold', () => {
    assert.equal(code(summaryOf(fixture(), 2), 'd').metrics!.kStrikes, true);
    assert.equal(code(summaryOf(fixture(), 3), 'd').metrics!.kStrikes, false);
    assert.equal(scoreMetrics([{ end: 1, score: 0.7 }, { end: 2, score: 0.8 }, { end: 3, score: 0.9 }], 0.7, 3).kStrikes, true);
    assert.equal(summaryOf().k, 3);
});

test('an empty series yields null metrics, not zeros', () => {
    const m = scoreMetrics([], 0.7, 3);
    assert.deepEqual(m, { windows: 0, max: null, mean: null, countAbove: 0, fractionAbove: null, firstOccurrenceOrdinal: null, kStrikes: false, undecided: 0 });
});

test('audit codes are summarized over every completed window so their flags stay visible', () => {
    const m = code(summaryOf(), 'a').metrics!;
    assert.equal(m.windows, 5); assert.equal(m.max, 0.7); assert.equal(m.countAbove, 1); assert.equal(m.firstOccurrenceOrdinal, 4);
});

test('actor-scoped codes pool by the per-window maximum and break down per actor', () => {
    const c = code(summaryOf(), 'act'); // pooled 0.8, 0.6, 0.75
    assert.equal(c.metrics!.windows, 3); assert.equal(c.metrics!.max, 0.8); close(c.metrics!.mean, 0.716666666667); assert.equal(c.metrics!.countAbove, 2); assert.equal(c.metrics!.firstOccurrenceOrdinal, 1);
    const a = c.byActor!.A!, b = c.byActor!.B!;
    assert.equal(a.windows, 2); assert.equal(a.max, 0.8); close(a.mean, 0.55); assert.equal(a.countAbove, 1); assert.equal(a.firstOccurrenceOrdinal, 1);
    assert.equal(b.windows, 3); assert.equal(b.max, 0.75); close(b.mean, 0.483333333333); assert.equal(b.countAbove, 1); assert.equal(b.firstOccurrenceOrdinal, 3);
});

test('choice codes report the label distribution and mean top probability', () => {
    const c = code(summaryOf(), 'ch').choice!;
    assert.deepEqual(c.labelCounts, { x: 2, y: 1 }); close(c.labelDistribution.x!, 2 / 3); close(c.labelDistribution.y!, 1 / 3);
    close(c.meanTopProbability, (0.6 + 0.7 + 0.9) / 3); assert.equal(code(summaryOf(), 'ch').metrics, undefined);
});

test('score codes report the mean expected score and the level distribution', () => {
    const s = code(summaryOf(), 'sc').score!;
    assert.equal(s.windows, 2); close(s.meanScore, 1.75); close(s.levelDistribution.low!, 0.25); close(s.levelDistribution.high!, 0.75);
});

test('v1 results without a typed answer read probability', () => {
    const data = fixture(); data.results = [{ id: 'x', jobId: 'job', windowId: 'w1', codeId: 'd', probability: 0.8, attemptId: 'a', createdAt: '' }];
    assert.equal(code(summaryOf(data), 'd').metrics!.max, 0.8);
});

test('the probe floor counts windows within one sd of the yes threshold', () => {
    const reliability: AnalysisReliability = { perCode: { d: { sd: 0.05, maxSpread: 0.1, n: 4 } }, overall: { meanSd: 0.05, maxSd: 0.05, probedWindows: 6, repeats: 4 }, completedAt: 't' };
    const summary = summaryOf({ ...fixture(), reliability });
    assert.equal(code(summary, 'd').metrics!.undecided, 1); // only 0.7 is within 0.05 of 0.7
    assert.deepEqual(summary.reliability, reliability);
});

test('windowScoreSeries is the population control thresholds draw from', () => {
    assert.deepEqual(windowScoreSeries(fixture()).d, [0.2, 0.9, 0.7, 0.4]);
    assert.deepEqual(windowScoreSeries(fixture()).act, [0.8, 0.6, 0.75]);
    assert.equal(windowScoreSeries(fixture()).ch, undefined);
});

test('percentile interpolates linearly', () => {
    assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5); assert.equal(percentile([1, 2, 3, 4], 1), 4); assert.equal(percentile([5], 0.95), 5); assert.equal(percentile([], 0.5), null);
    close(percentile([0.1, 0.2, 0.3, 0.4, 0.5], 0.95), 0.48);
});

test('fixed, control-percentile and validated policies resolve per code with provenance', () => {
    assert.deepEqual(resolveThresholds(fixed, definitions).d, { yes: 0.7, no: 0.3, source: 'fixed' });
    assert.equal(resolveThresholds(fixed, definitions).ch, undefined); // only noul codes have thresholds
    const control = resolveThresholds({ kind: 'control-percentile', percentile: 0.95, controlAnalysisIds: ['c'] }, definitions, { d: [0.1, 0.2, 0.3, 0.4, 0.5] });
    close(control.d!.yes, 0.48); assert.equal(control.d!.source, 'control-percentile'); assert.equal(control.d!.controlWindows, 5); assert.equal(control.d!.no, 0.3);
    assert.deepEqual(control.act, { yes: 0.7, no: 0.3, source: 'fallback', controlWindows: 0 });
    const validated = resolveThresholds({ kind: 'validated', fallback: { yes: 0.8, no: 0.2 } }, definitions, {}, { d: { yes: 0.6, no: 0.1 } });
    assert.deepEqual(validated.d, { yes: 0.6, no: 0.1, source: 'validated' }); assert.deepEqual(validated.a, { yes: 0.8, no: 0.2, source: 'fallback' });
});

test('a summary marks fallback use and applies per-code thresholds', () => {
    const policy = { kind: 'validated', fallback: { yes: 0.8, no: 0.2 } } as const, data = fixture();
    const summary = summarize(data, { ...context, policy, thresholds: resolveThresholds(policy, data.definitions, {}, { d: { yes: 0.4, no: 0.1 } }) });
    assert.equal(summary.usedFallback, true); assert.equal(code(summary, 'd').metrics!.countAbove, 3); // 0.9 0.7 0.4 >= 0.4
    assert.equal(code(summary, 'd').threshold!.source, 'validated');
});

test('threshold policies validate untrusted input', () => {
    assert.deepEqual(parseThresholdPolicy(undefined), fixed);
    assert.throws(() => parseThresholdPolicy({ kind: 'fixed', yes: 0.2, no: 0.4 }), /must not exceed/);
    assert.throws(() => parseThresholdPolicy({ kind: 'fixed', yes: 1.2, no: 0.4 }), /0 to 1/);
    assert.throws(() => parseThresholdPolicy({ kind: 'control-percentile', percentile: 0.9, controlAnalysisIds: [] }), /controlAnalysisIds/);
    assert.throws(() => parseThresholdPolicy({ kind: 'nope' }), /policy.kind/);
    assert.equal(policyKey({ kind: 'control-percentile', percentile: 0.9, controlAnalysisIds: ['b', 'a'] }), policyKey({ kind: 'control-percentile', percentile: 0.9, controlAnalysisIds: ['a', 'b'] }));
});

// Bootstrap and comparison -------------------------------------------------------------------------------------------

test('the bootstrap estimate is the difference of run means', () => {
    const r = bootstrapDifference([1, 2, 3], [4, 6], { seed: 7, iterations: 500 })!; // 5 - 2
    assert.equal(r.estimate, 3); assert.equal(r.iterations, 500); assert.equal(r.confidence, 0.95);
    assert.ok(r.lower <= r.upper);
});

test('the bootstrap is deterministic for a seed and varies with it', () => {
    const run = (seed: number) => bootstrapDifference([0, 10, 4, 7], [20, 30, 25], { seed, iterations: 300 });
    assert.deepEqual(run(5), run(5)); assert.notDeepEqual(run(5), run(6));
});

test('the bootstrap resamples runs: permuting per-run values changes nothing', () => {
    const base = [0.1, 0.5, 0.2, 0.9], cond = [0.7, 0.3, 0.8];
    assert.deepEqual(bootstrapDifference(base, cond, { seed: 3, iterations: 400 }), bootstrapDifference([...base].reverse(), [cond[2]!, cond[0]!, cond[1]!], { seed: 3, iterations: 400 }));
});

test('interval bounds stay within the achievable range and collapse for constant runs', () => {
    const wide = bootstrapDifference([0, 10], [20, 30], { seed: 1, iterations: 1000 })!;
    assert.ok(wide.lower >= 10 && wide.upper <= 30 && wide.lower < wide.estimate && wide.estimate < wide.upper);
    const flat = bootstrapDifference([1, 1, 1], [3, 3], { seed: 1, iterations: 100 })!;
    assert.equal(flat.estimate, 2); assert.equal(flat.lower, 2); assert.equal(flat.upper, 2);
    assert.equal(bootstrapDifference([], [1], { seed: 1 }), null);
});

test('derived seeds differ by label and are stable', () => {
    assert.equal(deriveSeed(1, 'a'), deriveSeed(1, 'a')); assert.notEqual(deriveSeed(1, 'a'), deriveSeed(1, 'b')); assert.notEqual(deriveSeed(1, 'a'), deriveSeed(2, 'a'));
});

const runValue = (pairId: string | undefined, value: number | null, id = Math.random().toString(36)): ComparisonRunValue => ({ analysisId: id, runId: 'r' + id, ...(pairId ? { pairId } : {}), value });

test('the paired variant differences within pairId first and averages runs sharing a pair', () => {
    const baseline = [runValue('p1', 0.2), runValue('p2', 0.5), runValue('p3', 0.3), runValue(undefined, 0.1)];
    const condition = [runValue('p1', 0.6), runValue('p2', 0.6), runValue('p3', 0.9), runValue('p3', 0.7), runValue('p4', 0.9)];
    const paired = pairedBootstrap(baseline, condition, { seed: 2, iterations: 400 })!;
    assert.deepEqual(paired.pairs.map(p => p.pairId), ['p1', 'p2', 'p3']); // p4 has no baseline, the unpaired baseline run has no pair
    close(paired.pairs[0]!.difference, 0.4); close(paired.pairs[1]!.difference, 0.1); close(paired.pairs[2]!.difference, 0.5); // p3 averages 0.9 and 0.7 against 0.3
    close(paired.estimate, (0.4 + 0.1 + 0.5) / 3);
    assert.equal(pairedBootstrap([runValue(undefined, 1)], [runValue('p1', 1)], { seed: 1 }), null);
});

/** A single-code summary whose run metric is `value`. */
function fakeSummary(analysisId: string, value: number | null, overrides: Partial<AnalysisSummary> = {}): AnalysisSummary {
    return {
        analysisId, runId: 'r-' + analysisId, codebookRevisionId: 'rev', model: 'm', policy: fixed, k: 3, auditThreshold: 0.7, controlAnalysisIds: [], usedFallback: false,
        coverage: { totalWindows: 1, scoredWindows: 1, excludedByAudit: 0, oversized: 0, skipped: 0, failed: 0, unfinished: 0, gapWindowIds: [], excludedWindowIds: [] },
        codes: [{ codeId: 'd', code: 'd', name: 'D', kind: 'behavioral', scope: 'window', questionType: 'noul', threshold: { yes: 0.7, no: 0.3, source: 'fixed' },
            metrics: { windows: value === null ? 0 : 1, max: value, mean: value, countAbove: value !== null && value >= 0.7 ? 1 : 0, fractionAbove: value, firstOccurrenceOrdinal: null, kStrikes: false, undecided: 0 } }],
        computedAt: 't', ...overrides,
    };
}

function setup(spec: [condition: string, value: number | null, pairId?: string][]) {
    const inputs: ComparisonInput[] = [], summaries = new Map<string, AnalysisSummary>();
    spec.forEach(([condition, value, pairId], i) => { const id = 'a' + i; inputs.push({ analysisId: id, runId: 'r-' + id, condition, ...(pairId ? { pairId } : {}) }); summaries.set(id, fakeSummary(id, value)); });
    return { inputs, summaries };
}

const options = { metric: 'max', seed: 1, iterations: 300, confidence: 0.95, paired: false } as const;

test('a comparison groups per-run values by condition and differences against the baseline', () => {
    const { inputs, summaries } = setup([['excluded', 0.2], ['excluded', 0.4], ['reviewed', 0.6], ['reviewed', 0.8], ['reviewed', 1]]);
    const { codes, baseline } = compareSummaries(inputs, summaries, options);
    assert.equal(baseline, 'excluded');
    const d = codes[0]!;
    assert.deepEqual(d.groups.map(g => g.condition), ['excluded', 'reviewed']); close(d.groups[0]!.mean, 0.3); close(d.groups[1]!.mean, 0.8);
    const diff = d.differences[0]!;
    assert.equal(diff.condition, 'reviewed'); assert.equal(diff.baselineRuns, 2); assert.equal(diff.conditionRuns, 3); close(diff.interval!.estimate, 0.5);
});

test('comparison metrics read the matching run metric', () => {
    const { inputs, summaries } = setup([['excluded', 0.2], ['reviewed', 0.9]]);
    assert.equal(compareSummaries(inputs, summaries, { ...options, metric: 'countAbove' }).codes[0]!.groups[1]!.runs[0]!.value, 1);
    assert.equal(compareSummaries(inputs, summaries, { ...options, metric: 'kStrikes' }).codes[0]!.groups[1]!.runs[0]!.value, 0);
});

test('window-level changes inside a run that leave its metric alone cannot move the interval, and units are runs', () => {
    const data = fixture(), perturbed = fixture();
    perturbed.results = perturbed.results.map(r => r.codeId === 'd' && r.windowId === 'w1' && !r.probe ? { ...r, probability: 0.1, answer: { type: 'noul' as const, probability: 0.1 } } : r); // not the max
    const inputs: ComparisonInput[] = [{ analysisId: 'a0', runId: 'r0', condition: 'excluded' }, { analysisId: 'a1', runId: 'r1', condition: 'reviewed' }];
    const compare = (d: AggregationData) => compareSummaries(inputs, new Map([['a0', { ...summaryOf(d), analysisId: 'a0' }], ['a1', { ...summaryOf(data), analysisId: 'a1' }]]), options).codes.find(c => c.codeId === 'd')!;
    const before = compare(data), after = compare(perturbed);
    assert.equal(before.differences[0]!.baselineRuns, 1); assert.equal(after.differences[0]!.baselineRuns, 1); // 9 windows, one resampling unit
    assert.deepEqual(before.differences[0]!.interval, after.differences[0]!.interval);
    assert.equal(data.windows.length, 9);
});

test('warnings: few runs, single condition, mixed codebooks, fallbacks, exclusions and gaps', () => {
    const { inputs, summaries } = setup([['excluded', 0.2], ['reviewed', 0.6]]);
    const codes = compareSummaries(inputs, summaries, options).warnings.map(w => `${w.code}:${w.condition ?? ''}`);
    assert.deepEqual(codes, ['few-runs:excluded', 'few-runs:reviewed']);
    const many = setup([...Array(5)].map((_, i): [string, number] => ['excluded', i / 10]).concat([...Array(5)].map((_, i): [string, number] => ['reviewed', 0.5 + i / 10])));
    assert.deepEqual(compareSummaries(many.inputs, many.summaries, options).warnings, []);
    const one = setup([['reviewed', 0.3]]);
    assert.ok(compareSummaries(one.inputs, one.summaries, options).warnings.some(w => w.code === 'single-condition'));
    const mixed = setup([['excluded', 0.2], ['reviewed', 0.6]]);
    mixed.summaries.set('a1', fakeSummary('a1', 0.6, { codebookRevisionId: 'other', usedFallback: true, coverage: { ...fakeSummary('a1', 0).coverage, excludedByAudit: 2, gapWindowIds: ['w1'] } }));
    const kinds = compareSummaries(mixed.inputs, mixed.summaries, options).warnings.map(w => w.code);
    for (const kind of ['mixed-codebook', 'threshold-fallback', 'audit-exclusions', 'coverage-gaps']) assert.ok(kinds.includes(kind as never), kind);
});

test('the paired comparison reports pairs and warns when none are shared', () => {
    const { inputs, summaries } = setup([['excluded', 0.2, 'p1'], ['excluded', 0.5, 'p2'], ['reviewed', 0.6, 'p1'], ['reviewed', 0.6, 'p2'], ['reviewed', 0.9]]);
    const result = compareSummaries(inputs, summaries, { ...options, paired: true });
    const diff = result.codes[0]!.differences[0]!;
    close(diff.interval!.estimate, 0.7 - 0.35); // unpaired: mean(0.6, 0.6, 0.9) against mean(0.2, 0.5)
    close(diff.paired!.estimate, (0.4 + 0.1) / 2); assert.equal(diff.paired!.pairs.length, 2);
    const unpaired = setup([['excluded', 0.2], ['reviewed', 0.6]]);
    assert.ok(compareSummaries(unpaired.inputs, unpaired.summaries, { ...options, paired: true }).warnings.some(w => w.code === 'no-pairs'));
});

test('an unknown baseline is rejected', () => {
    const { inputs, summaries } = setup([['excluded', 0.2], ['reviewed', 0.6]]);
    assert.throws(() => compareSummaries(inputs, summaries, { ...options, baseline: 'missing' }), /baseline/);
});
