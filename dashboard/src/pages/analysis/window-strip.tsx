import type { AnalysisWindow, BehaviorCode } from "../../lib/analysis-types";
import { anyAtOrAbove, coverage, hasScores } from "./analysis-summary";
import { sortWindows } from "./analysis-view";

/** Coverage at a glance: one cell per window, dark where any behavior reaches the threshold, hatched where unscored. */
export function WindowStrip({
  windows,
  codes,
  threshold,
}: {
  windows: AnalysisWindow[];
  codes: BehaviorCode[];
  threshold: number;
}) {
  const ordered = sortWindows(windows);
  const cov = coverage(ordered);
  const thr = Math.round(threshold * 100);
  if (!ordered.length) return <div className="small muted">No windows prepared yet.</div>;
  return (
    <div>
      <div className="an-strip-head small muted">
        <span>Coverage · {cov.total} windows</span>
        <span className="nowrap">
          {cov.scored} scored · {cov.skipped} skipped · {cov.failed} failed
        </span>
      </div>
      <div
        className="strip"
        role="img"
        aria-label={`${cov.total} source-step windows: ${cov.scored} scored, ${cov.skipped} skipped, ${cov.failed} failed`}
      >
        {ordered.map((w) => (
          <i key={w.id} className={!hasScores(w) ? "skip" : anyAtOrAbove(w, codes, threshold) ? "hi" : ""} />
        ))}
      </div>
      <div className="strip-axis">
        <span>step {ordered[0]!.endStep}</span>
        <span>dark: any behavior at or above {thr}%</span>
        <span>{ordered[ordered.length - 1]!.endStep}</span>
      </div>
    </div>
  );
}
