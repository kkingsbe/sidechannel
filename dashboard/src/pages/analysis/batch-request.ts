import type { BatchStrategy } from "@sidechannel/contracts/browser";

export type StrategyChoice = "flagged-plus-random" | "stratified" | "disagreement";

export interface BatchForm {
  mode: "assisted" | "blind";
  threshold: number;
  randomSize: number;
  seed: string;
  strategy: StrategyChoice;
  /** Comma-separated bin edges, e.g. "0, 0.3, 0.7, 1". */
  bins: string;
  perBin: number;
  minGap: number;
}

export const DEFAULT_BINS = "0, 0.3, 0.7, 1";

/** Parses comma-separated edges; null when fewer than two or any entry is not a number. */
export function parseBins(text: string): number[] | null {
  const edges = text.split(",").map((part) => part.trim()).filter(Boolean).map(Number);
  return edges.length >= 2 && edges.every((edge) => Number.isFinite(edge)) ? edges : null;
}

/** Why the form cannot be submitted, or null. Mirrors the server's strategy validation so errors appear before the request. */
export function batchFormProblem(form: BatchForm): string | null {
  if (form.strategy === "stratified") {
    const edges = parseBins(form.bins);
    if (!edges || edges.some((edge, i) => edge < 0 || edge > 1 || (i > 0 && edge <= edges[i - 1]!))) return "Bin edges must be strictly increasing numbers from 0 to 1.";
    if (!Number.isInteger(form.perBin) || form.perBin < 1) return "Windows per bin must be a whole number of at least 1.";
  }
  if (form.strategy === "disagreement" && !(form.minGap > 0 && form.minGap <= 1)) return "Minimum gap must be greater than 0 and at most 1.";
  return null;
}

export function toStrategy(form: BatchForm): BatchStrategy | undefined {
  if (form.strategy === "stratified") return { kind: "stratified", bins: parseBins(form.bins) ?? [], perBin: form.perBin };
  if (form.strategy === "disagreement") return { kind: "disagreement", minGap: form.minGap };
  return undefined;
}

/** Request body for `POST /analyses/:id/review-batches`; the v1 selection sends no `strategy`. */
export function batchRequest(form: BatchForm): Record<string, unknown> {
  const strategy = toStrategy(form);
  return { mode: form.mode, threshold: form.threshold, randomSize: form.randomSize, seed: form.seed, ...(strategy ? { strategy } : {}) };
}

const reasonLabels: Record<string, string> = { stratified: "Stratified draw", disagreement: "Label vs score", flagged: "Flagged", random: "Random", manual: "Manual" };

/** Plain-language label for a recorded selection reason. */
export const reasonLabel = (reason: string) => reasonLabels[reason] ?? reason;

export function describeStrategy(strategy: BatchStrategy | undefined): string {
  if (!strategy || strategy.kind === "flagged-plus-random") return "Flagged + random";
  if (strategy.kind === "stratified") return `Stratified · bins ${strategy.bins.join(" / ")} · ${strategy.perBin} per bin`;
  return `Disagreement · gap at least ${strategy.minGap}`;
}
