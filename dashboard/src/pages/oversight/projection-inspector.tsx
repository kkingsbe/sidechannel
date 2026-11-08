import { Link } from "react-router-dom";
import { JsonView, Notice } from "../../components/ui";
import type { Projection } from "@sidechannel/contracts/browser";

/** Says whether a category was recorded for the run and whether this view received it. */
function availabilityText(
  projection: Projection,
  recorded: boolean,
  category: string,
) {
  const excluded = projection.excluded.includes(category);
  if (recorded)
    return excluded
      ? "recorded for this run · not included in this view"
      : "recorded for this run · included in this view";
  return excluded
    ? "not recorded for this run · not included in this view"
    : "not recorded for this run";
}

export function ProjectionInspector({ projection }: { projection: Projection }) {
  return (
    <>
      <dl className="definition-list">
        <dt>Source run</dt>
        <dd>
          <Link className="table-title" to={"/runs/" + projection.runId}>
            {projection.runId}
          </Link>
        </dd>
        <dt>Projection version</dt>
        <dd>{projection.version}</dd>
        <dt>Included categories</dt>
        <dd>{projection.included.join(", ")}</dd>
        <dt>Excluded categories</dt>
        <dd>{projection.excluded.join(", ")}</dd>
        <dt>Private memory</dt>
        <dd>
          {availabilityText(
            projection,
            projection.availability.privateMemory,
            "private memory",
          )}
        </dd>
        <dt>Provider reasoning</dt>
        <dd>
          {availabilityText(
            projection,
            projection.availability.providerReasoning,
            "provider reasoning",
          )}
        </dd>
        <dt>Input hash</dt>
        <dd className="mono">{projection.hash}</dd>
        <dt>Complete request preflight</dt>
        <dd>
          {projection.status} ·{" "}
          {projection.estimatedInputTokens.toLocaleString()} estimated input
          tokens
        </dd>
      </dl>
      <hr className="section-divider" />
      {projection.reason && <Notice kind="warning">{projection.reason}</Notice>}
      <JsonView
        value={projection.serialized}
        title="Exact serialized monitor input"
      />
    </>
  );
}
