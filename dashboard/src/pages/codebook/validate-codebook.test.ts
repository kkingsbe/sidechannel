import { expect, it } from "vitest";
import { validateCodebook } from "./validate-codebook";
import type { BehaviorCode } from "../../lib/analysis-types";

const code = (patch: Partial<BehaviorCode> = {}): BehaviorCode => ({ id: "supply", code: "SUPPLY", name: "Supply", definition: "Original definition", inclusionCriteria: [], exclusionCriteria: [], examples: [], counterexamples: [], qualifyingEvidenceTypes: [], enabled: true, archived: false, color: "#123456", ...patch });

it("names every blocking reason in a single status string", () => {
  const missingName = validateCodebook({ name: "", author: "Reviewer", codes: [code()], baseRevisionId: "revision-1" }, { dirty: true, baseLoaded: true });
  expect(missingName.invalid).toBe(true);
  expect(missingName.nameError).toBe("Enter a codebook name.");
  expect(missingName.status).toBe("Complete the name, display code and definition for every active behavior; display codes must be unique.");
  expect(validateCodebook({ name: "Study", author: "", codes: [code()], baseRevisionId: "r" }, { dirty: true, baseLoaded: true }).status).toBe("Enter a revision author to save your changes.");
  expect(validateCodebook({ name: "Study", author: "A", codes: [code()], baseRevisionId: "r" }, { dirty: false, baseLoaded: true }).status).toBe("No unsaved changes.");
  expect(validateCodebook({ name: "Study", author: "A", codes: [code()], baseRevisionId: "r" }, { dirty: true, baseLoaded: true }).status).toBe("Ready to save a new revision. Existing analyses keep their frozen definitions.");
});

it("reports duplicate display codes per code and ignores archived definitions", () => {
  const duplicate = validateCodebook({ name: "Study", author: "A", codes: [code(), code({ id: "second" })], baseRevisionId: "r" }, { dirty: true, baseLoaded: true });
  expect(duplicate.duplicateNames).toBe(true);
  expect(duplicate.codeError(code())).toBe("This display code is already used.");
  const archived = validateCodebook({ name: "Study", author: "A", codes: [code(), code({ id: "second", archived: true, enabled: false })], baseRevisionId: "r" }, { dirty: true, baseLoaded: true });
  expect(archived.duplicateNames).toBe(false);
  expect(archived.invalid).toBe(false);
});
