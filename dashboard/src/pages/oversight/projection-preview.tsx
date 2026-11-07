import { Link } from "react-router-dom";
import { Badge, Button, Card, CardHeading, Table } from "../../components/ui";
import { short } from "../../lib/utils";
import type { MonitorPreview, Projection } from "@sidechannel/contracts/browser";
import { monitorStatusMeta } from "../../lib/status";
import { viewNames } from "./views";

export function ProjectionPreview({
  preview,
  onInspect,
}: {
  preview: MonitorPreview;
  onInspect: (projection: Projection) => void;
}) {
  return (
    <Card className="form-section">
      <CardHeading
        title="Exact server-generated projections"
        description={`Definition revision ${preview.definition.revision} · ${preview.settings.model.provider}/${preview.settings.model.id} · frozen across views`}
      />
      <div className="card-body">
        <p className="helper">
          Unavailable reasoning is not evidence of absent intent. Oversized views
          are not truncated or summarized; the comparison remains partial.
        </p>
      </div>
      <Table
        label="Monitor evidence projection previews"
        headers={[
          "Source run",
          "Evidence view",
          "Input size",
          "Availability",
          "",
        ]}
      >
        {preview.runs.flatMap((run) =>
          run.projections.map((p) => (
            <tr key={run.runId + p.view}>
              <td>
                <Link className="table-title" to={"/runs/" + run.runId}>
                  {short(run.runId)}
                </Link>
              </td>
              <td>
                {viewNames[p.view]}
                <small>{p.version}</small>
              </td>
              <td>
                {p.characters.toLocaleString()} characters
                <small>
                  {p.estimatedInputTokens.toLocaleString()} estimated input
                  tokens
                </small>
              </td>
              <td>
                <Badge tone={monitorStatusMeta[p.status].tone}>
                  {monitorStatusMeta[p.status].label}
                </Badge>
                {p.reason && <small>{p.reason}</small>}
              </td>
              <td>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onInspect(p)}
                >
                  Exact input
                </Button>
              </td>
            </tr>
          )),
        )}
      </Table>
    </Card>
  );
}
