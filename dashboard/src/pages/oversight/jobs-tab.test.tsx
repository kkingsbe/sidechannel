// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { MonitorEvaluation } from "@sidechannel/contracts/browser";
import { fakeClients, renderWithClients } from "../../test/clients";
import { JobsTab } from "./jobs-tab";

afterEach(cleanup);

const job = {
  id: "evaluation-1",
  settings: { model: { provider: "fixture", id: "Independent monitor" } },
  runIds: ["source"],
  definition: { id: "definition-7", revision: 7, outcomes: [] },
  status: "completed",
  createdAt: "2026-11-07T12:00:00Z",
  results: [],
} as unknown as MonitorEvaluation;

it("lists evaluation jobs with their cursor page and source-return link", async () => {
  renderWithClients(<JobsTab />, {
    route: "/oversight",
    clients: fakeClients({
      monitor: { evaluations: async () => ({ items: [job], nextCursor: null }) },
    }),
  });
  const link = await screen.findByRole("link", {
    name: "Independent monitor - 1 source run - revision 7",
  });
  expect(link.getAttribute("href")).toContain(
    "/oversight/evaluation-1?returnTo=",
  );
  expect(screen.getByText("Page 1")).toBeTruthy();
});

it("renders the empty state without fetching anything else", async () => {
  renderWithClients(<JobsTab />, {
    route: "/oversight",
    clients: fakeClients({
      monitor: { evaluations: async () => ({ items: [], nextCursor: null }) },
    }),
  });
  expect(await screen.findByText("No oversight comparisons yet")).toBeTruthy();
});
