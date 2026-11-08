import { Link } from "react-router-dom";
import { Lane, Table } from "../ui";
import type { Run } from "../../lib/types";
import { short, when } from "../../lib/utils";
import { CONDITIONS, conditionCells, groupByPair } from "./group";
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
      {run.status === "failed" && run.failureReason && <small className="pair-failure">{run.failureReason}</small>}
    </Lane>
  );
}

/** One row per matched pair, both conditions as lanes; runs without a pair appear as single rows. */
export function PairTable({
  runs,
  detailSearch = "",
  label = "Matched pairs",
}: {
  runs: Run[];
  detailSearch?: string;
  label?: string;
}) {
  const groups = groupByPair(runs);
  return (
    <div className="responsive-rows">
      <Table label={label} headers={["Experiment · pair", "Conditions", "Updated"]}>
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
                  {group.runs[0].config?.model?.id && <> · {group.runs[0].config.model.id}</>}
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
              <td data-label="Updated" className="muted nowrap n">{when(group.updatedAt)}</td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
