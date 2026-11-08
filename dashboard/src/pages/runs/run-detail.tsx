import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Copy, Download } from "lucide-react";
import type { TurnSummary } from "@sidechannel/contracts/browser";
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
import { Downstream } from "../../components/run-evidence/downstream";
import { RunDiagnostic } from "../../components/run-evidence/run-diagnostic";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import { useProviders, useScenarios } from "../../lib/descriptors";
import { MODEL_CALL_EVENT_TYPES } from "../../lib/model-calls";
import { runStatusMeta } from "../../lib/status";
import { short, when } from "../../lib/utils";
import { useRunEvents, type EventStart } from "../../lib/use-run-events";
import { ModelCallDetail } from "./ModelCallDetail";
import { RunLiveProvider, type RunLiveFilters } from "./run-live-context";
import { useRunRecord } from "./use-run-record";
import { useRunSelection } from "./use-run-evidence";
import { RunFreshness } from "./panels";
import { DEFAULT_RUN_TAB, runsOrder, runsViews, type RunsTab } from "./views";

export const safeRunReturn = (value: string | null) =>
  value === "/runs" || value?.startsWith("/runs?") ? value : "/runs";

const EMPTY_FILTERS: RunLiveFilters = { actor: "", phase: "", type: "", from: "", to: "" };
const ACTIVE_STATUSES = ["queued", "running", "reporting", "stopping"];

/** The run detail: frozen header, live registry dispatch and the evidence drawer. */
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
  const [filters, setFilters] = useState<RunLiveFilters>(EMPTY_FILTERS);
  const setFilter = (name: keyof RunLiveFilters, value: string) =>
    setFilters((previous) => ({ ...previous, [name]: value }));
  const data = record.data;
  const eventTabs = tab === "timeline" || tab === "traces";
  const status = data?.status;
  // Whether the run was active when this page opened decides the default start, so a run that
  // finishes while you watch keeps its window instead of jumping back to the first event.
  const [opened, setOpened] = useState<{ id: string; active: boolean }>();
  const openedActive = opened?.id === id ? opened?.active : undefined;
  useEffect(() => {
    if (id && openedActive === undefined && status)
      setOpened({ id, active: ACTIVE_STATUSES.includes(status) });
  }, [id, openedActive, status]);
  const at = params.get("at");
  const start: EventStart =
    at === "end"
      ? "latest"
      : at && Number.isSafeInteger(Number(at)) && Number(at) > 0
        ? Number(at)
        : openedActive || status === "failed" || status === "interrupted"
          ? "latest"
          : "first";
  const runActive = !!status && ACTIVE_STATUSES.includes(status);
  const follow = runActive && start === "latest" && !filters.to;
  const runEvents = useRunEvents(id, filters, {
    start,
    follow,
    enabled: eventTabs && openedActive !== undefined,
  });
  const turns = useResource<{ turns: TurnSummary[] }>(
    id && eventTabs ? `run:${id}:turns` : null,
    () => clients.request<{ turns: TurnSummary[] }>(`/runs/${encodeURIComponent(id!)}/turns`),
    { interval: follow ? 10000 : 0 },
  );
  const jumpTo = (target: number | "end") =>
    setParams((previous) => {
      previous.set("at", String(target));
      return previous;
    });
  const setTab = (view: RunsTab) =>
    setParams((previous) => {
      previous.set("view", view);
      previous.delete("evidence");
      previous.delete("seq");
      previous.delete("call");
      return previous;
    });
  const close = () =>
    setParams((previous) => {
      previous.delete("evidence");
      previous.delete("seq");
      return previous;
    });
  const inspect = (key: string, sequence?: number) =>
    setParams((previous) => {
      previous.set("evidence", key);
      sequence ? previous.set("seq", String(sequence)) : previous.delete("seq");
      return previous;
    });
  const focusCall = params.get("call");
  const openTraces = (invocationId: string) => {
    const alreadyThere = params.get("view") === "traces" && params.get("call") === invocationId;
    setParams((previous) => {
      previous.set("view", "traces");
      // Re-selecting the focused call must re-trigger the panel's scroll/highlight.
      if (alreadyThere) previous.delete("call");
      else previous.set("call", invocationId);
      previous.delete("evidence");
      previous.delete("seq");
      return previous;
    });
    if (alreadyThere)
      setTimeout(
        () =>
          setParams(
            (previous) => {
              previous.set("call", invocationId);
              return previous;
            },
            { replace: true },
          ),
        0,
      );
  };
  if (record.run.loading) return <Loading />;
  if (!data) return <ErrorState error={record.run.error} retry={record.run.refresh} />;
  const provider = providers.view(data.config.model.provider);
  const scenario = scenarios.view(data.config.scenario.version);
  const hasResults = scenario.presentation.tabs.includes("results");
  const event = selection.event ?? runEvents.events.find((item) => item.id === selected);
  const liveValue = {
    runEvents,
    turns: turns.data?.turns,
    follow,
    start,
    provider: data.config.model.provider,
    roles: data.config.roles.map((role) => role.id),
    focusCall,
    filters,
    setFilter,
    onInspect: inspect,
    onOpenTraces: openTraces,
    onJump: jumpTo,
  };
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
            <Badge tone={runStatusMeta[data.status].tone}>{runStatusMeta[data.status].label}</Badge>
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
        <span role="status" className="run-live-summary">
          <span>
            State <strong>{data.status}</strong>
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
      <RunDiagnostic
        runId={id!}
        status={data.status}
        failureReason={data.failureReason}
        createdAt={data.createdAt}
        updatedAt={data.updatedAt}
      />
      <Downstream runId={id!} status={data.status} />
      <RunLiveProvider value={liveValue}>
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
            event
              ? event.type.replaceAll("_", " ")
              : runsViews(hasResults)[tab]?.title === "Artifacts"
                ? "Artifact version"
                : runsViews(hasResults)[tab]?.title === "Board & deliveries"
                  ? "Board message"
                  : "Recorded evidence"
          }
        >
          {selection.loading ? (
            <Loading />
          ) : event || selection.item ? (
            <>
              <dl className="definition-list">
                <dt>Source run</dt>
                <dd>
                  <Link to={"/runs/" + id}>{id}</Link>
                </dd>
                <dt>Evidence ID</dt>
                <dd className="mono">{selected}</dd>
                {event && (
                  <>
                    <dt>Actor</dt>
                    <dd>{event.agentId || "system"}</dd>
                    <dt>Sequence</dt>
                    <dd>{event.sequence}</dd>
                    <dt>Invocation</dt>
                    <dd>{event.invocationId || "Not applicable"}</dd>
                    <dt>Recorded at</dt>
                    <dd>{when(event.timestamp)}</dd>
                  </>
                )}
              </dl>
              <hr className="section-divider" />
              {event && event.invocationId && MODEL_CALL_EVENT_TYPES.has(event.type) ? (
                <ModelCallDetail
                  event={event}
                  events={runEvents.events.length ? runEvents.events : [event]}
                  provider={data.config.model.provider}
                  onNavigate={inspect}
                  onOpenTraces={openTraces}
                />
              ) : (
                <>
                  {event && tab !== "memory" && (
                    <Notice>
                      Tool requests are proposals until an admission and result are recorded. Repeated input context
                      is not a new action.
                    </Notice>
                  )}
                  <JsonView value={event ?? selection.item} />
                  {event?.invocationId && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openTraces(event!.invocationId!)}
                    >
                      Open model call in Model &amp; traces
                    </Button>
                  )}
                </>
              )}
            </>
          ) : (
            <Empty
              title="Evidence is outside the current page"
              description="Use the timeline sequence filters or the original paginated evidence view to locate this record. Its ID remains stable in this link."
            />
          )}
        </Drawer>
      </RunLiveProvider>
    </>
  );
}
