/** The Timeline tab's right rail: context per model call, the turn list, and what the run recorded. */
import { useId } from "react";
import type { TurnSummary } from "@sidechannel/contracts/browser";
import { Card, CardHeading } from "../../components/ui";
import { contextPoints, type ContextPoint } from "../../components/run-evidence/evidence-model";
import { useRunEventsByType } from "../../components/run-evidence/use-run-events";
import type { Run } from "../../lib/types";
import { compactNumber, niceMax } from "./run-stats";
import { roleStyle } from "./role-color";

const W = 330;
const H = 150;
const PLOT = { left: 34, right: 324, top: 14, bottom: 128 };

/** A line chart of the context tokens each model call was sent with, against a round y scale. */
export function ContextChart({ points, allowance }: { points: ContextPoint[]; allowance?: number }) {
  const titleId = useId();
  if (!points.length) {
    return <p className="small muted">No model call has recorded its context size yet.</p>;
  }
  const peak = points.reduce((best, point) => (point.context > best.context ? point : best), points[0]!);
  const top = niceMax(peak.context);
  const x = (index: number) =>
    points.length === 1 ? (PLOT.left + PLOT.right) / 2 : PLOT.left + (index * (PLOT.right - PLOT.left)) / (points.length - 1);
  const y = (value: number) => PLOT.bottom - (value / top) * (PLOT.bottom - PLOT.top);
  const ticks = [0, 1, 2, 3, 4].map((step) => (top * step) / 4);
  const peakIndex = points.indexOf(peak);
  // Label the first call of each turn, thinned to about seven labels.
  const turnStarts = points
    .map((point, index) => ({ point, index }))
    .filter(({ point, index }) => index === 0 || points[index - 1]!.turn !== point.turn);
  const stride = Math.max(1, Math.ceil(turnStarts.length / 7));
  const labels = turnStarts.filter((_, i) => i % stride === 0);
  const labelRight = x(peakIndex) > (PLOT.left + PLOT.right) / 2;
  const peakText = `${peak.context.toLocaleString()} · call ${peakIndex + 1}${peak.turn ? `, T${peak.turn}` : ""}`;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-labelledby={titleId} className="run-chart">
        <title id={titleId}>
          {`Context tokens per model call across ${points.length} calls; peak ${peak.context.toLocaleString()} at call ${peakIndex + 1}`}
        </title>
        <g className="run-chart-grid">
          {ticks.map((tick) => (
            <line key={tick} x1={PLOT.left} x2={PLOT.right} y1={y(tick)} y2={y(tick)} />
          ))}
        </g>
        <g className="run-chart-axis" textAnchor="end">
          {ticks.map((tick) => (
            <text key={tick} x={PLOT.left - 5} y={y(tick) + 3}>
              {tick === 0 ? "0" : compactNumber(tick)}
            </text>
          ))}
        </g>
        <polyline
          className="run-chart-line"
          points={points.map((point, index) => `${x(index).toFixed(1)},${y(point.context).toFixed(1)}`).join(" ")}
        />
        <circle className="run-chart-dot" cx={x(peakIndex)} cy={y(peak.context)} r="2.5" />
        <text
          className="run-chart-note"
          x={x(peakIndex) + (labelRight ? -6 : 6)}
          y={y(peak.context) - 6}
          textAnchor={labelRight ? "end" : "start"}
        >
          {peakText}
        </text>
        <g className="run-chart-axis" textAnchor="middle">
          {labels.map(({ point, index }) => (
            <text key={index} x={x(index)} y={H - 6}>
              {point.turn ? `T${point.turn}` : `#${index + 1}`}
            </text>
          ))}
        </g>
      </svg>
      <p className="small muted run-chart-foot">
        {allowance
          ? `Measured from the request; the input allowance is ${allowance.toLocaleString()} tokens.`
          : "Measured from the request."}
      </p>
    </>
  );
}

export function TurnsRail({
  turns,
  onJump,
  config,
}: {
  turns: TurnSummary[] | undefined;
  onJump(at: number): void;
  config: Run["config"];
}) {
  const events = turns?.reduce((sum, turn) => sum + turn.eventCount, 0) ?? 0;
  const allowance = config.scheduler.toolCallsPerTurn;
  const shown = (turns ?? []).slice(0, 8);
  return (
    <Card>
      <CardHeading
        title="Turns"
        actions={turns?.length ? <span className="small muted">{turns.length} · {events} events</span> : undefined}
      />
      {turns?.length ? (
        <>
          <ul className="run-turns" aria-label="Turns">
            {shown.map((turn) => (
              <li key={turn.firstSequence}>
                <button
                  type="button"
                  className="run-turn"
                  onClick={() => onJump(turn.firstSequence)}
                  aria-label={`Jump to round ${turn.round ?? "—"} turn ${turn.turn}`}
                >
                  <span className="mono small muted">R{turn.round ?? "—"} T{turn.turn}</span>
                  <span className="who-chip trunc" style={roleStyle(turn.agentId)}>{turn.agentId}</span>
                  <span className="muted n">{turn.modelCalls} {turn.modelCalls === 1 ? "call" : "calls"}</span>
                  <span className={turn.failures ? "n bad" : "muted n"}>
                    {turn.failures ? `${turn.failures} failed` : allowance ? `of ${allowance}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="card-foot">
            <span>
              {turns.length > shown.length
                ? `Turns 1–${shown.length} of ${turns.length}`
                : `${turns.length} ${turns.length === 1 ? "turn" : "turns"}`}
            </span>
            {turns.length > shown.length && (
              <button type="button" className="link" onClick={() => onJump(turns[shown.length]!.firstSequence)}>
                Later turns
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="small muted run-rail-empty">No turn has started yet.</p>
      )}
    </Card>
  );
}

export function RecordedRail({ run, memoryUpdates, partial }: { run: Run; memoryUpdates: number | undefined; partial: boolean }) {
  const usage = run.usage as Record<string, number | undefined> | undefined;
  const invalid = (run.reports ?? []).filter((report) => (report as { parsed?: unknown }).parsed === null).length;
  const frozen = (run.artifacts ?? []).find((item) => item.frozen);
  return (
    <Card>
      <CardHeading title="Recorded for this run" />
      <dl className="kv run-recorded">
        <dt>Board posts</dt>
        <dd>{run.board?.length ?? 0}</dd>
        <dt>Artifact versions</dt>
        <dd>
          {run.artifacts?.length ?? 0}
          {frozen ? <span className="muted"> · final frozen at version {frozen.version}</span> : null}
        </dd>
        <dt>Final reports</dt>
        <dd>
          {run.reports?.length ?? 0}
          {invalid ? <span className="muted"> · {invalid} invalid / unparsed</span> : null}
        </dd>
        <dt>Memory updates</dt>
        <dd>{memoryUpdates === undefined ? "…" : `${memoryUpdates}${partial ? "+" : ""}`}</dd>
        {usage?.totalTokens !== undefined && (
          <>
            <dt>Tokens</dt>
            <dd>
              {usage.totalTokens.toLocaleString()}
              <span className="muted">
                {usage.inputTokens !== undefined ? ` · ${usage.inputTokens.toLocaleString()} in` : ""}
                {usage.outputTokens !== undefined ? ` · ${usage.outputTokens.toLocaleString()} out` : ""}
              </span>
            </dd>
          </>
        )}
        {usage?.reasoningTokens !== undefined && usage.reasoningTokens > 0 && (
          <>
            <dt>Reasoning</dt>
            <dd>
              {usage.reasoningTokens.toLocaleString()} <span className="muted">tokens</span>
            </dd>
          </>
        )}
      </dl>
    </Card>
  );
}

/** What the rail reads from the recorded events, refreshing while the run is active. */
export function useRailEvents(runId: string, active: boolean) {
  const result = useRunEventsByType(runId, ["context_accounted", "model_usage", "memory_updated"], true, active ? 15000 : 0);
  const points = contextPoints(result.events.context_accounted ?? [], result.events.model_usage ?? []);
  const memoryUpdates = result.loading && !result.events.memory_updated ? undefined : (result.events.memory_updated ?? []).length;
  return { points, memoryUpdates, partial: result.partial, loading: result.loading };
}
