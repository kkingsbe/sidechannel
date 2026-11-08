import { expect, it } from "vitest";
import { reviewerLabel, summarizeReviewers } from "./reviewer-summary";

type Row = Parameters<typeof summarizeReviewers>[0][number];
const review = (reviewer: string, decision: Row["decision"], codeId = "c", patch: Partial<Row> = {}): Row => ({ reviewer, decision, codeId, scope: "window", subjectId: "w1", windowId: "w1", ...patch });

it("counts distinct reviewers and flags the second one", () => {
  expect(summarizeReviewers([], "w1")).toEqual({ reviewers: 0, second: false, split: false });
  expect(reviewerLabel(summarizeReviewers([], "w1"))).toBe("No reviewers yet");
  const one = summarizeReviewers([review("a", "present"), review("a", "absent", "d")], "w1");
  expect(one).toEqual({ reviewers: 1, second: false, split: false });
  expect(reviewerLabel(one)).toBe("1 reviewer · second pending");
  const two = summarizeReviewers([review("a", "present"), review("b", "present")], "w1");
  expect(two).toEqual({ reviewers: 2, second: true, split: false });
  expect(reviewerLabel(two)).toBe("2 reviewers");
});

it("a split needs opposite present and absent decisions on one code; uncertain never splits", () => {
  expect(summarizeReviewers([review("a", "present"), review("b", "absent")], "w1").split).toBe(true);
  expect(summarizeReviewers([review("a", "present", "c"), review("b", "absent", "d")], "w1").split).toBe(false);
  expect(summarizeReviewers([review("a", "present"), review("b", "uncertain")], "w1").split).toBe(false);
});

it("ignores event-scope and other-window reviews", () => {
  const rows = [review("a", "present", "c", { scope: "event" }), review("b", "present", "c", { subjectId: "w2", windowId: "w2" }), review("c", "present")];
  expect(summarizeReviewers(rows, "w1").reviewers).toBe(1);
});
