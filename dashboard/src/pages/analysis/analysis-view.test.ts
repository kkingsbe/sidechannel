import { expect, it } from "vitest";
import {
  groupDiagnostics,
  linePath,
  plural,
  sortWindows,
  stepTicks,
  suggestWindowSize,
} from "./analysis-view";

const win = (n: number, size = 3, score?: number) => ({
  id: `window-${n}`,
  index: n - 1,
  startStep: (n - 1) * 2 + 1,
  endStep: (n - 1) * 2 + size,
  results: score === undefined ? [] : [{ codeId: "c", probability: score }],
});

it("orders windows by numeric start step, not by text window id", () => {
  const ids = Array.from({ length: 16 }, (_, i) => i + 1)
    .map((n) => win(n))
    .sort((a, b) => a.id.localeCompare(b.id));
  expect(ids.slice(0, 3).map((w) => w.id)).toEqual(["window-1", "window-10", "window-11"]);
  expect(sortWindows(ids).map((w) => w.index + 1)).toEqual(
    Array.from({ length: 16 }, (_, i) => i + 1),
  );
});

it("draws the timeline left to right and breaks the line at a missing window", () => {
  const windows = [1, 2, 3, 10, 11].map((n) => win(n, 3, n === 3 ? undefined : 0.5));
  const shuffled = [windows[3], windows[0], windows[4], windows[2], windows[1]];
  const max = 21 + 2;
  const path = linePath(shuffled, "c", 1, max);
  const xs = [...path.matchAll(/[ML](-?[\d.]+),/g)].map((m) => Number(m[1]));
  expect(xs).toEqual([...xs].sort((a, b) => a - b));
  // w1-w2 joined, window 3 missing so w10-w11 start a new subpath.
  expect(path.match(/M/g)).toHaveLength(2);
  expect(path.match(/L/g)).toHaveLength(2);
});

it("suggests a smaller window size from the measured tokens per step", () => {
  const budget = (tokens: number, oversized: boolean) => ({
    bytes: 1,
    estimatedTokens: tokens,
    estimatorVersion: "v",
    perQuestionLimit: 32000,
    perRequestLimit: 64000,
    headroom: 2000,
    oversized,
    batches: oversized ? [] : [["a"]],
  });
  const windows = [
    { id: "a", index: 0, startStep: 1, endStep: 12, partial: false, incomplete: false, empty: false, budget: budget(60000, true) },
    { id: "b", index: 1, startStep: 5, endStep: 16, partial: false, incomplete: false, empty: false, budget: budget(90000, true) },
  ];
  // worst case 7,500 tokens/step; capacity 30,000 -> 4 steps -> 90% margin -> 3
  expect(suggestWindowSize(windows, 12)).toBe(3);
  expect(suggestWindowSize([{ ...windows[0], budget: budget(100, false) }], 12)).toBeUndefined();
});

it("builds readable ticks, plurals and grouped diagnostics", () => {
  const ticks = stepTicks(1, 35);
  expect(ticks[0]).toBe(1);
  expect(ticks.at(-1)).toBe(35);
  expect(plural(1, "step")).toBe("1 step");
  expect(plural(1, "tag batch", "tag batches")).toBe("1 tag batch");
  expect(plural(2, "step")).toBe("2 steps");
  const grouped = groupDiagnostics([
    "Expected one current response or submitted report; found 0 responses.",
    "Expected one current response or submitted report; found 0 responses.",
  ]);
  expect(grouped).toHaveLength(1);
  expect(grouped[0].count).toBe(2);
  expect(grouped[0].text).not.toMatch(/Expected one current/);
});
