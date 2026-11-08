/** Pure view helpers for the run summary panel and the condition comparison page (v2 spec section 8). */
import type { AnalysisSummary, ThresholdPolicy } from "../../lib/analysis-types";

export const DEFAULT_POLICY: ThresholdPolicy = { kind: "fixed", yes: 0.7, no: 0.3 };

/** The editable fields behind the policy picker; text so fields can be cleared while typing. */
export interface PolicyDraft {
  kind: ThresholdPolicy["kind"];
  yes: string;
  no: string;
  percentile: string;
  controls: string;
}

export const draftOf = (policy: ThresholdPolicy): PolicyDraft => ({
  kind: policy.kind,
  yes: policy.kind === "fixed" ? String(policy.yes) : policy.kind === "validated" ? String(policy.fallback.yes) : "0.7",
  no: policy.kind === "fixed" ? String(policy.no) : policy.kind === "validated" ? String(policy.fallback.no) : String(policy.no ?? 0.3),
  percentile: policy.kind === "control-percentile" ? String(policy.percentile) : "0.95",
  controls: policy.kind === "control-percentile" ? policy.controlAnalysisIds.join(", ") : "",
});

/** The policy a draft describes, or the reason it is not valid yet. Mirrors the server rules so errors show before a request. */
export function policyOf(draft: PolicyDraft): { policy: ThresholdPolicy } | { error: string } {
  const unit = (text: string) => (text.trim() === "" ? NaN : Number(text));
  const inRange = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  if (draft.kind === "control-percentile") {
    const percentile = unit(draft.percentile);
    const ids = [...new Set(draft.controls.split(/[\s,]+/).filter(Boolean))];
    if (!inRange(percentile)) return { error: "Percentile must be from 0 to 1." };
    if (!ids.length) return { error: "Name at least one control analysis." };
    const no = unit(draft.no);
    return { policy: { kind: "control-percentile", percentile, controlAnalysisIds: ids, ...(inRange(no) ? { no } : {}) } };
  }
  const yes = unit(draft.yes);
  const no = unit(draft.no);
  if (!inRange(yes) || !inRange(no)) return { error: "Thresholds must be from 0 to 1." };
  if (no > yes) return { error: "The no threshold cannot exceed the yes threshold." };
  return { policy: draft.kind === "fixed" ? { kind: "fixed", yes, no } : { kind: "validated", fallback: { yes, no } } };
}

/** One line saying where the numbers came from, shown with every summary. */
export function provenanceLine(summary: AnalysisSummary): string {
  const { policy } = summary;
  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
  if (policy.kind === "fixed") return `Fixed thresholds: yes at or above ${pct(policy.yes)}, no at or below ${pct(policy.no)}.`;
  if (policy.kind === "validated")
    return `Validated thresholds where the validation loop set them; ${summary.usedFallback ? `fixed fallback ${pct(policy.fallback.yes)} / ${pct(policy.fallback.no)} marked below for the rest` : "every code had one"}.`;
  const windows = summary.codes.reduce((n, c) => n + (c.threshold?.controlWindows ?? 0), 0);
  return `Control ${pct(policy.percentile)} percentile of ${windows} window scores from ${summary.controlAnalysisIds.length} control ${summary.controlAnalysisIds.length === 1 ? "analysis" : "analyses"}${summary.usedFallback ? "; codes without control scores use the fixed fallback, marked below" : ""}.`;
}

export const SOURCE_LABELS = { fixed: "fixed", "control-percentile": "control percentile", validated: "validated", fallback: "fallback" } as const;

export const pct = (value: number | null | undefined) => (value == null ? "–" : `${Math.round(value * 100)}%`);

export const num = (value: number | null | undefined, digits = 2) => (value == null ? "–" : String(Math.round(value * 10 ** digits) / 10 ** digits));

/** Audit-excluded windows are hatched; the floor band is the probe sd either side of the threshold, clipped to 0..1. */
export function floorBand(threshold: number, sd: number | undefined): { low: number; high: number } | undefined {
  if (!sd || sd <= 0) return undefined;
  return { low: Math.max(0, threshold - sd), high: Math.min(1, threshold + sd) };
}
