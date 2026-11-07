import { Badge, Button, Card, CardHeading, Empty, ErrorState, Loading, Pager, Table } from "../../components/ui";
import { Link } from "react-router-dom";
import { jobStatusMeta } from "../../lib/status";
import { short, when } from "../../lib/utils";
import type { AnalysisSetupState } from "./analysis-setup";

export function SavedAnalyses({ state }: { state: AnalysisSetupState }) {
  const { runId, jobs } = state;
  return (
    <>
          {runId && (
            <Card>
              <CardHeading
                title="Saved analyses of this run"
                description="Each settings change creates a separate reproducible result."
              />
              {jobs.loading ? (
                <Loading />
              ) : jobs.error ? (
                <ErrorState error={jobs.error} retry={jobs.refresh} />
              ) : jobs.data.length ? (
                <Table
                  label="Source analysis jobs"
                  headers={[
                    "Analysis",
                    "Model / windows",
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
                          to={"/analysis/" + job.id}
                        >
                          {short(job.id)}
                        </Link>
                      </td>
                      <td>
                        {job.manifest.settings.model} ·{" "}
                        {job.manifest.settings.windowSize}/
                        {job.manifest.settings.stride}
                      </td>
                      <td>
                        <Badge tone={jobStatusMeta[job.status].tone}>{jobStatusMeta[job.status].label}</Badge>
                      </td>
                      <td>{when(job.createdAt)}</td>
                      <td>
                        <Button asChild variant="ghost" size="sm">
                          <Link to={"/analysis/" + job.id}>Open</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty title="No analyses of this source run yet" />
              )}
              <Pager page={jobs.page} hasMore={jobs.hasMore} onChange={jobs.onChange} />
            </Card>
          )}
    </>
  );
}
