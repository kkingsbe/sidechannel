import { Link, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, CardHeading, Empty, ErrorState, Loading, PageHeader, Pager, Table } from "../../components/ui";
import { useApi, usePage } from "../../lib/api";
import { useClients } from "../../lib/clients/context";
import type { AnalysisJob } from "../../lib/analysis-types";
import type { Run } from "../../lib/types";
import { when } from "../../lib/utils";

export function AnalysisCollection() {
  const clients = useClients();
  const [params] = useSearchParams();
  const jobs = usePage<AnalysisJob>(clients.analyses.paths.list(), {
    interval: 5000,
    cursorKey: "cursor",
    limit: 30,
  });
  const returnTo = "/analysis" + (params.size ? "?" + params.toString() : "");
  return (
    <>
      <PageHeader
        title="Analyses"
        description="Open saved screening results or prepare a new analysis."
        actions={
          <Button asChild>
            <Link to="/analysis/new">New analysis</Link>
          </Button>
        }
      />
      <Card>
        <CardHeading title="Saved analyses" />
        {jobs.loading ? (
          <Loading />
        ) : jobs.error ? (
          <ErrorState error={jobs.error} retry={jobs.refresh} />
        ) : !jobs.data.length ? (
          <Empty
            title="No analyses yet"
            description="Choose New analysis to select a source run and frozen definitions."
          />
        ) : (
          <Table
            label="Saved analyses"
            headers={["Source and settings", "State", "Created", ""]}
          >
            {jobs.data.map((job) => (
              <AnalysisCollectionRow
                key={job.id}
                job={job}
                returnTo={returnTo}
              />
            ))}
          </Table>
        )}
        <Pager
          page={jobs.page}
          hasMore={jobs.hasMore}
          onChange={jobs.onChange}
        />
      </Card>
    </>
  );
}
export function AnalysisCollectionRow({
  job,
  returnTo,
}: {
  job: AnalysisJob;
  returnTo: string;
}) {
  const clients = useClients();
  const source = useApi<Run>(clients.runs.paths.get(job.runId));
  const target = `/analysis/${job.id}?return=${encodeURIComponent(returnTo)}`;
  return (
    <tr>
      <td>
        <Link className="table-title" to={target}>
          {source.data?.config?.label || "Source run"} -{" "}
          {source.data?.config?.condition?.id || "Condition unavailable"}
        </Link>
        <small className="analysis-id">
          {job.manifest.settings.model} - {job.manifest.settings.windowSize}
          -step windows - revision {job.manifest.codebook.revision}
        </small>
        <details>
          <summary>Canonical identifiers</summary>
          <p className="mono">
            Analysis: {job.id}
            <br />
            Source: {job.runId}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigator.clipboard.writeText(job.id)}
          >
            Copy analysis ID
          </Button>
        </details>
      </td>
      <td>
        <Badge status={job.status} />
      </td>
      <td>{when(job.createdAt)}</td>
      <td>
        <Button asChild variant="ghost" size="sm">
          <Link to={target}>Open results</Link>
        </Button>
      </td>
    </tr>
  );
}
