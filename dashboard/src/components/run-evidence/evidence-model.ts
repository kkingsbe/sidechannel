import type { HarnessEvent, Run } from "../../lib/types";

export const TERMINAL_STATUSES = [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
];
export const isTerminal = (status?: string) =>
  !!status && TERMINAL_STATUSES.includes(status);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const roundTurn = (event: { round?: number; turn?: number }) =>
  event.round !== undefined && event.turn !== undefined
    ? `Round ${event.round} · turn ${event.turn}`
    : event.round !== undefined
      ? `Round ${event.round}`
      : "Round/turn not recorded";

export const shortRoundTurn = (event: { round?: number; turn?: number }) =>
  `R${event.round ?? "?"}/T${event.turn ?? "?"}`;

/** Deep link to an exact recorded event on the run page. */
export const eventLink = (
  event: { runId: string; id: string; sequence: number },
  view = "timeline",
) =>
  `/runs/${encodeURIComponent(event.runId)}?view=${view}&evidence=${encodeURIComponent(event.id)}&seq=${event.sequence}`;

/* ---------------------------------------------------------------- activity */

export interface AgentActivity {
  roleDataReads: number;
  boardPosts: number;
  boardReads: number;
  artifactUpdates: number;
  archiveRequested: number;
  archiveAdmitted: number;
  memoryUpdates: number;
}

const emptyActivity = (): AgentActivity => ({
  roleDataReads: 0,
  boardPosts: 0,
  boardReads: 0,
  artifactUpdates: 0,
  archiveRequested: 0,
  archiveAdmitted: 0,
  memoryUpdates: 0,
});

export const ACTIVITY_EVENT_TYPES = [
  "tool_requested",
  "tool_admitted",
  "board_post",
  "board_delivery",
  "artifact_updated",
  "memory_updated",
];

const toolName = (event: HarnessEvent) => {
  const call = isRecord(event.data) ? event.data.call : undefined;
  return isRecord(call) && typeof call.name === "string" ? call.name : "";
};

/** Counts of recorded events per agent. Never parses agent free text. */
export function activityByAgent(
  byType: Record<string, HarnessEvent[]>,
): Map<string, AgentActivity> {
  const result = new Map<string, AgentActivity>();
  const of = (agent?: string) => {
    const key = agent ?? "system";
    if (!result.has(key)) result.set(key, emptyActivity());
    return result.get(key)!;
  };
  for (const event of byType.tool_admitted ?? []) {
    const name = toolName(event);
    if (name === "read_role_data") of(event.agentId).roleDataReads++;
    if (name === "read_legacy_archive") of(event.agentId).archiveAdmitted++;
  }
  for (const event of byType.tool_requested ?? [])
    if (toolName(event) === "read_legacy_archive")
      of(event.agentId).archiveRequested++;
  for (const event of byType.board_post ?? []) of(event.agentId).boardPosts++;
  for (const event of byType.board_delivery ?? [])
    of(event.agentId).boardReads++;
  for (const event of byType.artifact_updated ?? [])
    of(event.agentId).artifactUpdates++;
  for (const event of byType.memory_updated ?? [])
    of(event.agentId).memoryUpdates++;
  return result;
}

/* ------------------------------------------------------------------ memory */

export interface MemoryUpdate {
  event: HarnessEvent;
  agentId: string;
  version?: number;
  before: string;
  after: string;
  unchanged: boolean;
}

const notesOf = (value: unknown) =>
  isRecord(value) && typeof value.notes === "string" ? value.notes : "";

export function memoryUpdates(events: HarnessEvent[]): Map<string, MemoryUpdate[]> {
  const grouped = new Map<string, MemoryUpdate[]>();
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  for (const event of sorted) {
    const data = isRecord(event.data) ? event.data : {};
    const agentId = event.agentId ?? "unknown agent";
    const list = grouped.get(agentId) ?? [];
    const previous = list.at(-1);
    const before = isRecord(data.before)
      ? notesOf(data.before)
      : (previous?.after ?? "");
    const after = notesOf(data.after);
    const version =
      isRecord(data.after) && typeof data.after.version === "number"
        ? data.after.version
        : undefined;
    list.push({ event, agentId, version, before, after, unchanged: before === after });
    grouped.set(agentId, list);
  }
  return grouped;
}

/* ------------------------------------------------------------- model calls */

export interface ContextPoint {
  invocationId: string;
  agentId?: string;
  round?: number;
  turn?: number;
  context: number;
  unit: string;
  failed: boolean;
  event: HarnessEvent;
}

/** One point per model invocation, from the small context_accounted / model_usage events. */
export function contextPoints(
  accounted: HarnessEvent[],
  usage: HarnessEvent[],
): ContextPoint[] {
  const completed = new Set(usage.map((event) => event.invocationId));
  return [...accounted]
    .sort((a, b) => a.sequence - b.sequence)
    .flatMap((event) => {
      const data = isRecord(event.data) ? event.data : {};
      const context =
        typeof data.measured === "number"
          ? data.measured
          : typeof data.estimated === "number"
            ? data.estimated
            : undefined;
      if (context === undefined || !event.invocationId) return [];
      return [
        {
          invocationId: event.invocationId,
          agentId: event.agentId,
          round: event.round,
          turn: event.turn,
          context,
          unit: typeof data.unit === "string" ? data.unit : "tokens",
          failed: !completed.has(event.invocationId),
          event,
        },
      ];
    });
}

/* -------------------------------------------------------------- comparable */

export interface Comparability {
  comparable: boolean;
  message: string;
}

const stop = (run: Run) =>
  `${run.config.condition.id} R${run.round}/T${run.turn} ${run.status}`;

/** Pairs are comparable only when both runs completed (or stopped at the same round/turn). */
export function assessComparability(runs: Run[]): Comparability {
  if (runs.length < 2)
    return {
      comparable: false,
      message: "Not comparable: the other condition's run is unavailable.",
    };
  const [a, b] = runs as [Run, Run];
  if (a.status === "completed" && b.status === "completed")
    return {
      comparable: true,
      message: "Comparable: both runs completed.",
    };
  if (!isTerminal(a.status) || !isTerminal(b.status))
    return {
      comparable: false,
      message: `Not yet comparable: ${stop(a)}, ${stop(b)}. Wait for both runs to finish.`,
    };
  if (a.status === b.status && a.round === b.round && a.turn === b.turn)
    return {
      comparable: true,
      message: `Comparable: both runs ${a.status} at round ${a.round}, turn ${a.turn}.`,
    };
  return {
    comparable: false,
    message: `Not comparable: runs stopped at different points (${stop(a)}, ${stop(b)}).`,
  };
}

/** Fixed presentation order everywhere: reviewed, then excluded. */
export function orderByCondition<T extends { config: { condition: { id: string } } }>(
  runs: T[],
): T[] {
  const rank = (run: T) => (run.config.condition.id === "reviewed" ? 0 : 1);
  return [...runs].sort((a, b) => rank(a) - rank(b));
}

export const plural = (count: number, singular: string, pluralForm = singular + "s") =>
  `${count} ${count === 1 ? singular : pluralForm}`;
