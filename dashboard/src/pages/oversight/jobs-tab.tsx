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
import type { MonitorEvaluation } from "@sidechannel/contracts/browser";
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
        title="Monitor evaluation jobs"
        description="Each comparison has its own lifecycle, separate from experiment and analysis jobs."
      />
      {jobs.loading ? (
        <Loading />
      ) : jobs.error ? (
        <ErrorState error={jobs.error} retry={jobs.refresh} />
      ) : jobs.data.length ? (
        <Table
          label="Monitor comparison jobs"
          headers={[
            "Evaluation",
            "Frozen monitor model",
            "Sources / definitions",
            "State",
            "Created",
            "",
          ]}
        >
          {jobs.data.map((job) => (
            <tr key={job.id}>
              <td>
                <Link
                  className="table-title"
                  to={"/oversight/" + job.id + returnSearch}
                >
                  {evaluationName(job)}
                </Link>
                <small>{when(job.createdAt)}</small>
                <details>
                  <summary>Evaluation identifier</summary>
                  <span className="mono">{job.id}</span>
                </details>
              </td>
              <td>
                {job.settings.model.provider}/{job.settings.model.id}
              </td>
              <td>
                {job.runIds.length} runs · revision {job.definition.revision}
              </td>
              <td>
                <Badge status={job.status} />
              </td>
              <td>{when(job.createdAt)}</td>
              <td>
                <Button asChild variant="ghost" size="sm">
                  <Link to={"/oversight/" + job.id + returnSearch}>
                    Inspect
                  </Link>
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty
          title="No oversight comparisons yet"
          description="Preview evidence and explicitly launch the first independent monitor comparison."
        />
      )}
      <Pager
        page={jobs.page}
        hasMore={jobs.hasMore}
        onChange={jobs.onChange}
      />
    </Card>
  );
}
