import { useEffect, useState } from "react";
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
import { arrayOf, post, useApi, useMutation } from "../lib/api";
import type {
  ArtifactVersion,
  BoardMessage,
  Draft,
  HarnessEvent,
  Run,
} from "../lib/types";
import { cn, pretty, short, when } from "../lib/utils";
import { RunTable } from "../App";
import "./runs-oversight.css";
import { ArtifactView } from "../components/artifact-view";
import { BudgetSummary } from "../components/budget-summary";
import { HealthcareResults } from "../components/healthcare-results";
import { MODEL_CALL_EVENT_TYPES } from "../lib/model-calls";
import type { TurnSummary } from "@sidechannel/contracts/browser";
import { useRunEvents, type EventStart } from "../lib/use-run-events";
import { RunEventsView, StreamBadge } from "./runs/RunEventsView";
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
        <div className="filter-bar">
          <Filter size={16} className="muted" aria-hidden="true" />
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
          <RunTable
            runs={items}
            detailSearch={
              "?returnTo=" +
              encodeURIComponent(
                "/runs" + (params.size ? "?" + params.toString() : ""),
              )
            }
          />
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
const ACTIVE_STATUSES = ["queued", "running", "reporting", "stopping"];

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
  const [page, setPage] = useState(0);
  const eventTabs = tab === "timeline" || tab === "traces";
  // Guard against the previous run's data during a route change: useApi clears data only after render.
  const status =
    run.data?.id === id
      ? (progress.data?.id === id ? progress.data?.status : undefined) ?? run.data?.status
      : undefined;
  const runActive = !!status && ACTIVE_STATUSES.includes(status);
  // Whether the run was active when this page opened decides the default start, so a run that finishes
  // while you watch keeps its window instead of jumping back to the first event.
  const [opened, setOpened] = useState<{ id: string; active: boolean }>();
  const openedActive = opened?.id === id ? opened?.active : undefined;
  useEffect(() => {
    if (id && openedActive === undefined && status) setOpened({ id, active: runActive });
  }, [id, openedActive, status, runActive]);
  const at = params.get("at");
  const start: EventStart =
    at === "end"
      ? "latest"
      : at && Number.isSafeInteger(Number(at)) && Number(at) > 0
        ? Number(at)
        : openedActive
          ? "latest"
          : "first";
  const follow = runActive && start === "latest" && !to;
  const runEvents = useRunEvents(
    id,
    { actor, phase, type: eventType, from, to },
    { start, follow, enabled: eventTabs && openedActive !== undefined },
  );
  const turns = useApi<{ turns: TurnSummary[] }>(
    eventTabs ? "/runs/" + id + "/turns" : null,
    follow ? 10000 : 0,
  );
  const jumpTo = (target: number | "end") =>
    setParams((prev) => {
      prev.set("at", String(target));
      return prev;
    });
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
    ["board", "artifacts", "memory", "reports"].includes(tab)
      ? `/runs/${id}/${tab}?limit=30&offset=${page * 30}`
      : null,
    5000,
  );
  useEffect(() => {
    setPage(0);
  }, [tab, actor, phase, eventType, from, to, id]);
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
    selectedEvent.data ?? runEvents.events.find((e) => e.id === selected);
  const selectedItem =
    event ??
    selectedRecord.data ??
    items.find((item, index) => evidenceKey(item, index) === selected);
  // Both panels need the whole page: Traces derives tool status from tool lifecycle events.
  const traceEvents = runEvents.events;
  const focusCall = params.get("call");
  const openTraces = (invocationId: string) =>
    setParams((prev) => {
      prev.set("view", "traces");
      prev.set("call", invocationId);
      prev.delete("evidence");
      prev.delete("seq");
      return prev;
    });
  if (run.loading) return <Loading />;
  if (!data) return <ErrorState error={run.error} retry={run.refresh} />;
  const active = ACTIVE_STATUSES.includes(data.status);
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
      post<Draft>("/runs/" + id + "/duplicate", {}),
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
      {data.failureReason && (
        <Notice kind="error">Run diagnostic: {data.failureReason}</Notice>
      )}
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
          <HealthcareResults runId={id!} />
        ) : ["timeline", "traces"].includes(tab) ? (
          <Card>
            <CardHeading
              title={
                tab === "timeline" ? "Execution timeline" : "Model invocations"
              }
              description={
                tab === "timeline"
                  ? "Proposed requests, admitted actions, side effects, and results remain distinct."
                  : "One card per model call in the loaded turns: what it reasoned, what it said, and what it proposed."
              }
              actions={<StreamBadge status={runEvents.status} />}
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
            <RunEventsView
              tab={tab === "timeline" ? "timeline" : "traces"}
              runEvents={runEvents}
              follow={follow}
              turns={turns.data?.turns}
              start={start}
              provider={data.config.model.provider}
              focusCall={focusCall}
              onInspect={inspect}
              onOpenTraces={openTraces}
              onJump={jumpTo}
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
                <JsonView value={data.usage} title="Recorded provider usage" />
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
            {evidence.error && (
              <ErrorState error={evidence.error} retry={evidence.refresh} />
            )}
            {evidence.loading ? (
              <Loading />
            ) : items.length ? (
              <div className="card-body stack">
                {items.map((item, index) => {
                  const object = item as Record<string, unknown>;
                  const key = evidenceKey(item, index);
                  return (
                    <Card key={key}>
                      <div className="card-heading">
                        <div>
                          <h3>
                            {tab === "board"
                              ? `Post ${object.sequence ?? index + 1} · ${object.authorId ?? "Unknown author"}`
                              : tab === "artifacts"
                                ? `Version ${object.version ?? index + 1}`
                                : tab === "memory"
                                  ? `${object.agentId ?? "Agent"} · ${object.type ?? "Memory snapshot"}`
                                  : `Report · ${object.agentId ?? "Unknown agent"}`}
                          </h3>
                          <p>
                            {object.id
                              ? short(String(object.id))
                              : object.operationId
                                ? String(object.operationId)
                                : "Recorded evidence"}
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
                            onClick={() =>
                              inspect(
                                key,
                                tab === "memory" &&
                                  typeof object.sequence === "number"
                                  ? object.sequence
                                  : undefined,
                              )
                            }
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
                          />
                        ) : (
                          <p className="text-block">
                            {tab === "board"
                              ? String(object.text ?? "")
                              : tab === "reports"
                                ? String(object.raw ?? "")
                                : pretty(
                                    object.value ?? object.data ?? item,
                                  ).slice(0, 500)}
                          </p>
                        )}
                        {tab === "board" && (
                          <BoardDelivery
                            id={String(object.id)}
                            deliveries={
                              !Array.isArray(evidence.data)
                                ? evidence.data?.deliveries
                                : undefined
                            }
                          />
                        )}
                        {tab === "artifacts" && index > 0 && (
                          <details style={{ marginTop: 12 }}>
                            <summary className="helper">
                              Compare to previous version
                            </summary>
                            <div className="form-grid">
                              <JsonView
                                value={
                                  (items[index - 1] as ArtifactVersion).value
                                }
                                title="Previous version"
                              />
                              <JsonView
                                value={object.value}
                                title="Selected version"
                              />
                            </div>
                          </details>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Empty
                title={"No " + tab + " recorded on this page"}
                description="Unavailable evidence is distinct from an empty agent action or a negative finding."
              />
            )}
            <Pager
              page={page}
              hasMore={
                !Array.isArray(evidence.data) &&
                evidence.data?.nextOffset != null
              }
              onChange={setPage}
            />
          </Card>
        )}
      </section>
      <p className="helper">
        Execution state is the last recorded worker state. Fetch timestamps
        indicate dashboard freshness, not worker health or proof of progress.
        Run record updated {when(data.updatedAt)}.
      </p>
      {data.status === "completed" && (
        <div className="actions" style={{ marginTop: 22 }}>
          <Button asChild>
            <Link to={"/analysis?run=" + id}>New Jev analysis</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to={"/oversight?run=" + id}>Configure oversight</Link>
          </Button>
        </div>
      )}
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
                <JsonView value={selectedItem} />
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
function BoardDelivery({
  id,
  deliveries,
}: {
  id: string;
  deliveries?: HarnessEvent[];
}) {
  const matches = deliveries?.filter((event) => {
    const after = (event.data as { after?: unknown })?.after;
    return Array.isArray(after) && after.some((message) => message.id === id);
  });
  return (
    <div style={{ marginTop: 12 }}>
      {matches?.length ? (
        <div className="actions">
          <span className="helper">Exact delivery records:</span>
          {matches.map((e) => (
            <Link
              key={e.id}
              to={`/runs/${e.runId}?view=timeline&evidence=${encodeURIComponent(e.id)}`}
            >
              <Badge>
                {e.agentId} · event #{e.sequence}
              </Badge>
            </Link>
          ))}
        </div>
      ) : (
        <span className="helper">
          No read/delivery event for this post is present in this response.
          Posting alone does not establish receipt.
        </span>
      )}
    </div>
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
  }>("/pairs/" + id);
  if (pair.loading) return <Loading />;
  if (!pair.data) return <ErrorState error={pair.error} retry={pair.refresh} />;
  return (
    <>
      <PageHeader
        eyebrow="MATCHED EXECUTIONS"
        title="Pair comparison"
        description={id!}
      />
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
                ...pair.data.runs.map((run) => run.config.condition.id),
              ]}
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
          <JsonView
            value={pair.data.configurationDifferences}
            title="Exact differing field paths"
          />
          <p className="helper">
            This page compares execution and frozen settings. It does not
            establish model rankings or independent statistical evidence.
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
              {resource.data.board?.length ?? 0} board posts -{" "}
              {resource.data.artifacts?.length ?? 0} artifact versions -{" "}
              {resource.data.reports?.length ?? 0} final reports.{" "}
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
                    {report.agentId} -{" "}
                    {report.parsed === null
                      ? "Invalid / unparsed"
                      : "Recorded report"}
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
        <p className="helper">
          Missing outputs remain unavailable, including while a run is
          incomplete. Fetching this record does not verify worker health.
        </p>
      </div>
    </Card>
  );
}
