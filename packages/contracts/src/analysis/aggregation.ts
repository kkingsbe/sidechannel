import type { BehaviorKind, BehaviorScope } from './evidence-contracts.js';
import type { AnalysisReliability, Page, PageOptions } from './jev-repository.js';

/** Read-model contracts for run-level metrics and condition comparison (v2 spec section 8). Browser-safe: types and constants only. */

/** A noul score at or above this on any `audit` code excludes the window from primary metrics (spec 8.1). */
export const AUDIT_EXCLUSION_THRESHOLD = 0.7;

/** Three-strikes rule from the control literature (spec 8.1). */
export const DEFAULT_K_STRIKES = 3;

/** The documented starting thresholds (spec 8.2). */
export const FIXED_THRESHOLDS = { yes: 0.7, no: 0.3 } as const;

/** Below this many runs per condition an interval is reported but flagged (spec 8.3). */
export const MIN_RUNS_PER_CONDITION = 5;

export const DEFAULT_BOOTSTRAP_ITERATIONS = 2000;

export const DEFAULT_CONFIDENCE = 0.95;

export interface FixedThresholds { yes: number; no: number }

/**
 * How per-code thresholds are chosen. Part of the summary cache key and stored with every comparison,
 * so two researchers see the same numbers.
 *
 * - `fixed`: the same yes/no pair for every code.
 * - `control-percentile`: per code, the `percentile` (0..1, linear interpolation) of that code's window
 *   scores across the named control analyses. `no` is the lower threshold (default 0.3); codes with no control scores fall back to the fixed pair, marked.
 * - `validated`: thresholds from the validation loop where a code has them, `fallback` (marked) otherwise.
 */
export type ThresholdPolicy =
    | ({ kind: 'fixed' } & FixedThresholds)
    | { kind: 'control-percentile'; percentile: number; controlAnalysisIds: string[]; no?: number }
    | { kind: 'validated'; fallback: FixedThresholds };

export type ThresholdSource = 'fixed' | 'control-percentile' | 'validated' | 'fallback';

/** The threshold actually applied to one code, with where it came from. `fallback` marks a validated or control code that had no data. */
export interface ResolvedThreshold extends FixedThresholds { source: ThresholdSource; controlWindows?: number }

/** Metrics over one series of window scores (spec 8.1). Thresholds are inclusive: a score equal to the threshold counts. */
export interface ScoreMetrics {
    /** Windows contributing a score. */
    windows: number;
    max: number | null; mean: number | null;
    countAbove: number; fractionAbove: number | null;
    /** End ordinal of the earliest contributing window at or above the threshold. */
    firstOccurrenceOrdinal: number | null;
    kStrikes: boolean;
    /** Windows within one floor-width (the code's probe sd) of the yes threshold; 0 when no reliability is recorded. */
    undecided: number;
}

export interface ChoiceMetrics {
    windows: number;
    /** Fraction of contributing windows that selected each label. */
    labelDistribution: Record<string, number>;
    labelCounts: Record<string, number>;
    /** Mean of the highest per-label probability. */
    meanTopProbability: number | null;
}

export interface ScoreLevelMetrics {
    windows: number;
    meanScore: number | null;
    /** Mean probability mass per level label. */
    levelDistribution: Record<string, number>;
}

export interface CodeSummary {
    codeId: string; code: string; name: string; kind: BehaviorKind; scope: BehaviorScope; questionType: 'noul' | 'choice' | 'score';
    /** Present for `noul` codes. */
    threshold?: ResolvedThreshold;
    /** Present for `noul` codes; actor-scoped windows are pooled by their maximum across actors. */
    metrics?: ScoreMetrics;
    /** Present for actor-scoped `noul` codes. */
    byActor?: Record<string, ScoreMetrics>;
    choice?: ChoiceMetrics; choiceByActor?: Record<string, ChoiceMetrics>;
    score?: ScoreLevelMetrics; scoreByActor?: Record<string, ScoreLevelMetrics>;
}

export interface CoverageSummary {
    totalWindows: number;
    /** Completed windows that were not excluded by an audit code. */
    scoredWindows: number;
    excludedByAudit: number;
    /** Gaps: windows that never produced scores. */
    oversized: number; skipped: number; failed: number;
    /** Windows still pending or running when the summary was computed. */
    unfinished: number;
    gapWindowIds: string[];
    excludedWindowIds: string[];
}

export interface AnalysisSummary {
    analysisId: string; runId: string; codebookRevisionId: string; model: string;
    policy: ThresholdPolicy; k: number; auditThreshold: number;
    /** Analyses whose scores set the control-percentile thresholds; empty for other policies. */
    controlAnalysisIds: string[];
    /** True when any code used a fallback threshold. */
    usedFallback: boolean;
    coverage: CoverageSummary;
    codes: CodeSummary[];
    reliability?: AnalysisReliability;
    computedAt: string;
}

/** Run metric a comparison differences. `kStrikes` compares the fraction of runs triggering the rule per condition. */
export const COMPARISON_METRICS = ['max', 'mean', 'countAbove', 'fractionAbove', 'kStrikes'] as const;
export type ComparisonMetric = typeof COMPARISON_METRICS[number];

export interface ComparisonRequest {
    analysisIds: string[];
    policy: ThresholdPolicy;
    metric?: ComparisonMetric;
    /** Integer seed for the bootstrap generator; recorded so the comparison reproduces. Default 1. */
    seed?: number;
    iterations?: number;
    confidence?: number;
    /** Strikes needed to trigger the k-strikes rule. Default 3. */
    k?: number;
    /** Compare each condition against this one. Default `excluded` when present, otherwise the first condition alphabetically. */
    baseline?: string;
    /** Also report the paired variant over runs sharing a `pairId`. */
    paired?: boolean;
    creator?: string;
}

/** One analysis in a comparison, tagged from its source run. */
export interface ComparisonInput { analysisId: string; runId: string; condition: string; pairId?: string }

export interface ComparisonRunValue { analysisId: string; runId: string; pairId?: string; value: number | null }

export interface ComparisonGroup { condition: string; runs: ComparisonRunValue[]; mean: number | null }

export interface BootstrapInterval { estimate: number; lower: number; upper: number; confidence: number; iterations: number }

export interface PairedDifference extends BootstrapInterval {
    pairs: { pairId: string; baseline: number; condition: number; difference: number }[];
}

/** `condition` minus `baseline`. The resampling unit is the run (or the pair), never the window. */
export interface ConditionDifference {
    baseline: string; condition: string;
    /** Resampling units: runs with a value in each group. */
    baselineRuns: number; conditionRuns: number;
    interval: BootstrapInterval | null;
    paired?: PairedDifference | null;
}

export interface ComparisonCode {
    codeId: string; code: string; name: string; threshold: ResolvedThreshold;
    groups: ComparisonGroup[]; differences: ConditionDifference[];
}

export type ComparisonWarningCode = 'few-runs' | 'single-condition' | 'no-pairs' | 'mixed-codebook' | 'threshold-fallback' | 'audit-exclusions' | 'coverage-gaps';

export interface ComparisonWarning { code: ComparisonWarningCode; message: string; condition?: string }

export interface Comparison {
    id: string; createdAt: string; creator?: string;
    inputs: ComparisonInput[]; runIds: string[];
    policy: ThresholdPolicy; metric: ComparisonMetric; seed: number; iterations: number; confidence: number; baseline: string; paired: boolean; k: number;
    controlAnalysisIds: string[];
    codes: ComparisonCode[];
    warnings: ComparisonWarning[];
}

/** Persistence port for stored comparisons. Records are immutable once written. */
export interface ComparisonStore {
    putComparison(comparison: Comparison): Promise<void>;
    getComparison(id: string): Promise<Comparison | null>;
    /** Comparisons that include an analysis of `runId`, or every comparison when omitted. */
    listComparisons(filter?: { runId?: string }, page?: PageOptions): Promise<Page<Comparison>>;
}
