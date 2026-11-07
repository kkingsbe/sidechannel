import { Badge, Table } from "../../components/ui";
import type { AnalysisWindow, BehaviorCode } from "../../lib/analysis-types";
import { windowStatusMeta } from "../../lib/status";

export function ScoreTable({
  windows,
  codes,
  onSelect,
}: {
  windows: AnalysisWindow[];
  codes: BehaviorCode[];
  onSelect: (w: AnalysisWindow) => void;
}) {
  return (
    <Table
      label="Window probability scores"
      headers={["Source window", ...codes.map((c) => c.code), "State"]}
    >
      {windows.map((w) => (
        <tr key={w.id}>
          <td>
            <button
              className="table-title"
              style={{
                border: 0,
                background: "none",
                padding: 0,
                cursor: "pointer",
              }}
              onClick={() => onSelect(w)}
            >
              Steps {w.startStep}–{w.endStep}
            </button>
            <small>
              {w.partial
                ? "Partial window"
                : w.incomplete
                  ? "Incomplete evidence"
                  : "Fixed window"}
            </small>
          </td>
          {codes.map((code) => {
            const score = w.results?.find(
              (r) => r.codeId === code.id,
            )?.probability;
            return (
              <td key={code.id}>
                {score == null ? (
                  <span title={w.error || w.status}>— missing</span>
                ) : (
                  (score * 100).toFixed(1) + "%"
                )}
              </td>
            );
          })}
          <td>
            <Badge tone={windowStatusMeta[w.status].tone}>{windowStatusMeta[w.status].label}</Badge>
            {w.error && <small>{w.error}</small>}
          </td>
        </tr>
      ))}
    </Table>
  );
}
