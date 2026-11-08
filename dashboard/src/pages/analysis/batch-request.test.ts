import { expect, it } from "vitest";
import { batchFormProblem, batchRequest, DEFAULT_BINS, describeStrategy, parseBins, reasonLabel, type BatchForm } from "./batch-request";

const form = (patch: Partial<BatchForm> = {}): BatchForm => ({ mode: "assisted", threshold: 0.7, randomSize: 10, seed: "s", strategy: "flagged-plus-random", bins: DEFAULT_BINS, perBin: 10, minGap: 0.5, ...patch });

it("the default selection sends the v1 body with no strategy", () => {
  expect(batchRequest(form())).toEqual({ mode: "assisted", threshold: 0.7, randomSize: 10, seed: "s" });
});

it("a stratified selection sends parsed bin edges and the per-bin count", () => {
  expect(batchRequest(form({ strategy: "stratified", bins: "0, .25, 0.75,1", perBin: 4 })).strategy).toEqual({ kind: "stratified", bins: [0, 0.25, 0.75, 1], perBin: 4 });
});

it("a disagreement selection sends the minimum gap", () => {
  expect(batchRequest(form({ strategy: "disagreement", minGap: 0.3 })).strategy).toEqual({ kind: "disagreement", minGap: 0.3 });
});

it("rejects malformed bins, per-bin counts and gaps before any request", () => {
  expect(batchFormProblem(form())).toBeNull();
  expect(batchFormProblem(form({ strategy: "stratified" }))).toBeNull();
  for (const bins of ["0", "0, a, 1", "0, 0.5, 0.5, 1", "0, 1.5", "-0.1, 1"]) expect(batchFormProblem(form({ strategy: "stratified", bins }))).toMatch(/Bin edges/);
  expect(batchFormProblem(form({ strategy: "stratified", perBin: 0 }))).toMatch(/per bin/);
  expect(batchFormProblem(form({ strategy: "stratified", perBin: 2.5 }))).toMatch(/per bin/);
  expect(batchFormProblem(form({ strategy: "disagreement", minGap: 0 }))).toMatch(/gap/);
  expect(batchFormProblem(form({ strategy: "disagreement", minGap: 1.2 }))).toMatch(/gap/);
  expect(batchFormProblem(form({ strategy: "disagreement", minGap: Number.NaN }))).toMatch(/gap/);
});

it("parses bin edges and describes strategies and reasons", () => {
  expect(parseBins(" 0 , 0.3 ,1 ")).toEqual([0, 0.3, 1]);
  expect(parseBins("")).toBeNull();
  expect(describeStrategy(undefined)).toBe("Flagged + random");
  expect(describeStrategy({ kind: "stratified", bins: [0, 0.3, 1], perBin: 5 })).toBe("Stratified · bins 0 / 0.3 / 1 · 5 per bin");
  expect(describeStrategy({ kind: "disagreement", minGap: 0.4 })).toBe("Disagreement · gap at least 0.4");
  expect(reasonLabel("stratified")).toBe("Stratified draw");
  expect(reasonLabel("disagreement")).toBe("Label vs score");
  expect(reasonLabel("unknown")).toBe("unknown");
});
