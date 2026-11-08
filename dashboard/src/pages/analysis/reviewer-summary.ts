import type { HumanReview } from "../../lib/analysis-types";

export interface ReviewerSummary {
  /** Distinct reviewers with a latest window-scope judgment on the window. */
  reviewers: number;
  /** True once two reviewers have judged the window, the minimum for human-human agreement. */
  second: boolean;
  /** True when two reviewers gave different present/absent decisions on the same code. */
  split: boolean;
}

/** Summarises the latest window-scope judgments of one window across reviewers. `uncertain` never counts as a split. */
export function summarizeReviewers(reviews: readonly Pick<HumanReview, "reviewer" | "scope" | "codeId" | "decision" | "subjectId" | "windowId">[], windowId: string): ReviewerSummary {
  const own = reviews.filter((r) => r.scope === "window" && (r.subjectId ?? r.windowId) === windowId);
  const reviewers = new Set(own.map((r) => r.reviewer)).size;
  const decided = new Map<string, Set<string>>();
  for (const r of own) if (r.decision !== "uncertain") decided.set(r.codeId, (decided.get(r.codeId) ?? new Set()).add(r.decision));
  return { reviewers, second: reviewers >= 2, split: [...decided.values()].some((set) => set.size > 1) };
}

export const reviewerLabel = (summary: ReviewerSummary) =>
  summary.reviewers === 0 ? "No reviewers yet" : summary.second ? `${summary.reviewers} reviewers` : "1 reviewer · second pending";
