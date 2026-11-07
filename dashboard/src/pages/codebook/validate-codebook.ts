import type { BehaviorCode } from "../../lib/analysis-types";

export interface CodebookDraft {
  name: string;
  author: string;
  codes: BehaviorCode[];
  baseRevisionId: string;
}

export interface CodebookValidation {
  invalid: boolean;
  /** Rendered in the save-status region, in this order. */
  status: string;
  nameError: string | undefined;
  /** Duplicate display code among active definitions. */
  codeError(code: BehaviorCode): string | undefined;
  duplicateNames: boolean;
  readyToSave: boolean;
}

const DUPLICATE_CODE = "This display code is already used.";
const INVALID_SUMMARY =
  "Complete the name, display code and definition for every active behavior; display codes must be unique.";

/** The single owner of the three validity questions (name, active fields, unique display codes). */
export function validateCodebook(
  draft: CodebookDraft,
  state: { dirty: boolean; baseLoaded: boolean },
): CodebookValidation {
  const active = draft.codes.filter((code) => !code.archived);
  const duplicateNames = active.some(
    (code, index) =>
      active.findIndex((other) => other.code === code.code) !== index,
  );
  const invalid =
    !draft.name.trim() ||
    active.some(
      (code) =>
        !code.definition.trim() || !code.code.trim() || !code.name.trim(),
    ) ||
    duplicateNames;
  const status = !state.dirty
    ? "No unsaved changes."
    : !draft.author.trim()
      ? "Enter a revision author to save your changes."
      : invalid
        ? INVALID_SUMMARY
        : "Ready to save a new revision. Existing analyses keep their frozen definitions.";
  return {
    invalid,
    status,
    nameError: draft.name.trim() ? undefined : "Enter a codebook name.",
    codeError: (code: BehaviorCode) =>
      code.archived ||
      !active.some(
        (other) => other.id !== code.id && other.code === code.code,
      )
        ? undefined
        : DUPLICATE_CODE,
    duplicateNames,
    readyToSave:
      state.dirty && state.baseLoaded && !invalid && !!draft.author.trim(),
  };
}
