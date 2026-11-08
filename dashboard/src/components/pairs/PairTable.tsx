import type React from "react";
import { Link } from "react-router-dom";
import { Lane, Table } from "../ui";
import type { Run } from "../../lib/types";
import { short, when } from "../../lib/utils";
import { CONDITIONS, comparability, conditionCells, failureSentence, groupByPair } from "./group";
import "./pairs.css";

/** One lane per condition: the state pill links to the run; a failure reason sits under the lane. */
function ConditionLane({ run, condition, detailSearch }: { run?: Run; condition: string; detailSearch: string }) {
  if (!run)
    return (
      <div className={"lane lane-empty" + (condition === "excluded" ? " excluded" : "")}>
        <span className="cond">{condition}</span>
        <span className="muted small">Not recorded</span>
      </div>
    );
  return (
    <Lane
      condition={run.config?.condition?.id ?? condition}
      status={run.status}
      round={run.round}
      rounds={run.config?.scheduler?.rounds}
      turn={run.turn}
      turnsPerRound={(run.config as { roles?: unknown[] } | undefined)?.roles?.length}
      stateLink={(pill) => (
        <Link
          className="pair-cell-state"
          to={"/runs/" + run.id + detailSearch}
          aria-label={`${run.config?.condition?.id ?? "Run"} run ${short(run.id)}, ${run.status}`}
        >
          {pill}
        </Link>
      )}
    >
      {run.status === "failed" && run.failureReason && (
        <small className="pair-failure" title={run.failureReason}>
          {failureSentence(run.failureReason)}
        </small>
      )}
    </Lane>
  );
}

function ComparableCell({ runs }: { runs: Run[] }) {
  const result = comparability(runs);
  return (
    <td data-label="Comparable" className="pair-cmp-cell">
      <span className="who-chip" style={{ "--c": result.state === "yes" ? "var(--success-fg)" : "var(--amber)" } as React.CSSProperties}>
        {result.state === "yes" ? "Yes" : result.state === "pending" ? "Pending" : "No"}
      </span>
      <small>{result.reason}</small>
    </td>
  );
}

/** One row per matched pair, both conditions as lanes; runs without a pair appear as single rows. */
export function PairTable({
  runs,
  detailSearch = "",
  label = "Matched pairs",
  showComparable = false,
}: {
  runs: Run[];
  detailSearch?: string;
  label?: string;
  /** Adds the Comparable column (both conditions completed) used on the full list. */
  showComparable?: boolean;
}) {
  const groups = groupByPair(runs);
  return (
    <div className="responsive-rows">
      <Table label={label} headers={showComparable ? ["Experiment · pair", "Conditions", "Comparable", "Updated"] : ["Experiment · pair", "Conditions", "Updated"]}>
        {groups.map((group) => {
          const [first, second] = conditionCells(group.runs);
          return (
            <tr key={group.key}>
              <td data-label="Experiment · pair" className="pair-name">
                <Link
                  className="table-title"
                  to={group.pairId ? "/runs/pairs/" + encodeURIComponent(group.pairId) + detailSearch : "/runs/" + group.runs[0].id + detailSearch}
                >
                  {group.label}
                </Link>
                <small>
                  {group.runs[0].config?.scenario?.version ?? "Scenario unavailable"}
                  {group.runs[0].config?.model?.id && group.runs[0].config.model.id !== group.runs[0].config?.scenario?.version && <> · {group.runs[0].config.model.id}</>}
                  {" · "}
                  <span className="mono">{group.pairId ? short(group.pairId) : short(group.runs[0].id)}</span>
                  {!group.pairId && " · single run"}
                  {group.runs[0].config?.model?.provider === "scripted" && " · scripted fixture"}
                </small>
              </td>
              <td data-label="Conditions" className="pair-lanes">
                <div className="lanes">
                  <ConditionLane run={first} condition={CONDITIONS[0]} detailSearch={detailSearch} />
                  <ConditionLane run={second} condition={CONDITIONS[1]} detailSearch={detailSearch} />
                </div>
              </td>
              {showComparable && <ComparableCell runs={group.runs} />}
              <td data-label="Updated" className="muted nowrap n">{when(group.updatedAt)}</td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
