import { Link } from "react-router-dom";
import { Notice } from "../ui";
import type { HarnessEvent } from "../../lib/types";
import {
  contextPoints,
  eventLink,
  isTerminal,
  roundTurn,
  type ContextPoint,
} from "./evidence-model";
import { useRunEventsByType } from "./use-run-events";

const PALETTE = ["#2563eb", "#d97706", "#16a34a", "#9333ea", "#0891b2", "#db2777", "#65a30d"];

function duration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function ContextSparkline({ points }: { points: ContextPoint[] }) {
  if (!points.length) return null;
  const width = 180;
  const height = 36;
  const agents = [...new Set(points.map((point) => point.agentId ?? "system"))].sort();
  const color = (point: ContextPoint) =>
    PALETTE[agents.indexOf(point.agentId ?? "system") % PALETTE.length]!;
  const max = Math.max(...points.map((point) => point.context), 1);
  const x = (index: number) =>
    points.length === 1 ? width / 2 : 4 + (index * (width - 8)) / (points.length - 1);
  const y = (value: number) => height - 4 - (value / max) * (height - 8);
  const unit = points[0]!.unit;
  const failed = points.filter((point) => point.failed).length;
  return (
    <div className="context-sparkline">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`Context size per model call: ${points.length} calls, peak ${max.toLocaleString()} ${unit}${failed ? `, ${failed} without a recorded response` : ""}`}
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
          points={points.map((point, index) => `${x(index)},${y(point.context)}`).join(" ")}
        />
        {points.map((point, index) =>
          point.failed ? (
            <text
              key={point.invocationId}
              x={x(index)}
              y={y(point.context) + 4}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill="var(--danger)"
            >
              <title>{`Call ${index + 1} · ${point.agentId ?? "system"} · no recorded response · ${point.context.toLocaleString()} ${unit}`}</title>
              ×
            </text>
          ) : (
            <circle key={point.invocationId} cx={x(index)} cy={y(point.context)} r="2.5" fill={color(point)}>
              <title>{`Call ${index + 1} · ${point.agentId ?? "system"} · ${point.context.toLocaleString()} ${unit}`}</title>
            </circle>
          ),
        )}
      </svg>
      <span className="helper">
        Context per model call (peak {max.toLocaleString()} {unit}).{" "}
        {agents.map((agent) => (
          <span key={agent} className="context-legend">
            <i style={{ background: PALETTE[agents.indexOf(agent) % PALETTE.length] }} />
            {agent}
          </span>
        ))}
        {failed > 0 && <span className="context-legend">× no recorded response</span>}
      </span>
    </div>
  );
}

/** Header diagnostic (terminating agent, round/turn, link, duration, context) and the per-call context sparkline. */
export function RunDiagnostic({
  runId,
  status,
  failureReason,
  createdAt,
  updatedAt,
}: {
  runId: string;
  status: string;
  failureReason?: string;
  createdAt?: string;
  updatedAt?: string;
}) {
  const active = !isTerminal(status);
  const result = useRunEventsByType(
    runId,
    ["context_accounted", "model_usage", "run_terminated"],
    true,
    active ? 15000 : 0,
  );
  // While the run is active, a call without usage is simply in flight, not failed.
  const points = contextPoints(
    result.events.context_accounted ?? [],
    result.events.model_usage ?? [],
  ).map((point) => (active ? { ...point, failed: false } : point));
  const terminated: HarnessEvent | undefined = result.events.run_terminated?.at(-1);
  const lastFailed = points.filter((point) => point.failed).at(-1);
  const culprit = lastFailed?.event ?? terminated;
  const elapsed =
    createdAt && updatedAt
      ? duration(Date.parse(updatedAt) - Date.parse(createdAt))
      : undefined;
  return (
    <>
      {failureReason && (
        <Notice kind="error">
          Run diagnostic: {failureReason}
          {culprit && (
            <>
              {" "}
              — {culprit.agentId ?? "system"}, {roundTurn(culprit).toLowerCase()}
              {" ("}
              <Link to={eventLink(culprit)}>event #{culprit.sequence}</Link>
              {")"}
              {lastFailed &&
                ` · context ${lastFailed.context.toLocaleString()} ${lastFailed.unit}`}
              {elapsed && ` · recorded run time ${elapsed}`}
            </>
          )}
          {!culprit && elapsed && ` — recorded run time ${elapsed}`}
        </Notice>
      )}
      <ContextSparkline points={points} />
    </>
  );
}
