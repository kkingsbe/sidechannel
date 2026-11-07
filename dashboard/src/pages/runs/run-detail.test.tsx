// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { defaultFixtureConfiguration } from "@sidechannel/contracts/testing";
import { fakeClients, renderWithClients } from "../../test/clients";
import { RunDetail } from "./run-detail";
import type { Run } from "../../lib/types";
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
