// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { fakeClients, renderWithClients } from "../../test/clients";
import { AnalysisDetail } from "./analysis-detail";
import { analysisFixture } from "./analysis-fixture";

afterEach(cleanup);

const detail = (
  <Routes>
    <Route path="/analysis/:id" element={<AnalysisDetail />} />
  </Routes>
);

function clients() {
  const { job, windows, run } = analysisFixture();
  return fakeClients({
    analyses: {
      job: async () => job,
      windows: async () => ({ items: windows, nextCursor: null }),
      runJobs: async () => ({ items: [job], nextCursor: null }),
    },
    runs: { get: async () => run },
  });
}

it("keeps the frozen job header, coverage notice and heatmap scores", async () => {
  renderWithClients(detail, {
    route: "/analysis/analysis-a",
    clients: clients(),
  });
  expect(
    await screen.findByText(/Coverage on this page: 1 window .* 1 partial window/),
  ).toBeTruthy();
  expect(
    screen.getByRole("tab", { name: "Heatmap" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    screen.getByRole("table", { name: "Behavior probability heatmap" }),
  ).toBeTruthy();
  expect(screen.getByText("0%")).toBeTruthy();
  expect(screen.getByText("Source boundary")).toBeTruthy();
});

it("renders not-found for an unknown view instead of the provenance panel", async () => {
  renderWithClients(detail, {
    route: "/analysis/analysis-a?view=typo",
    clients: clients(),
  });
  expect(await screen.findByText("This view does not exist")).toBeTruthy();
  expect(screen.queryByText("Reproducible provenance")).toBeNull();
});
