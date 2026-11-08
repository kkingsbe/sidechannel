import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Badge, Table } from "../ui";
import { runStatusMetaFor } from "../../lib/status";
import type { Run } from "../../lib/types";
import { short, when } from "../../lib/utils";
import { CONDITIONS, conditionCells, groupByPair } from "./group";
import "./pairs.css";

function ConditionCell({ run, detailSearch }: { run?: Run; detailSearch: string }) {
  if (!run) return <span className="muted">Not recorded</span>;
  return (
    <div className="pair-cell">
      <Link
        className="pair-cell-state"
        to={"/runs/" + run.id + detailSearch}
        aria-label={`${run.config?.condition?.id ?? "Run"} run ${short(run.id)}, ${run.status}`}
      >
        <Badge tone={runStatusMetaFor(run.status).tone}>{runStatusMetaFor(run.status).label}</Badge>
      </Link>
      <small>
        Round {run.round ?? 0} / {run.config?.scheduler?.rounds ?? "?"} · turn {run.turn ?? 0}
        {run.activeAgentId && ` · ${run.activeAgentId}`}
      </small>
      {run.status === "failed" && run.failureReason && <small className="pair-failure">{run.failureReason}</small>}
    </div>
  );
}

/** One row per matched pair, reviewed then excluded; runs without a pair appear as single rows. */
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
      <Table label={label} headers={["Experiment / pair", ...CONDITIONS.map((id) => id[0].toUpperCase() + id.slice(1)), "Updated"]}>
        {groups.map((group) => {
          const [first, second] = conditionCells(group.runs);
          return (
            <tr key={group.key}>
              <td data-label="Experiment / pair">
                <Link
                  className="table-title"
                  to={group.pairId ? "/runs/pairs/" + encodeURIComponent(group.pairId) + detailSearch : "/runs/" + group.runs[0].id + detailSearch}
                >
                  {group.label}
                </Link>
                <small>
                  {group.pairId ? (
                    <>Matched pair <ArrowUpRight size={11} aria-hidden="true" /></>
                  ) : (
                    <>Single run · <span className="mono">{short(group.runs[0].id)}</span></>
                  )}
                  {group.runs[0].config?.model?.provider === "scripted" && " · scripted fixture"}
                </small>
              </td>
              <td data-label="Reviewed"><ConditionCell run={first} detailSearch={detailSearch} /></td>
              <td data-label="Excluded"><ConditionCell run={second} detailSearch={detailSearch} /></td>
              <td data-label="Updated" className="muted nowrap">{when(group.updatedAt)}</td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
