// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { REVIEWER_STORAGE_KEY } from "../../components/claimed-reviewer";
import { activate, fakeServer, renderWithServer } from "../../test/clients";
import type { AnalysisJob } from "../../lib/analysis-types";
import { ReviewWorkspace } from "./review-workspace";

const job = {
  id: "analysis-a",
  runId: "run",
  status: "completed",
  createdAt: "2026-11-08T00:00:00Z",
  manifest: {
    settings: { codebookId: "book", model: "jev-test" },
    codebook: { codes: [
      { id: "supply", code: "SUPPLY", enabled: true, archived: false },
      { id: "challenge", code: "CHALLENGE", enabled: true, archived: false },
    ] },
  },
} as unknown as AnalysisJob;

const report = { codebookId: "book", definitionRevision: "rev", model: "jev-test", items: [
  { codeId: "supply", status: "tentative", reasons: ["kappa 0.5 is below 0.67"] },
] };

const createBatch = vi.fn();
const reviewsFor = (path: string) => {
  if (!path.includes("scope=window")) return { items: [], nextCursor: null };
  return { items: [
    { id: "r1", reviewer: "alice", scope: "window", subjectId: "w1", windowId: "w1", codeId: "supply", decision: "present", revision: 1 },
    { id: "r2", reviewer: "bob", scope: "window", subjectId: "w1", windowId: "w1", codeId: "supply", decision: "absent", revision: 1 },
  ], nextCursor: null };
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(REVIEWER_STORAGE_KEY, "Reviewer A");
  createBatch.mockResolvedValue({ id: "new-batch", mode: "assisted" });
  activate(fakeServer((path) => {
    if (path.includes("/validation")) return report;
    if (path.includes("/review-batches/")) return {
      batch: { id: "batch-1", mode: "assisted", threshold: 0.7, populationCount: 12, selectionCount: 1, strategy: { kind: "stratified", bins: [0, 0.3, 1], perBin: 3 }, shortfalls: [{ codeId: "supply", bin: 1, requested: 3, drawn: 2 }] },
      selections: { items: [{ id: "w1", windowId: "w1", reasons: ["stratified"] }], nextCursor: null },
    };
    if (path.includes("/reviews")) return reviewsFor(path);
    if (path.includes("/windows/")) return { window: { id: "w1", index: 0, startStep: 1, endStep: 2 } };
    return { items: [], nextCursor: null };
  }), { analyses: { createBatch } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const render = (route = "/") => renderWithServer(
  <MemoryRouter initialEntries={[route]}><ReviewWorkspace job={job} onSelect={() => {}} /></MemoryRouter>,
);

it("shows each code's validation status on its chip, with reasons on hover", async () => {
  render();
  const badge = await screen.findByText("Tentative");
  expect(badge.closest("[title]")!.getAttribute("title")).toBe("kappa 0.5 is below 0.67");
  expect(screen.getAllByText("No validation data").length).toBe(1);
});

it("creates a stratified batch with parsed bins and the per-bin count", async () => {
  const user = userEvent.setup();
  render();
  await user.selectOptions(screen.getByLabelText("Selection strategy"), "stratified");
  const bins = screen.getByLabelText("Bin edges");
  await user.clear(bins); await user.type(bins, "0, 0.5, 1");
  const perBin = screen.getByLabelText("Windows per bin");
  await user.clear(perBin); await user.type(perBin, "4");
  await user.click(screen.getByRole("button", { name: "Create selection batch" }));
  await waitFor(() => expect(createBatch).toHaveBeenCalled());
  expect(createBatch.mock.calls[0]![1]).toMatchObject({ mode: "assisted", seed: "pilot-42", strategy: { kind: "stratified", bins: [0, 0.5, 1], perBin: 4 } });
});

it("blocks creation with invalid bins and sends no strategy for the default selection", async () => {
  const user = userEvent.setup();
  render();
  await user.click(screen.getByRole("button", { name: "Create selection batch" }));
  await waitFor(() => expect(createBatch).toHaveBeenCalled());
  expect(createBatch.mock.calls[0]![1]).not.toHaveProperty("strategy");
  expect(createBatch.mock.calls[0]![1]).toMatchObject({ randomSize: 10, threshold: 0.7 });
  await user.selectOptions(screen.getByLabelText("Selection strategy"), "stratified");
  const bins = screen.getByLabelText("Bin edges");
  await user.clear(bins); await user.type(bins, "0, 0.9, 0.5");
  expect(screen.getByText(/strictly increasing/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Create selection batch" }) as HTMLButtonElement).disabled).toBe(true);
});

it("creates a disagreement batch with the minimum gap", async () => {
  const user = userEvent.setup();
  render();
  await user.selectOptions(screen.getByLabelText("Selection strategy"), "disagreement");
  const gap = screen.getByLabelText("Minimum gap");
  await user.clear(gap); await user.type(gap, "0.3");
  await user.click(screen.getByRole("button", { name: "Create selection batch" }));
  await waitFor(() => expect(createBatch).toHaveBeenCalled());
  expect(createBatch.mock.calls[0]![1]).toMatchObject({ strategy: { kind: "disagreement", minGap: 0.3 } });
});

it("shows the strategy, the short bins, the sampling reason and the two-reviewer indicator for a stored batch", async () => {
  render("/?batch=batch-1");
  expect(await screen.findByText(/Stratified · bins 0 \/ 0.3 \/ 1 · 3 per bin/)).toBeTruthy();
  expect(screen.getByText(/supply bin 2 drew 2 of 3/)).toBeTruthy();
  expect(await screen.findByText("Stratified draw")).toBeTruthy();
  expect(await screen.findByText(/2 reviewers · reviewers disagree/)).toBeTruthy();
});
