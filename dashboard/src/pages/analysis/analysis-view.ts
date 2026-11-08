/** Pure view helpers for the Analysis page: window ordering, chart geometry, token budgeting and copy. */
import type { AnalysisPreview, EvidenceCategory } from "../../lib/analysis-types";

export const categoryLabels: Record<EvidenceCategory, string> = {
  assistant: "Assistant outputs",
  tools: "Tool arguments & results",
  board: "Board & exact deliveries",
  artifacts: "Artifact history",
  memory: "Private working memory",
  reasoning: "Available provider reasoning",
  reports: "Individual final reports",
};

export const plural = (n: number, singular: string, pluralForm = singular + "s") =>
  `${n} ${n === 1 ? singular : pluralForm}`;

/** Windows in run order: numeric start step, then end step, then index. Window IDs must never be sorted as text. */
export function sortWindows<T extends { startStep: number; endStep: number; index: number }>(windows: readonly T[]): T[] {
  return [...windows].sort((a, b) => a.startStep - b.startStep || a.endStep - b.endStep || a.index - b.index);
}

type Scored = { results?: readonly { codeId: string; probability: number | null }[] };
/** The noul probability for a code, or undefined when the window has no result or the answer is not a probability. */
export const scoreOf = (window: Scored, codeId: string) =>
  window.results?.find((r) => r.codeId === codeId)?.probability ?? undefined;

/** Plot geometry shared by the probability timeline and its tests. */
export const plotLeft = 36;
export const plotWidth = 624;
export const plotX = (step: number, min: number, max: number) =>
  plotLeft + ((step - min) / Math.max(1, max - min)) * plotWidth;
export const plotY = (p: number) => 91 - p * 75;

/** SVG path through scored windows in run order; a window without a score breaks the line instead of bridging the gap. */
export function linePath(
  windows: readonly (Scored & { startStep: number; endStep: number; index: number })[],
  codeId: string,
  min: number,
  max: number,
): string {
  let path = "";
  let connected = false;
  for (const w of sortWindows(windows)) {
    const score = scoreOf(w, codeId);
    if (score == null) {
      connected = false;
      continue;
    }
    path += (connected ? " L" : " M") + plotX(w.endStep, min, max) + "," + plotY(score);
    connected = true;
  }
  return path.trim();
}

/** Roughly `count` evenly spaced step ticks from min to max, always including both ends. */
export function stepTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];
  const span = max - min;
  const raw = span / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks = [min];
  for (let t = Math.ceil((min + 1) / step) * step; t < max - step / 3; t += step) ticks.push(t);
  ticks.push(max);
  return ticks;
}

type PreviewWindow = AnalysisPreview["windows"][number];
export const isScoreable = (w: PreviewWindow) => !w.budget.oversized && !w.empty && w.budget.batches.length > 0;

/** Per-question token capacity a window must fit within, or undefined when the preview carries no limits. */
export function windowCapacity(windows: readonly PreviewWindow[]): number | undefined {
  const budget = windows[0]?.budget;
  if (!budget || !(budget.perQuestionLimit > 0) || !(budget.perRequestLimit > 0)) return undefined;
  return Math.max(0, Math.min(budget.perQuestionLimit, budget.perRequestLimit) - (budget.headroom || 0));
}

/**
 * Suggests a window size that should fit the budget, scaled from the worst measured tokens-per-step of the
 * oversized windows with a 10% margin. Returns undefined when nothing is oversized or no size can fit.
 */
export function suggestWindowSize(windows: readonly PreviewWindow[], currentSize: number): number | undefined {
  const oversized = windows.filter((w) => w.budget.oversized && w.budget.estimatedTokens > 0);
  const capacity = windowCapacity(windows);
  if (!oversized.length || !capacity) return undefined;
  const perStep = Math.max(...oversized.map((w) => w.budget.estimatedTokens / Math.max(1, w.endStep - w.startStep + 1)));
  const size = Math.floor((capacity / perStep) * 0.9);
  return size >= 1 && size < currentSize ? size : undefined;
}

/** Rewrites worker diagnostics that read as internal assertions into plain terms. */
export function plainDiagnostic(message: string): string {
  const match = /^Expected one current response or submitted report; found (\d+) responses?\.?$/.exec(message);
  if (!match) return message;
  const found = Number(match[1]);
  return found === 0
    ? "Some steps have no model response and no submitted report, so their evidence may be incomplete."
    : `Some steps have ${found} model responses where one was expected, so their evidence may be ambiguous.`;
}

/** Collapses repeated messages into one line with a count. */
export function groupDiagnostics(messages: readonly string[]): { text: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    const text = plainDiagnostic(message);
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts].map(([text, count]) => ({ text, count }));
}

export const percent = (p: number) => Math.round(p * 100);
