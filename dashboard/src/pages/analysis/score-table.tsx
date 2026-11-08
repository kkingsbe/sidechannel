import { Badge } from "../../components/ui";
import type { AnalysisWindow, BehaviorCode } from "../../lib/analysis-types";
import { windowStatusMeta } from "../../lib/status";
import { gapLabel, hasScores } from "./analysis-summary";
import { percent, scoreOf } from "./analysis-view";

/** Whole-percent scores per window; one muted cell spans a window that has none. */
export function ScoreTable({
  windows,
  codes,
  threshold = 0.7,
  onSelect,
}: {
  windows: AnalysisWindow[];
  codes: BehaviorCode[];
  threshold?: number;
  onSelect: (w: AnalysisWindow) => void;
}) {
  return (
    <div className="an-scores">
      <table aria-label="Window probability scores">
        <thead>
          <tr>
            <th scope="col">Source window</th>
            {codes.map((c) => (
              <th key={c.id} scope="col" className="n">
                {c.code}
              </th>
            ))}
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {windows.map((w) => (
            <tr key={w.id}>
              <td>
                <button type="button" className="table-title an-plain" onClick={() => onSelect(w)}>
                  Steps {w.startStep}–{w.endStep}
                </button>
                {(w.partial || w.incomplete) && (
                  <small>{w.partial ? "Partial window" : "Incomplete evidence"}</small>
                )}
              </td>
              {hasScores(w) ? (
                codes.map((code) => {
                  const score = scoreOf(w, code.id);
                  return (
                    <td key={code.id} className="n">
                      {score == null ? (
                        <span className="faint">—</span>
                      ) : (
                        <span className={"an-val" + (score >= threshold ? " hi" : "")}>
                          {percent(score)}%
                        </span>
                      )}
                    </td>
                  );
                })
              ) : (
                <td colSpan={Math.max(1, codes.length)} className="muted an-gaprow" title={w.error || w.status}>
                  {gapLabel(w)}
                </td>
              )}
              <td>
                <span title={w.error || undefined}>
                  <Badge tone={windowStatusMeta[w.status].tone}>{windowStatusMeta[w.status].label}</Badge>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
