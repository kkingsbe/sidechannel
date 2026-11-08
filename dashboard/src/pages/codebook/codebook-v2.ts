import { NEGATED_PHRASING, type BackgroundPart, type BehaviorKind, type BehaviorQuestion, type BehaviorScope, type CodebookWarning } from "@sidechannel/contracts/browser";
import type { BehaviorCode } from "../../lib/analysis-types";

/** A code with every v2 field present, mirroring the server's `resolveDefinition` (v1 codes read as these defaults). */
export type ResolvedCode = BehaviorCode & { kind: BehaviorKind; scope: BehaviorScope; question: BehaviorQuestion; background: BackgroundPart[]; framingExclusions: string[] };

export function withDefaults(code: BehaviorCode): ResolvedCode {
  return {
    ...code,
    kind: code.kind ?? "behavioral",
    scope: code.scope ?? "window",
    question: code.question ?? { type: "noul" },
    background: code.background ?? ["task", "policy"],
    framingExclusions: code.framingExclusions ?? [],
  };
}

/** The decision procedure is stored as numbered lines ("1. step"); the studio edits it as an ordered list. */
export function parseSteps(procedure: string | undefined): string[] {
  return (procedure ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
}

export function formatSteps(steps: string[]): string | undefined {
  const kept = steps.map((step) => step.trim()).filter(Boolean);
  return kept.length ? kept.map((step, index) => `${index + 1}. ${step}`).join("\n") : undefined;
}

/** An audit choice code with no options takes its options from the window's active agents at request time. */
export const isDynamicChoice = (code: ResolvedCode) =>
  code.kind === "audit" && code.question.type === "choice" && code.question.options.length === 0 && !code.question.allowNone;

/** Mirrors the server's blocking rules for the v2 fields so a save is not rejected after the fact. */
export function questionError(code: BehaviorCode): string | undefined {
  const resolved = withDefaults(code), q = resolved.question;
  if (resolved.scope === "actor" && resolved.kind === "audit") return "Actor scope is only valid for behavioral and distractor codes.";
  if (q.type === "choice") {
    if (isDynamicChoice(resolved)) return undefined;
    if (q.options.length < 2 || q.options.length > 255) return "A choice question needs 2 to 255 options.";
    const labels = q.options.map((option) => option.label.trim());
    if (labels.some((label) => !label)) return "Every choice option needs a label.";
    if (new Set(labels).size !== labels.length) return "Choice option labels must be unique.";
    if (q.allowNone && labels.includes("none_of_these")) return "none_of_these is reserved when none of these is allowed.";
  }
  if (q.type === "score" && (q.levels.length < 2 || q.levels.length > 10 || q.levels.some((level) => !level.trim()))) return "A score question needs 2 to 10 named levels.";
  return undefined;
}

/** The same leading-negation rule the server applies on save, evaluated live. */
export function negationWarnings(code: BehaviorCode): CodebookWarning[] {
  return (["definition", "decisionProcedure"] as const).flatMap((field) =>
    code[field] && NEGATED_PHRASING.test(code[field]!)
      ? [{ codeId: code.id, field, message: `The ${field === "definition" ? "definition" : "decision procedure"} opens with negated phrasing; state what the behavior is and put what it is not in the exclusion criteria.` }]
      : [],
  );
}

const COMPARED = ["code", "name", "definition", "inclusionCriteria", "exclusionCriteria", "examples", "counterexamples", "qualifyingEvidenceTypes", "kind", "scope", "question", "background", "decisionProcedure", "framingExclusions"] as const;

export interface SeedDiff {
  added: BehaviorCode[];
  changed: { id: string; code: string; fields: string[] }[];
  unchanged: number;
  /** Codes in the current revision the seed does not define; the server keeps them as they are. */
  kept: string[];
}

/** What applying the v2 seed would do to the current revision, comparing resolved codes field by field. */
export function diffSeed(current: BehaviorCode[], proposed: BehaviorCode[]): SeedDiff {
  const before = new Map(current.map((code) => [code.id, withDefaults(code)]));
  const diff: SeedDiff = { added: [], changed: [], unchanged: 0, kept: current.filter((code) => !proposed.some((next) => next.id === code.id)).map((code) => code.code) };
  for (const next of proposed) {
    const old = before.get(next.id);
    if (!old) { diff.added.push(next); continue; }
    const resolved = withDefaults(next);
    const fields = COMPARED.filter((field) => JSON.stringify(old[field] ?? null) !== JSON.stringify(resolved[field] ?? null));
    if (fields.length) diff.changed.push({ id: next.id, code: next.code, fields: [...fields] });
    else diff.unchanged += 1;
  }
  return diff;
}
