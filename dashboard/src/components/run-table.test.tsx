// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { RunTable } from "./run-table";
import { renderWithClients } from "../test/clients";

afterEach(cleanup);
it("keeps the run table headers, fixture badge and inspect link", () => {
  const run = {
    id: "run-1",
    config: {
      label: "Study",
      scenario: { version: "fixture-v1" },
      condition: { id: "reviewed" },
      model: { provider: "scripted", id: "fixture", settings: {} },
      scheduler: { rounds: 3 },
    },
    status: "completed",
    round: 3,
    turn: 6,
    updatedAt: "2026-11-07T12:01:00Z",
  };
  renderWithClients(<RunTable runs={[run as never]} detailSearch="?returnTo=%2Fruns" />);
  expect(screen.getByRole("table", { name: "Experiment runs" })).toBeTruthy();
  expect(screen.getByText("Scripted fixture")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: /Inspect Study/ })
      .getAttribute("href"),
  ).toBe("/runs/run-1?returnTo=%2Fruns");
});
