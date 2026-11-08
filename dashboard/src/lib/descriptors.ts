import { useCallback } from "react";
import type { ProviderMetadata, ScenarioMetadata, ScenarioPresentationMetadata } from "@sidechannel/contracts/browser";
import { useClients } from "./clients/context";
import { useResource } from "./clients/query";

export type ProviderCatalogEntry = ProviderMetadata;
export type ScenarioCatalogEntry = ScenarioMetadata;

export interface ProviderView {
  readonly id: string;
  readonly label: string;
  readonly optionLabel: string;
  readonly fixture: boolean;
  readonly settings: readonly string[];
  readonly catalogPath: string | undefined;
  /** The playbook driver registers immutable scripts instead of a live model catalog. */
  readonly playbook: boolean;
  readonly defaultPhase: "development" | "pilot" | "study" | undefined;
  readonly defaultModelId: string | undefined;
  readonly copiesCapacity: boolean;
  readonly capacityNote: string | undefined;
  readonly runEyebrow: string | undefined;
  readonly listingBadge: string | undefined;
}

export interface ScenarioView {
  readonly version: string;
  readonly label: string;
  readonly fixture: boolean;
  readonly artifactSchemaVersion: string;
  readonly presentation: ScenarioPresentationMetadata;
  readonly showDatasetFields: boolean;
  readonly modelSection: "catalog" | "freeText";
}

/** Dashboard-owned presentation copy; the server supplies identity, capability flags and limits. */
const PROVIDER_PRESENTATION: Record<string, Partial<ProviderView>> = {
  scripted: {
    optionLabel: "Scripted healthcare · development",
    defaultPhase: "development",
    defaultModelId: "healthcare-points-v0.3",
    fixture: true,
    copiesCapacity: false,
    capacityNote: "Scripted driver — no provider context",
    runEyebrow: "SCRIPTED FIXTURE · NOT SPONTANEOUS MODEL BEHAVIOR",
    listingBadge: "Scripted fixture",
  },
  adaption: {
    optionLabel: "Live Adaption · pilot",
    defaultPhase: "pilot",
    defaultModelId: "",
    copiesCapacity: true,
    catalogPath: "/models/adaption",
  },
  playbook: {
    optionLabel: "Uploaded playbook · development",
    defaultPhase: "development",
    defaultModelId: "",
    fixture: true,
    copiesCapacity: false,
  },
};

const SCENARIO_PRESENTATION: Record<string, { presentation: ScenarioPresentationMetadata; modelSection: "catalog" | "freeText" }> = {
  "healthcare-points-v0.3": {
    presentation: { title: "Healthcare", tabs: ["results"], hasDatasetPreset: true },
    modelSection: "catalog",
  },
};

export function providerView(id: string, catalog: readonly ProviderCatalogEntry[]): ProviderView {
  const entry = catalog.find((candidate) => candidate.id === id);
  const presentation = PROVIDER_PRESENTATION[id] ?? {};
  return {
    id,
    label: entry?.label ?? id,
    optionLabel: presentation.optionLabel ?? entry?.label ?? id,
    fixture: entry?.fixture ?? presentation.fixture ?? false,
    settings: entry?.settings ?? [],
    catalogPath: presentation.catalogPath,
    playbook: id === "playbook",
    defaultPhase: presentation.defaultPhase,
    defaultModelId: presentation.defaultModelId,
    copiesCapacity: presentation.copiesCapacity ?? false,
    capacityNote: presentation.capacityNote,
    runEyebrow: presentation.runEyebrow,
    listingBadge: presentation.listingBadge,
  };
}

export function scenarioView(version: string, catalog: readonly ScenarioCatalogEntry[]): ScenarioView {
  const entry = catalog.find((candidate) => candidate.version === version);
  const fallback = SCENARIO_PRESENTATION[version];
  const presentation = entry?.presentation ?? fallback?.presentation ?? { title: version, tabs: [], hasDatasetPreset: false };
  const modelSection = entry ? (fallback?.modelSection ?? "freeText") : (fallback?.modelSection ?? "freeText");
  return {
    version,
    label: entry?.label ?? version,
    fixture: entry?.fixture ?? false,
    artifactSchemaVersion: entry?.artifactSchemaVersion ?? (fallback ? "healthcare-ranking-v0.3" : ""),
    presentation,
    showDatasetFields: !presentation.hasDatasetPreset,
    modelSection,
  };
}

/** Both catalogs are loaded once per page; view helpers are stable for a given catalog. */
export function useProviders() {
  const clients = useClients();
  const resource = useResource<{ providers: ProviderCatalogEntry[] }>("descriptors:providers", () => clients.experiments.providers());
  const providers = resource.data?.providers ?? [];
  const view = useCallback((id: string) => providerView(id, providers), [providers]);
  return { providers, view, loading: resource.loading, error: resource.error };
}

export function useScenarios() {
  const clients = useClients();
  const resource = useResource<{ scenarios: ScenarioCatalogEntry[] }>("descriptors:scenarios", () => clients.experiments.scenarios());
  const scenarios = resource.data?.scenarios ?? [];
  const view = useCallback((version: string) => scenarioView(version, scenarios), [scenarios]);
  return { scenarios, view, loading: resource.loading, error: resource.error };
}

/** Select options: server catalog plus the presentation-only known providers, deduplicated. */
export function providerOptions(catalog: readonly ProviderCatalogEntry[]): ProviderView[] {
  const ids = new Set([...catalog.map((entry) => entry.id), ...Object.keys(PROVIDER_PRESENTATION)]);
  return [...ids].map((id) => providerView(id, catalog));
}
