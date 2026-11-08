import { expect, it } from "vitest";
import type { ReviewBatch } from "@sidechannel/contracts/browser";
import { toBatch } from "./jev";

const raw: ReviewBatch = { id: "b", analysisId: "a", createdAt: "2026-11-08T00:00:00.000Z", definitionRevision: "r", evidenceRevision: "e", populationHash: "h", populationSize: 12, seed: "s", randomSize: 0, threshold: 0.7, codeIds: ["c"], selectedCount: 8, mode: "assisted" };

it("a v1 batch maps without strategy fields", () => {
  const batch = toBatch(raw);
  expect(batch.populationCount).toBe(12);
  expect("strategy" in batch).toBe(false);
  expect("shortfalls" in batch).toBe(false);
});

it("carries the strategy and shortfalls of a stratified batch", () => {
  const batch = toBatch({ ...raw, strategy: { kind: "stratified", bins: [0, 0.5, 1], perBin: 3 }, shortfalls: [{ codeId: "c", bin: 1, requested: 3, drawn: 2 }] });
  expect(batch.strategy).toEqual({ kind: "stratified", bins: [0, 0.5, 1], perBin: 3 });
  expect(batch.shortfalls).toEqual([{ codeId: "c", bin: 1, requested: 3, drawn: 2 }]);
});
