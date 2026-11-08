import { Link } from "react-router-dom";
import { Notice } from "../ui";
import type { HarnessEvent } from "../../lib/types";
import {
  contextPoints,
  eventLink,
  isTerminal,
  roundTurn,
} from "./evidence-model";
import { useRunEventsByType } from "./use-run-events";
import { oneSentence } from "../model-call";

function duration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Header diagnostic: one sentence naming the terminating agent, round/turn, event and duration; the raw text sits behind "Full diagnostic". */
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
    !!failureReason,
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
  if (!failureReason) return null;
  const reason = oneSentence(failureReason, 200);
  return (
    <Notice kind="error">
      Run diagnostic: {reason}
      {culprit && (
        <>
          {" "}
          {culprit.agentId ?? "system"}, {roundTurn(culprit).toLowerCase()}
          {" ("}
          <Link to={eventLink(culprit)}>event #{culprit.sequence}</Link>
          {")"}
          {lastFailed && ` · context ${lastFailed.context.toLocaleString()} ${lastFailed.unit}`}
          {elapsed && ` · recorded run time ${elapsed}`}
        </>
      )}
      {!culprit && elapsed && ` · recorded run time ${elapsed}`}
      {reason !== failureReason.trim() && (
        <details className="run-diagnostic-full">
          <summary>Full diagnostic</summary>
          <pre>{failureReason}</pre>
        </details>
      )}
    </Notice>
  );
}
