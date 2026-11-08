/** Figures derived from the events a run page already loads; nothing here is estimated or invented. */
import type { HarnessEvent, TurnSummary } from "@sidechannel/contracts/browser";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Turn summaries rebuilt from loaded events, for when the turns resource is unavailable. */
export function deriveTurns(events: readonly HarnessEvent[]): TurnSummary[] {
  const byKey = new Map<string, TurnSummary>();
  const calls = new Map<string, Set<string>>();
  for (const event of events) {
    if (!event.turn || !event.agentId) continue;
    const key = `${event.round ?? ""}|${event.turn}|${event.agentId}`;
    const turn =
      byKey.get(key) ??
      { agentId: event.agentId, round: event.round, turn: event.turn, firstSequence: event.sequence, lastSequence: event.sequence, eventCount: 0, modelCalls: 0, failures: 0 };
    turn.firstSequence = Math.min(turn.firstSequence, event.sequence);
    turn.lastSequence = Math.max(turn.lastSequence, event.sequence);
    turn.eventCount += 1;
    if (event.invocationId && event.type.startsWith("model_")) {
      const set = calls.get(key) ?? new Set<string>();
      set.add(event.invocationId);
      calls.set(key, set);
      turn.modelCalls = set.size;
    }
    byKey.set(key, turn);
  }
  return [...byKey.values()].sort((a, b) => a.firstSequence - b.firstSequence);
}

/** A round axis maximum above `peak`: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceMax(peak: number): number {
  if (peak <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * magnitude > peak * 1.02) return step * magnitude;
  return 10 * magnitude;
}

export const compactNumber = (value: number): string =>
  value >= 1000 ? `${Number((value / 1000).toFixed(value >= 10000 ? 0 : 1))}k` : String(value);

/** Whole seconds as "4 min 45 s" / "77 s". */
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min ${seconds % 60} s`;
}

export function ago(iso: string | undefined, now: number): string {
  const then = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  return seconds < 90 ? `${seconds} s ago` : seconds < 5400 ? `${Math.round(seconds / 60)} min ago` : `${Math.round(seconds / 3600)} h ago`;
}
