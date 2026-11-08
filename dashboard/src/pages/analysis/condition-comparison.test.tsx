// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import type { ComparisonRequest } from "../../lib/analysis-types";
import { fakeClients, renderWithClients } from "../../test/clients";
import { analysisFixture } from "./analysis-fixture";
import { ConditionComparison } from "./condition-comparison";
import { comparisonFixture } from "./summary-fixture";

afterEach(cleanup);

const page = (
  <Routes>
    <Route path="/analysis/compare" element={<ConditionComparison />} />
  </Routes>
);

const { job } = analysisFixture();
const jobs = ["a", "b", "c"].map((id) => ({ ...job, id: `analysis-${id}`, runId: `run-${id}` }));

it("preselects analyses from the URL and posts the chosen policy, metric, seed and paired flag", async () => {
  const posted: ComparisonRequest[] = [];
  const clients = fakeClients({
    analyses: { list: async () => ({ items: jobs, nextCursor: null }), createComparison: async (input: ComparisonRequest) => { posted.push(input); return comparisonFixture(); }, comparison: async () => comparisonFixture() },
    monitor: { evaluations: async () => ({ items: [], nextCursor: null }) },
  });
  renderWithClients(page, { clients, route: "/analysis/compare?ids=analysis-a,analysis-b" });
  const run = await screen.findByRole("button", { name: /Compare 2 analyses/ });
  expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getAllByRole("checkbox")[2]!); // analysis-c
  fireEvent.change(screen.getByLabelText("Metric"), { target: { value: "fractionAbove" } });
  fireEvent.change(screen.getByLabelText("Bootstrap seed"), { target: { value: "42" } });
  fireEvent.click(screen.getByRole("button", { name: /Compare 3 analyses/ }));
  await waitFor(() => expect(posted).toHaveLength(1));
  expect(posted[0]).toEqual({ analysisIds: ["analysis-a", "analysis-b", "analysis-c"], policy: { kind: "fixed", yes: 0.7, no: 0.3 }, metric: "fractionAbove", paired: true, seed: 42 });
  expect(run).toBeTruthy();
  expect(await screen.findByRole("table", { name: "Difference in VISIBILITY" })).toBeTruthy();
});

it("needs two analyses and a valid seed before it will compare", async () => {
  const clients = fakeClients({ analyses: { list: async () => ({ items: jobs, nextCursor: null }) } });
  renderWithClients(page, { clients, route: "/analysis/compare?ids=analysis-a" });
  const button = await screen.findByRole("button", { name: /Compare 1 analysis/ });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getAllByRole("checkbox")[1]!);
  expect((screen.getByRole("button", { name: /Compare 2 analyses/ }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText("Bootstrap seed"), { target: { value: "-3" } });
  expect((screen.getByRole("button", { name: /Compare 2 analyses/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Use a whole number, 0 or more.")).toBeTruthy();
});

it("reopens a stored comparison from the URL and joins monitor verdicts", async () => {
  const clients = fakeClients({
    analyses: { list: async () => ({ items: jobs, nextCursor: null }), comparison: async () => comparisonFixture() },
    monitor: { evaluations: async () => ({ items: [{ id: "e", updatedAt: "2026-11-05", definition: { outcomes: [{ id: "o", name: "Shaping" }] }, results: [{ runId: "run-excluded-0", view: "full", status: "completed", judgments: [{ outcomeId: "o", verdict: "absent" }] }] }] as never, nextCursor: null }) },
  });
  renderWithClients(page, { clients, route: "/analysis/compare?comparison=cmp-1" });
  expect(await screen.findByRole("table", { name: "Difference in VISIBILITY" })).toBeTruthy();
  expect(await screen.findByRole("table", { name: "Monitor verdicts by run" })).toBeTruthy();
});

it("surfaces a comparison failure", async () => {
  const clients = fakeClients({ analyses: { list: async () => ({ items: jobs, nextCursor: null }), createComparison: async () => { throw new Error("Each run may appear once"); } } });
  renderWithClients(page, { clients, route: "/analysis/compare?ids=analysis-a,analysis-b" });
  fireEvent.click(await screen.findByRole("button", { name: /Compare 2 analyses/ }));
  expect(await screen.findByText("Each run may appear once")).toBeTruthy();
});
