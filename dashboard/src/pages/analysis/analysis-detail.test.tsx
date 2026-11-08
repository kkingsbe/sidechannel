// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { fakeClients, fakeServer, renderWithClients } from "../../test/clients";
import { AnalysisDetail } from "./analysis-detail";
import { analysisCode, analysisFixture } from "./analysis-fixture";

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

it("keeps the frozen job header, coverage strip and heatmap scores", async () => {
  renderWithClients(detail, {
    route: "/analysis/analysis-a",
    clients: clients(),
  });
  expect(
    await screen.findByRole("img", { name: /1 source-step windows: 1 scored, 0 skipped, 0 failed/ }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1, name: "Study" })).toBeTruthy();
  expect(
    screen.getByRole("tab", { name: "Heatmap" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    screen.getByRole("table", { name: "Behavior probability heatmap" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: /VISIBILITY, steps 1–12: 0%/ })).toBeTruthy();
  expect(screen.getByText(/up to event 35/)).toBeTruthy();
});

it("renders not-found for an unknown view instead of the provenance panel", async () => {
  renderWithClients(detail, {
    route: "/analysis/analysis-a?view=typo",
    clients: clients(),
  });
  expect(await screen.findByText("This view does not exist")).toBeTruthy();
  expect(screen.queryByText("Reproducible provenance")).toBeNull();
});

function inspectorClients() {
  const { job, windows, run } = analysisFixture();
  const second = { ...analysisCode, id: "second", code: "SECOND", definition: "Second definition" };
  job.manifest.codebook.codes = [analysisCode, second];
  const scored = [0.2, 0.9, 0.5].map((p, index) => ({
    ...windows[0],
    id: `w${index + 1}`,
    index,
    startStep: index + 1,
    endStep: index + 1,
    results: [
      { ...windows[0].results![0], windowId: `w${index + 1}`, codeId: analysisCode.id, probability: p },
      { ...windows[0].results![0], windowId: `w${index + 1}`, codeId: "second", probability: 1 - p },
    ],
  }));
  return fakeClients(
    {
      analyses: {
        job: async () => job,
        windows: async () => ({ items: scored, nextCursor: null }),
        runJobs: async () => ({ items: [job], nextCursor: null }),
        window: async (_id: string, windowId: string) => ({
          window: scored.find((w) => w.id === windowId)!,
          sourceEventIds: [],
          events: [],
        }),
      },
      runs: { get: async () => run },
    },
    fakeServer(() => ({ items: [], nextCursor: null })).request,
  );
}

it("titles a one-step window without a range and leads with the clicked behavior's figure", async () => {
  renderWithClients(detail, {
    route: "/analysis/analysis-a?window=w2&code=analysis-missing",
    clients: inspectorClients(),
  });
  expect(await screen.findByRole("heading", { name: "Window 2 · step 2" })).toBeTruthy();
  expect(screen.getByTestId("lead-figure").textContent).toBe("90.0%");
  expect(screen.getByText("At or above the 70% threshold")).toBeTruthy();
});

it("shows how far under the threshold the estimate is", async () => {
  renderWithClients(detail, {
    route: "/analysis/analysis-a?window=w1",
    clients: inspectorClients(),
  });
  expect(await screen.findByText("50.0 points under the 70% threshold")).toBeTruthy();
  expect(screen.getByTestId("lead-figure").textContent).toBe("20.0%");
});

it("switches the lead block and the judgment form when a behavior is picked in the grid", async () => {
  const user = userEvent.setup();
  renderWithClients(detail, {
    route: "/analysis/analysis-a?window=w1",
    clients: inspectorClients(),
  });
  await screen.findByTestId("lead-figure");
  await user.click(screen.getByRole("button", { name: /SECOND/ }));
  expect(screen.getByTestId("lead-figure").textContent).toBe("80.0%");
  expect((screen.getByLabelText("Behavior") as HTMLSelectElement).value).toBe("second");
  expect(screen.getByText("Is SECOND present in this window?")).toBeTruthy();
});

it("walks to the previous and next window from the drawer header", async () => {
  const user = userEvent.setup();
  renderWithClients(detail, {
    route: "/analysis/analysis-a?window=w2",
    clients: inspectorClients(),
  });
  await screen.findByRole("heading", { name: "Window 2 · step 2" });
  expect(screen.getByText("2 of 3")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Next window, 3" }));
  expect(await screen.findByRole("heading", { name: "Window 3 · step 3" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Next window" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Previous window, 2" }));
  await user.click(await screen.findByRole("button", { name: "Previous window, 1" }));
  expect(await screen.findByRole("heading", { name: "Window 1 · step 1" })).toBeTruthy();
});
