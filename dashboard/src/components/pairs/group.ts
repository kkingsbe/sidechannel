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
