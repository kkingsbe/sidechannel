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
  CheckCircle2,
  Copy,
  Download,
  Filter,
  MessageSquare,
  Play,
  RefreshCw,
  Square,
  Wrench,
  XCircle,
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
type RecordPage<T> = {
  items: T[];
  nextOffset?: number | null;
  total?: number;
  posts?: T[];
  deliveries?: HarnessEvent[];
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
            <Link to="/experiments">New experiment</Link>
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
          <RunTable runs={items} />
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
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState([0]);
  const query = new URLSearchParams({
    limit: "50",
    after: String(cursors[page] || 0),
  });
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
    ["board", "artifacts", "memory", "reports"].includes(tab)
      ? `/runs/${id}/${tab}?limit=30&offset=${page * 30}`
      : null,
    5000,
  );
  useEffect(() => {
    setPage(0);
    setCursors([0]);
  }, [tab, actor, phase, eventType, from, to, id]);
  const data = run.data
    ? { ...run.data, ...progress.data, config: run.data.config }
    : undefined;
  const setTab = (view: string) => {
    setParams((prev) => {
      prev.set("view", view);
      prev.delete("evidence");
      prev.delete("seq");
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
  const traceEvents =
    events.data?.events.filter(
      (e) => tab !== "traces" || /model|invocation|reason|trace/.test(e.type),
    ) ?? [];
  if (run.loading) return <Loading />;
  if (!data) return <ErrorState error={run.error} retry={run.refresh} />;
  const active = ["queued", "running", "reporting", "stopping"].includes(
    data.status,
  );
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
        <Link to="/runs">
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
                : "Action"}
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
          <Link className="table-title" to={"/runs/pairs/" + data.pairId}>
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
        ]}
      />
      {["timeline", "traces"].includes(tab) ? (
        <Card>
          <CardHeading
            title={
              tab === "timeline"
                ? "Execution timeline"
                : "Model invocations & trace references"
            }
            description="Proposed requests, admitted actions, side effects, and results remain distinct."
            actions={
              <Badge>
                {progress.updatedAt
                  ? "Live · " +
                    new Date(progress.updatedAt).toLocaleTimeString()
                  : "Connecting"}
              </Badge>
            }
          />
          <div className="filter-bar">
            <Field label="Actor">
              <Select value={actor} onChange={(e) => setActor(e.target.value)}>
                <option value="">All actors</option>
                {data.config.roles.map((role) => (
                  <option key={role.id}>{role.id}</option>
                ))}
              </Select>
            </Field>
            <Field label="Phase">
              <Select value={phase} onChange={(e) => setPhase(e.target.value)}>
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
            <div className="timeline-list">
              {traceEvents.map((e) => {
                const Icon = /denied|error|fail/.test(e.type)
                  ? XCircle
                  : /board/.test(e.type)
                    ? MessageSquare
                    : /tool/.test(e.type)
                      ? Wrench
                      : /complete|success/.test(e.type)
                        ? CheckCircle2
                        : Play;
                return (
                  <button
                    className="timeline-row"
                    key={e.id}
                    onClick={() => inspect(e.id, e.sequence)}
                  >
                    <span className="timeline-marker">
                      <Icon size={13} aria-hidden="true" />
                    </span>
                    <div className="timeline-main">
                      <div>
                        <strong>{e.type.replaceAll("_", " ")}</strong>
                        <Badge>{e.agentId || "system"}</Badge>
                        <span className="helper">
                          #{e.sequence} · R{e.round ?? "—"} / T{e.turn ?? "—"}
                        </span>
                        {/denied|error|fail/.test(e.type) && (
                          <Badge status="failed">Diagnostic</Badge>
                        )}
                      </div>
                      <p>{pretty(e.data).slice(0, 190)}</p>
                    </div>
                    <time className="timeline-time">
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </time>
                    <ArrowUpRight
                      size={13}
                      className="muted"
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty
              title="No matching events"
              description="New recorded evidence will appear here without changing your selected object."
            />
          )}
          <Pager
            page={page}
            hasMore={events.data?.hasMore ?? events.data?.events.length === 50}
            onChange={(next) => {
              if (next > page)
                setCursors((prev) => [
                  ...prev.slice(0, next),
                  events.data?.nextCursor ?? 0,
                ]);
              setPage(next);
            }}
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
                <dd>
                  Private thread ·{" "}
                  {data.config.memory.contextBudget.toLocaleString()} characters
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
                        {object.frozen === true && <Badge>Frozen final</Badge>}
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
                      <p className="text-block">
                        {tab === "board"
                          ? String(object.text ?? "")
                          : tab === "reports"
                            ? String(object.raw ?? "")
                            : pretty(object.value ?? object.data ?? item).slice(
                                0,
                                500,
                              )}
                      </p>
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
              !Array.isArray(evidence.data) && evidence.data?.nextOffset != null
            }
            onChange={setPage}
          />
        </Card>
      )}
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
            {event && (
              <Notice>
                Tool requests are proposals until an admission and result are
                recorded. Repeated input context is not a new action.
              </Notice>
            )}
            <JsonView value={selectedItem} />
            {event?.invocationId && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setTab("traces");
                }}
              >
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
            <Badge key={e.id}>
              {e.agentId} · event #{e.sequence}
            </Badge>
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
function PairDetail() {
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
      <Card>
        <RunTable runs={pair.data.runs} />
      </Card>
      <Card style={{ marginTop: 20 }}>
        <CardHeading title="Configuration differences" />
        <div className="card-body">
          <JsonView value={pair.data.configurationDifferences} />
          <p className="helper">
            This page compares execution and frozen settings. It does not
            establish model rankings or independent statistical evidence.
          </p>
        </div>
      </Card>
    </>
  );
}
