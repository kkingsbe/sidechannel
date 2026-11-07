import type { MonitorView } from "@sidechannel/contracts/browser";
import type { ViewRegistry } from "../../lib/contracts";
import { DefinitionsTab } from "./definitions-tab";
import { JobsTab } from "./jobs-tab";
import { MonitorSetupTab } from "./monitor-setup-tab";
import { ReferencesTab } from "./references-tab";

export const OVERSIGHT_TABS = ["jobs", "setup", "definitions", "references"] as const;
export type OversightTab = (typeof OVERSIGHT_TABS)[number];

/** Setup is explicit: only a new evaluation or a preselected source run opens it by default. */
export function defaultOversightTab(query: URLSearchParams, creating: boolean): OversightTab {
  return creating || query.has("run") ? "setup" : "jobs";
}

export const viewNames: Record<MonitorView, string> = {
  reports: "Reports",
  audit: "Reports + audit metadata",
  board: "Reports + audit + board",
  full: "Full observable trace",
};
export const views: MonitorView[] = ["reports", "audit", "board", "full"];

export const OVERSIGHT_VIEWS: ViewRegistry<OversightTab> = {
  jobs: { title: "Evaluation jobs", Component: JobsTab },
  setup: { title: "Configure & preview", Component: MonitorSetupTab },
  definitions: {
    title: "Questions & outcome definitions",
    Component: DefinitionsTab,
  },
  references: { title: "Human reference outcomes", Component: ReferencesTab },
};
