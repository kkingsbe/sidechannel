import { Link } from "react-router-dom";
import { Badge, Button, Card, CardHeading, Table } from "../../components/ui";
import { short } from "../../lib/utils";
import type {
  MonitorEvaluation,
  MonitorPreview,
  MonitorView,
  Projection,
} from "@sidechannel/contracts/browser";
import type { MonitorComparison } from "../../lib/types";
import { agreementMeta, monitorStatusMeta } from "../../lib/status";
import { viewNames, views } from "./views";

export interface ResultSelection {
  runId: string;
  view: MonitorView;
  outcomeId: string;
}

/** One card per source run: human reference column plus the four isolated monitor views. */
export function VerdictMatrix({
  evaluation,
  comparison,
  provenance,
  onSelect,
  onInspect,
}: {
  evaluation: MonitorEvaluation;
  comparison: MonitorComparison | undefined;
  provenance: { evaluation: MonitorEvaluation; preview: MonitorPreview } | undefined;
  onSelect: (selection: ResultSelection) => void;
  onInspect: (projection: Projection) => void;
}) {
  return (
    <>
      {evaluation.runIds.map((runId) => (
        <Card key={runId} className="form-section">
          <CardHeading
            title={<Link to={"/runs/" + runId}>Source run {short(runId)}</Link>}
            description="Human reference on the left; isolated monitor evidence views on the right."
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link
                  to={
                    "/oversight?view=references&run=" +
                    runId +
                    "&definition=" +
                    encodeURIComponent(evaluation.definition.id)
                  }
                >
                  Adjudicate source outcomes
                </Link>
              </Button>
            }
          />
          <Table
            label={"Evidence-view verdict matrix for " + runId}
            headers={[
              "Run-level outcome",
              "Human reference",
              ...views.map((v) => viewNames[v]),
            ]}
          >
            {evaluation.definition.outcomes
              .filter((o) => !o.archived)
              .map((outcome) => {
                const referenceRow = comparison?.comparisons
                  .find((c) => c.outcome.id === outcome.id)
                  ?.rows.find((row) => row.runId === runId);
                const reference = referenceRow?.reference;
                return (
                  <tr key={outcome.id}>
                    <td>
                      {outcome.name}
                      <small>{outcome.definition}</small>
                    </td>
                    <td>
                      {reference ? (
                        <Badge tone={agreementMeta[reference.state].tone}>{agreementMeta[reference.state].label}</Badge>
                      ) : (
                        <Badge>Unreviewed</Badge>
                      )}
                      {reference?.decision && (
                        <small>{reference.decision}</small>
                      )}
                      {reference && !reference.sourceMatches && (
                        <small>
                          Incompatible or stale reference · excluded
                        </small>
                      )}
                    </td>
                    {views.map((view) => {
                      const result = evaluation.results.find(
                        (r) => r.runId === runId && r.view === view,
                      );
                      const item = result?.judgments.find(
                        (j) => j.outcomeId === outcome.id,
                      );
                      return (
                        <td key={view}>
                          {result ? (
                            <Badge tone={monitorStatusMeta[result.status].tone}>{monitorStatusMeta[result.status].label}</Badge>
                          ) : (
                            <Badge>Pending</Badge>
                          )}
                          {item && (
                            <div style={{ marginTop: 7 }}>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                  onSelect({
                                    runId,
                                    view,
                                    outcomeId: outcome.id,
                                  })
                                }
                              >
                                {item.verdict} · evidence
                              </Button>
                            </div>
                          )}
                          {result?.error && <small>{result.error}</small>}
                          {result?.durationMs != null && (
                            <small>
                              {(result.durationMs / 1000).toFixed(1)}s
                            </small>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
          </Table>
          <div className="card-body actions" style={{ paddingTop: 15 }}>
            {provenance?.preview.runs
              .find((r) => r.runId === runId)
              ?.projections.map((p) => (
                <Button
                  variant="secondary"
                  size="sm"
                  key={p.view}
                  onClick={() => onInspect(p)}
                >
                  Preview {viewNames[p.view]}
                </Button>
              ))}
          </div>
        </Card>
      ))}
    </>
  );
}
