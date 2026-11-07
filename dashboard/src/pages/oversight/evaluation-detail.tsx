import { useState, type ReactElement } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download, Square } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeading,
  Drawer,
  ErrorState,
  JsonView,
  Loading,
  Notice,
  PageHeader,
} from "../../components/ui";
import { useCommand } from "../../components/use-command";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import type {
  MonitorEvaluation,
  MonitorPreview,
  Projection,
} from "@sidechannel/contracts/browser";
import type { MonitorComparison } from "../../lib/types";
import { short, when } from "../../lib/utils";
import { DetectionMetrics } from "./detection-metrics";
import { ProjectionInspector } from "./projection-inspector";
import { VerdictDrawer } from "./verdict-drawer";
import { VerdictMatrix, type ResultSelection } from "./verdict-matrix";
import { viewNames } from "./views";

export function evaluationName(job: MonitorEvaluation) {
  return `${job.settings.model.id} - ${job.runIds.length} source ${job.runIds.length === 1 ? "run" : "runs"} - revision ${job.definition.revision}`;
}

export function evaluationReturn(value: string | null) {
  return value === "/oversight" ||
    value?.startsWith("/oversight?") ||
    value?.startsWith("/oversight/new?")
    ? value
    : "/oversight?view=jobs";
}

/** Frozen monitor comparison detail: header, verdict matrices and the two inspectors. */
export function EvaluationDetail(): ReactElement {
  const [params] = useSearchParams();
  const { id } = useParams();
  const clients = useClients();
  const evaluation = useResource(
    id ? `oversight:evaluation:${id}` : null,
    () => clients.monitor.evaluation(id!),
    { interval: 4000 },
  );
  const comparison = useResource(
    id ? `oversight:comparison:${id}` : null,
    () => clients.monitor.comparison(id!),
    { interval: 5000 },
  );
  const provenance = useResource(
    id ? `oversight:export:${id}` : null,
    () => clients.monitor.exportEnvelope(id!),
  );
  const [projection, setProjection] = useState<Projection>();
  const [resultSelection, setResultSelection] = useState<ResultSelection>();
  const command = useCommand();
  if (evaluation.loading) return <Loading />;
  if (!evaluation.data)
    return <ErrorState error={evaluation.error} retry={evaluation.refresh} />;
  const data = evaluation.data;
  const selectedResult = data.results.find(
    (r) =>
      r.runId === resultSelection?.runId && r.view === resultSelection?.view,
  );
  const judgment = selectedResult?.judgments.find(
    (j) => j.outcomeId === resultSelection?.outcomeId,
  );
  const resultProjection = provenance.data?.preview.runs
    .find((r) => r.runId === resultSelection?.runId)
    ?.projections.find((p) => p.view === resultSelection?.view);
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link to={evaluationReturn(params.get("returnTo"))}>
          <ArrowLeft size={14} />
          Oversight workspace
        </Link>
      </Button>
      <PageHeader
        eyebrow="FROZEN MONITOR COMPARISON"
        title={evaluationName(data)}
        description={`${data.settings.model.provider}/${data.settings.model.id} · created ${when(data.createdAt)}`}
        actions={
          <>
            <Badge status={data.status} />
            <Button asChild variant="secondary">
              <a href={clients.monitor.exportUrl(id!)} download>
                <Download size={14} />
                Monitor export
              </a>
            </Button>
            {["queued", "running"].includes(data.status) && (
              <Button
                variant="destructive"
                disabled={command.busy || data.cancelRequested}
                onClick={async () => {
                  if (
                    window.confirm(
                      "Cancel remaining monitor calls? Completed view results remain available.",
                    )
                  ) {
                    await command.run(() => clients.monitor.cancel(id!));
                    void evaluation.refresh();
                  }
                }}
              >
                <Square size={13} />
                {data.cancelRequested
                  ? "Cancellation requested"
                  : "Cancel remaining"}
              </Button>
            )}
          </>
        }
      />
      <details style={{ marginBottom: 20 }}>
        <summary>Evaluation identifier</summary>
        <p className="mono">{data.id}</p>
      </details>
      {evaluation.error && (
        <Notice kind="warning">
          Connection stale: {evaluation.error.message}. Last loaded job state is
          retained.
        </Notice>
      )}
      {command.error && <Notice kind="error">{command.error.message}</Notice>}
      {comparison.error && (
        <Notice kind="warning">
          Human references unavailable: {comparison.error.message}. No detection
          rates can be inferred from missing labels.
        </Notice>
      )}
      <Notice>
        Monitor outputs and human references are separate records. Invalid
        citations or structured output are failures, not negative findings. An
        unavailable view makes a comparison partial.
      </Notice>
      <VerdictMatrix
        evaluation={data}
        comparison={comparison.data}
        provenance={provenance.data}
        onSelect={setResultSelection}
        onInspect={setProjection}
      />
      <DetectionMetrics evaluation={data} comparison={comparison.data} />
      <Card>
        <CardHeading title="Frozen monitor configuration" />
        <div className="card-body">
          <JsonView
            value={{
              definition: data.definition,
              settings: data.settings,
              previewHash: data.previewHash,
            }}
          />
          <p className="helper">
            Export scope: this monitor evaluation, frozen definitions, exact
            projections, and results. Source evidence and human reviews are
            separate linked records.
          </p>
        </div>
      </Card>
      <Drawer
        open={!!projection}
        onOpenChange={(open) => {
          if (!open) setProjection(undefined);
        }}
        title={projection ? viewNames[projection.view] : "Projection"}
      >
        {projection && <ProjectionInspector projection={projection} />}
      </Drawer>
      <VerdictDrawer
        selection={resultSelection}
        judgment={judgment}
        resultProjection={resultProjection}
        usage={selectedResult?.usage}
        onOpenChange={(open) => {
          if (!open) setResultSelection(undefined);
        }}
      />
    </>
  );
}
