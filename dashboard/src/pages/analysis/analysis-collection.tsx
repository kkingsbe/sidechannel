import { Link, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, CardHeading, ConditionPill, Empty, ErrorState, Loading, PageHeader, Pager, Table } from "../../components/ui";
import { useApi, usePage } from "../../lib/api";
import { useClients } from "../../lib/clients/context";
import type { AnalysisJob } from "../../lib/analysis-types";
import type { Run } from "../../lib/types";
import { jobStatusMeta } from "../../lib/status";
import { short, when } from "../../lib/utils";
import "./analysis.css";

const PAGE_SIZE = 30;

/** "3 analyses · 2 completed · 1 partial" for the rows on this page. */
function summarize(jobs: AnalysisJob[]) {
  const counts = new Map<string, number>();
  for (const job of jobs) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
  const parts = [...counts].map(([status, n]) => `${n} ${jobStatusMeta[status as AnalysisJob["status"]].label}`);
  return `${jobs.length} ${jobs.length === 1 ? "analysis" : "analyses"}${parts.length ? " · " + parts.join(" · ") : ""}`;
}

export function AnalysisCollection() {
  const clients = useClients();
  const [params] = useSearchParams();
  const jobs = usePage<AnalysisJob>(clients.analyses.paths.list(), {
    interval: 5000,
    cursorKey: "cursor",
    limit: PAGE_SIZE,
  });
  const returnTo = "/analysis" + (params.size ? "?" + params.toString() : "");
  const first = jobs.page * PAGE_SIZE + 1;
  return (
    <>
      <PageHeader
        title="Analyses"
        description={
          jobs.loading || jobs.error ? (
            "Jev screens each source run window by window for behavior codes."
          ) : jobs.data.length ? (
            <strong>{summarize(jobs.data)}</strong>
          ) : (
            "No analyses have been saved yet."
          )
        }
        actions={
          <Button asChild>
            <Link to="/analysis/new">New analysis</Link>
          </Button>
        }
      />
      <Card>
        <CardHeading
          ruled
          title="Saved analyses"
          count={jobs.data.length ? `${first}–${first + jobs.data.length - 1}${jobs.hasMore ? "+" : ""}` : undefined}
        />
        {jobs.loading ? (
          <Loading />
        ) : jobs.error ? (
          <ErrorState error={jobs.error} retry={jobs.refresh} />
        ) : !jobs.data.length ? (
          <Empty
            title="No analyses yet"
            description="Choose New analysis to select a source run and frozen definitions."
          >
            <Button asChild variant="secondary" size="sm">
              <Link to="/analysis/new">New analysis</Link>
            </Button>
          </Empty>
        ) : (
          <Table
            label="Saved analyses"
            headers={["Source and settings", "Condition", "State", "Created", ""]}
          >
            {jobs.data.map((job) => (
              <AnalysisCollectionRow key={job.id} job={job} returnTo={returnTo} />
            ))}
          </Table>
        )}
        <Pager page={jobs.page} hasMore={jobs.hasMore} onChange={jobs.onChange} />
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
  const meta = jobStatusMeta[job.status];
  return (
    <tr>
      <td>
        <Link className="table-title" to={target}>
          {source.data?.config?.label || "Source run"}
        </Link>
        <small>
          {job.manifest.settings.model} · {job.manifest.settings.windowSize}-step windows · revision{" "}
          {job.manifest.codebook.revision} ·{" "}
          <span className="mono">{short(job.id)}</span>
        </small>
        <details className="an-ids">
          <summary>Source identifiers</summary>
          <p className="mono">
            Analysis: {job.id}
            <br />
            Source: {job.runId}
          </p>
          <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(job.id)}>
            Copy analysis ID
          </Button>
        </details>
      </td>
      <td>
        {source.data?.config?.condition?.id ? (
          <ConditionPill condition={source.data.config.condition.id} />
        ) : (
          <span className="faint">—</span>
        )}
      </td>
      <td>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </td>
      <td className="nowrap">{when(job.createdAt)}</td>
      <td className="n">
        <Button asChild variant="ghost" size="sm">
          <Link to={target}>Open results</Link>
        </Button>
      </td>
    </tr>
  );
}
