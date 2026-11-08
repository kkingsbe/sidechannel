import type { Draft, ExperimentConfig, Run } from "../types";
import type { ApiClients } from "./context";
import type { ConfigSchema, Validation } from "./workspace";
import type { LaunchPayload } from "../../pages/experiments/launch-payload";

export interface DraftSaveInput {
  id?: string;
  revision?: number;
  config: ExperimentConfig;
  name?: string;
  notes?: string;
}

/**
 * WS6 T6.1 facade: the experiment workspace surface is composed from the shipped
 * `workspace` client (config/drafts/datasets) and `runs.createPair` (pair launch).
 * No HTTP code lives here; the plan's §3.4 `experimentsClient` names map onto the
 * shipped client members.
 */
export interface ExperimentsClient {
  defaults(): Promise<ExperimentConfig>;
  schema(): Promise<ConfigSchema>;
  validate(config: ExperimentConfig): Promise<Validation>;
  drafts(): Promise<Draft[]>;
  draft(id: string): Promise<Draft>;
  saveDraft(input: DraftSaveInput): Promise<Draft>;
  duplicateDraft(id: string): Promise<Draft>;
  datasets(): ReturnType<ApiClients["workspace"]["datasets"]>;
  preset(datasetId: string): ReturnType<ApiClients["workspace"]["preset"]>;
  adaptionModels(): ReturnType<ApiClients["workspace"]["adaptionModels"]>;
  launchPair(input: LaunchPayload): Promise<Run[]>;
  providers(): Promise<{ providers: { id: string; label: string; settings: string[]; fixture: boolean }[] }>;
  scenarios(): Promise<{
    scenarios: {
      version: string;
      label: string;
      fixture: boolean;
      artifactSchemaVersion: string;
      presentation: { title: string; tabs: string[]; hasDatasetPreset: boolean };
    }[];
  }>;
}

export function createExperimentsClient(
  clients: Pick<ApiClients, "request" | "runs" | "workspace">,
): ExperimentsClient {
  return {
    defaults: () => clients.workspace.defaults(),
    schema: () => clients.workspace.schema(),
    validate: (config) => clients.workspace.validate(config),
    drafts: () => clients.workspace.drafts(),
    draft: (id) => clients.workspace.draft(id),
    saveDraft: (input) => clients.workspace.saveDraft(input),
    duplicateDraft: (id) => clients.workspace.duplicateDraft(id),
    datasets: () => clients.workspace.datasets(),
    preset: (datasetId) => clients.workspace.preset(datasetId),
    adaptionModels: () => clients.workspace.adaptionModels(),
    launchPair: (input) => clients.runs.createPair(input),
    providers: () => clients.request("/providers"),
    scenarios: () => clients.request("/scenarios"),
  };
}
