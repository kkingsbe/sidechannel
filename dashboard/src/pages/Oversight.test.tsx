// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Oversight from "./Oversight";
import { activate, fakeServer, renderWithServer } from "../test/clients";

const outcome = {
  id: "outcome",
  name: "Outcome",
  definition: "A frozen definition",
  qualifyingCriteria: "Executed conduct",
  presentGuidance: "Cited",
  absentGuidance: "Supported",
  uncertainGuidance: "Insufficient",
  examples: "",
  exclusions: "",
  archived: false,
};
const definition = {
  id: "definition:1",
  schemaVersion: 1,
  revision: 1,
  createdAt: "2026-11-07T12:00:00Z",
  questions: "Q",
  outcomes: [outcome],
};
const sourceRun = (id: string, condition: string) => ({
  id,
  pairId: "pair-1",
  config: { label: "Pair experiment", condition: { id: condition } },
  status: "completed",
});
const projection = (runId: string, view: string) => ({
  schemaVersion: 1,
  version: "monitor-projection-v1",
  runId,
  view,
  evidenceIds: ["e1"],
  included: ["reports"],
  excluded: ["private memory"],
  availability: { privateMemory: true, providerReasoning: false },
  serialized: "{}",
  hash: "h",
  characters: 10,
  estimatedInputTokens: 1000,
  status: "ready",
});
const views = ["reports", "audit", "board", "full"];
const result = (runId: string, verdict: string) => ({
  runId,
  view: "reports",
  status: "completed",
  judgments: [{ outcomeId: "outcome", verdict, evidenceIds: ["e1"], explanation: "Because" }],
});
const evaluation = {
  id: "eval-1",
  createdAt: "2026-11-07T12:00:00Z",
  definition,
  settings: { model: { provider: "fixture", id: "monitor" } },
  runIds: ["run-excluded", "run-reviewed"],
  status: "completed",
  results: [result("run-excluded", "absent"), result("run-reviewed", "present")],
  cancelRequested: false,
};
const routes = {
  "/monitor-evaluations/eval-1": evaluation,
  "/monitor-evaluations/eval-1/comparison": { comparisons: [] },
  "/monitor-evaluations/eval-1/export": {
    evaluation,
    preview: {
      runs: ["run-excluded", "run-reviewed"].map((runId) => ({
        runId,
        projections: views.map((view) => projection(runId, view)),
      })),
    },
  },
  "/runs/run-reviewed": sourceRun("run-reviewed", "reviewed"),
  "/runs/run-excluded": sourceRun("run-excluded", "excluded"),
} as Record<string, unknown>;

const server = () =>
  fakeServer((path: string) => {
    const clean = path.split("?")[0]!;
    if (clean in routes) return routes[clean];
    throw new Error("Unexpected route " + path);
  });

afterEach(cleanup);

const renderDetail = (route = "/eval-1") => {
  activate(server());
  return renderWithServer(
    <MemoryRouter initialEntries={[route]}>
      <Oversight />
    </MemoryRouter>,
  );
};

it("shows a pair-aligned reviewed/excluded summary for a completed source pair", async () => {
  renderDetail();
  await screen.findByText("Pair-aligned summary · Pair experiment");
  const summary = screen.getByRole("table", { name: /Pair-aligned verdicts/ });
  expect(within(summary).getByText("present")).toBeTruthy();
  expect(within(summary).getByText("absent")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Pair pair-1" }).getAttribute("href"),
  ).toBe("/runs/pairs/pair-1");
});

it("keeps the source-run metadata loading failures harmless for the summary", async () => {
  activate(
    fakeServer((path: string) => {
      const clean = path.split("?")[0]!;
      if (clean.startsWith("/runs/")) throw new Error("run metadata unavailable");
      if (clean in routes) return routes[clean];
      throw new Error("Unexpected route " + path);
    }),
  );
  renderWithServer(
    <MemoryRouter initialEntries={["/eval-1"]}>
      <Oversight />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Frozen monitor configuration")).toBeTruthy();
  expect(screen.queryByText("Pair-aligned summary · Pair experiment")).toBeNull();
});
