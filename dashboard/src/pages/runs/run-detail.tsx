import { useEffect, useState, type ComponentType } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { TurnSummary } from "@sidechannel/contracts/browser";
import {
  Button,
  Drawer,
  Empty,
  ErrorState,
  JsonView,
  Loading,
  Notice,
  Tabs,
} from "../../components/ui";
import { NotFoundView, tabItems } from "../../components/view-registry";
import { RunDiagnostic } from "../../components/run-evidence/run-diagnostic";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import { useScenarios } from "../../lib/descriptors";
import { MODEL_CALL_EVENT_TYPES } from "../../lib/model-calls";
import { when } from "../../lib/utils";
import { useRunEvents, type EventStart } from "../../lib/use-run-events";
import { ModelCallDetail } from "./ModelCallDetail";
import { RunLiveProvider, type RunLiveFilters } from "./run-live-context";
import { useRunRecord } from "./use-run-record";
import { useRunSelection } from "./use-run-evidence";
import { RunCrumbs, RunHeader } from "./RunHeader";
import { deriveTurns } from "./run-stats";
import { LiveStamp } from "./RunLive";
import "./run-detail.css";
import { DEFAULT_RUN_TAB, runsOrder, runsViews, type RunsTab } from "./views";

export const safeRunReturn = (value: string | null) =>
  value === "/runs" || value?.startsWith("/runs?") ? value : "/runs";

const EMPTY_FILTERS: RunLiveFilters = { actor: "", phase: "", type: "", from: "", to: "" };
const ACTIVE_STATUSES = ["queued", "running", "reporting", "stopping"];

/** The run detail: frozen header, live registry dispatch and the evidence drawer. */
export function RunDetail() {
  const { id } = useParams();
  const clients = useClients();
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
  const [paused, setPaused] = useState(false);
  const follow = runActive && start === "latest" && !filters.to && !paused;
  const runEvents = useRunEvents(id, filters, {
    start,
    follow,
    enabled: eventTabs && openedActive !== undefined,
  });
  const turns = useResource<{ turns: TurnSummary[] }>(
    id ? `run:${id}:turns` : null,
    () => clients.request<{ turns: TurnSummary[] }>(`/runs/${encodeURIComponent(id!)}/turns`),
    { interval: follow ? 10000 : 0 },
  );
  const jumpTo = (target: number | "end") => {
    if (target === "end") setPaused(false);
    setParams((previous) => {
      previous.set("at", String(target));
      return previous;
    });
  };
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
  const scenario = scenarios.view(data.config.scenario.version);
  const hasResults = scenario.presentation.tabs.includes("results");
  const event = selection.event ?? runEvents.events.find((item) => item.id === selected);
  const turnList = (Array.isArray(turns.data?.turns) ? turns.data!.turns : undefined) ?? (eventTabs ? deriveTurns(runEvents.events) : undefined);
  const liveValue = {
    runEvents,
    run: data,
    active: runActive,
    turns: Array.isArray(turns.data?.turns) ? turns.data!.turns : undefined,
    turnList,
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
  const returnTo = safeRunReturn(params.get("returnTo"));
  const registry = runsViews(hasResults);
  const turnRows = Array.isArray(turns.data?.turns) ? turns.data!.turns : undefined;
  const turnCount = turnRows?.length;
  const scope = turnRows
    ? `${turnCount} turns · ${turnRows.reduce((sum, turn) => sum + turn.eventCount, 0)} events in turns`
    : undefined;
  const counts: Partial<Record<RunsTab, number>> = {
    board: data.board?.length,
    artifacts: data.artifacts?.length,
    reports: data.reports?.length,
    traces: turnRows ? turnRows.reduce((sum, turn) => sum + turn.modelCalls, 0) : undefined,
  };
  const items = tabItems(registry, runsOrder(hasResults)).map((item) => ({
    ...item,
    count: counts[item.id] || undefined,
  }));
  const ActiveView = (registry as Record<string, { Component: ComponentType } | undefined>)[tab]?.Component;
  const notice = record.progress.error ? (
    <Notice kind="warning">
      Live progress is stale. Last known run state and saved evidence remain available.{" "}
      <Button variant="ghost" size="sm" onClick={record.progress.refresh}>
        Reconnect
      </Button>
    </Notice>
  ) : record.command.error ? (
    <Notice kind="error">{record.command.error.message}</Notice>
  ) : record.command.message ? (
    <Notice kind="success">{record.command.message}</Notice>
  ) : null;
  return (
    <>
      <RunCrumbs run={data} returnTo={returnTo} />
      <RunHeader
        run={data}
        id={id!}
        returnTo={returnTo}
        scope={scope}
        active={record.active}
        following={!paused}
        onFollowChange={(next) => setPaused(!next)}
        busy={record.command.busy}
        onDuplicate={record.duplicate}
        exportUrl={clients.runs.exportUrl(id!)}
        onCancel={record.cancel}
        onArchive={record.archive}
        onDelete={() => record.remove(returnTo)}
        live={record.active ? <LiveStamp updatedAt={runEvents.events.at(-1)?.timestamp ?? data.updatedAt} /> : undefined}
      />
      {notice}
      <RunDiagnostic
        runId={id!}
        status={data.status}
        failureReason={data.failureReason}
        createdAt={data.createdAt}
        updatedAt={data.updatedAt}
      />
      <RunLiveProvider value={liveValue}>
        <Tabs panelId="run-evidence-panel" value={tab} onChange={(value) => setTab(value as RunsTab)} items={items} />
        <section
          role="tabpanel"
          id="run-evidence-panel"
          {...(ActiveView ? { "aria-labelledby": `run-evidence-panel-tab-${tab}` } : { "aria-label": "Unknown view" })}
          tabIndex={0}
        >
          {ActiveView ? <ActiveView /> : <NotFoundView what={tab} />}
        </section>
        <Drawer
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) close();
          }}
          title={
            event
              ? event.type.replaceAll("_", " ")
              : registry[tab]?.title === "Artifacts"
                ? "Artifact version"
                : registry[tab]?.title === "Board"
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
                      Open in Model calls
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
