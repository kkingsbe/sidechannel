// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { MonitorEvaluation } from "@sidechannel/contracts/browser";
import { ComparisonResult } from "./comparison-result";
import { comparisonFixture } from "./summary-fixture";

afterEach(cleanup);

const evaluation = {
  id: "eval-1", updatedAt: "2026-11-05T00:00:00Z", definition: { outcomes: [{ id: "shaped", name: "Report shaping" }] },
  results: [{ runId: "run-reviewed-0", view: "reports", status: "completed", judgments: [{ outcomeId: "shaped", verdict: "present", evidenceIds: [], explanation: "" }] }],
} as unknown as MonitorEvaluation;

it("groups per-run points by condition with the group mean", () => {
  render(<ComparisonResult comparison={comparisonFixture()} />);
  const strip = screen.getByRole("img", { name: "VISIBILITY max per run, grouped by condition" });
  expect(strip.querySelectorAll("circle")).toHaveLength(4);
  expect([...strip.querySelectorAll("text")].map((t) => t.textContent)).toEqual(expect.arrayContaining(["excluded", "reviewed"]));
  expect(strip.querySelectorAll("circle title")[0]!.textContent).toContain("run run-excl");
});

it("reports the difference with its run-bootstrap interval and the paired variant", () => {
  render(<ComparisonResult comparison={comparisonFixture()} />);
  const table = screen.getByRole("table", { name: "Difference in VISIBILITY" });
  const rows = within(table).getAllByRole("row").slice(1).map((row) => [...row.querySelectorAll("th,td")].map((c) => c.textContent));
  expect(rows[0]).toEqual(["reviewed − excluded", "2 / 2", "+50%", "+40% to +70%", "Run bootstrap"]);
  expect(rows[1]).toEqual(["reviewed − excluded · paired", "2 pairs", "+55%", "+40% to +70%", "Within-pair differences"]);
  const pairs = screen.getByRole("table", { name: "Paired differences, reviewed against excluded" });
  expect(within(pairs).getAllByRole("row")).toHaveLength(3);
  expect(within(pairs).getByText("+70%")).toBeTruthy();
});

it("shows warnings, the few-runs caveat and the resampling provenance", () => {
  render(<ComparisonResult comparison={comparisonFixture()} />);
  expect(screen.getAllByText(/too narrow a base to interpret the interval/).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(/Fewer than five runs in a condition/)).toBeTruthy();
  expect(screen.getByTestId("comparison-provenance").textContent).toContain("bootstrap over runs, seed 7, 2000 resamples");
  expect(screen.getByTestId("comparison-provenance").textContent).toContain("paired by pairId");
});

it("omits the paired rows when the comparison was not paired", () => {
  const comparison = comparisonFixture({ paired: false });
  for (const code of comparison.codes) for (const diff of code.differences) delete diff.paired;
  render(<ComparisonResult comparison={comparison} />);
  expect(screen.queryByText(/· paired/)).toBeNull();
});

it("says so when there is no shared pairId", () => {
  const comparison = comparisonFixture();
  comparison.codes[0]!.differences[0]!.paired = null;
  render(<ComparisonResult comparison={comparison} />);
  expect(screen.getByText("No shared pairId")).toBeTruthy();
});

it("joins monitor verdicts for runs in the comparison and leaves the section out otherwise", () => {
  const { rerender } = render(<ComparisonResult comparison={comparisonFixture()} evaluations={[evaluation]} />);
  const table = screen.getByRole("table", { name: "Monitor verdicts by run" });
  const cells = within(table).getAllByRole("row")[1]!.querySelectorAll("th,td");
  expect([...cells].map((c) => c.textContent)).toEqual(["run-revi", "reviewed", "90%", "Report shaping", "reports", "present"]);
  expect(screen.getByText(/1 of 4 runs have completed monitor evaluations/)).toBeTruthy();
  rerender(<ComparisonResult comparison={comparisonFixture()} evaluations={[]} />);
  expect(screen.queryByRole("table", { name: "Monitor verdicts by run" })).toBeNull();
});
