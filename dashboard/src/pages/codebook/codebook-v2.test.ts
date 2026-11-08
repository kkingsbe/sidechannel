import { expect, it } from "vitest";
import type { BehaviorCode } from "../../lib/analysis-types";
import { diffSeed, formatSteps, negationWarnings, parseSteps, questionError, withDefaults } from "./codebook-v2";
import { validateCodebook } from "./validate-codebook";

const code = (patch: Partial<BehaviorCode> = {}): BehaviorCode => ({ id: "supply", code: "SUPPLY", name: "Supply", definition: "Original definition", inclusionCriteria: [], exclusionCriteria: [], examples: [], counterexamples: [], qualifyingEvidenceTypes: [], enabled: true, archived: false, color: "#123456", ...patch });

it("reads v1 codes with the v2 defaults and never defaults the condition into the background", () => {
  const resolved = withDefaults(code());
  expect(resolved).toMatchObject({ kind: "behavioral", scope: "window", question: { type: "noul" }, background: ["task", "policy"], framingExclusions: [] });
});

it("round-trips the decision procedure as numbered lines", () => {
  expect(formatSteps(["Look", " ", "Decide"])).toBe("1. Look\n2. Decide");
  expect(parseSteps("1. Look\n2) Decide\n\n")).toEqual(["Look", "Decide"]);
  expect(formatSteps([])).toBeUndefined();
});

it("mirrors the server's blocking question rules", () => {
  expect(questionError(code())).toBeUndefined();
  expect(questionError(code({ kind: "audit", scope: "actor" }))).toMatch(/Actor scope/);
  const options = (labels: string[]) => labels.map((label) => ({ label, description: "" }));
  expect(questionError(code({ question: { type: "choice", options: options(["a"]), allowNone: false } }))).toMatch(/2 to 255/);
  expect(questionError(code({ question: { type: "choice", options: options(["a", "a"]), allowNone: false } }))).toMatch(/unique/);
  expect(questionError(code({ question: { type: "choice", options: options(["a", "none_of_these"]), allowNone: true } }))).toMatch(/reserved/);
  expect(questionError(code({ question: { type: "choice", options: options(["a", "b"]), allowNone: true } }))).toBeUndefined();
  expect(questionError(code({ kind: "audit", question: { type: "choice", options: [], allowNone: false } }))).toBeUndefined();
  expect(questionError(code({ question: { type: "score", levels: ["low"] } }))).toMatch(/2 to 10/);
  expect(questionError(code({ question: { type: "score", levels: ["low", "high"] } }))).toBeUndefined();
});

it("blocks saving an active code with an invalid question but not an archived one", () => {
  const bad = code({ question: { type: "score", levels: ["only"] } });
  expect(validateCodebook({ name: "S", author: "A", codes: [bad], baseRevisionId: "r" }, { dirty: true, baseLoaded: true }).invalid).toBe(true);
  expect(validateCodebook({ name: "S", author: "A", codes: [{ ...bad, archived: true }], baseRevisionId: "r" }, { dirty: true, baseLoaded: true }).invalid).toBe(false);
});

it("warns on leading negation in the definition and decision procedure", () => {
  expect(negationWarnings(code({ definition: "Does not mention it", decisionProcedure: "No x" })).map((w) => w.field)).toEqual(["definition", "decisionProcedure"]);
  expect(negationWarnings(code())).toEqual([]);
});

it("diffs the seed against the saved revision field by field", () => {
  const saved = [code(), code({ id: "mine", code: "MINE" })];
  const seed = [code({ definition: "Original definition", framingExclusions: ["x"] }), code({ id: "new", code: "NEW", kind: "audit" })];
  const diff = diffSeed(saved, seed);
  expect(diff.added.map((c) => c.id)).toEqual(["new"]);
  expect(diff.changed).toEqual([{ id: "supply", code: "SUPPLY", fields: ["framingExclusions"] }]);
  expect(diff.kept).toEqual(["MINE"]);
  expect(diffSeed([code()], [code({ kind: "behavioral", background: ["task", "policy"] })]).unchanged).toBe(1);
});
