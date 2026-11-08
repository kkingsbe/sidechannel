/** Pure summaries of an analysis's windows: coverage counts, flagged behaviours and heat colours. */
import type { AnalysisWindow, BehaviorCode } from "../../lib/analysis-types";
import { scoreOf, sortWindows } from "./analysis-view";

export const hasScores = (w: AnalysisWindow) => !!w.results?.length;

export interface Coverage {
  total: number;
  scored: number;
  failed: number;
  skipped: number;
  pending: number;
}

/** Scored windows carry results; the rest are failed, still pending, or skipped (oversized or empty). */
export function coverage(windows: readonly AnalysisWindow[]): Coverage {
  const out: Coverage = { total: windows.length, scored: 0, failed: 0, skipped: 0, pending: 0 };
  for (const w of windows) {
    if (hasScores(w)) out.scored++;
    else if (w.status === "failed") out.failed++;
    else if (w.status === "pending") out.pending++;
    else out.skipped++;
  }
  return out;
}

/** Why a window has no score, in one word for a table cell or tooltip. */
export function gapLabel(w: AnalysisWindow): string {
  if (w.status === "failed") return "failed";
  if (w.status === "pending") return "pending";
  if (w.status === "oversized") return "oversized";
  return "skipped";
}

export function anyAtOrAbove(w: AnalysisWindow, codes: readonly BehaviorCode[], threshold: number) {
  return codes.some((c) => {
    const s = scoreOf(w, c.id);
    return s != null && s >= threshold;
  });
}

/** Behaviours ranked by how many scored windows reach the threshold. */
export function flaggedCounts(windows: readonly AnalysisWindow[], codes: readonly BehaviorCode[], threshold: number) {
  return codes
    .map((code) => ({
      code,
      count: windows.filter((w) => {
        const s = scoreOf(w, code.id);
        return s != null && s >= threshold;
      }).length,
    }))
    .sort((a, b) => b.count - a.count);
}

export const stepLabel = (w: { startStep: number; endStep: number }) =>
  w.startStep === w.endStep ? `step ${w.endStep}` : `steps ${w.startStep}–${w.endStep}`;

export interface HighWindow {
  window: AnalysisWindow;
  value: number;
  others: { code: BehaviorCode; value: number }[];
}

/** Windows where `code` is at or above the threshold, strongest first, with the other behaviours also high there. */
export function highWindows(
  windows: readonly AnalysisWindow[],
  codes: readonly BehaviorCode[],
  code: BehaviorCode,
  threshold: number,
): HighWindow[] {
  return sortWindows(windows)
    .flatMap((window) => {
      const value = scoreOf(window, code.id);
      if (value == null || value < threshold) return [];
      const others = codes
        .filter((c) => c.id !== code.id)
        .flatMap((c) => {
          const v = scoreOf(window, c.id);
          return v != null && v >= threshold ? [{ code: c, value: v }] : [];
        });
      return [{ window, value, others }];
    })
    .sort((a, b) => b.value - a.value);
}

/** One blue ramp from 8% to 100% alpha; white ink once the cell is dark enough to need it. */
export function heatStyle(p: number): { background: string; color: string } {
  const pct = p * 100;
  return {
    background: `rgba(36,86,184,${(0.08 + 0.92 * p).toFixed(3)})`,
    color: pct >= 55 ? "#ffffff" : "#131416",
  };
}

/** The finding under the object header, computed from the windows. */
export function analysisFinding(
  windows: readonly AnalysisWindow[],
  codes: readonly BehaviorCode[],
  threshold: number,
): { lead: string; rest: string } {
  const cov = coverage(windows);
  const thr = `${Math.round(threshold * 100)}%`;
  const rest =
    (cov.skipped + cov.failed
      ? `${cov.skipped + cov.failed} of ${cov.total} windows have no score and show as gaps, never zero. `
      : "") + "Values are exploratory estimates, not calibrated accuracy or run-level labels.";
  if (!cov.scored)
    return { lead: cov.total ? "No window has a score yet." : "No windows have been prepared yet.", rest: "" };
  const top = flaggedCounts(windows, codes, threshold)[0];
  if (!top || top.count === 0)
    return { lead: `No behaviour reached ${thr} in ${cov.scored} scored windows.`, rest };
  return {
    lead: `${top.code.code} scored at or above ${thr} in ${top.count} of ${cov.scored} scored windows.`,
    rest,
  };
}
