// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import { fakeClients, renderWithClients } from "../../test/clients";
import { analysisFixture } from "./analysis-fixture";
import { ScorePanel } from "./score-panel";
import { summaryFixture } from "./summary-fixture";

afterEach(cleanup);

const { job, windows } = analysisFixture();
const reliability = { perCode: { visibility: { sd: 0.04, maxSpread: 0.1, n: 4 } }, overall: { meanSd: 0.04, maxSd: 0.04, probedWindows: 6, repeats: 4 }, completedAt: "2026-11-08T00:00:00Z" };

it("reads the floor from the job's reliability and hatches audit-excluded windows on the probability plot", async () => {
  const clients = fakeClients({
    analyses: {
      job: async () => ({ ...job, reliability }),
      windows: async () => ({ items: windows, nextCursor: null }),
      summary: async () => summaryFixture({ coverage: { ...summaryFixture().coverage, excludedWindowIds: [windows[0]!.id] } }),
    },
  });
  const { container } = renderWithClients(<ScorePanel kind="probability" id="analysis-a" />, { clients });
  await waitFor(() => expect(container.querySelector(".an-floor")).not.toBeNull());
  await waitFor(() => expect(container.querySelectorAll("[data-audit-excluded]")).toHaveLength(1));
});

it("draws the plain plot for a job without reliability or when the summary is unavailable", async () => {
  const clients = fakeClients({
    analyses: { job: async () => job, windows: async () => ({ items: windows, nextCursor: null }), summary: async () => { throw new Error("unavailable"); } },
  });
  const { container } = renderWithClients(<ScorePanel kind="probability" id="analysis-a" />, { clients });
  await waitFor(() => expect(container.querySelector("svg[role=img]")).not.toBeNull());
  expect(container.querySelector(".an-floor")).toBeNull();
  expect(container.querySelector("[data-audit-excluded]")).toBeNull();
});
