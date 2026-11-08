import { Link } from "react-router-dom";
import { Badge, Button, Card, CardHeading } from "../ui";
import { useApi } from "../../lib/api";
import type { Tone } from "../../lib/status";
import { plural } from "./evidence-model";
import { short, when } from "../../lib/utils";

const rowsOf = <T,>(value: { items?: T[] } | T[] | undefined): T[] =>
  Array.isArray(value) ? value : (value?.items ?? []);

/** Semantic tone for dashboard job statuses (display copy stays the raw status). */
export function jobTone(status: string | undefined): Tone {
  if (status === "failed" || status === "cancelled" || status === "interrupted") return "danger";
  if (status === "completed") return "success";
  if (status === "running" || status === "reporting" || status === "preparing") return "info";
  if (status === "queued" || status === "stopping") return "warning";
  return "neutral";
}

type AnalysisSummary = {
  id: string;
  status?: string;
  createdAt?: string;
  manifest?: {
    settings?: {
      model?: string;
      windowSize?: number;
      stride?: number;
      phases?: string[];
    };
  };
};
type EvaluationSummary = {
  id: string;
  status?: string;
  createdAt?: string;
  runIds?: string[];
  settings?: { model?: { provider?: string; id?: string } };
  definition?: { revision?: number };
};
type OutcomeSummary = { outcomeId?: string; state?: string };

/** Jev analyses, oversight evaluations and reference status that already exist for a run, plus the create actions. */
export function Downstream({
  runId,
  status,
  compact = false,
}: {
  runId: string;
  status: string;
  compact?: boolean;
}) {
  const analyses = useApi<{ items?: AnalysisSummary[] }>(
    "/runs/" + encodeURIComponent(runId) + "/analyses?limit=20",
  );
  const evaluations = useApi<{ items?: EvaluationSummary[] }>(
    "/monitor-evaluations?limit=50",
  );
  const outcomes = useApi<OutcomeSummary[]>(
    "/runs/" + encodeURIComponent(runId) + "/outcomes",
  );
  const analysisRows = rowsOf<AnalysisSummary>(analyses.data).filter(
    (row) => row && typeof row.id === "string",
  );
  const evaluationRows = rowsOf<EvaluationSummary>(evaluations.data).filter(
    (row) => Array.isArray(row?.runIds) && row.runIds.includes(runId),
  );
  const references = Array.isArray(outcomes.data) ? outcomes.data : [];
  const completed = status === "completed";
  const agreed = references.filter((item) => item.state === "agreed").length;
  const content = (
    <div className="card-body stack">
      <div>
        <h3>Jev analyses</h3>
        {analyses.loading ? (
          <p className="helper">Loading…</p>
        ) : analyses.error ? (
          <p className="helper">Analyses could not be listed.</p>
        ) : analysisRows.length ? (
          <ul className="downstream-list">
            {analysisRows.map((job) => {
              const settings = job.manifest?.settings;
              return (
                <li key={job.id}>
                  <Link to={"/analysis/" + job.id}>
                    Analysis {short(job.id)}
                  </Link>
                  <Badge tone={jobTone(job.status)}>{job.status ?? "unknown"}</Badge>
                  <span className="helper">
                    {[
                      settings?.model,
                      settings?.windowSize !== undefined
                        ? `windows ${settings.windowSize} / stride ${settings.stride ?? "?"}`
                        : undefined,
                      settings?.phases?.join(" + "),
                      job.createdAt ? when(job.createdAt) : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="helper">No analyses for this run yet.</p>
        )}
      </div>
      <div>
        <h3>Oversight evaluations</h3>
        {evaluations.loading ? (
          <p className="helper">Loading…</p>
        ) : evaluations.error ? (
          <p className="helper">Evaluations could not be listed.</p>
        ) : evaluationRows.length ? (
          <ul className="downstream-list">
            {evaluationRows.map((job) => (
              <li key={job.id}>
                <Link to={"/oversight/" + job.id}>
                  Evaluation {short(job.id)}
                </Link>
                <Badge tone={jobTone(job.status)}>{job.status ?? "unknown"}</Badge>
                <span className="helper">
                  {[
                    job.settings?.model?.id,
                    job.definition?.revision !== undefined
                      ? `definition revision ${job.definition.revision}`
                      : undefined,
                    job.runIds && job.runIds.length > 1
                      ? plural(job.runIds.length, "run")
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="helper">
            No evaluations among the 50 most recent include this run.
          </p>
        )}
      </div>
      <div>
        <h3>Reference status</h3>
        <p className="helper">
          {outcomes.loading
            ? "Loading…"
            : references.length
              ? `${agreed} of ${references.length} outcomes have an agreed human reference.`
              : "No human reference reviews recorded for this run."}
        </p>
      </div>
      <div className="actions">
        {completed ? (
          <>
            <Button asChild size="sm">
              <Link to={"/analysis?run=" + runId}>New Jev analysis</Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link to={"/oversight?run=" + runId}>Configure oversight</Link>
            </Button>
          </>
        ) : (
          <span className="helper">
            Analyses and oversight can be created once the run has completed.
          </span>
        )}
      </div>
    </div>
  );
  const total = analysisRows.length + evaluationRows.length;
  return (
    <Card className={compact ? "downstream-rail" : "downstream-panel"}>
      <CardHeading
        title="Downstream"
        count={analyses.loading || evaluations.loading ? undefined : total}
        description={compact ? undefined : "Analyses, oversight evaluations and reference status built on this run."}
      />
      {content}
    </Card>
  );
}
