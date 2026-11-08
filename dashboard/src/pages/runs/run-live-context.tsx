import { createContext, useContext } from "react";
import type { TurnSummary } from "@sidechannel/contracts/browser";
import type { EventStart, RunEvents } from "../../lib/use-run-events";
import type { Run } from "../../lib/types";

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
  /** The frozen record merged with live progress. */
  run: Run;
  /** The run is queued, running, reporting or stopping. */
  active: boolean;
  /** Every turn of the run, from the turns resource; undefined until it loads or when it is unavailable. */
  turns: TurnSummary[] | undefined;
  /** `turns`, or the turns visible in the loaded events window when that resource is unavailable. */
  turnList: TurnSummary[] | undefined;
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
