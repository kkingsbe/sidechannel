import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeading,
  Empty,
  ErrorState,
  EventIcon,
  Field,
  Input,
  JsonView,
  Loading,
  Notice,
  Pager,
  Select,
} from "../../components/ui";
import { ArtifactView } from "../../components/artifact-view";
import { BudgetSummary } from "../../components/budget-summary";
import { HealthcareResults } from "../../components/healthcare-results";
import type { ArtifactVersion } from "../../lib/types";
import type { BoardPage, ReportPage } from "../../lib/contracts";
import { eventMeta } from "../../lib/status";
import { pretty, when } from "../../lib/utils";
import { BoardDelivery } from "./board-delivery";
import { evidenceKey } from "./evidence-key";
import { useRunEvidence, useRunEvents, useRunId, useRunRoute } from "./use-run-evidence";
import { useScenarios } from "../../lib/descriptors";
import { useRunProgress } from "./use-run-progress";
import { useRunRecordOnly } from "./use-run-record";

/** Timeline and model-trace views: the recorded evidence stream. */
export function EventsPanel({ kind }: { kind: "timeline" | "traces" }) {
  const id = useRunId();
  const run = useRunRecordOnly(id);
  const { progress, updatedAt } = useRunProgress(id);
  const events = useRunEvents(kind);
  const { inspect } = useRunRoute();
  if (run.loading) return <Loading />;
  if (!run.data) return <ErrorState error={run.error} retry={run.refresh} />;
  const data = run.data;
  return (
    <Card>
      <CardHeading
        title={kind === "timeline" ? "Execution timeline" : "Model invocations & trace references"}
        description="Proposed requests, admitted actions, side effects, and results remain distinct."
        actions={
          <Badge>
            {updatedAt ? "Live · " + new Date(updatedAt).toLocaleTimeString() : "Progress not yet received"}
          </Badge>
        }
      />
      <div className="filter-bar">
        <Field label="Actor">
          <Select value={events.filters.actor} onChange={(e) => events.setFilter("actor", e.target.value)}>
            <option value="">All actors</option>
            {data.config.roles.map((role) => (
              <option key={role.id}>{role.id}</option>
            ))}
          </Select>
        </Field>
        <Field label="Phase">
          <Select value={events.filters.phase} onChange={(e) => events.setFilter("phase", e.target.value)}>
            <option value="">All phases</option>
            <option value="action">Action</option>
            <option value="report">Report</option>
          </Select>
        </Field>
        <Field label="Event type">
          <Input value={events.filters.type} onChange={(e) => events.setFilter("type", e.target.value)} placeholder="Exact type" />
        </Field>
        <Field label="Sequence from">
          <Input type="number" min="1" value={events.filters.from} onChange={(e) => events.setFilter("from", e.target.value)} />
        </Field>
        <Field label="Sequence through">
          <Input type="number" min="1" value={events.filters.to} onChange={(e) => events.setFilter("to", e.target.value)} />
        </Field>
      </div>
      {events.error && <ErrorState error={events.error} retry={events.refresh} />}
      {events.loading ? (
        <Loading />
      ) : events.traceEvents.length ? (
        <div className="timeline-list">
          {events.traceEvents.map((e) => {
            const meta = eventMeta(e);
            return (
              <button className="timeline-row" key={e.id} onClick={() => inspect(e.id, e.sequence)}>
                <span className="timeline-marker">
                  <EventIcon name={meta.icon} />
                </span>
                <div className="timeline-main">
                  <div>
                    <strong>{meta.label}</strong>
                    <Badge>{e.agentId || "system"}</Badge>
                    <span className="helper">
                      #{e.sequence} · R{e.round ?? "—"} / T{e.turn ?? "—"}
                    </span>
                    {meta.tone === "danger" && <Badge tone="danger">Diagnostic</Badge>}
                  </div>
                  <p>{pretty(e.data).slice(0, 190)}</p>
                </div>
                <time className="timeline-time">{new Date(e.timestamp).toLocaleTimeString()}</time>
                <ArrowUpRight size={13} className="muted" aria-hidden="true" />
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
      <Pager page={events.page} hasMore={events.hasMore} onChange={events.onChange} />
    </Card>
  );
}

export function TimelinePanel() {
  return <EventsPanel kind="timeline" />;
}
export function TracesPanel() {
  return <EventsPanel kind="traces" />;
}

/** Board, artifacts, private memory and reports share one paginated evidence shape. */
export function EvidencePanel({ kind }: { kind: "board" | "artifacts" | "memory" | "reports" }) {
  const id = useRunId();
  const run = useRunRecordOnly(id);
  const evidence = useRunEvidence(kind);
  const scenarios = useScenarios();
  const { inspect } = useRunRoute();
  const board = kind === "board" ? evidence.payload as BoardPage | undefined : undefined;
  const reporting = kind === "reports" && evidence.payload && "reporting" in evidence.payload
    ? (evidence.payload as ReportPage).reporting
    : undefined;
  if (run.loading) return <Loading />;
  if (!run.data) return <ErrorState error={run.error} retry={run.refresh} />;
  const data = run.data;
  const items = evidence.data;
  return (
    <Card>
      <CardHeading
        title={
          {
            board: "Chronological board & exact deliveries",
            artifacts: "Artifact versions",
            memory: "Private agent memory",
            reports: "Individual final reports",
          }[kind]
        }
        description={
          kind === "board"
            ? "Posting does not imply every agent received a message. Inspect the exact read events."
            : kind === "memory"
              ? "Thread-scoped notes and conversation snapshots; these are not shared with other agents."
              : "Recorded source evidence with immutable provenance."
        }
      />
      {kind === "reports" && reporting && (
        <div className="card-body">
          <JsonView value={reporting} title="Exact reporting instructions and schema version" />
        </div>
      )}
      {kind === "board" && board?.deliveriesMayHaveMore && (
        <Notice kind="warning">
          This response contains a page of delivery events. For a complete delivery history, filter the timeline for
          board_delivery and paginate through the source events.
        </Notice>
      )}
      {evidence.error && <ErrorState error={evidence.error} retry={evidence.refresh} />}
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
                      {kind === "board"
                        ? `Post ${object.sequence ?? index + 1} · ${object.authorId ?? "Unknown author"}`
                        : kind === "artifacts"
                          ? `Version ${object.version ?? index + 1}`
                          : kind === "memory"
                            ? `${object.agentId ?? "Agent"} · ${object.type ?? "Memory snapshot"}`
                            : `Report · ${object.agentId ?? "Unknown agent"}`}
                    </h3>
                    <p>
                      {object.id
                        ? String(object.id).length > 23
                          ? String(object.id).slice(0, 12) + "…" + String(object.id).slice(-6)
                          : String(object.id)
                        : object.operationId
                          ? String(object.operationId)
                          : "Recorded evidence"}
                    </p>
                  </div>
                  <div className="actions">
                    {object.frozen === true && <Badge>Frozen final</Badge>}
                    {kind === "reports" && object.parsed === null && <Badge tone="danger">Invalid / unparsed</Badge>}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        inspect(key, kind === "memory" && typeof object.sequence === "number" ? object.sequence : undefined)
                      }
                    >
                      Inspect
                    </Button>
                  </div>
                </div>
                <div className="card-body">
                  {kind === "artifacts" ? (
                    <ArtifactView
                      value={object.value}
                      scenarioVersion={data.config.scenario.version}
                      artifactSchemaVersion={scenarios.view(data.config.scenario.version).artifactSchemaVersion}
                    />
                  ) : (
                    <p className="text-block">
                      {kind === "board"
                        ? String(object.text ?? "")
                        : kind === "reports"
                          ? String(object.raw ?? "")
                          : pretty(object.value ?? object.data ?? item).slice(0, 500)}
                    </p>
                  )}
                  {kind === "board" && <BoardDelivery id={String(object.id)} deliveries={board?.deliveries} />}
                  {kind === "artifacts" && index > 0 && (
                    <details style={{ marginTop: 12 }}>
                      <summary className="helper">Compare to previous version</summary>
                      <div className="form-grid">
                        <JsonView value={(items[index - 1] as ArtifactVersion).value} title="Previous version" />
                        <JsonView value={object.value} title="Selected version" />
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
          title={"No " + kind + " recorded on this page"}
          description="Unavailable evidence is distinct from an empty agent action or a negative finding."
        />
      )}
      <Pager page={evidence.page} hasMore={evidence.hasMore} onChange={evidence.onChange} />
    </Card>
  );
}

export function BoardPanel() {
  return <EvidencePanel kind="board" />;
}
export function ArtifactsPanel() {
  return <EvidencePanel kind="artifacts" />;
}
export function MemoryPanel() {
  return <EvidencePanel kind="memory" />;
}
export function ReportsPanel() {
  return <EvidencePanel kind="reports" />;
}

export function ConfigurationPanel() {
  const id = useRunId();
  const run = useRunRecordOnly(id);
  if (run.loading) return <Loading />;
  if (!run.data) return <ErrorState error={run.error} retry={run.refresh} />;
  const data = run.data;
  return (
    <div className="editor-layout">
      <Card>
        <CardHeading title="Frozen run configuration" description="Editing a draft never changes this execution." />
        <div className="card-body">
          <dl className="definition-list">
            <dt>Scenario</dt>
            <dd>
              {data.config.scenario.version} · {data.config.scenario.datasetId}
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
          <JsonView value={data.config} title="Complete immutable configuration (developer view)" />
        </div>
      </Card>
      <Card>
        <CardHeading title="Usage & provenance" />
        <div className="card-body">
          <JsonView value={data.usage} title="Recorded provider usage" />
          <p className="helper">
            Recorded usage may be partial. Missing provider reasoning does not establish that the agent had no reasoning
            or intent.
          </p>
        </div>
      </Card>
    </div>
  );
}

export function ResultsPanel() {
  const id = useRunId();
  return <HealthcareResults runId={id!} />;
}

/** Freshness/post-completion footer shared by the detail shell. */
export function RunFreshness({ updatedAt, id, completed }: { updatedAt: string; id: string; completed: boolean }) {
  return (
    <>
      <p className="helper">
        Execution state is the last recorded worker state. Fetch timestamps indicate dashboard freshness, not worker
        health or proof of progress. Run record updated {when(updatedAt)}.
      </p>
      {completed && (
        <div className="actions" style={{ marginTop: 22 }}>
          <Button asChild>
            <Link to={"/analysis?run=" + id}>New Jev analysis</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to={"/oversight?run=" + id}>Configure oversight</Link>
          </Button>
        </div>
      )}
    </>
  );
}
