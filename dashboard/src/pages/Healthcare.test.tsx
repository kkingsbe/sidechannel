// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { activate, fakeServer, renderWithServer } from "../test/clients";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import type { Run } from "../lib/types";
import Experiments from "./Experiments";
import Runs from "./Runs";

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
const config = defaultFixtureConfiguration();
config.scenario.version = "healthcare-points-v0.3";
config.scenario.datasetId = "fixture10-s101-points";
config.roles = ["care_manager", "clinical_records", "pharmacy", "diagnostics", "outside_analytics"].map(id => ({ ...config.roles[0]!, id }));
config.tokenBudget = { version: 1, unit: "tokens", maxInputTokens: 120000, counting: { method: "utf8-byte-upper-bound", version: "1", scope: "messages-and-tool-definitions", reservedTokens: 2048 } };
config.memory.maxPrivateNoteCharacters = 32000;

it("blocks missing dataset launches and focuses the field-level readiness error", async () => {
  const server = fakeServer((path: string) => path === "/config/default" ? config : path === "/config/schema" ? { fields: [] } : ["/drafts", "/datasets"].includes(path) ? [] : path === "/config/validate" ? { valid: false, errors: ["Dataset unavailable"], fieldErrors: { "scenario.datasetId": "Import this dataset before launch" } } : {});
  activate(server);
  renderWithServer(<MemoryRouter initialEntries={["/experiments/new"]}><Experiments /></MemoryRouter>);
  await screen.findByLabelText("Maximum input tokens");
  expect(screen.getAllByLabelText("Role identifier")).toHaveLength(5);
  await userEvent.click(screen.getByRole("button", { name: "Validate & review launch" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Validated healthcare dataset")));
  expect(screen.queryByRole("button", { name: "Launch matched pair" })).toBeNull();
  expect(server.calls.some(({ path }) => path.endsWith("/pairs"))).toBe(false);
});

it("renders five-role progress, frozen rankings, failure diagnostics and researcher result navigation", async () => {
  const artifact = { version: 2, previousVersion: 1, authorId: null, operationId: "freeze", frozen: true, value: { entries: [{ rank: 1, case_key: "C-AB234", uncertain: true, note: "Approved contributions only" }] } };
  const run: Run = { id: "healthcare", config, status: "failed", configHash: "hash", launchKey: "key", createdAt: "2026-11-07T12:00:00Z", updatedAt: "2026-11-07T12:01:00Z", round: 3, turn: 15, activeAgentId: "outside_analytics", failureReason: "Input token allowance exceeded during report", board: [], artifacts: [artifact], reports: [], operations: {}, scenarioState: {}, usage: {} };
  activate(fakeServer((path: string) => path.includes("/artifacts?") ? { items: [artifact], total: 1, nextOffset: null } : path.endsWith("/evaluation") ? { status: "failed", reason: "Evaluator truth unavailable" } : run));
  renderWithServer(<MemoryRouter initialEntries={["/healthcare?view=artifacts"]}><Runs /></MemoryRouter>);
  expect(await screen.findByRole("table", { name: "Healthcare ranked cases" })).toBeTruthy();
  expect(screen.getByText("outside_analytics")).toBeTruthy();
  expect(screen.getByText(/Input token allowance exceeded/)).toBeTruthy();
  expect(screen.getByText("Frozen final")).toBeTruthy();
  await userEvent.click(screen.getByRole("tab", { name: "Researcher results" }));
  expect(await screen.findByText("Evaluator truth unavailable")).toBeTruthy();
});
