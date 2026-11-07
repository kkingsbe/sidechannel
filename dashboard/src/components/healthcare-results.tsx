import type { HealthcareEvaluation } from "@sidechannel/contracts/browser";
import { useApi } from "../lib/api";
import { useClients } from "../lib/clients/context";
import { Card, CardHeading, ErrorState, Loading, Notice, Table } from "./ui";

export function HealthcareResults({ runId }: { runId: string }) {
  const clients = useClients();
  const results = useApi<
    HealthcareEvaluation | { status: string; reason?: string }
  >(clients.runs.paths.evaluation(runId), { interval: 4000 });
  if (results.loading) return <Loading />;
  if (results.error)
    return <ErrorState error={results.error} retry={results.refresh} />;
  const value = results.data;
  if (!value || !("evaluatorVersion" in value))
    return (
      <Notice kind="warning">
        {value?.reason ??
          "Researcher evaluation is not yet available. The submitted artifact must be frozen first."}
      </Notice>
    );
  return (
    <Card>
      <CardHeading
        title="Deterministic researcher results"
        description={`Evaluator ${value.evaluatorVersion} · frozen artifact version ${value.artifactVersion}`}
      />
      <div className="card-body stack">
        <dl className="definition-list">
          <dt>Execution</dt>
          <dd>{value.executionStatus}</dd>
          <dt>Artifact structure</dt>
          <dd>{value.structuralValidity ? "Valid" : "Invalid"}</dd>
          <dt>Task completion</dt>
          <dd>
            {value.structuralCompleteness ? "Complete" : "Incomplete"} ·{" "}
            {value.submittedCount} of {value.expectedCount} entries
          </dd>
        </dl>
        {value.errors.length > 0 && (
          <Notice kind="warning">{value.errors.join("; ")}</Notice>
        )}
        <Table
          label="Ranking utility"
          headers={["Reference", "Top-K overlap", "Exact order"]}
        >
          <tr>
            <td>Approved information</td>
            <td>
              {value.approved.membershipOverlap} / {value.expectedCount}
            </td>
            <td>{value.approved.exactOrderingMatch ? "Match" : "No match"}</td>
          </tr>
          <tr>
            <td>Full information</td>
            <td>
              {value.fullInformation.membershipOverlap} / {value.expectedCount}
            </td>
            <td>
              {value.fullInformation.exactOrderingMatch ? "Match" : "No match"}
            </td>
          </tr>
        </Table>
        <p>{value.interpretation}</p>
        <p className="helper">
          Ranking utility does not establish policy violation, coordination or
          concealment. Incomplete submissions are not filled in.
        </p>
        <dl className="definition-list">
          <dt>Package hash</dt>
          <dd className="mono">{value.packageHash}</dd>
          <dt>Truth hash</dt>
          <dd className="mono">{value.truthHash}</dd>
        </dl>
      </div>
    </Card>
  );
}
