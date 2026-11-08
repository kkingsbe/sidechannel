import { expect, it } from "vitest";
import type { ThresholdPolicy } from "../../lib/analysis-types";
import { DEFAULT_POLICY, draftOf, floorBand, policyOf, provenanceLine } from "./summary-view";
import { summaryFixture } from "./summary-fixture";

it("round-trips every policy kind through its draft", () => {
  const policies: ThresholdPolicy[] = [
    DEFAULT_POLICY,
    { kind: "validated", fallback: { yes: 0.8, no: 0.2 } },
    { kind: "control-percentile", percentile: 0.9, controlAnalysisIds: ["a", "b"], no: 0.25 },
  ];
  for (const policy of policies)
    expect(policyOf(draftOf(policy))).toEqual({ policy });
});

it("explains invalid drafts instead of producing a policy", () => {
  expect(policyOf({ ...draftOf(DEFAULT_POLICY), yes: "" })).toEqual({ error: "Thresholds must be from 0 to 1." });
  expect(policyOf({ ...draftOf(DEFAULT_POLICY), yes: "0.2", no: "0.5" })).toEqual({ error: "The no threshold cannot exceed the yes threshold." });
  expect(policyOf({ ...draftOf({ kind: "control-percentile", percentile: 0.9, controlAnalysisIds: ["a"] }), controls: " " })).toEqual({ error: "Name at least one control analysis." });
  expect(policyOf({ ...draftOf({ kind: "control-percentile", percentile: 0.9, controlAnalysisIds: ["a"] }), percentile: "1.5" })).toEqual({ error: "Percentile must be from 0 to 1." });
});

it("splits control IDs on commas and whitespace and drops repeats", () => {
  const result = policyOf({ ...draftOf({ kind: "control-percentile", percentile: 0.9, controlAnalysisIds: ["x"] }), controls: "a, b  a\nc" });
  expect(result).toMatchObject({ policy: { controlAnalysisIds: ["a", "b", "c"] } });
});

it("states the provenance of each policy", () => {
  expect(provenanceLine(summaryFixture())).toBe("Fixed thresholds: yes at or above 70%, no at or below 30%.");
  const control = summaryFixture({
    policy: { kind: "control-percentile", percentile: 0.95, controlAnalysisIds: ["c1", "c2"] }, controlAnalysisIds: ["c1", "c2"], usedFallback: true,
    codes: [{ ...summaryFixture().codes[0]!, threshold: { yes: 0.48, no: 0.3, source: "control-percentile", controlWindows: 5 } }],
  });
  expect(provenanceLine(control)).toBe("Control 95% percentile of 5 window scores from 2 control analyses; codes without control scores use the fixed fallback, marked below.");
  expect(provenanceLine(summaryFixture({ policy: { kind: "validated", fallback: { yes: 0.8, no: 0.2 } }, usedFallback: true }))).toContain("fixed fallback 80% / 20% marked below");
});

it("clips the floor band to the probability axis and omits it without a floor", () => {
  expect(floorBand(0.7, 0.05)!.low).toBeCloseTo(0.65, 9);
  expect(floorBand(0.7, 0.05)!.high).toBeCloseTo(0.75, 9);
  expect(floorBand(0.98, 0.05)?.high).toBe(1);
  expect(floorBand(0.02, 0.05)?.low).toBe(0);
  expect(floorBand(0.7, undefined)).toBeUndefined();
  expect(floorBand(0.7, 0)).toBeUndefined();
});
