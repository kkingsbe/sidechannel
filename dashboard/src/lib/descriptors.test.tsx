// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { providerView, scenarioView, useProviders, useScenarios } from "./descriptors";

afterEach(cleanup);

const providers = [
  { id: "scripted", label: "Scripted healthcare", settings: [], fixture: true },
  { id: "adaption", label: "Live Adaption", settings: ["temperature"], fixture: false },
];
const scenarios = [{ version: "healthcare-points-v0.3", label: "Healthcare points", fixture: true, artifactSchemaVersion: "healthcare-ranking-v0.3", presentation: { title: "Healthcare", tabs: ["results"], hasDatasetPreset: true } }];

it("keeps the exact provider copy for known providers", () => {
  expect(providerView("scripted", providers)).toMatchObject({
    optionLabel: "Scripted healthcare · development",
    defaultPhase: "development",
    defaultModelId: "healthcare-points-v0.3",
    fixture: true,
    runEyebrow: "SCRIPTED FIXTURE · NOT SPONTANEOUS MODEL BEHAVIOR",
    listingBadge: "Scripted fixture",
  });
  expect(providerView("adaption", providers)).toMatchObject({ optionLabel: "Live Adaption · pilot", catalogPath: "/models/adaption", copiesCapacity: true, fixture: false });
});

it("falls back to a generic descriptor for an unknown provider", () => {
  const view = providerView("acme", providers);
  expect(view.optionLabel).toBe("acme");
  expect(view.catalogPath).toBeUndefined();
  expect(view.defaultPhase).toBeUndefined();
  expect(view.runEyebrow).toBeUndefined();
  expect(view.listingBadge).toBeUndefined();
  expect(view.fixture).toBe(false);
});

it("derives the dataset and results capabilities from the scenario descriptor", () => {
  expect(scenarioView("healthcare-points-v0.3", scenarios)).toMatchObject({ showDatasetFields: false, modelSection: "catalog" });
  expect(scenarioView("healthcare-points-v0.3", scenarios).presentation.tabs).toContain("results");
  const unknown = scenarioView("future-v9", scenarios);
  expect(unknown.showDatasetFields).toBe(true);
  expect(unknown.modelSection).toBe("freeText");
  expect(unknown.presentation.tabs).toEqual([]);
});

it("keeps known presentation copy when the catalogs are empty (fixture tests, first paint)", () => {
  expect(providerView("scripted", []).listingBadge).toBe("Scripted fixture");
  expect(scenarioView("healthcare-points-v0.3", []).presentation.hasDatasetPreset).toBe(true);
  expect(scenarioView("healthcare-points-v0.3", []).artifactSchemaVersion).toBe("healthcare-ranking-v0.3");
});

it("exposes hook views without rendering a component tree", () => {
  expect(typeof useProviders).toBe("function");
  expect(typeof useScenarios).toBe("function");
  render(<div />);
});
