import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardHeading,
  Empty,
  ErrorState,
  JsonView,
  Loading,
  Notice,
  Pager,
} from "../../components/ui";
import { ArtifactView } from "../../components/artifact-view";
import { ReadableValue } from "../../components/readable-value";
import { BoardDeliveries } from "../../components/run-evidence/board-deliveries";
import { EvidenceTab } from "../../components/run-evidence/evidence-tab";
import { MemoryPanel as MemoryEvidencePanel } from "../../components/run-evidence/memory-panel";
import { ActivityStrip, ReportSections } from "../../components/run-evidence/report-sections";
import { DiffView } from "../../components/run-evidence/line-diff";
import { ACTIVITY_EVENT_TYPES, activityByAgent, isTerminal, roundTurn } from "../../components/run-evidence/evidence-model";
import { useRunEventsByType } from "../../components/run-evidence/use-run-events";
import { BudgetSummary } from "../../components/budget-summary";
import { HealthcareResults } from "../../components/healthcare-results";
import type { ArtifactVersion } from "../../lib/types";
import type { BoardPage, ReportPage } from "../../lib/contracts";
import { pretty, when } from "../../lib/utils";
import { RunEventsView, StreamBadge } from "./RunEventsView";
import { LiveOverview } from "./RunLive";
import { ContextChart, RecordedRail, TurnsRail, useRailEvents } from "./RunRail";
import { Downstream } from "../../components/run-evidence/downstream";
import { useRunLive } from "./run-live-context";
import { BoardDelivery } from "./board-delivery";
import { evidenceKey } from "./evidence-key";
import { useRunEvidence, useRunId, useRunRoute } from "./use-run-evidence";
import { useScenarios } from "../../lib/descriptors";
import { useRunProgress } from "./use-run-progress";
import { useRunRecordOnly } from "./use-run-record";

/** The one sentence that says what is worth knowing about this run's timeline, from recorded data only. */
function timelineFinding(live: ReturnType<typeof useRunLive>, peak: number | undefined): ReactNode {
  const turns = live.turns;
  if (!turns?.length) return "Proposed requests, admitted actions and results stay distinct.";
  const failed = turns.filter((turn) => turn.failures > 0);
  const events = turns.reduce((sum, turn) => sum + turn.eventCount, 0);
  if (failed.length) {
    const first = failed[0]!;
    return (
      <>
        <strong>
          {failed.length} {failed.length === 1 ? "turn recorded a failure" : "turns recorded failures"}
        </strong>
        , the first by {first.agentId} at round {first.round ?? "—"} · turn {first.turn}.
      </>
    );
  }
  const idle = live.roles.filter((role) => !turns.some((turn) => turn.agentId === role));
  if (!live.active && idle.length) {
    return (
      <>
        <strong>{idle.join(", ")} never took a turn</strong>, so nothing from {idle.length === 1 ? "it" : "them"} is on the board.
      </>
    );
  }
  return (
    <>
      <strong>
        {turns.length} turns · {events} events
      </strong>
      {peak ? ` · peak context ${peak.toLocaleString()} tokens` : ""}. Proposed requests, admitted actions and results stay distinct.
    </>
  );
}

/** Timeline and model-call views: the live, turn-aligned event window from the detail shell. */
export function EventsPanel({ kind }: { kind: "timeline" | "traces" }) {
  const live = useRunLive();
  const rail = useRailEvents(live.run.id, live.active);
  const peak = rail.points.reduce((best, point) => Math.max(best, point.context), 0);
  const filters = (
    <div className="run-filters">
      <label className="cf">
        <span>Actor</span>
        <select aria-label="Actor" value={live.filters.actor} onChange={(e) => live.setFilter("actor", e.target.value)}>
          <option value="">All {live.roles.length} roles</option>
          {live.roles.map((role) => (
            <option key={role}>{role}</option>
          ))}
        </select>
      </label>
      <label className="cf">
        <span>Phase</span>
        <select aria-label="Phase" value={live.filters.phase} onChange={(e) => live.setFilter("phase", e.target.value)}>
          <option value="">All</option>
          <option value="action">Action</option>
          <option value="report">Report</option>
        </select>
      </label>
      <label className="cf">
        <span>Event type</span>
        <input aria-label="Event type" value={live.filters.type} onChange={(e) => live.setFilter("type", e.target.value)} placeholder="Any" />
      </label>
      <span className="cf">
        <span>Sequence</span>
        <input aria-label="Sequence from" type="number" min="1" value={live.filters.from} onChange={(e) => live.setFilter("from", e.target.value)} placeholder="first" />
        <i aria-hidden="true">–</i>
        <input aria-label="Sequence through" type="number" min="1" value={live.filters.to} onChange={(e) => live.setFilter("to", e.target.value)} placeholder="last" />
      </span>
    </div>
  );
  const body = (
    <RunEventsView
      tab={kind}
      runEvents={live.runEvents}
      follow={live.follow}
      turns={live.turns}
      start={live.start}
      provider={live.provider}
      focusCall={live.focusCall}
      onInspect={live.onInspect}
      onOpenTraces={live.onOpenTraces}
      onJump={live.onJump}
      filters={filters}
    />
  );
  if (kind === "traces") {
    return (
      <Card>
        <CardHeading
          title="Model calls"
          count={live.turns ? live.turns.reduce((sum, turn) => sum + turn.modelCalls, 0) : undefined}
          description="What each call reasoned, said and proposed, in the turns loaded below."
          actions={<StreamBadge status={live.runEvents.status} />}
          ruled
        />
        {body}
      </Card>
    );
  }
  return (
    <>
      {live.active && <LiveOverview />}
      <div className="g12">
        <Card className="c8">
          <CardHeading
            title="Execution timeline"
            description={timelineFinding(live, peak)}
            actions={<StreamBadge status={live.runEvents.status} />}
            ruled
          />
          {body}
          <div className="card-foot">
            <span>
              Execution state is the last recorded worker state. Fetch timestamps indicate dashboard freshness, not worker
              health or proof of progress. Run record updated {when(live.run.updatedAt)}.
            </span>
          </div>
        </Card>
        <div className="c4 stack">
          <Card>
            <CardHeading
              title="Context per model call"
              actions={peak ? <span className="small muted">peak {peak.toLocaleString()} tokens</span> : undefined}
            />
            <div className="card-body run-chart-body">
              <ContextChart points={rail.points} allowance={live.run.config.tokenBudget?.maxInputTokens} />
            </div>
          </Card>
          <TurnsRail turns={live.turnList} onJump={live.onJump} config={live.run.config} />
          <RecordedRail run={live.run} memoryUpdates={rail.memoryUpdates} partial={rail.partial} />
          <Downstream runId={live.run.id} status={live.run.status} compact />
        </div>
      </div>
    </>
  );
}

export function TimelinePanel() {
  return <EventsPanel kind="timeline" />;
}
export function TracesPanel() {
  return <EventsPanel kind="traces" />;
}

/** Board, artifacts, private memory and reports: main's readable evidence family. */
export function EvidencePanel({ kind }: { kind: "board" | "artifacts" | "memory" | "reports" }) {
  const id = useRunId();
  const run = useRunRecordOnly(id);
  const evidence = useRunEvidence(kind);
  const scenarios = useScenarios();
  const { inspect } = useRunRoute();
  const board = kind === "board" ? (evidence.payload as BoardPage | undefined) : undefined;
  const reporting =
    kind === "reports" && evidence.payload && "reporting" in evidence.payload
      ? (evidence.payload as ReportPage).reporting
      : undefined;
  const active = !!run.data && !isTerminal(run.data.status);
  const sideTypes =
    kind === "board" ? ["board_post"] : kind === "artifacts" ? ["artifact_updated"] : kind === "reports" ? ACTIVITY_EVENT_TYPES : [];
  const sideEvents = useRunEventsByType(id, sideTypes, sideTypes.length > 0 && !!id, active ? 10000 : 0);
  if (run.loading) return <Loading />;
  if (!run.data) return <ErrorState error={run.error} retry={run.refresh} />;
  const data = run.data;
  const terminal = isTerminal(data.status);
  const items = evidence.data;
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
  const displayItems =
    kind === "artifacts"
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
      {kind !== "memory" && evidence.error && <ErrorState error={evidence.error} retry={evidence.refresh} />}
      {kind !== "memory" && sideEvents.partial && (
        <Notice kind="warning">
          Recorded event history was capped; round/turn details and counts on this tab may be incomplete.
        </Notice>
      )}
      {kind === "memory" ? (
        <MemoryEvidencePanel runId={id!} active={active} onInspect={inspect} />
      ) : evidence.loading ? (
        <Loading />
      ) : displayItems.length ? (
        <div className="card-body stack">
          {displayItems.map((item, index) => {
            const object = item as Record<string, unknown>;
            const key = evidenceKey(item, index);
            const postEvent = kind === "board" ? postEvents.get(String(object.id)) : undefined;
            const versionEvent =
              kind === "artifacts" ? versionEvents.get(Number(object.version)) : undefined;
            const previous =
              kind === "artifacts" && typeof object.previousVersion === "number"
                ? (items as ArtifactVersion[]).find((candidate) => candidate.version === object.previousVersion)
                : undefined;
            return (
              <Card key={key}>
                <div className="card-heading">
                  <div>
                    <h3>
                      {kind === "board"
                        ? `Post ${object.sequence ?? index + 1} · ${object.authorId ?? "Unknown author"}`
                        : kind === "artifacts"
                          ? object.frozen === true
                            ? `Final frozen version ${object.version ?? index + 1}`
                            : `Version ${object.version ?? index + 1}`
                          : `Report · ${object.agentId ?? "Unknown agent"}`}
                    </h3>
                    <p>
                      {kind === "board"
                        ? [
                            postEvent ? roundTurn(postEvent) : "Round/turn not loaded",
                            typeof object.timestamp === "string" ? when(object.timestamp) : undefined,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : kind === "artifacts"
                          ? object.frozen === true
                            ? `Frozen at the end of the run${typeof object.previousVersion === "number" ? ` from version ${object.previousVersion}` : ""}`
                            : [
                                String(object.authorId ?? "unknown author"),
                                versionEvent ? roundTurn(versionEvent) : "Round/turn not loaded",
                              ].join(" · ")
                          : "Submitted final report"}
                    </p>
                  </div>
                  <div className="actions">
                    {object.frozen === true && <Badge>Frozen final</Badge>}
                    {kind === "reports" && object.parsed === null && <Badge tone="danger">Invalid / unparsed</Badge>}
                    <Button variant="secondary" size="sm" onClick={() => inspect(key)}>
                      Inspect
                    </Button>
                  </div>
                </div>
                <div className="card-body">
                  {kind === "artifacts" ? (
                    <ArtifactView
                      value={object.value}
                      schemaVersion={data.config.artifactSchemaVersion}
                      scenarioVersion={data.config.scenario.version}
                      terminal={terminal}
                    />
                  ) : kind === "reports" ? (
                    <>
                      <ReportSections parsed={object.parsed} raw={String(object.raw ?? "")} />
                      <ActivityStrip
                        agentId={String(object.agentId)}
                        activity={activity.get(String(object.agentId))}
                        partial={sideEvents.partial}
                        loading={sideEvents.loading}
                      />
                    </>
                  ) : (
                    <p className="text-block">{String(object.text ?? "")}</p>
                  )}
                  {kind === "board" && (
                    <BoardDeliveries
                      postId={String(object.id)}
                      authorId={String(object.authorId)}
                      roles={data.config.roles.map((role) => role.id)}
                      deliveries={board?.deliveries}
                    />
                  )}
                  {kind === "artifacts" && previous && (
                    <details style={{ marginTop: 12 }}>
                      <summary className="helper">Compare to version {previous.version}</summary>
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
      ) : kind === "artifacts" && !terminal ? (
        <Empty
          title="No submission yet"
          description="The run is still in progress; artifact versions appear as agents submit them."
        />
      ) : (
        <Empty
          title={"No " + kind + " recorded on this page"}
          description="Unavailable evidence is distinct from an empty agent action or a negative finding."
        />
      )}
      {kind !== "memory" && <Pager page={evidence.page} hasMore={evidence.hasMore} onChange={evidence.onChange} />}
    </Card>
  );
}

export function BoardPanel() {
  return <EvidenceTab kind="board" />;
}
export function ArtifactsPanel() {
  return <EvidenceTab kind="artifacts" />;
}
export function MemoryPanel() {
  return <EvidenceTab kind="memory" />;
}
export function ReportsPanel() {
  return <EvidenceTab kind="reports" />;
}

export function ConfigurationPanel() {
  const id = useRunId();
  const run = useRunRecordOnly(id);
  if (run.loading) return <Loading />;
  if (!run.data) return <ErrorState error={run.error} retry={run.refresh} />;
  const data = run.data;
  return (
    <div className="g12">
      <Card className="c8">
        <CardHeading
          title="Frozen run configuration"
          description={
            <>
              <strong>{data.config.scenario.version}</strong> on {data.config.model.provider} / {data.config.model.id}; editing a draft never changes this execution.
            </>
          }
          ruled
        />
        <div className="card-body run-config-body">
          <dl className="kv">
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
      <Card className="c4">
        <CardHeading title="Usage & provenance" />
        <div className="card-body">
          <JsonView value={data.usage} title="Recorded provider usage" />
          <p className="small muted run-config-note">
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
