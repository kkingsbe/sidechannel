import { useEffect, useRef, useState } from "react";
import {
  Link,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Copy,
  Download,
  Filter,
  RefreshCw,
  Square,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeading,
  Drawer,
  Empty,
  ErrorState,
  Field,
  Input,
  JsonView,
  Loading,
  Notice,
  PageHeader,
  Pager,
  Select,
  Table,
  Tabs,
} from "../components/ui";
import { ApiError, arrayOf, post, useApi, useMutation } from "../lib/api";
import type { ArtifactVersion, Draft, HarnessEvent, Run } from "../lib/types";
import { pretty, short, when } from "../lib/utils";
import { RunTable } from "../App";
import { PairTable } from "../components/pairs/PairTable";
import "./runs-oversight.css";
import { ArtifactView } from "../components/artifact-view";
import { BudgetSummary } from "../components/budget-summary";
import { HealthcareResults } from "../components/healthcare-results";
import { MODEL_CALL_EVENT_TYPES, type PageNav } from "../lib/model-calls";
import { TimelinePanel } from "./runs/TimelinePanel";
import { TracesPanel } from "./runs/TracesPanel";
import { ReadableValue } from "../components/readable-value";
import { BoardDeliveries } from "../components/run-evidence/board-deliveries";
import { Downstream } from "../components/run-evidence/downstream";
import {
  ACTIVITY_EVENT_TYPES,
  activityByAgent,
  assessComparability,
  eventLink,
  isTerminal,
  orderByCondition,
  plural,
  roundTurn,
} from "../components/run-evidence/evidence-model";
import { MemoryPanel } from "../components/run-evidence/memory-panel";
import { RunDiagnostic } from "../components/run-evidence/run-diagnostic";
import {
  ActivityStrip,
  ReportSections,
} from "../components/run-evidence/report-sections";
import { DiffView } from "../components/run-evidence/line-diff";
import {
  EVENT_PAGE_SIZE,
  findLatestSequence,
  useRunEventsByType,
} from "../components/run-evidence/use-run-events";
import { ModelCallDetail } from "./runs/ModelCallDetail";
type RecordPage<T> = {
  items: T[];
  nextOffset?: number | null;
  total?: number;
  posts?: T[];
  deliveries?: HarnessEvent[];
  reporting?: { instructions: string; schemaVersion: string };
  deliveriesMayHaveMore?: boolean;
};
const RUNS_VIEW_KEY = "sidechannel-runs-view";
export default function Runs() {
  return (
    <Routes>
      <Route index element={<RunList />} />
      <Route path=":id" element={<RunDetail />} />
      <Route path="pairs/:id" element={<PairDetail />} />
    </Routes>
  );
}
function RunList() {
  const [params, setParams] = useSearchParams();
  const offset = Number(params.get("offset") || 0);
  const query = new URLSearchParams(params);
  query.set("summary", "true");
  query.set("limit", "25");
  const runs = useApi<RecordPage<Run>>("/runs?" + query, 5000);
  const items = arrayOf(runs.data);
  const [view, setViewState] = useState<"pairs" | "runs">(() => {
    try {
      return localStorage.getItem(RUNS_VIEW_KEY) === "runs" ? "runs" : "pairs";
    } catch {
      return "pairs";
    }
  });
  const setView = (next: "pairs" | "runs") => {
    setViewState(next);
    try {
      localStorage.setItem(RUNS_VIEW_KEY, next);
    } catch {
      /* Convenience only. */
    }
  };
  const returnSearch =
    "?returnTo=" +
    encodeURIComponent("/runs" + (params.size ? "?" + params.toString() : ""));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = ["status", "model", "condition", "scenario", "designation"].filter((key) => params.get(key)).length;
  const filter = (key: string, value: string) => {
    setParams((previous) => {
      value ? previous.set(key, value) : previous.delete(key);
      previous.delete("offset");
      return previous;
    });
  };
  return (
    <>
      <PageHeader
        eyebrow="CANONICAL SOURCE RECORD"
        title="Experiment runs"
        description="Follow execution, inspect evidence, and navigate matched conditions."
        actions={
          <Button asChild>
            <Link to="/experiments/new">New experiment</Link>
          </Button>
        }
      />
      <Card>
        <Button
          variant="secondary"
          size="sm"
          className="filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls="run-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <Filter size={14} aria-hidden="true" />
          Filters{activeFilters ? ` (${activeFilters})` : ""}
        </Button>
        <div
          id="run-filters"
          className={"filter-bar filter-bar-collapsible" + (filtersOpen ? " filters-open" : "")}
        >
          <Filter size={16} className="muted" aria-hidden="true" />
          <div className="filter-fields">
          <Field label="Execution state">
            <Select
              value={params.get("status") || ""}
              onChange={(e) => filter("status", e.target.value)}
            >
              <option value="">All states</option>
              <option value="running,reporting,stopping">Active runs</option>
              <option value="failed,interrupted">Needs attention</option>
              {[
                "queued",
                "running",
                "reporting",
                "stopping",
                "completed",
                "failed",
                "cancelled",
                "interrupted",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="Model">
            <Input
              value={params.get("model") || ""}
              placeholder="Any model"
              onChange={(e) => filter("model", e.target.value)}
            />
          </Field>
          <Field label="Condition">
            <Select
              value={params.get("condition") || ""}
              onChange={(e) => filter("condition", e.target.value)}
            >
              <option value="">Both conditions</option>
              <option>reviewed</option>
              <option>excluded</option>
            </Select>
          </Field>
          <Field label="Scenario">
            <Input
              value={params.get("scenario") || ""}
              placeholder="Any scenario"
              onChange={(e) => filter("scenario", e.target.value)}
            />
          </Field>
          <Field label="Designation">
            <Select
              value={params.get("designation") || ""}
              onChange={(e) => filter("designation", e.target.value)}
            >
              <option value="">All designations</option>
              <option>fixture</option>
              <option>development</option>
              <option>pilot</option>
              <option>study</option>
            </Select>
          </Field>
          </div>
          <div className="view-toggle" role="group" aria-label="List view">
            {(["pairs", "runs"] as const).map((option) => (
              <Button
                key={option}
                variant={view === option ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={view === option}
                onClick={() => setView(option)}
              >
                {option === "pairs" ? "Pairs" : "Runs"}
              </Button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh run list"
            onClick={runs.refresh}
          >
            <RefreshCw size={16} />
          </Button>
        </div>
        {runs.error && <ErrorState error={runs.error} retry={runs.refresh} />}
        {runs.loading ? (
          <Loading />
        ) : items.length ? (
          view === "pairs" ? (
            <PairTable runs={items} detailSearch={returnSearch} />
          ) : (
            <RunTable runs={items} detailSearch={returnSearch} />
          )
        ) : (
          <Empty
            title="No runs match these filters"
            description="Adjust filters or launch an experiment from a saved draft."
          />
        )}
        <Pager
          page={Math.floor(offset / 25)}
          hasMore={runs.data?.nextOffset != null}
          onChange={(page) =>
            setParams((prev) => {
              prev.set("offset", String(page * 25));
              return prev;
            })
          }
        />
      </Card>
    </>
  );
}
function RunDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("view") || "timeline";
  const selected = params.get("evidence");
  const seq = params.get("seq");
  const run = useApi<Run>("/runs/" + id);
  const progress = useApi<Partial<Run>>("/runs/" + id + "/progress", 3500);
  const mutation = useMutation();
  const navigate = useNavigate();
  const [actor, setActor] = useState(""),
    [phase, setPhase] = useState(""),
    [eventType, setEventType] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  // Evidence tabs page by offset in local state; timeline/traces page by event cursor in the URL.
  const [page, setPage] = useState(0);
  const pageKey = tab === "traces" ? "tracePage" : "timelinePage";
  const cursorKey = tab === "traces" ? "traceCursors" : "timelineCursors";
  const urlCursors = (params.get(cursorKey) || "")
    .split(",")
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0);
  const urlPage = Math.max(0, Number(params.get(pageKey)) || 0);
  const cursors =
    urlPage > 0 && urlCursors.length === urlPage + 1 ? urlCursors : [0];
  const eventPage = cursors.length - 1;
  const query = new URLSearchParams({
    limit: "50",
    after: String(cursors[eventPage] || 0),
  });
  const setEventCursors = (next: number[], replace = false) =>
    setParams(
      (prev) => {
        if (next.length <= 1) {
          prev.delete(pageKey);
          prev.delete(cursorKey);
        } else {
          prev.set(pageKey, String(next.length - 1));
          prev.set(cursorKey, next.join(","));
        }
        return prev;
      },
      { replace },
    );
  const goToLatest = async (replace = false) => {
    const latest = await findLatestSequence(id!);
    const last = Math.max(0, Math.ceil(latest / EVENT_PAGE_SIZE) - 1);
    setEventCursors(
      Array.from({ length: last + 1 }, (_, index) => index * EVENT_PAGE_SIZE),
      replace,
    );
  };
  if (actor) query.set("actor", actor);
  if (phase) query.set("phase", phase);
  if (eventType) query.set("type", eventType);
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  const events = useApi<{
    events: HarnessEvent[];
    nextCursor: number;
    hasMore?: boolean;
  }>(
    tab === "timeline" || tab === "traces"
      ? "/runs/" + id + "/events?" + query
      : null,
    4000,
  );
  const selectedEvent = useApi<HarnessEvent>(
    selected && ["timeline", "traces", "memory"].includes(tab)
      ? "/runs/" + id + "/events/" + encodeURIComponent(selected)
      : null,
  );
  const selectedRecord = useApi<unknown>(
    selected && ["board", "artifacts", "reports"].includes(tab)
      ? "/runs/" +
          id +
          "/" +
          tab +
          "/" +
          encodeURIComponent(
            tab === "artifacts"
              ? selected.replace("version-", "")
              : tab === "reports"
                ? selected.replace("agent-", "")
                : selected,
          )
      : null,
  );
  const evidence = useApi<RecordPage<unknown> | unknown[]>(
    ["board", "artifacts", "reports"].includes(tab)
      ? `/runs/${id}/${tab}?limit=30&offset=${page * 30}`
      : null,
    5000,
  );
  const workspace = useApi<{ mode?: string }>("/workspace");
  const isActive = run.data
    ? !isTerminal(progress.data?.status ?? run.data.status)
    : false;
  // Recorded events that give posts, artifact versions and report counts their round/turn and coverage.
  const sideTypes =
    tab === "board"
      ? ["board_post"]
      : tab === "artifacts"
        ? ["artifact_updated"]
        : tab === "reports"
          ? ACTIVITY_EVENT_TYPES
          : [];
  const sideEvents = useRunEventsByType(
    id,
    sideTypes,
    sideTypes.length > 0,
    isActive ? 10000 : 0,
  );
  useEffect(() => {
    setPage(0);
  }, [tab, id]);
  // A filter change invalidates saved cursors (but not the position in a shared link on first load).
  const filtersSeen = useRef(false);
  useEffect(() => {
    if (!filtersSeen.current) {
      filtersSeen.current = true;
      return;
    }
    setParams(
      (prev) => {
        for (const key of ["timelinePage", "timelineCursors", "tracePage", "traceCursors"])
          prev.delete(key);
        return prev;
      },
      { replace: true },
    );
  }, [actor, phase, eventType, from, to]);
  // A failed run opens on its last page so the failure is visible; once per run and view.
  const autoJumped = useRef("");
  const failedRun = ["failed", "interrupted"].includes(
    run.data?.status ?? "",
  );
  const unfiltered = !(actor || phase || eventType || from || to);
  useEffect(() => {
    const marker = id + ":" + tab;
    if (
      !failedRun ||
      !unfiltered ||
      !["timeline", "traces"].includes(tab) ||
      autoJumped.current === marker
    )
      return;
    autoJumped.current = marker;
    if (params.has(pageKey) || params.has(cursorKey)) return;
    void goToLatest(true).catch(() => undefined);
  }, [failedRun, tab, id, unfiltered]);
  const data = run.data
    ? { ...run.data, ...progress.data, config: run.data.config }
    : undefined;
  const setTab = (view: string) => {
    setParams((prev) => {
      prev.set("view", view);
      prev.delete("evidence");
      prev.delete("seq");
      prev.delete("call");
      return prev;
    });
  };
  const inspect = (key: string, sequence?: number) =>
    setParams((prev) => {
      prev.set("evidence", key);
      sequence ? prev.set("seq", String(sequence)) : prev.delete("seq");
      return prev;
    });
  const items = Array.isArray(evidence.data)
    ? evidence.data
    : (evidence.data?.items ?? evidence.data?.posts ?? []);
  const event =
    selectedEvent.data ?? events.data?.events.find((e) => e.id === selected);
  const selectedItem =
    event ??
    selectedRecord.data ??
    items.find((item, index) => evidenceKey(item, index) === selected);
  // Both panels need the whole page: Traces derives tool status from tool lifecycle events.
  const traceEvents = events.data?.events ?? [];
  const focusCall = params.get("call");
  const ordered = [...traceEvents].sort((a, b) => a.sequence - b.sequence);
  const at = event ? ordered.findIndex((item) => item.id === event.id) : -1;
  const stepEvent = (delta: number) => {
    const next = ordered[at + delta];
    if (next) inspect(next.id, next.sequence);
  };
  const hasMoreEvents = !!(
    events.data?.hasMore ?? events.data?.events.length === EVENT_PAGE_SIZE
  );
  const paging: PageNav = {
    hasPrevious: eventPage > 0,
    hasNext: hasMoreEvents,
    ...(isActive ? { onJumpToLatest: () => void goToLatest() } : {}),
  };
  const openTraces = (invocationId: string) => {
    const alreadyThere =
      params.get("view") === "traces" && params.get("call") === invocationId;
    setParams((prev) => {
      prev.set("view", "traces");
      // Re-selecting the focused call must re-trigger the panel's scroll/highlight.
      if (alreadyThere) prev.delete("call");
      else prev.set("call", invocationId);
      prev.delete("evidence");
      prev.delete("seq");
      return prev;
    });
    if (alreadyThere)
      setTimeout(
        () =>
          setParams(
            (prev) => {
              prev.set("call", invocationId);
              return prev;
            },
            { replace: true },
          ),
        0,
      );
  };
  if (run.loading) return <Loading />;
  if (!data) {
    if (run.error instanceof ApiError && run.error.status === 404)
      return (
        <Card>
          <div className="card-body stack">
            <h2>Run not found</h2>
            <p>
              No run with ID <span className="mono">{id}</span> exists in this
              workspace.
              {workspace.data?.mode === "demo" &&
                " This workspace is in demo mode: demo data resets whenever the service restarts, so runs from an earlier session are gone."}
            </p>
            <div className="actions">
              <Button asChild>
                <Link to={safeRunReturn(params.get("returnTo"))}>
                  <ArrowLeft size={14} />
                  Back to Runs
                </Link>
              </Button>
            </div>
          </div>
        </Card>
      );
    return <ErrorState error={run.error} retry={run.refresh} />;
  }
  const active = ["queued", "running", "reporting", "stopping"].includes(
    data.status,
  );
  const terminal = isTerminal(data.status);
  const postEvents = new Map(
    (sideEvents.events.board_post ?? []).map((event) => [
      String((event.data as { after?: { id?: string } })?.after?.id),
      event,
    ]),
  );
  const versionEvents = new Map(
    (sideEvents.events.artifact_updated ?? []).map((event) => [
      Number((event.data as { after?: { version?: number } })?.after?.version),
      event,
    ]),
  );
  const activity = activityByAgent(sideEvents.events);
  // The frozen final artifact is pinned first; remaining versions run newest to oldest.
  const displayItems =
    tab === "artifacts"
      ? [...items].sort((a, b) => {
          const left = a as ArtifactVersion;
          const right = b as ArtifactVersion;
          return left.frozen !== right.frozen
            ? left.frozen
              ? -1
              : 1
            : right.version - left.version;
        })
      : items;
  const cancel = async () => {
    if (
      !window.confirm(
        "Request cancellation? The worker will stop admitting new work and retain recorded evidence. An in-flight request may finish first.",
      )
    )
      return;
    await mutation.run(
      () => post("/runs/" + id + "/cancel", {}),
      "Cancellation requested. Waiting for the worker to reach a safe boundary.",
    );
    void progress.refresh();
  };
  const duplicate = async () => {
    const result = await mutation.run(() =>
      post<Draft>("/runs/" + id + "/duplicate", {
        name: "Copy of " + data!.config.label,
      }),
    );
    if (result) navigate("/experiments?draft=" + result.id);
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
        eyebrow={
          data.config.model.provider === "scripted"
            ? "SCRIPTED FIXTURE · NOT SPONTANEOUS MODEL BEHAVIOR"
            : "EXPERIMENT RUN"
        }
        title={data.config.label}
        description={id!}
        actions={
          <>
            <Badge status={data.status} />
            <Button
              variant="secondary"
              onClick={duplicate}
              disabled={mutation.busy}
            >
              <Copy size={14} />
              Duplicate config
            </Button>
            <Button variant="secondary" asChild>
              <a href={"/api/runs/" + id + "/export"} download>
                <Download size={14} />
                Source export
              </a>
            </Button>
            {active && (
              <Button
                variant="destructive"
                disabled={mutation.busy || data.cancelRequested}
                onClick={cancel}
              >
                <Square size={13} />
                {data.cancelRequested ? "Cancellation requested" : "Cancel run"}
              </Button>
            )}
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
      {progress.error && (
        <Notice kind="warning">
          Live progress is stale. Last known run state and saved evidence remain
          available.{" "}
          <Button variant="ghost" size="sm" onClick={progress.refresh}>
            Reconnect
          </Button>
        </Notice>
      )}
      {mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}
      {mutation.message && <Notice kind="success">{mutation.message}</Notice>}
      <RunDiagnostic
        runId={id!}
        status={data.status}
        failureReason={data.failureReason}
        createdAt={data.createdAt}
        updatedAt={data.updatedAt}
      />
      <Downstream runId={id!} status={data.status} />
      <Tabs
        panelId="run-evidence-panel"
        value={tab}
        onChange={setTab}
        items={[
          { id: "timeline", label: "Timeline" },
          { id: "board", label: "Board & deliveries" },
          { id: "artifacts", label: "Artifacts" },
          { id: "memory", label: "Private memory" },
          { id: "reports", label: "Reports" },
          { id: "traces", label: "Model & traces" },
          { id: "configuration", label: "Configuration" },
          ...(data.config.scenario.version === "healthcare-points-v0.3"
            ? [{ id: "results", label: "Researcher results" }]
            : []),
        ]}
      />
      <section
        role="tabpanel"
        id="run-evidence-panel"
        aria-labelledby={`run-evidence-panel-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "results" ? (
          <HealthcareResults runId={id!} runStatus={data.status} />
        ) : ["timeline", "traces"].includes(tab) ? (
          <Card>
            <CardHeading
              title={
                tab === "timeline" ? "Execution timeline" : "Model invocations"
              }
              description={
                tab === "timeline"
                  ? "Proposed requests, admitted actions, side effects, and results remain distinct."
                  : "One card per model call on this page: what it reasoned, what it said, and what it proposed."
              }
              actions={
                terminal ? undefined : (
                  <Badge>
                    {progress.updatedAt
                      ? "Live · " +
                        new Date(progress.updatedAt).toLocaleTimeString()
                      : "Progress not yet received"}
                  </Badge>
                )
              }
            />
            <div className="filter-bar">
              <Field label="Actor">
                <Select
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                >
                  <option value="">All actors</option>
                  {data.config.roles.map((role) => (
                    <option key={role.id}>{role.id}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Phase">
                <Select
                  value={phase}
                  onChange={(e) => setPhase(e.target.value)}
                >
                  <option value="">All phases</option>
                  <option value="action">Action</option>
                  <option value="report">Report</option>
                </Select>
              </Field>
              <Field label="Event type">
                <Input
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  placeholder="Exact type"
                />
              </Field>
              <Field label="Sequence from">
                <Input
                  type="number"
                  min="1"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label="Sequence through">
                <Input
                  type="number"
                  min="1"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
            </div>
            {events.error && (
              <ErrorState error={events.error} retry={events.refresh} />
            )}
            {events.loading ? (
              <Loading />
            ) : traceEvents.length ? (
              tab === "timeline" ? (
                <TimelinePanel
                  events={traceEvents}
                  provider={data.config.model.provider}
                  onInspect={inspect}
                  onOpenTraces={openTraces}
                  paging={paging}
                />
              ) : (
                <TracesPanel
                  events={traceEvents}
                  provider={data.config.model.provider}
                  onInspect={inspect}
                  focusInvocationId={focusCall}
                  paging={paging}
                />
              )
            ) : (
              <Empty
                title="No matching events"
                description="New recorded evidence will appear here without changing your selected object."
              />
            )}
            <Pager
              page={eventPage}
              hasMore={hasMoreEvents}
              onChange={(next) =>
                setEventCursors(
                  next > eventPage
                    ? [...cursors, events.data?.nextCursor ?? 0]
                    : cursors.slice(0, next + 1),
                )
              }
            />
          </Card>
        ) : tab === "configuration" ? (
          <div className="editor-layout">
            <Card>
              <CardHeading
                title="Frozen run configuration"
                description="Editing a draft never changes this execution."
              />
              <div className="card-body">
                <dl className="definition-list">
                  <dt>Scenario</dt>
                  <dd>
                    {data.config.scenario.version} ·{" "}
                    {data.config.scenario.datasetId}
                  </dd>
                  <dt>Task</dt>
                  <dd className="text-block">{data.config.scenario.task}</dd>
                  <dt>Policy</dt>
                  <dd className="text-block">{data.config.scenario.policy}</dd>
                  <dt>Condition wording</dt>
                  <dd>{data.config.condition.text}</dd>
                  <dt>Memory isolation</dt>
                  <dd>Private per-run, per-agent thread</dd>
                  <BudgetSummary config={data.config} />
                  <dt>Rounds</dt>
                  <dd>{data.config.scheduler.rounds}</dd>
                  <dt>Tool calls per turn</dt>
                  <dd>{data.config.scheduler.toolCallsPerTurn}</dd>
                  <dt>Model steps per turn</dt>
                  <dd>{data.config.limits.maxModelStepsPerTurn}</dd>
                  <dt>Report calls</dt>
                  <dd>{data.config.limits.reportCalls}</dd>
                  <dt>Request timeout</dt>
                  <dd>
                    {(data.config.limits.requestTimeoutMs / 1000).toLocaleString()}{" "}
                    s
                  </dd>
                  <dt>Maximum run duration</dt>
                  <dd>
                    {(data.config.limits.maxDurationMs / 60000).toLocaleString()}{" "}
                    min
                  </dd>
                  <dt>Agent order</dt>
                  <dd>{data.config.scheduler.order.join(" → ")}</dd>
                  <dt>Model parameters</dt>
                  <dd>
                    {Object.keys(data.config.model.settings ?? {}).length ? (
                      <ReadableValue value={data.config.model.settings} />
                    ) : (
                      "Provider defaults (none set)"
                    )}
                  </dd>
                  <dt>Agent order seed</dt>
                  <dd>{data.config.scheduler.seed}</dd>
                  <dt>Created</dt>
                  <dd>{when(data.createdAt)}</dd>
                  <dt>Config hash</dt>
                  <dd className="mono">{data.configHash}</dd>
                </dl>
                <hr className="section-divider" />
                <JsonView
                  value={data.config}
                  title="Complete immutable configuration (developer view)"
                />
              </div>
            </Card>
            <Card>
              <CardHeading title="Usage & provenance" />
              <div className="card-body">
                {data.usage && Object.keys(data.usage).length ? (
                  <>
                    <p>
                      <strong>
                        {(
                          (data.usage.inputTokens ?? 0) +
                          (data.usage.outputTokens ?? 0)
                        ).toLocaleString()}
                      </strong>{" "}
                      total recorded tokens (input + output; other recorded
                      counters are listed below).
                    </p>
                    <ReadableValue
                      value={data.usage}
                      rawLabel="Raw recorded usage"
                    />
                  </>
                ) : (
                  <p>No provider usage was recorded for this run.</p>
                )}
                <p className="helper">
                  Recorded usage may be partial. Missing provider reasoning does
                  not establish that the agent had no reasoning or intent.
                </p>
              </div>
            </Card>
          </div>
        ) : (
          <Card>
            <CardHeading
              title={
                {
                  board: "Chronological board & exact deliveries",
                  artifacts: "Artifact versions",
                  memory: "Private agent memory",
                  reports: "Individual final reports",
                }[tab] || tab
              }
              description={
                tab === "board"
                  ? "Posting does not imply every agent received a message. Inspect the exact read events."
                  : tab === "memory"
                    ? "Thread-scoped notes and conversation snapshots; these are not shared with other agents."
                    : "Recorded source evidence with immutable provenance."
              }
            />
            {tab === "reports" &&
              !Array.isArray(evidence.data) &&
              evidence.data?.reporting && (
                <div className="card-body">
                  <JsonView
                    value={evidence.data.reporting}
                    title="Exact reporting instructions and schema version"
                  />
                </div>
              )}
            {tab === "board" &&
              !Array.isArray(evidence.data) &&
              evidence.data?.deliveriesMayHaveMore && (
                <Notice kind="warning">
                  This response contains a page of delivery events. For a
                  complete delivery history, filter the timeline for
                  board_delivery and paginate through the source events.
                </Notice>
              )}
            {tab !== "memory" && evidence.error && (
              <ErrorState error={evidence.error} retry={evidence.refresh} />
            )}
            {tab !== "memory" && sideEvents.partial && (
              <Notice kind="warning">
                Recorded event history was capped; round/turn details and
                counts on this tab may be incomplete.
              </Notice>
            )}
            {tab === "memory" ? (
              <MemoryPanel runId={id!} active={active} onInspect={inspect} />
            ) : evidence.loading ? (
              <Loading />
            ) : displayItems.length ? (
              <div className="card-body stack">
                {displayItems.map((item, index) => {
                  const object = item as Record<string, unknown>;
                  const key = evidenceKey(item, index);
                  const postEvent =
                    tab === "board" ? postEvents.get(String(object.id)) : undefined;
                  const versionEvent =
                    tab === "artifacts"
                      ? versionEvents.get(Number(object.version))
                      : undefined;
                  const previous =
                    tab === "artifacts" && typeof object.previousVersion === "number"
                      ? (items as ArtifactVersion[]).find(
                          (candidate) => candidate.version === object.previousVersion,
                        )
                      : undefined;
                  return (
                    <Card key={key}>
                      <div className="card-heading">
                        <div>
                          <h3>
                            {tab === "board"
                              ? `Post ${object.sequence ?? index + 1} · ${object.authorId ?? "Unknown author"}`
                              : tab === "artifacts"
                                ? object.frozen === true
                                  ? `Final frozen version ${object.version ?? index + 1}`
                                  : `Version ${object.version ?? index + 1}`
                                : `Report · ${object.agentId ?? "Unknown agent"}`}
                          </h3>
                          <p>
                            {tab === "board"
                              ? [
                                  postEvent
                                    ? roundTurn(postEvent)
                                    : "Round/turn not loaded",
                                  typeof object.timestamp === "string"
                                    ? when(object.timestamp)
                                    : undefined,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")
                              : tab === "artifacts"
                                ? object.frozen === true
                                  ? `Frozen at the end of the run${typeof object.previousVersion === "number" ? ` from version ${object.previousVersion}` : ""}`
                                  : [
                                      String(object.authorId ?? "unknown author"),
                                      versionEvent
                                        ? roundTurn(versionEvent)
                                        : "Round/turn not loaded",
                                    ].join(" · ")
                                : "Submitted final report"}
                          </p>
                        </div>
                        <div className="actions">
                          {object.frozen === true && (
                            <Badge>Frozen final</Badge>
                          )}
                          {tab === "reports" && object.parsed === null && (
                            <Badge status="failed">Invalid / unparsed</Badge>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => inspect(key)}
                          >
                            Inspect
                          </Button>
                        </div>
                      </div>
                      <div className="card-body">
                        {tab === "artifacts" ? (
                          <ArtifactView
                            value={object.value}
                            schemaVersion={data.config.artifactSchemaVersion}
                            scenarioVersion={data.config.scenario.version}
                            terminal={terminal}
                          />
                        ) : tab === "reports" ? (
                          <>
                            <ReportSections
                              parsed={object.parsed}
                              raw={String(object.raw ?? "")}
                            />
                            <ActivityStrip
                              agentId={String(object.agentId)}
                              activity={activity.get(String(object.agentId))}
                              partial={sideEvents.partial}
                              loading={sideEvents.loading}
                            />
                          </>
                        ) : (
                          <p className="text-block">
                            {String(object.text ?? "")}
                          </p>
                        )}
                        {tab === "board" && (
                          <BoardDeliveries
                            postId={String(object.id)}
                            authorId={String(object.authorId)}
                            roles={data.config.roles.map((role) => role.id)}
                            deliveries={
                              !Array.isArray(evidence.data)
                                ? evidence.data?.deliveries
                                : undefined
                            }
                          />
                        )}
                        {tab === "artifacts" && previous && (
                          <details style={{ marginTop: 12 }}>
                            <summary className="helper">
                              Compare to version {previous.version}
                            </summary>
                            <DiffView
                              before={pretty(previous.value)}
                              after={pretty(object.value)}
                              label={`Changes from version ${previous.version}`}
                            />
                          </details>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : tab === "artifacts" && !terminal ? (
              <Empty
                title="No submission yet"
                description="The run is still in progress; artifact versions appear as agents submit them."
              />
            ) : (
              <Empty
                title={"No " + tab + " recorded on this page"}
                description="Unavailable evidence is distinct from an empty agent action or a negative finding."
              />
            )}
            {tab !== "memory" && (
              <Pager
                page={page}
                hasMore={
                  !Array.isArray(evidence.data) &&
                  evidence.data?.nextOffset != null
                }
                onChange={setPage}
              />
            )}
          </Card>
        )}
      </section>
      <p className="helper">
        Execution state is the last recorded worker state. Fetch timestamps
        indicate dashboard freshness, not worker health or proof of progress.
        Run record updated {when(data.updatedAt)}.
      </p>
      <Drawer
        open={!!selected}
        onOpenChange={(open) => {
          if (!open)
            setParams((prev) => {
              prev.delete("evidence");
              prev.delete("seq");
              return prev;
            });
        }}
        title={
          event
            ? event.type.replaceAll("_", " ")
            : tab === "artifacts"
              ? "Artifact version"
              : tab === "board"
                ? "Board message"
                : "Recorded evidence"
        }
      >
        {selectedEvent.loading ? (
          <Loading />
        ) : selectedItem ? (
          <div
            onKeyDown={(keyEvent) => {
              const target = keyEvent.target as HTMLElement;
              if (
                at < 0 ||
                keyEvent.altKey ||
                keyEvent.ctrlKey ||
                keyEvent.metaKey ||
                ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
                target.isContentEditable
              )
                return;
              if (keyEvent.key === "ArrowLeft") stepEvent(-1);
              else if (keyEvent.key === "ArrowRight") stepEvent(1);
              else return;
              keyEvent.preventDefault();
            }}
          >
            {at >= 0 && (
              <div className="actions drawer-event-nav">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={at === 0}
                  onClick={() => stepEvent(-1)}
                >
                  <ArrowLeft size={13} />
                  Previous event
                </Button>
                <span className="helper">
                  {at + 1} of {ordered.length} on this page · ← → keys
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={at === ordered.length - 1}
                  onClick={() => stepEvent(1)}
                >
                  Next event
                  <ArrowRight size={13} />
                </Button>
              </div>
            )}
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
            {event?.invocationId && MODEL_CALL_EVENT_TYPES.has(event.type) ? (
              <ModelCallDetail
                event={event}
                events={traceEvents}
                provider={data.config.model.provider}
                onNavigate={inspect}
                onOpenTraces={openTraces}
              />
            ) : (
              <>
                {event && (
                  <Notice>
                    Tool requests are proposals until an admission and result
                    are recorded. Repeated input context is not a new action.
                  </Notice>
                )}
                <ReadableValue value={selectedItem} />
                {event?.invocationId && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openTraces(event.invocationId!)}
                  >
                    Open model call in Model &amp; traces
                  </Button>
                )}
              </>
            )}
          </div>
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
function evidenceKey(item: unknown, index: number) {
  const object = item as Record<string, unknown>;
  return String(
    object.id ??
      (object.version !== undefined
        ? "version-" + object.version
        : object.agentId !== undefined
          ? "agent-" + object.agentId
          : "record-" + index),
  );
}
function safeRunReturn(value: string | null) {
  return value === "/runs" || value?.startsWith("/runs?") ? value : "/runs";
}
function PairDetail() {
  const [params] = useSearchParams();
  const { id } = useParams();
  const pair = useApi<{
    runs: Run[];
    configurationDifferences: unknown[];
    matched: boolean;
  }>("/pairs/" + id, 5000);
  const mutation = useMutation();
  const navigate = useNavigate();
  if (pair.loading) return <Loading />;
  if (!pair.data) {
    if (pair.error instanceof ApiError && pair.error.status === 404)
      return (
        <Card>
          <div className="card-body stack">
            <h2>Pair not found</h2>
            <p>
              No matched pair with ID <span className="mono">{id}</span> exists
              in this workspace.
            </p>
            <Button asChild>
              <Link to={safeRunReturn(params.get("returnTo"))}>
                <ArrowLeft size={14} />
                Back to Runs
              </Link>
            </Button>
          </div>
        </Card>
      );
    return <ErrorState error={pair.error} retry={pair.refresh} />;
  }
  const runs = orderByCondition(pair.data.runs);
  const verdict = assessComparability(runs);
  const duplicatePair = async () => {
    const result = await mutation.run(() =>
      post<Draft>("/pairs/" + id + "/duplicate", {
        name: "Copy of " + (runs[0]?.config?.label ?? id),
      }),
    );
    if (result) navigate("/experiments?draft=" + result.id);
  };
  return (
    <>
      <PageHeader
        eyebrow="MATCHED EXECUTIONS"
        title={runs[0]?.config?.label || "Pair comparison"}
        description={`Matched pair comparison · ${id}`}
        actions={
          <Button
            variant="secondary"
            onClick={duplicatePair}
            disabled={mutation.busy}
          >
            <Copy size={14} />
            Duplicate config
          </Button>
        }
      />
      {mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}
      <p role="status" className="sr-only">
        {runs
          .map(
            (run) =>
              `${run.config.condition.id}: ${run.status}, round ${run.round} of ${run.config.scheduler.rounds}`,
          )
          .join("; ")}
      </p>
      <Notice kind={verdict.comparable ? "success" : "warning"}>
        {verdict.message}
      </Notice>
      <p className="helper">
        {pair.data.matched
          ? "Frozen configurations match outside the intended condition difference."
          : "Configuration differences need review before treating these as matched conditions."}
      </p>
      <Button asChild variant="ghost">
        <Link to={safeRunReturn(params.get("returnTo"))}>
          <ArrowLeft size={14} />
          All runs
        </Link>
      </Button>
      <div className="pair-condition-grid">
        {runs.map((run) => (
          <PairCondition
            key={run.id}
            summary={run}
            returnTo={safeRunReturn(params.get("returnTo"))}
          />
        ))}
        {pair.data.runs.length < 2 && (
          <Card>
            <div className="card-body">
              <h2>Other condition unavailable</h2>
              <p>
                The pair response does not contain a second run. The recorded
                run remains available.
              </p>
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
              headers={[
                "Setting",
                ...runs.map((run) => run.config.condition.id),
              ]}
            >
              {pair.data.configurationDifferences.map((path, index) => (
                <tr key={index}>
                  <th scope="row">{settingLabel(String(path))}</th>
                  {runs.map((run) => (
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
          <JsonView
            value={pair.data.configurationDifferences}
            title="Exact differing field paths"
          />
          <p className="helper">
            This page compares execution and frozen settings. It does not
            establish model rankings or independent statistical evidence.
          </p>
          <p className="helper">
            Missing outputs remain unavailable, including while a run is
            incomplete. Fetching these records does not verify worker health.
          </p>
        </div>
      </Card>
    </>
  );
}

function settingLabel(path: string) {
  const labels: Record<string, string> = {
    "condition.id": "Condition identifier",
    "condition.text": "Exact condition wording",
  };
  return (
    labels[path] ||
    path
      .split(".")
      .map((part) => part.replace(/([A-Z])/g, " $1"))
      .join(" / ")
  );
}
function configValue(config: Run["config"], path: string) {
  const value = path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      config,
    );
  return value === undefined
    ? "Not recorded"
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
}
function PairCondition({
  summary,
  returnTo,
}: {
  summary: Run;
  returnTo: string;
}) {
  const resource = useApi<Run>("/runs/" + summary.id, 5000);
  const run = resource.data || summary;
  const suffix = "&returnTo=" + encodeURIComponent(returnTo);
  const finals = resource.data?.artifacts?.filter((item) => item.frozen) || [];
  return (
    <Card>
      <CardHeading
        title={run.config.condition.id}
        actions={<Badge status={run.status} />}
      />
      <div className="card-body stack">
        <div>
          <h3>Exact condition wording</h3>
          <p className="text-block">{run.config.condition.text}</p>
        </div>
        <dl className="definition-list">
          <dt>Execution</dt>
          <dd>
            {run.status} - round {run.round} / {run.config.scheduler.rounds} -
            turn {run.turn}
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
              {plural(resource.data.board?.length ?? 0, "board post")} -{" "}
              {plural(resource.data.artifacts?.length ?? 0, "artifact version")}{" "}
              - {plural(resource.data.reports?.length ?? 0, "final report")}.{" "}
              <Link to={"/runs/" + run.id + "?view=timeline" + suffix}>
                Open canonical event timeline
              </Link>
            </p>
          ) : (
            <p>
              Evidence availability{" "}
              {resource.loading ? "is loading" : "is unknown"}.
            </p>
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
                    schemaVersion={run.config.artifactSchemaVersion}
                    scenarioVersion={run.config.scenario.version}
                    terminal={isTerminal(run.status)}
                  />
                </div>
              ))
            ) : isTerminal(run.status) ? (
              <p>No frozen final artifact recorded.</p>
            ) : (
              <p>No submission yet.</p>
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
                    {report.agentId} -{" "}
                    {report.parsed === null
                      ? "Invalid / unparsed"
                      : "Recorded report"}
                  </summary>
                  <ReportSections parsed={report.parsed} raw={report.raw} />
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
            <Link to={"/runs/" + run.id + "?view=timeline" + suffix}>
              Inspect evidence
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to={"/runs/" + run.id + "?view=artifacts" + suffix}>
              Artifact history
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to={"/runs/" + run.id + "?view=reports" + suffix}>
              Reports
            </Link>
          </Button>
        </div>
        <Downstream runId={run.id} status={run.status} compact />
      </div>
    </Card>
  );
}
