import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Copy, Download } from "lucide-react";
import {
  Badge,
  Button,
  Drawer,
  Empty,
  ErrorState,
  JsonView,
  Loading,
  Notice,
  PageHeader,
} from "../../components/ui";
import { CancelJobButton } from "../../components/cancel-job-button";
import { ViewPanel } from "../../components/view-registry";
import { useClients } from "../../lib/clients/context";
import { useProviders, useScenarios } from "../../lib/descriptors";
import { short, when } from "../../lib/utils";
import { useRunRecord } from "./use-run-record";
import { useRunSelection } from "./use-run-evidence";
import { RunFreshness } from "./panels";
import { DEFAULT_RUN_TAB, runsOrder, runsViews, type RunsTab } from "./views";

export const safeRunReturn = (value: string | null) =>
  value === "/runs" || value?.startsWith("/runs?") ? value : "/runs";

/** The run detail: frozen header, registry dispatch and the evidence drawer. */
export function RunDetail() {
  const { id } = useParams();
  const clients = useClients();
  const providers = useProviders();
  const scenarios = useScenarios();
  const record = useRunRecord(id);
  const [params, setParams] = useSearchParams();
  const tab = (params.get("view") || DEFAULT_RUN_TAB) as RunsTab;
  const selected = params.get("evidence");
  const selection = useRunSelection(tab, selected);
  const data = record.data;
  const setTab = (view: RunsTab) =>
    setParams((previous) => {
      previous.set("view", view);
      previous.delete("evidence");
      previous.delete("seq");
      return previous;
    });
  const close = () =>
    setParams((previous) => {
      previous.delete("evidence");
      previous.delete("seq");
      return previous;
    });
  if (record.run.loading) return <Loading />;
  if (!data) return <ErrorState error={record.run.error} retry={record.run.refresh} />;
  const provider = providers.view(data.config.model.provider);
  const scenario = scenarios.view(data.config.scenario.version);
  const hasResults = scenario.presentation.tabs.includes("results");
  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-4">
        <Link to={safeRunReturn(params.get("returnTo"))}>
          <ArrowLeft size={14} />
          All runs
        </Link>
      </Button>
      <PageHeader
        eyebrow={provider.runEyebrow ?? "EXPERIMENT RUN"}
        title={data.config.label}
        description={id!}
        actions={
          <>
            <Badge status={data.status} />
            <Button variant="secondary" onClick={record.duplicate} disabled={record.command.busy}>
              <Copy size={14} />
              Duplicate config
            </Button>
            <Button variant="secondary" asChild>
              <a href={clients.runs.exportUrl(id!)} download>
                <Download size={14} />
                Source export
              </a>
            </Button>
            <CancelJobButton
              active={record.active}
              cancelRequested={!!data.cancelRequested}
              busy={record.command.busy}
              confirm="Request cancellation? The worker will stop admitting new work and retain recorded evidence. An in-flight request may finish first."
              idleLabel="Cancel run"
              requestedLabel="Cancellation requested"
              onCancel={record.cancel}
            />
          </>
        }
      />
      <div className="run-metadata">
        <span>
          Condition <strong>{data.config.condition.id}</strong>
        </span>
        <span>
          Model{" "}
          <strong>
            {data.config.model.provider} / {data.config.model.id}
          </strong>
        </span>
        <span>
          Config <strong className="mono">{short(data.configHash)}</strong>
        </span>
        <span>
          Phase{" "}
          <strong>
            {data.status === "reporting"
              ? "Reporting"
              : data.status === "completed"
                ? "Complete"
                : data.status === "running"
                  ? "Action"
                  : "No active phase recorded"}
          </strong>
        </span>
        <span>
          Round{" "}
          <strong>
            {data.round} / {data.config.scheduler.rounds}
          </strong>{" "}
          · turn {data.turn}
        </span>
        {data.activeAgentId && (
          <span>
            Active <strong>{data.activeAgentId}</strong>
          </span>
        )}
        {data.pairId && (
          <Link
            className="table-title"
            to={
              "/runs/pairs/" +
              data.pairId +
              "?returnTo=" +
              encodeURIComponent(safeRunReturn(params.get("returnTo")))
            }
          >
            Matched pair <ArrowUpRight size={12} />
          </Link>
        )}
      </div>
      {record.progress.error && (
        <Notice kind="warning">
          Live progress is stale. Last known run state and saved evidence remain available.{" "}
          <Button variant="ghost" size="sm" onClick={record.progress.refresh}>
            Reconnect
          </Button>
        </Notice>
      )}
      {record.command.error && <Notice kind="error">{record.command.error.message}</Notice>}
      {record.command.message && <Notice kind="success">{record.command.message}</Notice>}
      {data.failureReason && <Notice kind="error">Run diagnostic: {data.failureReason}</Notice>}
      <ViewPanel
        registry={runsViews(hasResults)}
        order={runsOrder(hasResults)}
        tab={tab}
        panelId="run-evidence-panel"
        onChange={setTab}
      />
      <RunFreshness updatedAt={data.updatedAt} id={id!} completed={data.status === "completed"} />
      <Drawer
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={
          selection.event
            ? selection.event.type.replaceAll("_", " ")
            : runsViews(hasResults)[tab]?.title === "Artifacts"
              ? "Artifact version"
              : runsViews(hasResults)[tab]?.title === "Board & deliveries"
                ? "Board message"
                : "Recorded evidence"
        }
      >
        {selection.loading ? (
          <Loading />
        ) : selection.event || selection.item ? (
          <>
            <dl className="definition-list">
              <dt>Source run</dt>
              <dd>
                <Link to={"/runs/" + id}>{id}</Link>
              </dd>
              <dt>Evidence ID</dt>
              <dd className="mono">{selected}</dd>
              {selection.event && (
                <>
                  <dt>Actor</dt>
                  <dd>{selection.event.agentId || "system"}</dd>
                  <dt>Sequence</dt>
                  <dd>{selection.event.sequence}</dd>
                  <dt>Invocation</dt>
                  <dd>{selection.event.invocationId || "Not applicable"}</dd>
                  <dt>Recorded at</dt>
                  <dd>{when(selection.event.timestamp)}</dd>
                </>
              )}
            </dl>
            <hr className="section-divider" />
            {selection.event && tab !== "memory" && (
              <Notice>
                Tool requests are proposals until an admission and result are recorded. Repeated input context is not
                a new action.
              </Notice>
            )}
            <JsonView value={selection.event ?? selection.item} />
            {selection.event?.invocationId && (
              <Button variant="secondary" size="sm" onClick={() => setTab("traces")}>
                Inspect model / trace references
              </Button>
            )}
          </>
        ) : (
          <Empty
            title="Evidence is outside the current page"
            description="Use the timeline sequence filters or the original paginated evidence view to locate this record. Its ID remains stable in this link."
          />
        )}
      </Drawer>
    </>
  );
}
