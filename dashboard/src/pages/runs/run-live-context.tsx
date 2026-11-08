import { createContext, useContext } from "react";
import type { TurnSummary } from "@sidechannel/contracts/browser";
import type { EventStart, RunEvents } from "../../lib/use-run-events";

export interface RunLiveFilters {
  actor: string;
  phase: string;
  type: string;
  from: string;
  to: string;
}

/**
 * The live events window owned by the run detail shell, shared with the timeline/traces views
 * (which are prop-less registry entries) and the model-call drawer.
 */
export interface RunLiveContextValue {
  runEvents: RunEvents;
  turns: TurnSummary[] | undefined;
  follow: boolean;
  start: EventStart;
  provider: string;
  roles: string[];
  focusCall: string | null;
  filters: RunLiveFilters;
  setFilter(name: keyof RunLiveFilters, value: string): void;
  onInspect(eventId: string, sequence?: number): void;
  onOpenTraces(invocationId: string): void;
  onJump(at: number | "end"): void;
}

const RunLiveContext = createContext<RunLiveContextValue | undefined>(undefined);

export const RunLiveProvider = RunLiveContext.Provider;

export function useRunLive(): RunLiveContextValue {
  const value = useContext(RunLiveContext);
  if (!value) throw new Error("useRunLive must be used inside its provider");
  return value;
}
