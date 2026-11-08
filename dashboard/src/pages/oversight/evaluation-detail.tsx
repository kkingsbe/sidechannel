import { useEffect, useState, type ReactElement } from "react";
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
  Table,
} from "../../components/ui";
import { useCommand } from "../../components/use-command";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import type { MonitorEvaluation, MonitorView, Projection } from "@sidechannel/contracts/browser";
import type { Run } from "../../lib/types";
import { monitorStatusMeta } from "../../lib/status";
import { short, when } from "../../lib/utils";
import { DetectionMetrics } from "./detection-metrics";
import { ProjectionInspector } from "./projection-inspector";
import { VerdictDrawer } from "./verdict-drawer";
import { VerdictMatrix, type ResultSelection } from "./verdict-matrix";
import { viewNames, views } from "./views";

/** Loads metadata (experiment, condition, pair) for source runs referenced by id. */
function useRunsMeta(runIds: string[]): Record<string, Run> {
  const clients = useClients();
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const key = runIds.join(",");
  useEffect(() => {
    let live = true;
    runIds.forEach((id) => {
      clients.runs
        .get(id)
        .then((run) => {
          if (live && run?.config)
            setRuns((previous) => ({ ...previous, [id]: run }));
        })
        .catch(() => undefined);
    });
    return () => {
      live = false;
    };
  }, [key, clients]);
  return runs;
}

/** Groups pair members together (reviewed before excluded), keeping first-seen order of groups. */
function orderSourceRuns(runIds: string[], metas: Record<string, Run>) {
  const rank = (id: string) =>
    metas[id]?.config.condition.id === "reviewed" ? 0 : 1;
  const groups = new Map<string, string[]>();
  runIds.forEach((id) => {
    const key = metas[id]?.pairId ?? id;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  });
  return [...groups.entries()].map(([key, ids]) => ({
    pairId: metas[ids[0]!]?.pairId ? key : undefined,
    runIds: [...ids].sort((a, b) => rank(a) - rank(b)),
  }));
}

function PairSummary({
  evaluation,
  metas,
  pairId,
  runIds,
}: {
  evaluation: MonitorEvaluation;
  metas: Record<string, Run>;
  pairId: string;
  runIds: string[];
}) {
  const reviewed = runIds.find(
    (id) => metas[id]?.config.condition.id === "reviewed",
  );
  const excluded = runIds.find(
    (id) => metas[id]?.config.condition.id === "excluded",
  );
  if (!reviewed || !excluded) return null;
  const verdict = (runId: string, view: MonitorView, outcomeId: string) => {
    const result = evaluation.results.find(
      (r) => r.runId === runId && r.view === view,
    );
    return (
      result?.judgments.find((j) => j.outcomeId === outcomeId)?.verdict ??
      result?.status ??
      "pending"
    );
  };
  return (
    <Card className="form-section">
      <CardHeading
        title={"Pair-aligned summary · " + metas[reviewed]!.config.label}
        description={
          <>
            Reviewed and excluded verdicts side by side ·{" "}
            <Link to={"/runs/pairs/" + pairId}>Pair {short(pairId)}</Link>
          </>
        }
      />
      <div className="card-body">
        <Table
          label={"Pair-aligned verdicts for " + pairId}
          headers={["Run-level outcome", ...views.map((v) => viewNames[v])]}
        >
          {evaluation.definition.outcomes
            .filter((o) => !o.archived)
            .map((outcome) => (
              <tr key={outcome.id}>
                <td>{outcome.name}</td>
                {views.map((view) => (
                  <td key={view}>
                    <div className="oversight-pair-cell">
                      <span>
                        Reviewed: <strong>{verdict(reviewed, view, outcome.id)}</strong>
                      </span>
                      <span>
                        Excluded: <strong>{verdict(excluded, view, outcome.id)}</strong>
                      </span>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
        </Table>
      </div>
    </Card>
  );
}

/** Runs whose source pair completed both conditions get a reviewed/excluded verdict summary. */
function PairSummaries({ evaluation }: { evaluation: MonitorEvaluation }) {
  const metas = useRunsMeta(evaluation.runIds);
  const groups = orderSourceRuns(evaluation.runIds, metas);
  return (
    <>
      {groups
        .filter((group) => group.pairId)
        .map((group) => (
          <PairSummary
            key={group.pairId}
            evaluation={evaluation}
            metas={metas}
            pairId={group.pairId!}
            runIds={group.runIds}
          />
        ))}
    </>
  );
}

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
            <Badge tone={monitorStatusMeta[data.status].tone}>{monitorStatusMeta[data.status].label}</Badge>
            <Button asChild variant="secondary">
              <a href={clients.monitor.exportUrl(id!)} download>
                <Download size={14} />
                Monitor export
              </a>
            </Button>
            {monitorStatusMeta[data.status].active && (
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
      <PairSummaries evaluation={data} />
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
