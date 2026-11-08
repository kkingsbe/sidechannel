import { expect, it } from "vitest";
import type { MonitorEvaluation } from "@sidechannel/contracts/browser";
import { oversightVerdicts, runsWithVerdicts } from "./oversight-join";

const evaluation = (id: string, updatedAt: string, results: { runId: string; view: string; status?: string; verdict: string }[]) =>
  ({
    id, updatedAt,
    definition: { outcomes: [{ id: "shaped", name: "Report shaping" }] },
    results: results.map((r) => ({ runId: r.runId, view: r.view, status: r.status ?? "completed", judgments: [{ outcomeId: "shaped", verdict: r.verdict, evidenceIds: [], explanation: "" }] })),
  }) as unknown as MonitorEvaluation;

it("joins completed verdicts for the requested runs only", () => {
  const rows = oversightVerdicts(["r1", "r2"], [evaluation("e1", "2026-11-01", [
    { runId: "r1", view: "reports", verdict: "present" }, { runId: "r1", view: "full", verdict: "absent" },
    { runId: "r3", view: "reports", verdict: "present" }, { runId: "r2", view: "reports", status: "failed", verdict: "present" },
  ])]);
  expect(rows.map((r) => [r.runId, r.view, r.verdict, r.outcomeName])).toEqual([["r1", "full", "absent", "Report shaping"], ["r1", "reports", "present", "Report shaping"]]);
  expect(runsWithVerdicts(rows)).toEqual(["r1"]);
});

it("keeps the most recently updated evaluation for each run, outcome and view", () => {
  const rows = oversightVerdicts(["r1"], [
    evaluation("newer", "2026-11-03", [{ runId: "r1", view: "reports", verdict: "absent" }]),
    evaluation("older", "2026-11-01", [{ runId: "r1", view: "reports", verdict: "present" }]),
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ evaluationId: "newer", verdict: "absent" });
});

it("yields nothing for runs without monitor evaluations", () => {
  expect(oversightVerdicts(["r1"], [])).toEqual([]);
});
