// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { fakeClients, renderWithClients } from "../../test/clients";
import { RunDetail } from "./run-detail";
import type { HarnessEvent, Run } from "../../lib/types";
import type { RunProgress } from "../../lib/contracts";

afterEach(cleanup);
const config = defaultFixtureConfiguration();
const detail = (
  <Routes>
    <Route path="/runs/:id" element={<RunDetail />} />
  </Routes>
);
const run = { id: "run-1", config, status: "completed", configHash: "fixture-hash", launchKey: "key", createdAt: "2026-11-07T12:00:00Z", updatedAt: "2026-11-07T12:01:00Z", round: 3, turn: 6, board: [], artifacts: [], reports: [], operations: {}, scenarioState: null, usage: {} } as unknown as Run;
const progress: RunProgress = { id: "run-1", status: "running", round: 4, turn: 7, updatedAt: "2026-11-07T12:02:00Z", observedAt: "2026-11-07T12:02:01Z", executionPhase: "action", rounds: 7, usage: {} };

it("merges live progress into the frozen record and keeps the seven evidence tabs", async () => {
  renderWithClients(detail, {
    route: "/runs/run-1?view=timeline",
    clients: fakeClients({ runs: { get: async () => run, progress: async () => progress } }),
  });
  expect(await screen.findByText(/Round/)).toBeTruthy();
  const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent?.slice(0, 8));
  expect(tabs).toContain("Timeline");
  expect(tabs).toContain("Board & ");
  expect(screen.getByRole("tab", { name: "Timeline" }).getAttribute("aria-selected")).toBe("true");
});

it("renders not-found for an unknown evidence view", async () => {
  renderWithClients(detail, {
    route: "/runs/run-1?view=typo",
    clients: fakeClients({ runs: { get: async () => run } }),
  });
  expect(await screen.findByText("This view does not exist")).toBeTruthy();
});

it("opens the evidence drawer from the URL and never substitutes an event sequence for a message id", async () => {
  const message = { id: "message-1", runId: "run-1", authorId: "alpha", sequence: 1, timestamp: run.createdAt, text: "board evidence" };
  renderWithClients(detail, {
    route: "/runs/run-1?view=board&evidence=message-1",
    clients: fakeClients({
      runs: {
        get: async () => run,
        evidenceTab: async () => ({ items: [message], total: 1, nextOffset: null, posts: [], deliveries: [], nextDeliveryCursor: 0, deliveriesMayHaveMore: false }) as never,
        evidenceItem: async () => message,
      },
    }),
  });
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("message-1");
  expect(dialog.textContent).toContain("board evidence");
});

/** One model call: request -> response -> usage, plus a turn start/end for grouping. */
function modelEvents(): HarnessEvent[] {
  const base = {
    schemaVersion: 1,
    runId: "run-1",
    timestamp: "2026-11-07T12:00:00Z",
    round: 1,
    turn: 1,
    agentId: "alpha",
  };
  return [
    { ...base, id: "evt-1", sequence: 1, type: "turn_started", data: { allowance: 8 } },
    { ...base, id: "evt-2", sequence: 2, type: "model_requested", invocationId: "inv-1", data: { phase: "action", messages: [{}], tools: [{}] } },
    {
      ...base,
      id: "evt-3",
      sequence: 3,
      type: "model_response",
      invocationId: "inv-1",
      data: {
        text: "Exact recorded answer",
        toolCalls: [],
        raw: { finishReason: "stop", steps: [{ reasoning: [{ type: "reasoning", text: "Recorded reasoning." }] }] },
      },
    },
    { ...base, id: "evt-4", sequence: 4, type: "model_usage", invocationId: "inv-1", data: { source: "provider", usage: { inputTokens: 10, outputTokens: 5 } } },
    { ...base, id: "evt-5", sequence: 5, type: "turn_ended", data: { reason: "agent", remainingAllowance: 6 } },
  ] as HarnessEvent[];
}

it("renders main's turn-grouped timeline and model-call row from the loaded events page", async () => {
  const events = modelEvents();
  renderWithClients(detail, {
    route: "/runs/run-1?view=timeline",
    clients: fakeClients({
      runs: {
        get: async () => run,
        progress: async () => progress,
        events: async () => ({ items: events, nextCursor: null }),
      },
    }),
  });
  expect(await screen.findByText("Round 1 · Turn 1")).toBeTruthy();
  expect(screen.getByText("model call")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Raw events" })).toBeTruthy();
});

it("focuses the URL-selected invocation in the traces panel", async () => {
  const events = modelEvents();
  renderWithClients(detail, {
    route: "/runs/run-1?view=traces&call=inv-1",
    clients: fakeClients({
      runs: {
        get: async () => run,
        progress: async () => progress,
        events: async () => ({ items: events, nextCursor: null }),
      },
    }),
  });
  expect(await screen.findByRole("article", { name: "Model call 1" })).toBeTruthy();
  expect(screen.getByText(/Reasoning returned on/)).toBeTruthy();
});

it("opens main's model-call detail in the drawer for a model event", async () => {
  const events = modelEvents();
  const response = events.find((event) => event.id === "evt-3")!;
  renderWithClients(detail, {
    route: "/runs/run-1?view=timeline&evidence=evt-3",
    clients: fakeClients({
      runs: {
        get: async () => run,
        progress: async () => progress,
        events: async () => ({ items: events, nextCursor: null }),
        event: async () => response,
      },
    }),
  });
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("Call 1 of 1");
  expect(dialog.textContent).toContain("Exact recorded answer");
  const open = screen.getByRole("button", { name: "Open in Model & traces" });
  await userEvent.click(open);
  expect(await screen.findByRole("article", { name: "Model call 1" })).toBeTruthy();
});
