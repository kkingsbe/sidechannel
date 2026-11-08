import { Link, useLocation } from "react-router-dom";
import type { ReactElement } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeading,
  Empty,
  ErrorState,
  Loading,
  Pager,
  Table,
} from "../../components/ui";
import { useClients } from "../../lib/clients/context";
import { useResourcePage } from "../../lib/clients/query";
import { monitorStatusMeta } from "../../lib/status";
import { when } from "../../lib/utils";
import { evaluationName } from "./evaluation-detail";

/** Evaluation jobs: its own cursor page, independent of setup and reference adjudication. */
export function JobsTab(): ReactElement {
  const clients = useClients();
  const location = useLocation();
  const jobs = useResourcePage(
    "oversight:jobs",
    (cursor) =>
      clients.monitor.evaluations({
        limit: 25,
        after: cursor ?? undefined,
      }),
    { interval: 5000, cursorKey: "jobCursor" },
  );
  const returnSearch =
    "?returnTo=" + encodeURIComponent(location.pathname + location.search);
  return (
    <Card>
      <CardHeading
        title="Evaluations"
        count={jobs.loading || jobs.error ? undefined : jobs.data.length + (jobs.hasMore ? "+" : "")}
        description="Each evaluation sends the same frozen questions to one monitor model under four evidence views."
        ruled
      />
      {jobs.loading ? (
        <Loading />
      ) : jobs.error ? (
        <ErrorState error={jobs.error} retry={jobs.refresh} />
      ) : jobs.data.length ? (
        <Table
          label="Monitor comparison jobs"
          headers={["Evaluation", "Source runs", "Status", "Views ready", "Updated"]}
        >
          {jobs.data.map((job) => {
            const ready = (job.results ?? []).filter((r) => r.status === "completed").length;
            return (
              <tr key={job.id}>
                <td>
                  <Link className="table-title" to={"/oversight/" + job.id + returnSearch}>
                    {evaluationName(job)}
                  </Link>
                  <small>
                    <span>{job.settings.model.provider}/{job.settings.model.id}</span> · <span className="mono">{job.id}</span>
                  </small>
                </td>
                <td>{job.runIds.length}</td>
                <td>
                  <Badge tone={monitorStatusMeta[job.status].tone}>{monitorStatusMeta[job.status].label}</Badge>
                </td>
                <td className="n">{ready}/{job.runIds.length * 4}</td>
                <td className="nowrap">{when(job.updatedAt ?? job.createdAt)}</td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <Empty
          title="No oversight comparisons yet"
          description="Open Configure & preview, choose completed runs and a monitor model, then launch the first evaluation."
        />
      )}
      {(jobs.page > 0 || jobs.hasMore || jobs.data.length > 0) && <Pager page={jobs.page} hasMore={jobs.hasMore} onChange={jobs.onChange} />}
    </Card>
  );
}
