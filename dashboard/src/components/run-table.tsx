import { NavLink } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Badge, Button, Table } from "./ui";
import type { Run } from "../lib/types";
import { short, when } from "../lib/utils";

/** The run summary table shared by Overview and Runs; no page owns it. */
export function RunTable({
  runs,
  detailSearch = "",
}: {
  runs: Run[];
  detailSearch?: string;
}) {
  return (
    <Table
      label="Experiment runs"
      headers={[
        "Run / scenario",
        "Condition",
        "Model",
        "State",
        "Progress",
        "Updated",
        "",
      ]}
    >
      {runs.map((run) => (
        <tr key={run.id}>
          <td>
            <NavLink className="table-title" to={"/runs/" + run.id + detailSearch}>
              {run.config?.label || short(run.id)}
            </NavLink>
            <small>
              {run.config?.scenario?.version || "Scenario unavailable"} ·{" "}
              <span className="mono">{short(run.id)}</span>
            </small>
            {run.config?.model?.provider === "scripted" && (
              <Badge>Scripted fixture</Badge>
            )}
          </td>
          <td>
            <Badge>{run.config?.condition?.id || "Unknown"}</Badge>
            <small>{run.config?.phase || "Unspecified"}</small>
          </td>
          <td>
            <span className="mono">{run.config?.model?.id || "Unavailable"}</span>
            <small>{run.config?.model?.provider}</small>
          </td>
          <td>
            <Badge status={run.status} />
          </td>
          <td>
            {run.round ?? 0} / {run.config?.scheduler?.rounds ?? "?"} rounds
            <small>
              Turn {run.turn ?? 0}
              {run.activeAgentId && ` · ${run.activeAgentId}`}
            </small>
          </td>
          <td className="muted nowrap">{when(run.updatedAt)}</td>
          <td>
            <Button asChild variant="ghost" size="icon">
              <NavLink
                aria-label={
                  "Inspect " +
                  (run.config?.label || "run") +
                  " · " +
                  (run.config?.condition?.id || "") +
                  " · " +
                  run.id
                }
                to={"/runs/" + run.id + detailSearch}
              >
                <ArrowUpRight size={18} />
              </NavLink>
            </Button>
          </td>
        </tr>
      ))}
    </Table>
  );
}
