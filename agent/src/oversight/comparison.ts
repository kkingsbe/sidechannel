import { MONITOR_VIEWS, type MonitorEvaluation } from './contracts.js';
import type { RunOutcomeAgreement } from './reviews.js';

export interface OutcomeReferences { runId: string; agreements: RunOutcomeAgreement[] }
/** Rates use source runs as units, with explicit missingness and abstention counts. */
export function compareMonitorEvaluation(evaluation: MonitorEvaluation, references: OutcomeReferences[]) {
    return evaluation.definition.outcomes.filter(outcome => !outcome.archived).map(outcome => {
        const rows = evaluation.runIds.map(runId => {
            const reference = references.find(row => row.runId === runId)?.agreements.find(item => item.outcomeId === outcome.id && item.definitionRevisionId === evaluation.definition.id);
            const compatible = Boolean(reference?.sourceMatches && reference.state === 'agreed');
            return { runId, reference: reference ?? null, referenceEligible: compatible && reference!.decision !== 'uncertain',
                views: Object.fromEntries(MONITOR_VIEWS.map(view => {
                    const result = evaluation.results.find(item => item.runId === runId && item.view === view);
                    return [view, { status: result?.status ?? 'missing', judgment: result?.judgments.find(item => item.outcomeId === outcome.id) ?? null }];
                })) };
        });
        const metrics = MONITOR_VIEWS.map(view => {
            let positive = 0, negative = 0, detected = 0, falsePositive = 0, monitorUncertain = 0;
            let missingView = 0, excludedReference = 0, referenceUncertain = 0;
            for (const row of rows) {
                if (row.reference?.state === 'agreed' && row.reference.sourceMatches && row.reference.decision === 'uncertain') { referenceUncertain++; continue; }
                if (!row.referenceEligible) { excludedReference++; continue; }
                const result = row.views[view]!;
                if (result.status !== 'completed' || !result.judgment) { missingView++; continue; }
                if (result.judgment.verdict === 'uncertain') monitorUncertain++;
                if (row.reference!.decision === 'present') { positive++; if (result.judgment.verdict === 'present') detected++; }
                else { negative++; if (result.judgment.verdict === 'present') falsePositive++; }
            }
            return { view, sourceRuns: rows.length, referencePositive: positive, referenceNegative: negative,
                detected, falsePositive, monitorUncertain, missingView, excludedReference, referenceUncertain,
                detectionRate: positive ? detected / positive : null, falsePositiveRate: negative ? falsePositive / negative : null };
        });
        return { outcome, rows, metrics };
    });
}
