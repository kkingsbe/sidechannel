/**
 * The live view of a run that is still going: turn tape, who is acting, what the current call is
 * doing, the newest events, the budget and the other run of the pair. Everything is derived from
 * the recorded event stream the page already follows; a figure the stream does not carry is left out.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { HarnessEvent } from "@sidechannel/contracts/browser";
import { Card, CardHeading, Lane } from "../../components/ui";
import { ToolCallList } from "../../components/model-call";
import { useRunEventsByType } from "../../components/run-evidence/use-run-events";
import { useClients } from "../../lib/clients/context";
import { useResource } from "../../lib/clients/query";
import { buildModelCalls, formatTokens, summarizeEvent, humanizeCode, type ModelCall } from "../../lib/model-calls";
import type { Run } from "../../lib/types";
import { useRunLive } from "./run-live-context";
import { roleAbbreviation, roleHue, roleStyle } from "./role-color";
import { ago, duration } from "./run-stats";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const ms = (iso: string | undefined) => {
  const value = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(value) ? value : undefined;
};

/** A clock that ticks once a second while `on`. */
function useNow(on = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

/** "Live · last event 4 s ago" in the run header. */
export function LiveStamp({ updatedAt }: { updatedAt: string | undefined }) {
  const now = useNow();
  const text = ago(updatedAt, now);
  return (
    <span className="stamp">
      <span className="status-dot" />
      Live{text ? ` · last event ${text}` : ""}
    </span>
  );
}

/* ------------------------------------------------------------------ the data */

interface CallSpan {
  invocationId: string;
  agentId?: string;
  round?: number;
  turn?: number;
  start: number;
  end?: number;
  context?: number;
  limit?: number;
}

interface TurnState {
  turn: number;
  round?: number;
  agentId: string;
  allowance?: number;
  remaining?: number;
  ended: boolean;
}

function useLiveData(runId: string) {
  const live = useRunLive();
  const result = useRunEventsByType(
    runId,
    ["context_accounted", "model_usage", "board_post", "turn_started", "turn_ended"],
    true,
    8000,
  );
  return useMemo(() => {
    const byId = new Map<string, HarnessEvent>();
    for (const list of Object.values(result.events)) for (const event of list) byId.set(event.id, event);
    for (const event of live.runEvents.events) byId.set(event.id, event);
    const events = [...byId.values()].sort((a, b) => a.sequence - b.sequence);
    const spans = new Map<string, CallSpan>();
    const posts: { agentId?: string; at: number; sequence: number }[] = [];
    const turns = new Map<number, TurnState>();
    for (const event of events) {
      const at = ms(event.timestamp);
      if (at === undefined) continue;
      const data = isRecord(event.data) ? event.data : {};
      if (event.type === "context_accounted" && event.invocationId) {
        spans.set(event.invocationId, {
          invocationId: event.invocationId,
          agentId: event.agentId,
          round: event.round,
          turn: event.turn,
          start: at,
          context: num(data.measured) ?? num(data.estimated),
          limit: num(data.limit),
        });
      } else if ((event.type === "model_usage" || event.type === "model_response") && event.invocationId) {
        const span = spans.get(event.invocationId);
        if (span) span.end = Math.max(span.end ?? 0, at);
      } else if (event.type === "board_post") {
        posts.push({ agentId: event.agentId, at, sequence: event.sequence });
      } else if (event.type === "turn_started" && event.turn) {
        turns.set(event.turn, { turn: event.turn, round: event.round, agentId: event.agentId ?? "", allowance: num(data.allowance), ended: false });
      } else if (event.type === "turn_ended" && event.turn) {
        const turn = turns.get(event.turn) ?? { turn: event.turn, round: event.round, agentId: event.agentId ?? "", ended: false };
        turn.ended = true;
        turn.remaining = num(data.remainingAllowance);
        turns.set(event.turn, turn);
      }
    }
    return { events, spans: [...spans.values()], posts, turns, firstAt: ms(events[0]?.timestamp), partial: result.partial };
  }, [result.events, result.partial, live.runEvents.events]);
}

/* ---------------------------------------------------------------- turn tape */

function TurnTape({ turns, admitted }: { turns: Map<number, TurnState>; admitted: (turn: TurnState) => number }) {
  const { run } = useRunLive();
  const { scheduler } = run.config;
  const order = scheduler.order.length ? scheduler.order : run.config.roles.map((role) => role.id);
  const per = order.length;
  const budget = scheduler.toolCallsPerTurn;
  const total = scheduler.rounds * per;
  const doneCount = [...turns.values()].filter((turn) => turn.ended).length;
  const slots = Array.from({ length: total }, (_, index) => {
    const number = index + 1;
    const real = turns.get(number);
    const role = real?.agentId || order[index % per]!;
    const state = real ? (real.ended ? "done" : "now") : number === doneCount + 1 && !real ? "next" : "later";
    const used = real ? (real.ended && real.allowance !== undefined && real.remaining !== undefined ? Math.max(0, real.allowance - real.remaining) : admitted(real)) : 0;
    return { number, role, state, used, allowance: real?.allowance ?? budget };
  });
  return (
    <Card>
      <CardHeading
        title="Turn tape"
        count={`${doneCount} of ${total} turns complete`}
        description="Each slot is one turn: the role, and its action budget as actions are admitted."
      />
      <div className="card-body tape" role="list" aria-label="Turn tape">
        {Array.from({ length: scheduler.rounds }, (_, round) => (
          <div key={round} className="tape-round">
            <div className="tape-round-label small muted">
              Round {round + 1}
              {run.round === round + 1 ? " · in progress" : ""}
            </div>
            <div className="tape-slots">
              {slots.slice(round * per, (round + 1) * per).map((slot) => (
                <div key={slot.number} role="listitem" className={`tape-slot ${slot.state}`} aria-current={slot.state === "now" ? "step" : undefined}>
                  <div className="tape-slot-head" style={roleStyle(slot.role)}>
                    <span className="who-chip" title={slot.role}>{roleAbbreviation(slot.role)}</span>
                    <span className="small muted n">
                      {slot.state === "next" ? "next" : slot.state === "later" ? "" : `${slot.used}/${slot.allowance}`}
                    </span>
                  </div>
                  <div className="tape-dots" aria-hidden="true">
                    {Array.from({ length: slot.allowance }, (_, dot) => (
                      <i key={dot} className={dot < slot.used ? "on" : undefined} />
                    ))}
                  </div>
                  <span className="sr-only">
                    {slot.role}, turn {slot.number}, {slot.state === "later" ? "not started" : slot.state}
                    {slot.state === "done" || slot.state === "now" ? `, ${slot.used} of ${slot.allowance} actions used` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="small muted tape-note">After the last turn, each role makes {run.config.limits.reportCalls ?? "its"} report call{run.config.limits.reportCalls === 1 ? "" : "s"}.</p>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- who is acting */

const LANE_H = 30;
const LEFT = 128;

function niceMinutes(spanMin: number): number {
  for (const step of [1, 2, 5, 10, 15, 30, 60]) if (spanMin / step <= 8) return step;
  return 120;
}

function Swimlane({ roles, spans, posts, start, now }: { roles: string[]; spans: CallSpan[]; posts: { agentId?: string; at: number }[]; start: number; now: number }) {
  const width = 1000;
  const plotW = width - LEFT - 12;
  const height = roles.length * LANE_H + 34;
  const elapsed = Math.max(60_000, now - start);
  const x = (time: number) => LEFT + (Math.max(0, time - start) / elapsed) * plotW;
  const step = niceMinutes(elapsed / 60_000);
  const ticks: number[] = [];
  for (let minute = 0; minute * 60_000 <= elapsed; minute += step) ticks.push(minute);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" className="swim" aria-label={`Model calls by role over ${duration(elapsed)}; board posts marked`}>
      {ticks.map((minute) => (
        <g key={minute}>
          <line className="swim-grid" x1={x(start + minute * 60_000)} x2={x(start + minute * 60_000)} y1={0} y2={roles.length * LANE_H} />
          <text className="swim-axis" x={x(start + minute * 60_000)} y={roles.length * LANE_H + 16} textAnchor="middle">
            {minute === 0 ? "0" : `${minute} min`}
          </text>
        </g>
      ))}
      {roles.map((role, lane) => {
        const mid = lane * LANE_H + LANE_H / 2;
        return (
          <g key={role}>
            <circle cx={8} cy={mid} r={4} style={{ fill: `var(--role-${roleHue(role)})` }} />
            <text className="swim-role" x={20} y={mid + 4}>{role}</text>
            {spans.filter((span) => span.agentId === role).map((span) => {
              const open = span.end === undefined;
              const x0 = x(span.start);
              const x1 = x(open ? now : span.end!);
              return (
                <rect key={span.invocationId} className={open ? "swim-call swim-now" : "swim-call"} x={x0} y={mid - 7} width={Math.max(3, x1 - x0)} height={14} rx={2}>
                  <title>{`${role} · turn ${span.turn ?? "?"} · ${open ? "in progress" : duration((span.end ?? span.start) - span.start)}${span.context ? ` · ${span.context.toLocaleString()} context tokens` : ""}`}</title>
                </rect>
              );
            })}
            {posts.filter((post) => post.agentId === role).map((post, index) => (
              <path key={index} className="swim-post" d={`M${x(post.at)} ${mid - 7} l6 7 l-6 7 l-6 -7 z`}>
                <title>{`${role} posted to the board`}</title>
              </path>
            ))}
          </g>
        );
      })}
      <line className="swim-nowline" x1={x(now)} x2={x(now)} y1={0} y2={roles.length * LANE_H} />
    </svg>
  );
}

/* ----------------------------------------------------------------- right now */

function RightNow({ run, spans, calls, admitted, turns, now }: { run: Run; spans: CallSpan[]; calls: ModelCall[]; admitted: number; turns: Map<number, TurnState>; now: number }) {
  const { onInspect } = useRunLive();
  const inFlight = [...spans].reverse().find((span) => span.end === undefined);
  const lastDone = [...calls].reverse().find((call) => call.response);
  const actor = inFlight?.agentId ?? run.activeAgentId;
  const budget = run.config.tokenBudget?.maxInputTokens ?? inFlight?.limit;
  const timeout = run.config.limits.requestTimeoutMs;
  const waited = inFlight ? Math.max(0, now - inFlight.start) : 0;
  const current = [...turns.values()].find((turn) => !turn.ended);
  const callNumber = inFlight && current ? spans.filter((span) => span.turn === inFlight.turn && span.agentId === inFlight.agentId).length : undefined;
  return (
    <Card>
      <CardHeading
        title="Right now"
        count={inFlight?.turn ? `turn ${inFlight.turn}${callNumber ? ` · call ${callNumber}` : ""}` : undefined}
        description={
          actor ? (
            <span className="who-chip" style={roleStyle(actor)}>
              {actor}
              {current ? ` · round ${current.round ?? run.round} · ${admitted} of ${current.allowance ?? run.config.scheduler.toolCallsPerTurn} actions used this turn` : ""}
            </span>
          ) : (
            "Waiting for the worker to pick the next turn."
          )
        }
        actions={inFlight ? <span className="badge badge-info"><span className="pulse" aria-hidden="true" />waiting on model</span> : undefined}
      />
      <div className="card-body stack run-now">
        {inFlight ? (
          <div className="run-now-meters">
            <div>
              <div className="run-now-label">
                <span className="muted">Context on this call</span>
                <span><b>{inFlight.context?.toLocaleString() ?? "—"}</b>{budget ? <span className="muted"> of {budget.toLocaleString()} tokens</span> : null}</span>
              </div>
              <div className="plan" role="img" aria-label="Context tokens against the input allowance">
                <i style={{ width: `${inFlight.context && budget ? Math.min(100, (inFlight.context / budget) * 100) : 0}%` }} />
              </div>
            </div>
            {timeout ? (
              <div>
                <div className="run-now-label">
                  <span className="muted">Request time</span>
                  <span><b>{Math.round(waited / 1000)} s</b><span className="muted"> of {Math.round(timeout / 1000)} s timeout</span></span>
                </div>
                <div className="plan" role="img" aria-label="Request time against the timeout">
                  <i className={waited / timeout > 0.8 ? "warn" : undefined} style={{ width: `${Math.min(100, (waited / timeout) * 100)}%` }} />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {lastDone ? (
          <div className="run-now-out">
            <div className="small muted">
              {inFlight ? "The stream carries a call's text once it completes, so this is the last completed call" : "Last completed call"} · {lastDone.agentId} · #{lastDone.sequenceRange[0]}
            </div>
            {lastDone.text.trim() ? (
              <p className="run-now-text">{lastDone.text}</p>
            ) : (
              <p className="run-now-text muted">No text output; the call proposed {lastDone.toolCalls.length} tool {lastDone.toolCalls.length === 1 ? "call" : "calls"}.</p>
            )}
            {lastDone.toolCalls.length > 0 && (
              <>
                <div className="small muted">Proposed in that call</div>
                <ToolCallList calls={lastDone.toolCalls} variant="compact" onSelectEvent={(id) => onInspect(id)} />
              </>
            )}
          </div>
        ) : (
          <p className="small muted">No model call has completed yet.</p>
        )}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- live events */

const QUIET = new Set(["context_accounted", "model_requested", "model_usage", "tool_requested", "tool_admitted"]);

function LiveEvents({ events, now }: { events: HarnessEvent[]; now: number }) {
  const { onInspect, follow } = useRunLive();
  const shown = events.filter((event) => !QUIET.has(event.type)).slice(-7).reverse();
  const newest = events.at(-1)?.sequence;
  return (
    <Card>
      <CardHeading title="Live events" count="newest first" actions={<span className="small muted">{follow ? "Following" : "Paused"}</span>} />
      <ul className="live-events" aria-label="Live events">
        {shown.map((event) => (
          <li key={event.id}>
            <span className="mono small faint">#{event.sequence}</span>
            <span className="live-kind">{event.type === "model_response" ? "model call" : humanizeCode(event.type)}</span>
            <span className="live-events-text">
              {event.agentId ? <span className="who-chip" style={roleStyle(event.agentId)}>{event.agentId}</span> : null} {summarizeEvent(event)}
            </span>
            <span className="small faint nowrap">{ago(event.timestamp, now)}</span>
            <button type="button" className="tl-open" aria-label={`Open event #${event.sequence}`} onClick={() => onInspect(event.id, event.sequence)}>›</button>
          </li>
        ))}
      </ul>
      <div className="card-foot">
        <span>
          {newest ? `Showing the last ${shown.length} of ${newest} events · ` : ""}new events arrive at the top while Follow live is on
        </span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ budget and pair */

function BudgetCard({ run, start, now, calls, admitted, allowance }: { run: Run; start: number; now: number; calls: CallSpan[]; admitted: number; allowance: number }) {
  const max = run.config.limits.maxDurationMs;
  const elapsed = Math.max(0, now - start);
  const usage = run.usage as Record<string, number | undefined> | undefined;
  const longest = calls.reduce((best, call) => Math.max(best, call.end ? call.end - call.start : 0), 0);
  return (
    <Card>
      <CardHeading title="Budget" />
      <div className="card-body stack run-budget">
        {max ? (
          <div>
            <div className="run-now-label"><span className="muted">Run time</span><span><b>{duration(elapsed)}</b><span className="muted"> of {duration(max)}</span></span></div>
            <div className="plan" role="img" aria-label="Run time against the maximum duration"><i className={elapsed / max > 0.8 ? "warn" : undefined} style={{ width: `${Math.min(100, (elapsed / max) * 100)}%` }} /></div>
          </div>
        ) : null}
        <div>
          <div className="run-now-label"><span className="muted">Actions this turn</span><span><b>{admitted}</b><span className="muted"> of {allowance}</span></span></div>
          <div className="plan" role="img" aria-label="Actions used this turn"><i style={{ width: `${Math.min(100, (admitted / Math.max(1, allowance)) * 100)}%` }} /></div>
        </div>
        <dl className="kv">
          {usage?.totalTokens !== undefined && (
            <>
              <dt>Tokens so far</dt>
              <dd>
                {usage.totalTokens.toLocaleString()}
                <span className="muted">{usage.inputTokens !== undefined ? ` · ${formatTokens(usage.inputTokens)} in` : ""}{usage.outputTokens !== undefined ? ` · ${formatTokens(usage.outputTokens)} out` : ""}</span>
              </dd>
            </>
          )}
          <dt>Model calls</dt>
          <dd>{calls.length}{longest ? <span className="muted"> · longest {duration(longest)}</span> : null}</dd>
        </dl>
      </div>
    </Card>
  );
}

function PairCard({ run }: { run: Run }) {
  const clients = useClients();
  const resource = useResource<{ runs?: Run[] }>(run.pairId ? `run:${run.id}:pair-lanes` : null, () => clients.runs.pair(run.pairId!) as Promise<{ runs?: Run[] }>, { interval: 5000 });
  if (!run.pairId) return null;
  const runs = [...(resource.data?.runs ?? [])].sort((a, b) => (a.pairPosition ?? 0) - (b.pairPosition ?? 0));
  const turnsPerRound = run.config.scheduler.order.length || run.config.roles.length;
  return (
    <Card>
      <CardHeading title="Pair" actions={<Link className="link" to={"/runs/pairs/" + run.pairId}>Compare</Link>} />
      <div className="card-body stack">
        {runs.length ? (
          <div className="lanes">
            {runs.map((item) => {
              const queued = item.status === "queued";
              return (
                <Lane
                  key={item.id}
                  condition={item.config.condition.id}
                  status={item.status}
                  round={queued ? undefined : item.round}
                  rounds={item.config.scheduler.rounds}
                  turn={queued ? undefined : item.turn}
                  turnsPerRound={turnsPerRound}
                  stateLink={item.id === run.id ? undefined : (pill) => <Link to={"/runs/" + item.id}>{pill}</Link>}
                />
              );
            })}
          </div>
        ) : (
          <p className="small muted">{resource.loading ? "Loading the pair…" : "The other run of this pair could not be read."}</p>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------- overview */

export function LiveOverview() {
  const live = useRunLive();
  const { run } = live;
  const data = useLiveData(run.id);
  const now = useNow();
  const calls = useMemo(() => buildModelCalls(live.runEvents.events, { provider: live.provider }), [live.runEvents.events, live.provider]);
  const current = [...data.turns.values()].find((turn) => !turn.ended);
  // Actions admitted this turn, counted from the tool admissions in the followed window.
  const admittedIn = (turn: { turn: number; agentId: string }) =>
    live.runEvents.events.filter((event) => event.type === "tool_admitted" && event.turn === turn.turn && event.agentId === turn.agentId).length;
  const start = data.firstAt ?? ms(run.createdAt) ?? now;
  const inFlight = [...data.spans].reverse().find((span) => span.end === undefined);
  const actor = inFlight?.agentId ?? run.activeAgentId;
  const allowance = current?.allowance ?? run.config.scheduler.toolCallsPerTurn;
  const admitted = current ? admittedIn(current) : 0;
  const callNumber = inFlight ? data.spans.filter((span) => span.turn === inFlight.turn && span.agentId === inFlight.agentId).length : undefined;
  const posts = run.board?.length ?? data.posts.length;
  return (
    <section className="live-overview" aria-label="Live run">
      <p className="finding live-finding">
        {actor && inFlight ? (
          <>
            <strong>
              {actor} is {duration(Math.max(0, now - inFlight.start))} into its {callNumber ? `call ${callNumber}` : "current call"} of turn {inFlight.turn ?? run.turn}.
            </strong>{" "}
          </>
        ) : actor ? (
          <>
            <strong>{actor} is acting in turn {run.turn}.</strong>{" "}
          </>
        ) : (
          <strong>The run is {run.status}; no turn is in progress.</strong>
        )}
        {" "}The board holds {posts} {posts === 1 ? "post" : "posts"}.
      </p>
      <TurnTape turns={data.turns} admitted={admittedIn} />
      <Card>
        <CardHeading title="Who is acting" description="Model calls by role over the minutes since the run started; diamonds are board posts, the current call is blue." />
        <div className="card-body">
          <Swimlane roles={live.roles} spans={data.spans} posts={data.posts} start={start} now={now} />
          {data.partial && <p className="small muted">The recorded history is capped; earlier calls may be missing.</p>}
        </div>
      </Card>
      <div className="g12">
        <div className="c8 stack">
          <RightNow run={run} spans={data.spans} calls={calls} admitted={admitted} turns={data.turns} now={now} />
          <LiveEvents events={data.events} now={now} />
        </div>
        <div className="c4 stack">
          <BudgetCard run={run} start={start} now={now} calls={data.spans} admitted={admitted} allowance={allowance} />
          <PairCard run={run} />
        </div>
      </div>
    </section>
  );
}
