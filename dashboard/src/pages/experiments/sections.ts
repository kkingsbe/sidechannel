import type { ExperimentConfig } from "../../lib/types";
import { fieldLabels, localFieldErrors } from "../../lib/experiment-form";
import { readableName } from "./config-edit";

export type SectionId = "scenario" | "model" | "limits" | "board" | "reports";

export const SECTIONS: { id: SectionId; title: string }[] = [
  { id: "scenario", title: "Scenario & data" },
  { id: "model", title: "Model & roles" },
  { id: "limits", title: "Execution & limits" },
  { id: "board", title: "Board & memory" },
  { id: "reports", title: "Reports & artifact" },
];

/** Which section owns a configuration path. */
export function sectionOf(path: string): SectionId {
  if (path.startsWith("model.") || path.startsWith("roles")) return "model";
  if (path.startsWith("scheduler.") || path.startsWith("limits.")) return "limits";
  if (path.startsWith("board.") || path.startsWith("memory.") || path.startsWith("tokenBudget")) return "board";
  if (path === "artifactSchemaVersion" || path === "reportSchemaVersion" || path === "reportInstructions") return "reports";
  return "scenario";
}

const blank = (value: unknown) => typeof value !== "string" || !value.trim();

/** Fields the browser can see are empty, beyond the numeric checks `localFieldErrors` makes. */
function blankErrors(config: ExperimentConfig, datasetFields: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  const need = (path: string, value: unknown) => {
    if (blank(value)) errors[path] = `${fieldLabels[path] ?? readableName(path)} can't be blank`;
  };
  need("scenario.version", config.scenario?.version);
  if (datasetFields) need("scenario.datasetId", config.scenario?.datasetId);
  need("model.provider", config.model?.provider);
  need("model.id", config.model?.id);
  config.roles?.forEach((role, index) => {
    if (blank(role.id)) errors[`roles.${index}.id`] = "Role identifier can't be blank";
  });
  return errors;
}

/** Live errors the browser can already determine, overlaid by the last server verdict. */
export function allErrors(
  config: ExperimentConfig,
  server: Record<string, string> | undefined,
  datasetFields: boolean,
): Record<string, string> {
  return { ...localFieldErrors(config), ...blankErrors(config, datasetFields), ...server };
}

const nounOf = (path: string) =>
  (fieldLabels[path] ?? readableName(path.split(".").pop() ?? path)).toLowerCase();

export interface SectionState {
  id: SectionId;
  title: string;
  /** Short names of what is still missing, e.g. "exact model identifier". */
  left: string[];
}

export function sectionStates(errors: Record<string, string>): SectionState[] {
  return SECTIONS.map((section) => ({
    ...section,
    left: Object.keys(errors)
      .filter((path) => sectionOf(path) === section.id)
      .map(nounOf),
  }));
}
