// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  config: {
    label: "Pair experiment",
    condition: { id: condition },
    model: { provider: "fixture", id: "fixture" },
    scenario: { version: "fixture-v1" },
  },
  status: "completed",
});
const projection = (runId: string, view: string, status = "ready", tokens = 1000) => ({
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
  estimatedInputTokens: tokens,
  status,
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
const metric = {
  view: "reports",
  detected: 1,
  referencePositive: 1,
  referenceNegative: 0,
  referenceUncertain: 0,
  falsePositive: 0,
  monitorUncertain: 0,
  excludedReference: 0,
  missingView: 0,
  detectionRate: 1,
  falsePositiveRate: null,
};
const detailRoutes = (comparisons: unknown[] = []) =>
  ({
    "/monitor-evaluations/eval-1": evaluation,
    "/monitor-evaluations/eval-1/comparison": { comparisons },
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
  }) as Record<string, unknown>;

const fake = (routes: Record<string, unknown>) =>
  activate(
    fakeServer((path: string) => {
      const clean = path.split("?")[0]!;
      if (clean in routes) return routes[clean];
      throw new Error("Unexpected route " + path);
    }),
  );

const renderDetail = (route = "/eval-1", comparisons: unknown[] = []) => {
  fake(detailRoutes(comparisons));
  return renderWithServer(
    <MemoryRouter initialEntries={[route]}>
      <Oversight />
    </MemoryRouter>,
  );
};

afterEach(cleanup);

it("shows a pair-aligned reviewed/excluded summary for a completed source pair", async () => {
  renderDetail();
  await screen.findByText("Pair-aligned summary · Pair experiment");
  const summary = screen.getByRole("table", { name: /Pair-aligned verdicts/ });
  expect(within(summary).getByText("present")).toBeTruthy();
  expect(within(summary).getByText("absent")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Pair pair-1" }).getAttribute("href")).toBe("/runs/pairs/pair-1");
});

it("keeps the source-run metadata loading failures harmless for the summary", async () => {
  activate(
    fakeServer((path: string) => {
      const clean = path.split("?")[0]!;
      if (clean.startsWith("/runs/")) throw new Error("run metadata unavailable");
      const routes = detailRoutes();
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

it("collapses denominators to an empty state until a reference is agreed", async () => {
  renderDetail();
  expect(await screen.findByText("No agreed human references yet")).toBeTruthy();
  expect(screen.queryByRole("table", { name: "Detection and false positive counts" })).toBeNull();
  expect(screen.getByRole("link", { name: "Open Human reference outcomes" }).getAttribute("href")).toBe(
    "/oversight?view=references",
  );
});

it("renders denominator counts once references are agreed", async () => {
  renderDetail("/eval-1", [{ outcome, rows: [], metrics: [metric] }]);
  expect(await screen.findByRole("table", { name: "Detection and false positive counts" })).toBeTruthy();
  expect(screen.queryByText("No agreed human references yet")).toBeNull();
});

it("words what a projection recorded versus what this view included", async () => {
  renderDetail();
  const user = userEvent.setup();
  await user.click((await screen.findAllByRole("button", { name: "Preview Reports" }))[0]!);
  expect(await screen.findByText("recorded for this run · not included in this view")).toBeTruthy();
  expect(screen.getByText("not recorded for this run")).toBeTruthy();
  expect(screen.queryByText("Private memory available")).toBeNull();
});

it("opens the verdict drawer from the ?verdict= deep link", async () => {
  renderDetail("/eval-1?verdict=run-reviewed:outcome:reports");
  expect(await screen.findByText("Because")).toBeTruthy();
  expect(screen.getByText("Reports verdict")).toBeTruthy();
});

it("requires acknowledging oversized views before launching", async () => {
  const preview = {
    id: "p1",
    hash: "ph",
    definition,
    settings: { model: { provider: "fixture", id: "monitor" } },
    runs: [
      {
        runId: "run-reviewed",
        projections: [
          projection("run-reviewed", "reports", "ready", 500),
          projection("run-reviewed", "audit", "oversized", 40000),
          projection("run-reviewed", "board", "oversized", 50000),
          projection("run-reviewed", "full", "oversized", 60000),
        ],
      },
    ],
  };
  fake({
    "/monitor-definitions": definition,
    "/monitor-definitions/history": { items: [definition], nextCursor: null },
    "/monitor-evaluations": { items: [], nextCursor: null },
    "/runs": { items: [sourceRun("run-reviewed", "reviewed")], total: 1, nextOffset: null },
    "/monitor/preview": preview,
  });
  renderWithServer(
    <MemoryRouter initialEntries={["/?view=setup&run=run-reviewed"]}>
      <Oversight />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/Monitor provider/), "fixture");
  await user.type(screen.getByLabelText(/Monitor model/), "monitor");
  await user.click(await screen.findByRole("button", { name: /Preview four views/ }));
  await screen.findByText("3 of 4 views oversized / unavailable");
  expect(screen.getByText(/150,500 tokens across 4 views/)).toBeTruthy();
  const launch = screen.getByRole("button", { name: /Launch monitor comparison/ });
  expect((launch as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByLabelText("Launch anyway; oversized views will be recorded as unavailable"));
  expect((launch as HTMLButtonElement).disabled).toBe(false);
});

it("cites run events from a searchable picker and marks citation errors", async () => {
  let posted: { eventIds?: string[] } | undefined;
  const routes: Record<string, unknown> = {
    "/monitor-definitions": definition,
    "/monitor-definitions/history": { items: [definition], nextCursor: null },
    "/monitor-evaluations": { items: [], nextCursor: null },
    "/runs": {
      items: [sourceRun("run-reviewed", "reviewed"), sourceRun("run-excluded", "excluded")],
      total: 2,
      nextOffset: null,
    },
    "/runs/run-reviewed/reviews/context": { runId: "run-reviewed", definition, evidenceRevision: "rev", eventCount: 2 },
    "/runs/run-reviewed/events": {
      events: [
        { id: "ev-1", runId: "run-reviewed", sequence: 1, type: "board_post", agentId: "agent-a", data: { text: "Hello board" } },
        { id: "ev-2", runId: "run-reviewed", sequence: 2, type: "tool_call", agentId: "agent-b", data: { text: "Call tool" } },
      ],
      nextCursor: 2,
      hasMore: false,
    },
    "/runs/run-reviewed/outcomes": [],
    "/runs/run-reviewed/reviews/latest": null,
    "/runs/run-reviewed/reviews": { items: [], nextCursor: null },
  };
  activate(
    fakeServer(async (path: string, options?: RequestInit) => {
      const clean = path.split("?")[0]!;
      if (clean === "/runs/run-reviewed/reviews" && options?.method === "POST") {
        posted = JSON.parse(String(options.body));
        throw new Error("Citations must be unique event IDs");
      }
      if (clean in routes) return routes[clean];
      throw new Error("Unexpected route " + path);
    }),
  );
  renderWithServer(
    <MemoryRouter initialEntries={["/?view=references&run=run-reviewed"]}>
      <Oversight />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  const picker = await screen.findByRole("combobox", { name: "Run for outcome adjudication" });
  expect(within(picker).getByRole("option", { name: "Pair experiment · excluded · run-excluded" })).toBeTruthy();
  await user.type(await screen.findByLabelText("Claimed reviewer identity"), "Alice");
  await user.type(screen.getByLabelText("Rationale / unresolved questions"), "Reason");
  await user.selectOptions(screen.getByLabelText("Human judgment"), "present");
  await user.click(await screen.findByLabelText("Cite event 2"));
  const field = screen.getByLabelText(/Supporting source event IDs/) as HTMLTextAreaElement;
  expect(field.value).toBe("ev-2");
  await user.click(screen.getByLabelText("Cite event 1"));
  expect(field.value).toBe("ev-2\nev-1");
  await user.click(screen.getByLabelText("Cite event 2"));
  expect(field.value).toBe("ev-1");
  await user.type(screen.getByLabelText("Search run events"), "tool");
  expect(screen.queryByLabelText("Cite event 1")).toBeNull();
  const save = await screen.findByRole("button", { name: "Save provisional reference" });
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  await user.click(save);
  await waitFor(() => expect(posted).toBeDefined());
  await waitFor(() => expect(screen.getAllByText(/Citations must be unique event IDs/).length).toBeGreaterThan(0));
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(posted?.eventIds).toEqual(["ev-1"]);
});
