import type { BehaviorCode } from "../../lib/analysis-types";

export const STORAGE_PREFIX = "sidechannel-codebook-";

export interface LocalDraft {
  name: string;
  codes: BehaviorCode[];
  baseRevision: number;
}

/** Local crash recovery: same-revision edits restore silently, older edits need explicit reconciliation. */
export function readLocalDraft(
  bookId: string,
  revision: number | undefined,
): { restored?: LocalDraft; recovery?: LocalDraft } {
  const saved = localStorage.getItem(STORAGE_PREFIX + bookId);
  if (!saved) return {};
  try {
    const recovered = JSON.parse(saved) as LocalDraft;
    if (!Array.isArray(recovered.codes) || typeof recovered.name !== "string")
      return {};
    return recovered.baseRevision === revision
      ? { restored: recovered }
      : { recovery: recovered };
  } catch {
    return {};
  }
}

export function duplicateCode(code: BehaviorCode): BehaviorCode {
  return {
    ...structuredClone(code),
    id: crypto.randomUUID(),
    code: code.code + "_COPY",
    name: code.name + " copy",
  };
}

export function moveCode(
  codes: BehaviorCode[],
  selected: string,
  direction: number,
): BehaviorCode[] | undefined {
  const index = codes.findIndex((item) => item.id === selected),
    next = index + direction;
  if (next < 0 || next >= codes.length) return undefined;
  const result = [...codes];
  [result[index], result[next]] = [result[next], result[index]];
  return result;
}
