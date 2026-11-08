// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiClientProvider } from "../../lib/clients/context";
import { fakeClients } from "../../test/clients";
import { ScorePanel } from "./score-panel";
import { analysisFixture } from "./analysis-fixture";

afterEach(cleanup);
const { job, windows } = analysisFixture();

function renderPanel(kind: "probability" | "heatmap" | "table", list = windows) {
  const clients = fakeClients({
    analyses: {
      job: async () => job,
      windows: async () => ({ items: list, nextCursor: null }),
    },
  });
  return render(
    <MemoryRouter initialEntries={["/analysis/analysis-a"]}>
      <ApiClientProvider clients={clients}>
        <ScorePanel kind={kind} id="analysis-a" />
      </ApiClientProvider>
    </MemoryRouter>,
  );
}

it("shows the same estimate caveat above the probability, heatmap and table views", async () => {
  for (const kind of ["probability", "heatmap", "table"] as const) {
    renderPanel(kind);
    expect(
      await screen.findByText(
        /Estimated probability the behavior occurs in this window/,
      ),
    ).toBeTruthy();
    cleanup();
  }
});

it("keeps missing scores as gaps, never zeros", async () => {
  renderPanel("table", [{ ...windows[0], results: [] } as never]);
  expect(await screen.findByText("skipped")).toBeTruthy();
  expect(screen.queryByText("0%")).toBeNull();
});
