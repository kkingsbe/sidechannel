// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ThresholdPolicy } from "../../lib/analysis-types";
import { fakeClients, renderWithClients } from "../../test/clients";
import { RunSummaryPanel, RunSummaryView } from "./run-summary-panel";
import { summaryFixture } from "./summary-fixture";

afterEach(cleanup);

it("shows the metrics, thresholds with provenance, actor rows and distributions", () => {
  renderWithClients(<RunSummaryView summary={summaryFixture()} />);
  const table = screen.getByRole("table", { name: "Run summary by behavior" });
  const row = within(table).getAllByRole("row")[1]!; // header, then the pooled VISIBILITY row, then its actor rows
  expect(within(row).getByText("fixed")).toBeTruthy();
  const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
  expect(cells).toEqual(["70% fixed", "4", "90%", "55%", "3", "75%", "2", "3+ windows", "1"]);
  expect(within(table).getAllByRole("row")[2]!.textContent).toContain("agent-a");
  expect(within(table).getByRole("row", { name: /ROUTE/ }).textContent).toContain("board 67% · memo 33%");
  expect(screen.getByRole("columnheader", { name: "3 strikes" })).toBeTruthy();
});

it("reports audit exclusions and coverage gaps next to the provenance line", () => {
  renderWithClients(<RunSummaryView summary={summaryFixture()} />);
  expect(screen.getByTestId("summary-provenance").textContent).toBe("Fixed thresholds: yes at or above 70%, no at or below 30%.");
  const text = document.body.textContent ?? "";
  expect(text).toContain("4 of 9 windows scored");
  expect(text).toContain("1 excluded because an audit code scored at or above 70%");
  expect(text).toContain("3 coverage gaps (1 oversized, 1 skipped, 1 failed)");
  expect(text).toContain("1 unfinished");
});

it("marks fallback thresholds and warns", () => {
  const base = summaryFixture();
  renderWithClients(<RunSummaryView summary={{ ...base, usedFallback: true, codes: [{ ...base.codes[0]!, threshold: { yes: 0.7, no: 0.3, source: "fallback" } }] }} />);
  expect(screen.getByText("fallback")).toBeTruthy();
  expect(screen.getByText(/fixed fallback threshold because the policy had no data/)).toBeTruthy();
});

it("loads the summary under the default policy and reloads when the policy changes", async () => {
  const requested: ThresholdPolicy[] = [];
  const clients = fakeClients({ analyses: { summary: async (_id: string, policy: ThresholdPolicy) => { requested.push(policy); return summaryFixture({ policy }); } } });
  renderWithClients(<RunSummaryPanel id="analysis-a" />, { clients });
  expect(await screen.findByRole("table", { name: "Run summary by behavior" })).toBeTruthy();
  expect(requested).toEqual([{ kind: "fixed", yes: 0.7, no: 0.3 }]);
  fireEvent.change(screen.getByLabelText("Yes at or above"), { target: { value: "0.8" } });
  await waitFor(() => expect(requested.at(-1)).toEqual({ kind: "fixed", yes: 0.8, no: 0.3 }));
  fireEvent.change(screen.getByLabelText("Threshold policy"), { target: { value: "control-percentile" } });
  fireEvent.change(screen.getByLabelText("Control analysis IDs"), { target: { value: "ctl-1" } });
  await waitFor(() => expect(requested.at(-1)).toEqual({ kind: "control-percentile", percentile: 0.95, controlAnalysisIds: ["ctl-1"], no: 0.3 }));
});

it("does not request an invalid policy and says why", async () => {
  const requested: ThresholdPolicy[] = [];
  const clients = fakeClients({ analyses: { summary: async (_id: string, policy: ThresholdPolicy) => { requested.push(policy); return summaryFixture(); } } });
  renderWithClients(<RunSummaryPanel id="analysis-a" />, { clients });
  await screen.findByRole("table", { name: "Run summary by behavior" });
  fireEvent.change(screen.getByLabelText("Yes at or above"), { target: { value: "2" } });
  expect((await screen.findByRole("alert")).textContent).toBe("Thresholds must be from 0 to 1.");
  expect(requested).toHaveLength(1);
});

it("shows the error when the summary cannot load", async () => {
  const clients = fakeClients({ analyses: { summary: async () => { throw new Error("analysis not found"); } } });
  renderWithClients(<RunSummaryPanel id="missing" />, { clients });
  expect(await screen.findByText("analysis not found")).toBeTruthy();
});
