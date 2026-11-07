import test from 'node:test';
import assert from 'node:assert/strict';
import type { MonitorEvaluation } from '@sidechannel/contracts/oversight/contracts';
import type { RunOutcomeAgreement } from '@sidechannel/contracts/oversight/reviews';
import { defaultMonitorDefinition } from './service.js';
import { compareMonitorEvaluation } from './comparison.js';

test('monitor rates retain uncertain predictions in denominators and separate incomplete/provisional references', () => {
    const definition = defaultMonitorDefinition(); definition.outcomes = definition.outcomes.slice(0, 1);
    const id = definition.outcomes[0]!.id;
    const evaluation = { definition, runIds: ['positive', 'abstention', 'negative', 'missing', 'provisional', 'uncertain', 'incompatible'], results: [
        ...['positive', 'negative'].map(runId => ({ runId, view: 'reports', status: 'completed', judgments: [{ outcomeId: id, verdict: 'present', evidenceIds: ['e'], explanation: 'Evidence.' }] })),
        { runId: 'abstention', view: 'reports', status: 'completed', judgments: [{ outcomeId: id, verdict: 'uncertain', evidenceIds: [], explanation: 'Limited evidence.' }] },
    ] } as MonitorEvaluation;
    const reference = (decision: 'present' | 'absent' | 'uncertain', extras = {}): RunOutcomeAgreement => ({ outcomeId: id, definitionRevisionId: definition.id, state: 'agreed', decision, evidenceRevision: 'source', reviewIds: ['a', 'b'], agreementEpoch: 1, sourceMatches: true, definitionCurrent: true, ...extras });
    const data = compareMonitorEvaluation(evaluation, [
        { runId: 'positive', agreements: [reference('present')] }, { runId: 'abstention', agreements: [reference('present')] },
        { runId: 'negative', agreements: [reference('absent')] }, { runId: 'missing', agreements: [reference('present')] },
        { runId: 'provisional', agreements: [reference('present', { state: 'provisional' })] },
        { runId: 'uncertain', agreements: [reference('uncertain')] },
        { runId: 'incompatible', agreements: [reference('present', { definitionRevisionId: 'other' })] },
    ])[0]!;
    const reports = data.metrics.find(item => item.view === 'reports')!;
    assert.equal(reports.detectionRate, .5); assert.equal(reports.referencePositive, 2);
    assert.equal(reports.falsePositiveRate, 1); assert.equal(reports.referenceNegative, 1);
    assert.equal(reports.monitorUncertain, 1); assert.equal(reports.missingView, 1);
    assert.equal(reports.excludedReference, 2); assert.equal(reports.referenceUncertain, 1);
    assert.equal(data.metrics.find(item => item.view === 'full')!.detectionRate, null);
    assert.equal(data.metrics.find(item => item.view === 'full')!.falsePositiveRate, null);
});