import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Card,
  CardHeading,
  Empty,
  ErrorState,
  Field,
  Loading,
  Notice,
  Pager,
  Select,
  Table,
} from "../../components/ui";
import { useClients } from "../../lib/clients/context";
import { useResource, useResourcePage } from "../../lib/clients/query";
import type { AnalysisJob, AnalysisWindow } from "../../lib/analysis-types";
import { pretty, short } from "../../lib/utils";
import { useAnalysisJob } from "./use-analysis-job";
import { useAnalysisWindows } from "./use-analysis-windows";
import { ScoreTable } from "./score-table";

/** Compare two analyses of the same source; values are never interpolated across grids. */
export function CompareAnalyses() {
  const { id } = useParams();
  const clients = useClients();
  const [params, setParams] = useSearchParams();
  const job = useAnalysisJob(id);
  const windows = useAnalysisWindows(id);
  const [compareId, setCompareId] = useState(params.get("compare") || "");
  const comparison = useResource<AnalysisJob>(
    compareId ? `analysis:${compareId}` : null,
    () => clients.analyses.job(compareId),
  );
  const otherWindows = useResource<{ items: AnalysisWindow[]; nextCursor: string | null }>(
    compareId ? `analysis:${compareId}:windows` : null,
    () => clients.analyses.windows(compareId, { limit: 30 }),
  );
  const sourceJobs = useResourcePage<AnalysisJob>(
    job.job ? `analysis:${id}:runJobs` : null,
    (cursor) =>
      clients.analyses.runJobs(job.job!.runId, {
        limit: 30,
        after: cursor ?? undefined,
      }),
  );
  if (job.loading) return <Loading />;
  if (!job.job) return <ErrorState error={job.error} retry={job.refresh} />;
  const data = job.job;
  const codes = data.manifest.codebook.codes.filter(
    (c) => c.enabled && !c.archived,
  );
  const shown = codes.filter(
    (c) => !windows.visible || windows.visible.includes(c.id),
  );
  return (
    <Card>
      <CardHeading
        ruled
        title="Compare two analyses of the same source"
        description="Actual source-step grids remain separate. Values are never interpolated."
      />
      <div className="card-body an-body">
        <Field label="Comparison analysis">
          <Select
            value={compareId}
            onChange={(e) => {
              setCompareId(e.target.value);
              setParams((prev) => {
                prev.set("compare", e.target.value);
                return prev;
              });
            }}
          >
            <option value="">Choose another saved analysis</option>
            {sourceJobs.data
              .filter((j) => j.id !== data.id)
              .map((j) => (
                <option key={j.id} value={j.id}>
                  {short(j.id)} · {j.manifest.settings.model} ·{" "}
                  {j.manifest.settings.windowSize}/{j.manifest.settings.stride}
                </option>
              ))}
          </Select>
        </Field>
        {(sourceJobs.page > 0 || sourceJobs.hasMore) && (
          <Pager
            page={sourceJobs.page}
            hasMore={sourceJobs.hasMore}
            onChange={sourceJobs.onChange}
          />
        )}
        {!compareId && (
          <Empty
            title="Choose a second analysis to compare"
            description={
              sourceJobs.data.filter((j) => j.id !== data.id).length
                ? "Comparing sets two analyses of this source run side by side: their settings, then their scores window by window."
                : "This source run has no other analysis yet. Use Duplicate settings with a different window size or model, then compare the two here."
            }
          />
        )}
        {comparison.data && (
          <>
            <hr className="section-divider" />
            {comparison.data.runId !== data.runId ||
            comparison.data.manifest.evidenceHash !==
              data.manifest.evidenceHash ||
            comparison.data.manifest.configHash !== data.manifest.configHash ? (
              <Notice kind="error">
                These analyses have different source runs, configurations, or
                recorded evidence snapshots. Direct score comparison is
                unsupported.
              </Notice>
            ) : (
              <>
                {comparison.data.manifest.codebook.id !==
                  data.manifest.codebook.id && (
                  <Notice kind="warning">
                    Codebook definitions differ. Shared display names do not
                    imply semantic equivalence.
                  </Notice>
                )}
                <Table
                  label="Analysis configuration differences"
                  headers={["Setting", "This analysis", "Comparison"]}
                >
                  {(
                    [
                      "model",
                      "windowSize",
                      "stride",
                      "codebookRevisionId",
                      "evidence",
                      "phases",
                    ] as const
                  ).map((key) => (
                    <tr key={key}>
                      <th scope="row">{key}</th>
                      <td>{pretty(data.manifest.settings[key])}</td>
                      <td>{pretty(comparison.data!.manifest.settings[key])}</td>
                    </tr>
                  ))}
                </Table>
                <div className="form-grid" style={{ marginTop: 20 }}>
                  <div>
                    <h3>This analysis · actual windows</h3>
                    <ScoreTable
                      windows={windows.windows}
                      codes={shown}
                      onSelect={(window) => windows.open(window.id)}
                    />
                  </div>
                  <div>
                    <h3>Comparison · actual windows</h3>
                    <ScoreTable
                      windows={otherWindows.data?.items ?? []}
                      codes={comparison.data.manifest.codebook.codes.filter(
                        (c) => c.enabled && !c.archived,
                      )}
                      onSelect={(w) => {
                        window.location.href =
                          "/analysis/" + comparison.data!.id + "?window=" + w.id;
                      }}
                    />
                  </div>
                </div>
                <p className="helper">
                  Each side shows its current first page. Open the comparison
                  analysis for pagination and complete evidence.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
