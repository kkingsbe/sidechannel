import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeading,
  ErrorState,
  JsonView,
  Loading,
  Notice,
  PageHeader,
  Table,
} from "../../components/ui";
import { ArtifactView } from "../../components/artifact-view";
import { useClients } from "../../lib/clients/context";
import { useScenarios } from "../../lib/descriptors";
import { useResource } from "../../lib/clients/query";
import type { Run } from "../../lib/types";
import { runStatusMeta } from "../../lib/status";
import { when } from "../../lib/utils";
import { safeRunReturn } from "./run-detail";
import { configValue, settingLabel } from "./pair-settings";

export function PairCondition({ summary, returnTo }: { summary: Run; returnTo: string }) {
  const clients = useClients();
  const scenarios = useScenarios();
  const resource = useResource<Run>(`run:${summary.id}:pair-condition`, () => clients.runs.get(summary.id), { interval: 5000 });
  const run = resource.data || summary;
  const suffix = "&returnTo=" + encodeURIComponent(returnTo);
  const finals = resource.data?.artifacts?.filter((item) => item.frozen) || [];
  return (
    <Card>
      <CardHeading title={run.config.condition.id} actions={<Badge tone={runStatusMeta[run.status].tone}>{runStatusMeta[run.status].label}</Badge>} />
      <div className="card-body stack">
        <div>
          <h3>Exact condition wording</h3>
          <p className="text-block">{run.config.condition.text}</p>
        </div>
        <dl className="definition-list">
          <dt>Execution</dt>
          <dd>
            {run.status} - round {run.round} / {run.config.scheduler.rounds} - turn {run.turn}
          </dd>
          <dt>Recorded update</dt>
          <dd>{when(run.updatedAt)}</dd>
          <dt>Model</dt>
          <dd>
            {run.config.model.provider} / {run.config.model.id}
          </dd>
        </dl>
        {run.failureReason && <Notice kind="error">{run.failureReason}</Notice>}
        {resource.error && (
          <Notice kind="warning">
            Output availability could not be refreshed.{" "}
            <Button variant="ghost" onClick={resource.refresh}>
              Retry
            </Button>
          </Notice>
        )}
        <div>
          <h3>Evidence availability</h3>
          {resource.data ? (
            <p>
              {resource.data.board?.length ?? 0} board posts - {resource.data.artifacts?.length ?? 0} artifact versions -{" "}
              {resource.data.reports?.length ?? 0} final reports.{" "}
              <Link to={"/runs/" + run.id + "?view=timeline" + suffix}>Open canonical event timeline</Link>
            </p>
          ) : (
            <p>Evidence availability {resource.loading ? "is loading" : "is unknown"}.</p>
          )}
        </div>
        <div>
          <h3>Final artifacts</h3>
          {resource.loading ? (
            <p>Checking recorded artifacts - </p>
          ) : resource.data ? (
            finals.length ? (
              finals.map((item) => (
                <div key={item.version}>
                  <strong>Frozen version {item.version}</strong>
                  <ArtifactView
                    value={item.value}
                    scenarioVersion={run.config.scenario.version}
                    artifactSchemaVersion={scenarios.view(run.config.scenario.version).artifactSchemaVersion}
                  />
                </div>
              ))
            ) : (
              <p>No frozen final artifact recorded.</p>
            )
          ) : (
            <p>Artifact availability unknown.</p>
          )}
        </div>
        <div>
          <h3>Final reports</h3>
          {resource.loading ? (
            <p>Checking recorded reports - </p>
          ) : resource.data ? (
            resource.data.reports?.length ? (
              resource.data.reports.map((report) => (
                <details key={report.agentId}>
                  <summary>
                    {report.agentId} - {report.parsed === null ? "Invalid / unparsed" : "Recorded report"}
                  </summary>
                  <p className="text-block">{report.raw}</p>
                </details>
              ))
            ) : (
              <p>No final reports recorded.</p>
            )
          ) : (
            <p>Report availability unknown.</p>
          )}
        </div>
        <div className="actions">
          <Button asChild variant="secondary">
            <Link to={"/runs/" + run.id + "?view=timeline" + suffix}>Inspect evidence</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to={"/runs/" + run.id + "?view=artifacts" + suffix}>Artifact history</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to={"/runs/" + run.id + "?view=reports" + suffix}>Reports</Link>
          </Button>
        </div>
        <p className="helper">
          Missing outputs remain unavailable, including while a run is incomplete. Fetching this record does not verify
          worker health.
        </p>
      </div>
    </Card>
  );
}

export function PairDetail() {
  const clients = useClients();
  const [params] = useSearchParams();
  const { id } = useParams();
  const pair = useResource<{ runs: Run[]; configurationDifferences: unknown[]; matched: boolean }>(
    id ? `pair:${id}` : null,
    () => clients.runs.pair(id!) as Promise<{ runs: Run[]; configurationDifferences: unknown[]; matched: boolean }>,
  );
  if (pair.loading) return <Loading />;
  if (!pair.data) return <ErrorState error={pair.error} retry={pair.refresh} />;
  return (
    <>
      <PageHeader eyebrow="MATCHED EXECUTIONS" title="Pair comparison" description={id!} />
      <Notice kind={pair.data.matched ? "success" : "warning"}>
        {pair.data.matched
          ? "Frozen configurations match outside the intended condition difference."
          : "Configuration differences need review before treating these as matched conditions."}
      </Notice>
      <Button asChild variant="ghost">
        <Link to={safeRunReturn(params.get("returnTo"))}>
          <ArrowLeft size={14} />
          All runs
        </Link>
      </Button>
      <div className="pair-condition-grid">
        {pair.data.runs.map((run) => (
          <PairCondition key={run.id} summary={run} returnTo={safeRunReturn(params.get("returnTo"))} />
        ))}
        {pair.data.runs.length < 2 && (
          <Card>
            <div className="card-body">
              <h2>Other condition unavailable</h2>
              <p>The pair response does not contain a second run. The recorded run remains available.</p>
            </div>
          </Card>
        )}
      </div>
      <Card style={{ marginTop: 20 }}>
        <CardHeading title="Configuration differences" />
        <div className="card-body">
          <p>
            {pair.data.matched
              ? "All settings outside the condition match, including scenario, model, roles, scheduling, memory and reporting."
              : "Matching outside the condition has not been established."}
          </p>
          {pair.data.configurationDifferences.length ? (
            <Table
              label="Differing frozen settings"
              headers={["Setting", ...pair.data.runs.map((run) => run.config.condition.id)]}
            >
              {pair.data.configurationDifferences.map((path, index) => (
                <tr key={index}>
                  <th scope="row">{settingLabel(String(path))}</th>
                  {pair.data!.runs.map((run) => (
                    <td key={run.id} className="text-block">
                      {configValue(run.config, String(path))}
                    </td>
                  ))}
                </tr>
              ))}
            </Table>
          ) : (
            <p>No configuration differences were returned.</p>
          )}
          <JsonView value={pair.data.configurationDifferences} title="Exact differing field paths" />
          <p className="helper">
            This page compares execution and frozen settings. It does not establish model rankings or independent
            statistical evidence.
          </p>
        </div>
      </Card>
    </>
  );
}
