/** Pure merge/evict rules for the gap-free slice of a run's events the timeline holds in memory. */
import type { HarnessEvent } from '@sidechannel/contracts/browser';

export const WINDOW_CAP = 1500;

export interface EventWindow {
  /** Oldest first, unique by id. */
  events: HarnessEvent[];
  hasEarlier: boolean;
  hasLater: boolean;
}

export const emptyWindow: EventWindow = { events: [], hasEarlier: false, hasLater: false };

function merge(a: readonly HarnessEvent[], b: readonly HarnessEvent[]): HarnessEvent[] {
  const byId = new Map<string, HarnessEvent>();
  for (const event of a) byId.set(event.id, event);
  for (const event of b) byId.set(event.id, event);
  return [...byId.values()].sort((x, y) => x.sequence - y.sequence);
}

/** Adds events after the window's end; past the cap the oldest are evicted. */
export function appendLater(w: EventWindow, incoming: readonly HarnessEvent[], hasLater: boolean, cap = WINDOW_CAP): EventWindow {
  const events = merge(w.events, incoming);
  const overflow = Math.max(0, events.length - cap);
  return { events: events.slice(overflow), hasEarlier: w.hasEarlier || overflow > 0, hasLater };
}

/** Adds events before the window's start; past the cap the newest are evicted. */
export function prependEarlier(w: EventWindow, incoming: readonly HarnessEvent[], hasEarlier: boolean, cap = WINDOW_CAP): EventWindow {
  const events = merge(incoming, w.events);
  const overflow = Math.max(0, events.length - cap);
  return { events: events.slice(0, events.length - overflow), hasEarlier, hasLater: w.hasLater || overflow > 0 };
}
