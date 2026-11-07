import { Link } from "react-router-dom";
import { JsonView, Notice } from "../../components/ui";
import type { Projection } from "@sidechannel/contracts/browser";

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
        <dt>Private memory available</dt>
        <dd>
          {projection.availability.privateMemory
            ? "Recorded"
            : "Unavailable or excluded"}
        </dd>
        <dt>Provider reasoning available</dt>
        <dd>
          {projection.availability.providerReasoning
            ? "Recorded"
            : "Unavailable or excluded"}
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
