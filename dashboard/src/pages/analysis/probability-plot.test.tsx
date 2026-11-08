// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { AnalysisWindow } from "../../lib/analysis-types";
import { analysisCode } from "./analysis-fixture";
import { ProbabilityPlot } from "./probability-plot";

afterEach(cleanup);

const win = (n: number, p: number): AnalysisWindow =>
  ({ id: `w${n}`, index: n - 1, startStep: n, endStep: n, partial: false, incomplete: false, results: [{ codeId: "visibility", probability: p, analysisId: "a", windowId: `w${n}`, attemptId: "x" }] }) as unknown as AnalysisWindow;

const windows = [win(1, 0.2), win(2, 0.8), win(3, 0.6)];
const noop = () => {};

it("draws no floor band or hatching without a reliability floor or audit exclusions", () => {
  const { container } = render(<ProbabilityPlot code={analysisCode} windows={windows} threshold={0.7} onSelect={noop} />);
  expect(container.querySelector(".an-floor")).toBeNull();
  expect(container.querySelector("[data-audit-excluded]")).toBeNull();
});

it("shades the undecided band one probe sd either side of the threshold", () => {
  const { container } = render(<ProbabilityPlot code={analysisCode} windows={windows} threshold={0.7} floor={0.1} onSelect={noop} />);
  const band = container.querySelector(".an-floor")!;
  // Axis: 0 at y=188 and 1 at y=12, so 0.6..0.8 spans y=153.6 down to 118.4 (height 35.2).
  expect(Number(band.getAttribute("y"))).toBeCloseTo(188 - 0.8 * 176, 6);
  expect(Number(band.getAttribute("height"))).toBeCloseTo(0.2 * 176, 6);
  expect(band.querySelector("title")!.textContent).toBe("Within one probe floor (sd 10%) of the threshold: scores in this band are undecided.");
});

it("hatches exactly the audit-excluded windows", () => {
  const { container } = render(<ProbabilityPlot code={analysisCode} windows={windows} threshold={0.7} excluded={new Set(["w2"])} onSelect={noop} />);
  const hatched = [...container.querySelectorAll("[data-audit-excluded]")];
  expect(hatched).toHaveLength(1);
  expect(hatched[0]!.querySelector("title")!.textContent).toContain("Steps 2–2 · excluded from run metrics by an audit code");
  const pattern = container.querySelector("pattern")!;
  expect(hatched[0]!.getAttribute("fill")).toBe(`url(#${pattern.id})`);
  expect(pattern.id).not.toContain(":");
});
