import {
    AUDIT_EXCLUSION_THRESHOLD, DEFAULT_BOOTSTRAP_ITERATIONS, DEFAULT_CONFIDENCE, DEFAULT_K_STRIKES, FIXED_THRESHOLDS, MIN_RUNS_PER_CONDITION,
    type AnalysisSummary, type BootstrapInterval, type ChoiceMetrics, type CodeSummary, type Comparison, type ComparisonCode, type ComparisonGroup, type ComparisonInput,
    type ComparisonMetric, type ComparisonRunValue, type ComparisonWarning, type ConditionDifference, type CoverageSummary, type FixedThresholds, type PairedDifference,
    type ResolvedThreshold, type ScoreLevelMetrics, type ScoreMetrics, type ThresholdPolicy,
} from '@sidechannel/contracts/analysis/aggregation';
import type { BehaviorDefinition, BehaviorKind, BehaviorScope } from '@sidechannel/contracts/analysis/evidence-contracts';
import { AnalysisValidation, type AnalysisReliability, type AnalysisResult, type WindowRecord } from '@sidechannel/contracts/analysis/jev-repository';

/*
 * Run-level metrics and condition comparison (v2 spec section 8) as pure functions over stored windows,
 * results and the manifest's codebook definitions. Nothing here reads a store or a clock.
 */

/** Everything the metrics need about one analysis. */
export interface AggregationData { windows: WindowRecord[]; results: AnalysisResult[]; definitions: BehaviorDefinition[]; reliability?: AnalysisReliability }

type QuestionType = 'noul' | 'choice' | 'score';

interface Resolved { id: string; code: string; name: string; kind: BehaviorKind; scope: BehaviorScope; type: QuestionType }

/** v2 defaults for v1 definitions: behavioral, window-scoped, noul. */
function resolve(d: BehaviorDefinition): Resolved {
    return { id: d.id, code: d.code, name: d.name, kind: d.kind ?? 'behavioral', scope: d.scope ?? 'window', type: d.question?.type ?? 'noul' };
}

/** The noul probability of a result, or null for choice and score answers and for missing values. v1 results carry only `probability`. */
export function noulScore(r: AnalysisResult): number | null {
    if (r.answer) return r.answer.type === 'noul' ? r.answer.probability : null;
    return r.probability;
}

const mean = (values: number[]): number | null => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** Linear-interpolation percentile (numpy's default): `q` in 0..1 over unsorted `values`. */
export function percentile(values: readonly number[], q: number): number | null {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), position = Math.min(1, Math.max(0, q)) * (sorted.length - 1), low = Math.floor(position), high = Math.ceil(position);
    return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

interface Classified { included: Set<string>; completed: Set<string>; coverage: CoverageSummary }

/**
 * Splits windows into scored, audit-excluded and coverage gaps. Probe results never count. Oversized, skipped and failed windows are
 * gaps; pending and running windows are reported as unfinished. A completed window is excluded when any `audit` code scored at or
 * above `auditThreshold` (noul) for any actor.
 */
export function classifyWindows(data: AggregationData, auditThreshold = AUDIT_EXCLUSION_THRESHOLD): Classified {
    const audits = new Set(data.definitions.map(resolve).filter(d => d.kind === 'audit' && d.type === 'noul').map(d => d.id));
    const flagged = new Set<string>();
    for (const r of data.results) { if (r.probe || !audits.has(r.codeId)) continue; const s = noulScore(r); if (s !== null && s >= auditThreshold) flagged.add(r.windowId); }
    const coverage: CoverageSummary = { totalWindows: data.windows.length, scoredWindows: 0, excludedByAudit: 0, oversized: 0, skipped: 0, failed: 0, unfinished: 0, gapWindowIds: [], excludedWindowIds: [] };
    const included = new Set<string>(), completed = new Set<string>();
    for (const w of [...data.windows].sort((a, b) => a.ordinal - b.ordinal)) {
        if (w.status === 'completed') {
            completed.add(w.id);
            if (flagged.has(w.id)) { coverage.excludedByAudit++; coverage.excludedWindowIds.push(w.id); } else { coverage.scoredWindows++; included.add(w.id); }
        } else if (w.status === 'oversized') { coverage.oversized++; coverage.gapWindowIds.push(w.id); }
        else if (w.status === 'skipped') { coverage.skipped++; coverage.gapWindowIds.push(w.id); }
        else if (w.status === 'failed') { coverage.failed++; coverage.gapWindowIds.push(w.id); }
        else coverage.unfinished++;
    }
    return { included, completed, coverage };
}

interface Point { windowId: string; end: number; score: number }

/** One pooled point per window: the maximum across actors for actor-scoped codes. Actor series keep their own points. */
function noulSeries(results: AnalysisResult[], ends: Map<string, number>, windowIds: Set<string>): { pooled: Point[]; byActor: Map<string, Point[]> } {
    const pooled = new Map<string, Point>(), byActor = new Map<string, Point[]>();
    for (const r of results) {
        const score = noulScore(r), end = ends.get(r.windowId);
        if (r.probe || score === null || end === undefined || !windowIds.has(r.windowId)) continue;
        const prior = pooled.get(r.windowId);
        if (!prior || score > prior.score) pooled.set(r.windowId, { windowId: r.windowId, end, score });
        if (r.actorId !== undefined) { const list = byActor.get(r.actorId) ?? []; list.push({ windowId: r.windowId, end, score }); byActor.set(r.actorId, list); }
    }
    return { pooled: [...pooled.values()], byActor };
}

/** Spec 8.1 metrics over one series. Thresholds are inclusive; `floor` is the code's probe sd. */
export function scoreMetrics(points: readonly { end: number; score: number }[], yes: number, k: number, floor = 0): ScoreMetrics {
    const scores = points.map(p => p.score), above = points.filter(p => p.score >= yes);
    return {
        windows: points.length, max: scores.length ? Math.max(...scores) : null, mean: mean(scores),
        countAbove: above.length, fractionAbove: points.length ? above.length / points.length : null,
        firstOccurrenceOrdinal: above.length ? Math.min(...above.map(p => p.end)) : null,
        kStrikes: above.length >= k, undecided: floor > 0 ? points.filter(p => Math.abs(p.score - yes) <= floor).length : 0,
    };
}

function choiceMetrics(results: AnalysisResult[]): ChoiceMetrics {
    const counts: Record<string, number> = {}, tops: number[] = [];
    for (const r of results) {
        if (r.answer?.type !== 'choice') continue;
        counts[r.answer.choice] = (counts[r.answer.choice] ?? 0) + 1;
        const values = Object.values(r.answer.probabilities); if (values.length) tops.push(Math.max(...values));
    }
    const windows = Object.values(counts).reduce((a, b) => a + b, 0);
    return { windows, labelCounts: counts, labelDistribution: Object.fromEntries(Object.entries(counts).map(([label, n]) => [label, n / windows])), meanTopProbability: mean(tops) };
}

function scoreLevelMetrics(results: AnalysisResult[]): ScoreLevelMetrics {
    const scores: number[] = [], mass = new Map<string, number>();
    for (const r of results) {
        if (r.answer?.type !== 'score') continue;
        scores.push(r.answer.score);
        for (const [level, p] of Object.entries(r.answer.probabilities)) mass.set(level, (mass.get(level) ?? 0) + p);
    }
    return { windows: scores.length, meanScore: mean(scores), levelDistribution: Object.fromEntries([...mass].map(([level, total]) => [level, total / scores.length])) };
}

function groupByActor(results: AnalysisResult[]): Map<string, AnalysisResult[]> {
    const groups = new Map<string, AnalysisResult[]>();
    for (const r of results) if (r.actorId !== undefined) groups.set(r.actorId, [...groups.get(r.actorId) ?? [], r]);
    return groups;
}

/** Primary noul window scores per code, after audit exclusion. This is the population control-percentile thresholds are drawn from. */
export function windowScoreSeries(data: AggregationData, auditThreshold = AUDIT_EXCLUSION_THRESHOLD): Record<string, number[]> {
    const { included } = classifyWindows(data, auditThreshold), ends = new Map(data.windows.map(w => [w.id, w.endOrdinal]));
    const out: Record<string, number[]> = {};
    for (const d of data.definitions.map(resolve)) {
        if (d.type !== 'noul') continue;
        out[d.id] = noulSeries(data.results.filter(r => r.codeId === d.id), ends, included).pooled.map(p => p.score);
    }
    return out;
}

const HEAD = (d: FixedThresholds): FixedThresholds => ({ yes: d.yes, no: d.no });

/** Per-code thresholds for noul codes. Codes lacking control scores or validated thresholds fall back and are marked `fallback`. */
export function resolveThresholds(policy: ThresholdPolicy, definitions: BehaviorDefinition[], controlScores: Record<string, number[]> = {}, validated: Record<string, FixedThresholds> = {}): Record<string, ResolvedThreshold> {
    const out: Record<string, ResolvedThreshold> = {};
    for (const d of definitions.map(resolve)) {
        if (d.type !== 'noul') continue;
        if (policy.kind === 'fixed') out[d.id] = { ...HEAD(policy), source: 'fixed' };
        else if (policy.kind === 'validated') out[d.id] = validated[d.id] ? { ...HEAD(validated[d.id]!), source: 'validated' } : { ...HEAD(policy.fallback), source: 'fallback' };
        else {
            const no = policy.no ?? FIXED_THRESHOLDS.no, scores = controlScores[d.id] ?? [];
            out[d.id] = scores.length ? { yes: percentile(scores, policy.percentile)!, no, source: 'control-percentile', controlWindows: scores.length } : { yes: FIXED_THRESHOLDS.yes, no, source: 'fallback', controlWindows: 0 };
        }
    }
    return out;
}

export interface SummaryContext { analysisId: string; runId: string; codebookRevisionId: string; model: string; policy: ThresholdPolicy; thresholds: Record<string, ResolvedThreshold>; controlAnalysisIds?: string[]; k?: number; auditThreshold?: number; computedAt: string }

/** Section 8.1: run metrics for every code that has primary results (and every audit code, over all completed windows). */
export function summarize(data: AggregationData, context: SummaryContext): AnalysisSummary {
    const k = context.k ?? DEFAULT_K_STRIKES, auditThreshold = context.auditThreshold ?? AUDIT_EXCLUSION_THRESHOLD;
    const { included, completed, coverage } = classifyWindows(data, auditThreshold), ends = new Map(data.windows.map(w => [w.id, w.endOrdinal]));
    const codes: CodeSummary[] = [];
    for (const d of data.definitions.map(resolve)) {
        const own = data.results.filter(r => r.codeId === d.id && !r.probe);
        if (!own.length) continue;
        // Audit codes are summarized over every completed window so their own flags stay visible.
        const population = d.kind === 'audit' ? completed : included, scoped = own.filter(r => population.has(r.windowId));
        const summary: CodeSummary = { codeId: d.id, code: d.code, name: d.name, kind: d.kind, scope: d.scope, questionType: d.type };
        if (d.type === 'noul') {
            const threshold = context.thresholds[d.id] ?? { ...FIXED_THRESHOLDS, source: 'fixed' as const }, floor = data.reliability?.perCode[d.id]?.sd ?? 0;
            const { pooled, byActor } = noulSeries(scoped, ends, population);
            summary.threshold = threshold; summary.metrics = scoreMetrics(pooled, threshold.yes, k, floor);
            if (byActor.size) summary.byActor = Object.fromEntries([...byActor].sort(([a], [b]) => a.localeCompare(b)).map(([actor, points]) => [actor, scoreMetrics(points, threshold.yes, k, floor)]));
        } else if (d.type === 'choice') {
            summary.choice = choiceMetrics(scoped);
            const actors = groupByActor(scoped); if (actors.size) summary.choiceByActor = Object.fromEntries([...actors].map(([actor, rows]) => [actor, choiceMetrics(rows)]));
        } else {
            summary.score = scoreLevelMetrics(scoped);
            const actors = groupByActor(scoped); if (actors.size) summary.scoreByActor = Object.fromEntries([...actors].map(([actor, rows]) => [actor, scoreLevelMetrics(rows)]));
        }
        codes.push(summary);
    }
    return {
        analysisId: context.analysisId, runId: context.runId, codebookRevisionId: context.codebookRevisionId, model: context.model, policy: context.policy, k, auditThreshold,
        controlAnalysisIds: context.controlAnalysisIds ?? [], usedFallback: codes.some(c => c.threshold?.source === 'fallback'), coverage, codes,
        ...(data.reliability ? { reliability: data.reliability } : {}), computedAt: context.computedAt,
    };
}

/** Stable text for cache keys and storage: control analysis IDs are order-insensitive. */
export function policyKey(policy: ThresholdPolicy): string {
    return JSON.stringify(policy.kind === 'control-percentile' ? { ...policy, controlAnalysisIds: [...policy.controlAnalysisIds].sort() } : policy);
}

const unit = (value: unknown, name: string): number => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new AnalysisValidation(`${name} must be a number from 0 to 1`); return value; };

function fixedPair(raw: unknown, name: string): FixedThresholds {
    const v = (raw ?? {}) as Record<string, unknown>, yes = unit(v.yes, `${name}.yes`), no = unit(v.no, `${name}.no`);
    if (no > yes) throw new AnalysisValidation(`${name}.no must not exceed ${name}.yes`);
    return { yes, no };
}

/** Validates an untrusted policy (query string or request body). `undefined` means the documented fixed default. */
export function parseThresholdPolicy(raw: unknown): ThresholdPolicy {
    if (raw === undefined || raw === null) return { kind: 'fixed', ...FIXED_THRESHOLDS };
    const v = raw as Record<string, unknown>;
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new AnalysisValidation('policy must be an object');
    if (v.kind === 'fixed') return { kind: 'fixed', ...fixedPair(v, 'policy') };
    if (v.kind === 'validated') return { kind: 'validated', fallback: fixedPair(v.fallback ?? FIXED_THRESHOLDS, 'policy.fallback') };
    if (v.kind === 'control-percentile') {
        const percentileValue = unit(v.percentile, 'policy.percentile'), ids = v.controlAnalysisIds;
        if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || !id || id.length > 200)) throw new AnalysisValidation('policy.controlAnalysisIds must list 1 to 50 analysis IDs');
        return { kind: 'control-percentile', percentile: percentileValue, controlAnalysisIds: [...new Set(ids as string[])], ...(v.no === undefined ? {} : { no: unit(v.no, 'policy.no') }) };
    }
    throw new AnalysisValidation('policy.kind must be fixed, control-percentile or validated');
}

/** Run metric a comparison differences; null when the run has no score for the code. */
export function runMetricValue(code: CodeSummary, metric: ComparisonMetric): number | null {
    const m = code.metrics;
    if (!m || m.windows === 0) return null;
    return metric === 'kStrikes' ? (m.kStrikes ? 1 : 0) : metric === 'max' ? m.max : metric === 'mean' ? m.mean : metric === 'countAbove' ? m.countAbove : m.fractionAbove;
}

/** Deterministic 32-bit generator (mulberry32). */
export function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Folds a label into the user seed (FNV-1a) so each code and contrast resamples independently of evaluation order. */
export function deriveSeed(seed: number, label: string): number {
    let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
    for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
    return h;
}

/**
 * Percentile bootstrap of a difference of means. The resampling unit is the entry of each array, which callers
 * supply one per run: windows never enter. Inputs are sorted first so permuting runs cannot change the result.
 */
export function bootstrapDifference(baseline: readonly number[], condition: readonly number[], options: { seed: number; iterations?: number; confidence?: number }): BootstrapInterval | null {
    if (!baseline.length || !condition.length) return null;
    const iterations = options.iterations ?? DEFAULT_BOOTSTRAP_ITERATIONS, confidence = options.confidence ?? DEFAULT_CONFIDENCE, random = seededRandom(options.seed);
    const a = [...baseline].sort((x, y) => x - y), b = [...condition].sort((x, y) => x - y), stats: number[] = [];
    const draw = (values: number[]) => { let total = 0; for (let i = 0; i < values.length; i++) total += values[Math.floor(random() * values.length)]!; return total / values.length; };
    for (let i = 0; i < iterations; i++) stats.push(draw(b) - draw(a));
    const tail = (1 - confidence) / 2;
    return { estimate: mean(b)! - mean(a)!, lower: percentile(stats, tail)!, upper: percentile(stats, 1 - tail)!, confidence, iterations };
}

/** Differences within `pairId` first (condition minus baseline, each side averaged over its runs), then a bootstrap over pairs. */
export function pairedBootstrap(baseline: readonly ComparisonRunValue[], condition: readonly ComparisonRunValue[], options: { seed: number; iterations?: number; confidence?: number }): PairedDifference | null {
    const side = (runs: readonly ComparisonRunValue[]) => { const by = new Map<string, number[]>(); for (const r of runs) if (r.pairId && r.value !== null) by.set(r.pairId, [...by.get(r.pairId) ?? [], r.value]); return by; };
    const base = side(baseline), cond = side(condition);
    const pairs = [...base.keys()].filter(id => cond.has(id)).sort().map(pairId => { const b = mean(base.get(pairId)!)!, c = mean(cond.get(pairId)!)!; return { pairId, baseline: b, condition: c, difference: c - b }; });
    if (!pairs.length) return null;
    const interval = bootstrapDifference([0], pairs.map(p => p.difference), options)!;
    // Differences are already within pairs, so the unpaired contrast against a constant zero is a bootstrap of their mean.
    return { ...interval, pairs };
}

export interface CompareOptions { metric: ComparisonMetric; seed: number; iterations: number; confidence: number; baseline?: string; paired: boolean }

/** Section 8.3. `summaries` are one per input analysis, computed under the same threshold policy. */
export function compareSummaries(inputs: ComparisonInput[], summaries: Map<string, AnalysisSummary>, options: CompareOptions): Pick<Comparison, 'codes' | 'warnings' | 'baseline' | 'controlAnalysisIds'> {
    const conditions = [...new Set(inputs.map(i => i.condition))].sort(), warnings: ComparisonWarning[] = [];
    const baseline = options.baseline ?? (conditions.includes('excluded') ? 'excluded' : conditions[0]!);
    if (!conditions.includes(baseline)) throw new AnalysisValidation(`baseline ${baseline} is not a condition among the analyses`);
    const all = inputs.map(i => summaries.get(i.analysisId)!);
    if (conditions.length < 2) warnings.push({ code: 'single-condition', message: 'All analyses share one condition, so there is nothing to difference.' });
    for (const condition of conditions) {
        const runs = inputs.filter(i => i.condition === condition).length;
        if (runs < MIN_RUNS_PER_CONDITION) warnings.push({ code: 'few-runs', condition, message: `${condition} has ${runs} run${runs === 1 ? '' : 's'}; fewer than ${MIN_RUNS_PER_CONDITION} per condition is too narrow a base to interpret the interval.` });
    }
    if (new Set(all.map(s => `${s.codebookRevisionId}|${s.model}`)).size > 1) warnings.push({ code: 'mixed-codebook', message: 'The analyses do not share one codebook revision and model; scores are not directly comparable.' });
    if (all.some(s => s.usedFallback)) warnings.push({ code: 'threshold-fallback', message: 'Some codes used the fixed fallback threshold because the policy had no data for them.' });
    const excluded = all.reduce((n, s) => n + s.coverage.excludedByAudit, 0), gaps = all.reduce((n, s) => n + s.coverage.gapWindowIds.length, 0);
    if (excluded) warnings.push({ code: 'audit-exclusions', message: `${excluded} window${excluded === 1 ? ' was' : 's were'} excluded by audit codes across the analyses.` });
    if (gaps) warnings.push({ code: 'coverage-gaps', message: `${gaps} window${gaps === 1 ? '' : 's'} were oversized, skipped or failed and carry no scores.` });
    const reference = all[0]!, codes: ComparisonCode[] = [];
    let pairsFound = false;
    for (const code of reference.codes.filter(c => c.questionType === 'noul' && c.kind !== 'audit')) {
        const groups: ComparisonGroup[] = conditions.map(condition => {
            const runs: ComparisonRunValue[] = inputs.filter(i => i.condition === condition).map(i => {
                const found = summaries.get(i.analysisId)!.codes.find(c => c.codeId === code.codeId);
                return { analysisId: i.analysisId, runId: i.runId, ...(i.pairId ? { pairId: i.pairId } : {}), value: found ? runMetricValue(found, options.metric) : null };
            });
            return { condition, runs, mean: mean(runs.filter(r => r.value !== null).map(r => r.value!)) };
        });
        const valuesOf = (condition: string) => groups.find(g => g.condition === condition)!.runs.filter(r => r.value !== null).map(r => r.value!);
        const differences: ConditionDifference[] = conditions.filter(c => c !== baseline).map(condition => {
            const seed = deriveSeed(options.seed, `${code.codeId}|${baseline}|${condition}`), base = valuesOf(baseline), cond = valuesOf(condition), shared = { seed, iterations: options.iterations, confidence: options.confidence };
            const difference: ConditionDifference = { baseline, condition, baselineRuns: base.length, conditionRuns: cond.length, interval: bootstrapDifference(base, cond, shared) };
            if (options.paired) { difference.paired = pairedBootstrap(groups.find(g => g.condition === baseline)!.runs, groups.find(g => g.condition === condition)!.runs, { ...shared, seed: deriveSeed(seed, 'paired') }); pairsFound ||= difference.paired !== null; }
            return difference;
        });
        codes.push({ codeId: code.codeId, code: code.code, name: code.name, threshold: code.threshold!, groups, differences });
    }
    if (options.paired && !pairsFound) warnings.push({ code: 'no-pairs', message: 'No pairId is shared between the baseline and another condition, so the paired variant is empty.' });
    return { codes, warnings, baseline, controlAnalysisIds: reference.controlAnalysisIds };
}
