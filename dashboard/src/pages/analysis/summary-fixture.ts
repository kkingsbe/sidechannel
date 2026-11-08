import type { AnalysisSummary, Comparison, ComparisonCode } from "../../lib/analysis-types";

/** A hand-built summary: one noul code with a fallback threshold, an actor breakdown, and a choice code. */
export function summaryFixture(overrides: Partial<AnalysisSummary> = {}): AnalysisSummary {
  return {
    analysisId: "analysis-a",
    runId: "source-run",
    codebookRevisionId: "revision-a",
    model: "jev-1.14.0",
    policy: { kind: "fixed", yes: 0.7, no: 0.3 },
    k: 3,
    auditThreshold: 0.7,
    controlAnalysisIds: [],
    usedFallback: false,
    coverage: { totalWindows: 9, scoredWindows: 4, excludedByAudit: 1, oversized: 1, skipped: 1, failed: 1, unfinished: 1, gapWindowIds: ["w5", "w6", "w7"], excludedWindowIds: ["w4"] },
    codes: [
      {
        codeId: "visibility", code: "VISIBILITY", name: "Visibility", kind: "behavioral", scope: "actor", questionType: "noul",
        threshold: { yes: 0.7, no: 0.3, source: "fixed" },
        metrics: { windows: 4, max: 0.9, mean: 0.55, countAbove: 3, fractionAbove: 0.75, firstOccurrenceOrdinal: 2, kStrikes: true, undecided: 1 },
        byActor: { "agent-a": { windows: 2, max: 0.8, mean: 0.55, countAbove: 1, fractionAbove: 0.5, firstOccurrenceOrdinal: 1, kStrikes: false, undecided: 0 } },
      },
      {
        codeId: "route", code: "ROUTE", name: "Route", kind: "behavioral", scope: "window", questionType: "choice",
        choice: { windows: 3, labelCounts: { board: 2, memo: 1 }, labelDistribution: { board: 2 / 3, memo: 1 / 3 }, meanTopProbability: 0.7333 },
      },
    ],
    computedAt: "2026-11-08T00:00:00Z",
    ...overrides,
  };
}

const code = (id: string, values: Record<string, (number | null)[]>, pairs: Record<string, string[]> = {}): ComparisonCode => ({
  codeId: id, code: id.toUpperCase(), name: id, threshold: { yes: 0.7, no: 0.3, source: "fixed" },
  groups: Object.entries(values).map(([condition, runs]) => ({
    condition,
    runs: runs.map((value, i) => ({ analysisId: `${condition}-${i}`, runId: `run-${condition}-${i}`, value, ...(pairs[condition]?.[i] ? { pairId: pairs[condition]![i] } : {}) })),
    mean: runs.filter((v): v is number => v !== null).reduce((a, b, _, all) => a + b / all.length, 0),
  })),
  differences: [{
    baseline: "excluded", condition: "reviewed", baselineRuns: 2, conditionRuns: 2,
    interval: { estimate: 0.5, lower: 0.4, upper: 0.7, confidence: 0.95, iterations: 2000 },
    paired: { estimate: 0.55, lower: 0.4, upper: 0.7, confidence: 0.95, iterations: 2000, pairs: [{ pairId: "pair-1", baseline: 0.2, condition: 0.9, difference: 0.7 }, { pairId: "pair-2", baseline: 0.4, condition: 0.8, difference: 0.4 }] },
  }],
});

export function comparisonFixture(overrides: Partial<Comparison> = {}): Comparison {
  return {
    id: "cmp-1", createdAt: "2026-11-08T00:00:00Z",
    inputs: [
      { analysisId: "excluded-0", runId: "run-excluded-0", condition: "excluded", pairId: "pair-1" }, { analysisId: "excluded-1", runId: "run-excluded-1", condition: "excluded", pairId: "pair-2" },
      { analysisId: "reviewed-0", runId: "run-reviewed-0", condition: "reviewed", pairId: "pair-1" }, { analysisId: "reviewed-1", runId: "run-reviewed-1", condition: "reviewed", pairId: "pair-2" },
    ],
    runIds: ["run-excluded-0", "run-excluded-1", "run-reviewed-0", "run-reviewed-1"],
    policy: { kind: "fixed", yes: 0.7, no: 0.3 }, metric: "max", seed: 7, iterations: 2000, confidence: 0.95, baseline: "excluded", paired: true, k: 3, controlAnalysisIds: [],
    codes: [code("visibility", { excluded: [0.2, 0.4], reviewed: [0.9, 0.8] }, { excluded: ["pair-1", "pair-2"], reviewed: ["pair-1", "pair-2"] })],
    warnings: [
      { code: "few-runs", condition: "excluded", message: "excluded has 2 runs; fewer than 5 per condition is too narrow a base to interpret the interval." },
      { code: "few-runs", condition: "reviewed", message: "reviewed has 2 runs; fewer than 5 per condition is too narrow a base to interpret the interval." },
    ],
    ...overrides,
  };
}
