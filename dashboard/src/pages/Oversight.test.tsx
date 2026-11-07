// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Oversight from "./Oversight";

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
const projection = (
  runId: string,
  view: string,
  status = "ready",
  tokens = 1000,
) => ({
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
  judgments: [
    { outcomeId: "outcome", verdict, evidenceIds: ["e1"], explanation: "Because" },
  ],
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
const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
function mock(
  handler: (url: URL, options?: RequestInit) => unknown,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, options?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      const path = url.pathname.replace(/^\/api/, "");
      const custom = await handler(new URL(path, "http://localhost"), options);
      if (custom === undefined) throw new Error("Unexpected route " + input);
      return custom instanceof Response ? custom : json(custom);
    }),
  );
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function detailRoutes(comparisons: unknown[]) {
  return (url: URL) => {
    if (url.pathname === "/monitor-evaluations/eval-1") return evaluation;
    if (url.pathname === "/monitor-evaluations/eval-1/comparison")
      return { comparisons };
    if (url.pathname === "/monitor-evaluations/eval-1/export")
      return {
        evaluation,
        preview: {
          runs: ["run-excluded", "run-reviewed"].map((runId) => ({
            runId,
            projections: views.map((view) => projection(runId, view)),
          })),
        },
      };
    if (url.pathname === "/runs/run-reviewed")
      return sourceRun("run-reviewed", "reviewed");
    if (url.pathname === "/runs/run-excluded")
      return sourceRun("run-excluded", "excluded");
  };
}

it("heads source blocks with experiment, condition and pair, reviewed first, with a pair summary", async () => {
  mock(detailRoutes([]));
  render(
    <MemoryRouter initialEntries={["/eval-1"]}>
      <Oversight />
    </MemoryRouter>,
  );
  await screen.findByText("Pair-aligned summary · Pair experiment");
  const tables = await screen.findAllByRole("table", {
    name: /Evidence-view verdict matrix/,
  });
  expect(tables[0].getAttribute("aria-label")).toContain("run-reviewed");
  expect(tables[1].getAttribute("aria-label")).toContain("run-excluded");
  expect(screen.getAllByRole("link", { name: "Pair experiment" })).toHaveLength(2);
  expect(screen.getAllByText("reviewed").length).toBeGreaterThan(0);
  const summary = screen.getByRole("table", { name: /Pair-aligned verdicts/ });
  expect(within(summary).getByText("present")).toBeTruthy();
  expect(within(summary).getByText("absent")).toBeTruthy();
});

it("collapses denominators to an empty state until a reference is agreed", async () => {
  mock(detailRoutes([]));
  const { unmount } = render(
    <MemoryRouter initialEntries={["/eval-1"]}>
      <Oversight />
    </MemoryRouter>,
  );
  await screen.findByText("No agreed human references yet");
  expect(
    screen.queryByRole("table", { name: "Detection and false positive counts" }),
  ).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "Open Human reference outcomes" })
      .getAttribute("href"),
  ).toBe("/oversight?view=references");
  unmount();
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
  mock(detailRoutes([{ outcome, rows: [], metrics: [metric] }]));
  render(
    <MemoryRouter initialEntries={["/eval-1"]}>
      <Oversight />
    </MemoryRouter>,
  );
  await screen.findByRole("table", { name: "Detection and false positive counts" });
});

it("opens the verdict drawer from ?verdict= and words excluded availability clearly", async () => {
  mock(detailRoutes([]));
  render(
    <MemoryRouter
      initialEntries={["/eval-1?verdict=run-reviewed:outcome:reports"]}
    >
      <Oversight />
    </MemoryRouter>,
  );
  await screen.findByText("Because");
  expect(
    (await screen.findAllByText(/recorded for this run · not included in this view/))
      .length,
  ).toBeGreaterThan(0);
  expect(screen.queryByText("Private memory available")).toBeNull();
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
  mock((url, options) => {
    if (url.pathname === "/monitor-definitions") return definition;
    if (url.pathname === "/monitor-definitions/history")
      return { items: [definition], nextCursor: null };
    if (url.pathname === "/monitor-evaluations")
      return options?.method === "POST"
        ? { id: "eval-new" }
        : { items: [], nextCursor: null };
    if (url.pathname === "/runs")
      return {
        items: [sourceRun("run-reviewed", "reviewed")],
        total: 1,
        nextOffset: null,
      };
    if (url.pathname === "/monitor/preview") return preview;
  });
  render(
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
  await user.click(
    screen.getByLabelText(
      "Launch anyway; oversized views will be recorded as unavailable",
    ),
  );
  expect((launch as HTMLButtonElement).disabled).toBe(false);
});

it("labels reference runs with condition and shows citation errors inline, with an event picker", async () => {
  let posted: any;
  mock((url, options) => {
    if (url.pathname === "/monitor-definitions") return definition;
    if (url.pathname === "/monitor-definitions/history")
      return { items: [definition], nextCursor: null };
    if (url.pathname === "/monitor-evaluations")
      return { items: [], nextCursor: null };
    if (url.pathname === "/runs")
      return {
        items: [sourceRun("run-reviewed", "reviewed"), sourceRun("run-excluded", "excluded")],
        total: 2,
        nextOffset: null,
      };
    if (url.pathname === "/runs/run-reviewed/reviews/context")
      return {
        runId: "run-reviewed",
        definition,
        evidenceRevision: "rev",
        eventCount: 2,
      };
    if (url.pathname === "/runs/run-reviewed/events")
      return {
        events: [
          { id: "ev-1", runId: "run-reviewed", sequence: 1, type: "board_post", agentId: "agent-a", data: { text: "Hello board" } },
          { id: "ev-2", runId: "run-reviewed", sequence: 2, type: "tool_call", agentId: "agent-b", data: { text: "Call tool" } },
        ],
        nextCursor: 2,
        hasMore: false,
      };
    if (url.pathname === "/runs/run-reviewed/outcomes") return [];
    if (url.pathname === "/runs/run-reviewed/reviews/latest") return null;
    if (url.pathname === "/runs/run-reviewed/reviews") {
      if (options?.method === "POST") {
        posted = JSON.parse(String(options.body));
        return new Response(
          JSON.stringify({ error: "Citations must be unique event IDs from this source run" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      return { items: [], nextCursor: null };
    }
  });
  render(
    <MemoryRouter initialEntries={["/?view=references&run=run-reviewed"]}>
      <Oversight />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  const picker = await screen.findByRole("combobox", { name: "Run for outcome adjudication" });
  expect(
    within(picker).getByRole("option", { name: "Pair experiment · excluded · run-excluded" }),
  ).toBeTruthy();
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
  await user.click(screen.getByRole("button", { name: "Save provisional reference" }));
  await waitFor(() => expect(posted?.eventIds).toEqual(["ev-1"]));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Citations must be unique event IDs");
  expect(field.getAttribute("aria-invalid")).toBe("true");
});
