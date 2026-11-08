import type { Run } from "../../lib/types";

export interface RunGroup {
  key: string;
  pairId?: string;
  label: string;
  runs: Run[];
  updatedAt: string;
}

export const CONDITIONS = ["reviewed", "excluded"] as const;

/** Group runs into matched pairs (runs without a pairId stay single), keeping first-seen order. */
export function groupByPair(runs: Run[]): RunGroup[] {
  const groups = new Map<string, RunGroup>();
  for (const run of runs) {
    const key = run.pairId ? "pair:" + run.pairId : "run:" + run.id;
    const found = groups.get(key);
    if (found) {
      found.runs.push(run);
      if ((run.updatedAt ?? "") > found.updatedAt) found.updatedAt = run.updatedAt;
    } else
      groups.set(key, {
        key,
        pairId: run.pairId,
        label: run.config?.label || run.id,
        runs: [run],
        updatedAt: run.updatedAt ?? "",
      });
  }
  return [...groups.values()];
}

/** Place runs into the reviewed / excluded columns; anything else takes the first free column. */
export function conditionCells(runs: Run[]): (Run | undefined)[] {
  const cells: (Run | undefined)[] = CONDITIONS.map((id) =>
    runs.find((run) => run.config?.condition?.id === id),
  );
  for (const run of runs) {
    if (cells.includes(run)) continue;
    const free = cells.findIndex((cell) => !cell);
    if (free >= 0) cells[free] = run;
  }
  return cells;
}

/** Group key for "launched experiments": the draft group when frozen on the run, else the label. */
export function experimentKey(run: Run): string {
  return run.sourceDraft?.groupId || run.config?.label || run.id;
}

/** One sentence for a failure reason; the raw text stays available through a title. */
export function failureSentence(reason: string, max = 110): string {
  const line = reason.trim().split(/\r?\n/)[0] ?? "";
  const first = line.match(/^.{20,}?[.!?](\s|$)/)?.[0].trim() ?? line;
  return first.length > max ? first.slice(0, max - 1).trimEnd() + "…" : first;
}

const position = (run: Run) => `R${run.round ?? 0} · T${run.turn ?? 0}`;
const COMPLETE = "completed";

export interface Comparability {
  state: "yes" | "no" | "pending";
  reason: string;
}

/** Comparable end to end: both conditions recorded and both completed. */
export function comparability(runs: Run[]): Comparability {
  const [first, second] = conditionCells(runs);
  const cells = [first, second];
  if (!first || !second) {
    const only = first ?? second;
    return { state: "no", reason: only ? "only " + (only.config?.condition?.id ?? "one") + " recorded" : "no runs recorded" };
  }
  if (cells.every((run) => run!.status === COMPLETE)) {
    const same = position(first) === position(second);
    return { state: "yes", reason: same ? "both ran to " + position(first) : "both completed" };
  }
  const active = cells.find((run) => ["queued", "running", "reporting", "stopping"].includes(run!.status));
  if (active) return { state: "pending", reason: (active.config?.condition?.id ?? "a run") + " still " + active.status };
  const odd = cells.find((run) => run!.status !== COMPLETE)!;
  return {
    state: "no",
    reason: `${odd.config?.condition?.id ?? "run"} ${odd.status} at ${position(odd)}`,
  };
}
