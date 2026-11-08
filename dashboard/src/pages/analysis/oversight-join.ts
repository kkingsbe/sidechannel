/**
 * Spec 8.4: a display join between run-level Jev metrics and the oversight monitor's verdicts. Jev results never feed
 * the monitor and the monitor's verdicts never alter Jev aggregation: this module only lines the two up by run.
 */
import type { MonitorEvaluation } from "@sidechannel/contracts/browser";

export interface OversightVerdict {
  runId: string;
  evaluationId: string;
  outcomeId: string;
  outcomeName: string;
  view: string;
  verdict: "present" | "absent" | "uncertain";
}

/**
 * Verdicts for the given runs from completed monitor views. When several evaluations cover a run, the most recently
 * updated one wins for each (outcome, view), so the table shows one verdict per cell.
 */
export function oversightVerdicts(runIds: readonly string[], evaluations: readonly MonitorEvaluation[]): OversightVerdict[] {
  const wanted = new Set(runIds);
  const latest = new Map<string, { at: string; row: OversightVerdict }>();
  for (const evaluation of evaluations) {
    const names = new Map(evaluation.definition.outcomes.map((o) => [o.id, o.name]));
    for (const result of evaluation.results) {
      if (!wanted.has(result.runId) || result.status !== "completed") continue;
      for (const judgment of result.judgments) {
        const key = JSON.stringify([result.runId, judgment.outcomeId, result.view]);
        const prior = latest.get(key);
        if (prior && prior.at >= evaluation.updatedAt) continue;
        latest.set(key, {
          at: evaluation.updatedAt,
          row: { runId: result.runId, evaluationId: evaluation.id, outcomeId: judgment.outcomeId, outcomeName: names.get(judgment.outcomeId) ?? judgment.outcomeId, view: result.view, verdict: judgment.verdict },
        });
      }
    }
  }
  return [...latest.values()].map((entry) => entry.row).sort((a, b) => a.runId.localeCompare(b.runId) || a.outcomeId.localeCompare(b.outcomeId) || a.view.localeCompare(b.view));
}

/** Runs with at least one verdict. */
export const runsWithVerdicts = (rows: readonly OversightVerdict[]) => [...new Set(rows.map((row) => row.runId))];
