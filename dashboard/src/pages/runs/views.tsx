import type { ViewRegistry } from "../../lib/contracts";
import {
  ArtifactsPanel,
  BoardPanel,
  ConfigurationPanel,
  MemoryPanel,
  ReportsPanel,
  ResultsPanel,
  TimelinePanel,
  TracesPanel,
} from "./panels";

export const RUN_TABS = ["timeline", "board", "artifacts", "memory", "reports", "traces", "configuration"] as const;
export type RunsTab = (typeof RUN_TABS)[number] | "results";
export const DEFAULT_RUN_TAB: RunsTab = "timeline";

export function runsViews(hasResults: boolean): ViewRegistry<RunsTab> {
  return {
    timeline: { title: "Timeline", Component: TimelinePanel },
    board: { title: "Board & deliveries", Component: BoardPanel },
    artifacts: { title: "Artifacts", Component: ArtifactsPanel },
    memory: { title: "Private memory", Component: MemoryPanel },
    reports: { title: "Reports", Component: ReportsPanel },
    traces: { title: "Model & traces", Component: TracesPanel },
    configuration: { title: "Configuration", Component: ConfigurationPanel },
    ...(hasResults ? { results: { title: "Researcher results", Component: ResultsPanel } } : {}),
  } as ViewRegistry<RunsTab>;
}

export function runsOrder(hasResults: boolean): readonly RunsTab[] {
  return hasResults ? [...RUN_TABS, "results"] : RUN_TABS;
}
