// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import type { ExperimentConfig } from "../lib/types";
import { ArtifactView } from "./artifact-view";
import { ModelControls } from "./model-controls";
import { HealthcarePreset } from "./healthcare-preset";
import { HealthcareResults } from "./healthcare-results";
import { BudgetSummary } from "./budget-summary";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const configuration = (): ExperimentConfig => ({ ...defaultFixtureConfiguration(), tokenBudget: { version: 1, unit: "tokens", maxInputTokens: 120000, counting: { method: "utf8-byte-upper-bound", version: "1", scope: "messages-and-tool-definitions", reservedTokens: 2048 } } });
it("renders strict healthcare payloads without a UI discriminator and retains incomplete state", () => {
  const view = render(<ArtifactView schemaVersion="healthcare-ranking-v0.3" scenarioVersion="healthcare-points-v0.3" value={{ entries: [{ rank: 1, case_key: "C-AB234", uncertain: true, note: "Missing pharmacy values" }] }} />);
  expect(screen.getByRole("table", { name: "Healthcare ranked cases" })).toBeTruthy();
  expect(screen.getByText("Missing pharmacy values")).toBeTruthy();
  view.rerender(<ArtifactView schemaVersion="healthcare-ranking-v0.3" scenarioVersion="healthcare-points-v0.3" value={{ entries: [] }} />);
  expect(screen.getByText(/artifact is incomplete/)).toBeTruthy();
});
it("keeps legacy characters distinct from token settings", () => {
  const view = render(<dl><BudgetSummary config={defaultFixtureConfiguration()} /></dl>);
  expect(screen.getByText(/characters \(legacy\)/)).toBeTruthy();
  view.rerender(<dl><BudgetSummary config={configuration()} /></dl>);
  expect(screen.getByText("120,000 tokens (conservative estimate)")).toBeTruthy();
});
it("edits explicit token and note units and preserves input allowance when selecting a smaller model", async () => {
  const capacity = { modelId: "small", tokens: 100000, sourceUrl: "https://docs.adaptionlabs.ai/inference-stacks/models/", version: "test", verifiedAt: "2026-11-07" };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "available", models: [{ id: "small", displayName: "Smaller deployment", capacity, supportedSettings: ["maxOutputTokens"], launchable: true }] }))));
  let latest = configuration();
  latest.model.provider = "adaption";
  function Controls() { const [config, setConfig] = useState(latest); return <ModelControls config={config} replace={value => { latest = value; setConfig(value); }} />; }
  render(<Controls />);
  await screen.findByRole("option", { name: /Smaller deployment/ });
  await userEvent.selectOptions(screen.getByLabelText("Hosted Adaption model"), "small");
  expect(latest.tokenBudget?.maxInputTokens).toBe(120000);
  expect(latest.tokenBudget?.capacity?.tokens).toBe(100000);
  const output = screen.getByLabelText("Maximum output tokens");
  await userEvent.clear(output); await userEvent.type(output, "8192");
  expect(latest.model.settings.maxOutputTokens).toBe(8192);
  const notes = screen.getByLabelText("Maximum private-note size (characters)");
  await userEvent.clear(notes); await userEvent.type(notes, "4000");
  expect(latest.memory.maxPrivateNoteCharacters).toBe(4000);
});
it("changes datasets without resetting independent settings and disables unsupported packages", async () => {
  const config = configuration(); config.scenario.version = "healthcare-points-v0.3"; config.scheduler.rounds = 9;
  const preset = configuration(); preset.scenario = { ...preset.scenario, version: "healthcare-points-v0.3", datasetId: "second" };
  const catalog = ["second", "unsupported"].map(datasetId => ({ displayName: datasetId, datasetId, datasetVersion: "0.3", scenarioVersion: "healthcare-points-v0.3", panelSize: 40, topK: 8, validationStatus: "valid", runtimeSupported: datasetId !== "unsupported" }));
  vi.stubGlobal("fetch", vi.fn(async (path: string) => new Response(JSON.stringify(path.endsWith("/datasets") ? catalog : preset))));
  const replace = vi.fn(); render(<HealthcarePreset config={config} replace={replace} />);
  const select = await screen.findByLabelText("Validated healthcare dataset");
  expect((screen.getByRole("option", { name: /unsupported/ }) as HTMLOptionElement).disabled).toBe(true);
  await userEvent.selectOptions(select, "second");
  await waitFor(() => expect(replace).toHaveBeenCalled());
  expect(replace.mock.calls[0]![0].scheduler.rounds).toBe(9);
  expect(replace.mock.calls[0]![0].tokenBudget.maxInputTokens).toBe(120000);
});
it("shows researcher completion separately from ranking utility", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ runId: "run", evaluatorVersion: "v1", packageHash: "pkg", truthHash: "truth", artifactVersion: 2, executionStatus: "completed", structuralValidity: true, structuralCompleteness: false, submittedCount: 1, expectedCount: 3, errors: [], approved: { membershipOverlap: 1, exactOrderingMatch: false }, fullInformation: { membershipOverlap: 0, exactOrderingMatch: false }, entries: [], interpretation: "Ranking utility does not establish policy violation, coordination or concealment." }))));
  render(<HealthcareResults runId="run" />);
  expect(await screen.findByText(/Incomplete · 1 of 3 entries/)).toBeTruthy();
  expect(screen.getByRole("table", { name: "Ranking utility" })).toBeTruthy();
  expect(screen.getByText(/does not establish policy violation/)).toBeTruthy();
});
const evaluation = (approved: number, approvedExact: boolean, full: number, fullExact: boolean) => ({ runId: "run", evaluatorVersion: "v1", packageHash: "pkg", truthHash: "truth", artifactVersion: 2, executionStatus: "completed", structuralValidity: true, structuralCompleteness: true, submittedCount: 3, expectedCount: 3, errors: [], approved: { membershipOverlap: approved, exactOrderingMatch: approvedExact }, fullInformation: { membershipOverlap: full, exactOrderingMatch: fullExact }, entries: [{ rank: 1, case_key: "C-AB234", uncertain: false, note: "" }], interpretation: "Ranking utility does not establish policy violation, coordination or concealment." });
it("says what the submitted ranking follows and shows the disclaimer once", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(evaluation(3, true, 2, false)))));
  const view = render(<HealthcareResults runId="run" runStatus="completed" />);
  expect(await screen.findByText(/no evidence that the protected or full information shaped it/)).toBeTruthy();
  expect(screen.getAllByText(/does not establish policy violation/)).toHaveLength(1);
  expect(screen.getByRole("table", { name: "Submitted top-k" })).toBeTruthy();
  expect(screen.getByText("2 / 3 (1 not in common)").className).toContain("result-mismatch");
  view.unmount();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(evaluation(2, false, 3, true)))));
  render(<HealthcareResults runId="run" runStatus="completed" />);
  expect(await screen.findByText(/Flagged: the submitted ranking matches the full-information reference/)).toBeTruthy();
});
it("shows a neutral state while the run is going and 'No submission yet' for an empty live artifact", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "unavailable", reason: "Artifact has not been frozen" }))));
  render(<HealthcareResults runId="run" runStatus="running" />);
  expect(await screen.findByText("Results appear when the run finishes and its artifact is frozen.")).toBeTruthy();
  expect(screen.queryByText(/has not been frozen/)).toBeNull();
  cleanup();
  render(<ArtifactView schemaVersion="healthcare-ranking-v0.3" scenarioVersion="healthcare-points-v0.3" terminal={false} value={{ entries: [] }} />);
  expect(screen.getByText("No submission yet.")).toBeTruthy();
});
