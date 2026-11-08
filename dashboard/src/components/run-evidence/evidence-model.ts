import type { HarnessEvent, Run } from "../../lib/types";
import { roleHue } from "../../pages/runs/role-color";

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

/* ------------------------------------------------------------------- roles */

const ROLE_COLORS: Record<string, string> = {
  clinical_records: "#a86f0c",
  outside_analytics: "#7a3fb8",
  pharmacy: "#1e7b4f",
  care_manager: "#2456b8",
  diagnostics: "#c4242a",
  system: "#5b5f66",
};
const FALLBACK_COLORS = ["#0e7490", "#9d3a6b", "#5b6b1f", "#8a4b12", "#3f5fa0", "#6b4fa0"];

/** A stable dot colour per role: the five scenario roles are fixed, anything else hashes into a small palette. */
export function roleColor(role?: string | null): string {
  if (!role || role === "system") return ROLE_COLORS.system!;
  const fixed =
    ROLE_COLORS[role] ??
    FALLBACK_COLORS[(roleHue(role) - 1) % FALLBACK_COLORS.length]!;
  // The shared role tokens win when the app defines them, so a role keeps one colour on every screen.
  return `var(--role-${roleHue(role)}, ${fixed})`;
}

/** "R1 · T3" from an event, "—" when it carries no round/turn. */
export const rt = (event?: { round?: number; turn?: number }) =>
  event && event.round !== undefined && event.turn !== undefined
    ? `R${event.round} · T${event.turn}`
    : event && event.round !== undefined
      ? `R${event.round}`
      : "—";

/* ------------------------------------------------------------------- board */

export interface BoardPost {
  id: string;
  authorId: string;
  sequence: number;
  timestamp: string;
  text: string;
}

export const asPost = (item: unknown, index = 0): BoardPost => {
  const o = isRecord(item) ? item : {};
  return {
    id: String(o.id ?? "post-" + index),
    authorId: String(o.authorId ?? "unknown author"),
    sequence: typeof o.sequence === "number" ? o.sequence : index + 1,
    timestamp: typeof o.timestamp === "string" ? o.timestamp : "",
    text: String(o.text ?? ""),
  };
};

const deliveredIds = (event: HarnessEvent): string[] => {
  const after = isRecord(event.data) ? event.data.after : undefined;
  return Array.isArray(after)
    ? after.flatMap((message) =>
        isRecord(message) && typeof message.id === "string" ? [message.id] : [],
      )
    : [];
};

export interface PostReads {
  post: BoardPost;
  event?: HarnessEvent;
  /** Roles other than the author, in scenario order, each with its read events in sequence order. */
  readers: { role: string; reads: HarnessEvent[] }[];
}

export interface BoardModel {
  posts: PostReads[];
  /** Pair reads (one post delivered to one non-author role) per turn. */
  readsPerTurn: Map<number, number>;
  maxTurn: number;
  deliveryEvents: number;
  firstReads: number;
  reReads: number;
  /** (post, role) pairs with no read recorded. */
  unread: { post: BoardPost; role: string }[];
  longestWait?: { post: BoardPost; role: string; turns: number; event: HarnessEvent };
  mostReRead?: { post: BoardPost; count: number; topRole: string; topCount: number };
}

/** Who read each post and when, computed only from recorded board_delivery events. */
export function boardModel(
  rawPosts: unknown[],
  postEvents: Map<string, HarnessEvent>,
  deliveries: HarnessEvent[],
  roles: string[],
): BoardModel {
  const sorted = [...deliveries].sort((a, b) => a.sequence - b.sequence);
  const posts = rawPosts.map(asPost);
  const known = [...roles];
  for (const event of sorted)
    if (event.agentId && !known.includes(event.agentId)) known.push(event.agentId);
  const byPost = new Map<string, HarnessEvent[]>();
  const readsPerTurn = new Map<number, number>();
  let maxTurn = 0;
  for (const event of sorted) {
    if (event.turn) maxTurn = Math.max(maxTurn, event.turn);
    for (const id of new Set(deliveredIds(event))) {
      const list = byPost.get(id) ?? [];
      list.push(event);
      byPost.set(id, list);
    }
  }
  for (const event of postEvents.values()) if (event.turn) maxTurn = Math.max(maxTurn, event.turn);
  const model: BoardModel = {
    posts: [],
    readsPerTurn,
    maxTurn,
    deliveryEvents: sorted.length,
    firstReads: 0,
    reReads: 0,
    unread: [],
  };
  let wait = -1;
  let rereadBest = 0;
  for (const post of posts) {
    const event = postEvents.get(post.id);
    const matches = (byPost.get(post.id) ?? []).filter((e) => e.agentId !== post.authorId);
    const readers = known
      .filter((role) => role !== post.authorId)
      .map((role) => ({ role, reads: matches.filter((e) => e.agentId === role) }));
    model.posts.push({ post, event, readers });
    let reread = 0;
    let topRole = "";
    let topCount = 0;
    for (const reader of readers) {
      if (!reader.reads.length) {
        model.unread.push({ post, role: reader.role });
        continue;
      }
      model.firstReads++;
      model.reReads += reader.reads.length - 1;
      reread += reader.reads.length - 1;
      if (reader.reads.length - 1 > topCount) {
        topCount = reader.reads.length - 1;
        topRole = reader.role;
      }
      const first = reader.reads[0]!;
      if (event?.turn && first.turn && first.turn - event.turn > wait) {
        wait = first.turn - event.turn;
        model.longestWait = { post, role: reader.role, turns: wait, event: first };
      }
    }
    if (reread > rereadBest) {
      rereadBest = reread;
      model.mostReRead = { post, count: reread, topRole, topCount };
    }
    for (const read of matches)
      if (read.turn) readsPerTurn.set(read.turn, (readsPerTurn.get(read.turn) ?? 0) + 1);
  }
  return model;
}

/** The one-sentence finding for the board tab, in plain facts. */
export function boardFinding(model: BoardModel, roles: string[]) {
  const total = model.posts.length;
  if (!total) return { strong: "No board posts were recorded", rest: "" };
  const incomplete = model.posts.filter((p) => p.readers.some((r) => !r.reads.length));
  const others = Math.max(roles.length - 1, 1);
  if (!incomplete.length)
    return {
      strong: `Every post was read by all ${others} other roles.`,
      rest: " Posting never implies receipt: the exact read events are recorded per role.",
    };
  const label = (p: PostReads) => `post ${p.post.sequence}`;
  if (incomplete.length === total)
    return {
      strong: "No post was read by every other role.",
      rest: " Posting never implies receipt: the exact read events are recorded per role.",
    };
  if (incomplete.length <= 2) {
    const only =
      incomplete.length === 1
        ? incomplete[0]!.readers.filter((r) => r.reads.length).map((r) => r.role)
        : [];
    const tail =
      incomplete.length === 1
        ? only.length
          ? `, which only ${only.join(" and ")} read`
          : ", which no one read"
        : "";
    return {
      strong: `Every post was read by all ${others} other roles except ${incomplete.map(label).join(" and ")}${tail}.`,
      rest: " Posting never implies receipt: the exact read events are recorded per role.",
    };
  }
  return {
    strong: `${incomplete.length} of ${total} posts were not read by every other role.`,
    rest: " Posting never implies receipt: the exact read events are recorded per role.",
  };
}
