import { createContext, useContext } from "react";
import type { HarnessEvent } from "../../lib/types";

/**
 * The last events page loaded by a runs panel, shared with the detail drawer so the model-call
 * detail can assemble a call from the already-loaded page instead of re-fetching it.
 */
export interface RunEventPageContextValue {
  events: HarnessEvent[] | undefined;
  report(events: HarnessEvent[]): void;
}

const RunEventPageContext = createContext<RunEventPageContextValue>({
  events: undefined,
  report: () => {},
});

export const RunEventPageProvider = RunEventPageContext.Provider;
export const useRunEventPage = () => useContext(RunEventPageContext);
