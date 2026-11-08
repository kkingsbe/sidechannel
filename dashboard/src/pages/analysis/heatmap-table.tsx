import type { AnalysisWindow, BehaviorCode } from "../../lib/analysis-types";

/** The heatmap branch of the score panel: one row per behavior, one column per window. */
export function HeatmapTable({
  windows,
  codes,
  threshold,
  onSelect,
}: {
  windows: AnalysisWindow[];
  codes: BehaviorCode[];
  threshold: number;
  onSelect: (window: AnalysisWindow) => void;
}) {
  return (
    <div className="card-body" style={{ paddingTop: 20 }}>
      <div className="heatmap">
        <table aria-label="Behavior probability heatmap">
          <thead>
            <tr>
              <th>Behavior</th>
              {windows.map((w) => (
                <th key={w.id}>
                  {w.startStep}–{w.endStep}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {codes.map((code) => (
              <tr key={code.id}>
                <th scope="row">{code.code}</th>
                {windows.map((w) => {
                  const score = w.results?.find(
                    (r) => r.codeId === code.id,
                  )?.probability;
                  return (
                    <td key={w.id}>
                      <button
                        className={
                          "heat-cell " +
                          (score == null
                            ? "missing"
                            : score >= threshold
                              ? "high"
                              : "medium")
                        }
                        title={`${code.code}, steps ${w.startStep}–${w.endStep}: ${score == null ? w.error || w.status : (score * 100).toFixed(1) + "%"}`}
                        onClick={() => onSelect(w)}
                      >
                        {score == null
                          ? "—"
                          : Math.round(score * 100) + "%"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
