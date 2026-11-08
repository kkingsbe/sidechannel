import test from 'node:test';
import assert from 'node:assert/strict';
import type { Run } from '@sidechannel/contracts/harness/contracts';
import { defaultFixtureConfiguration, resolveConfiguration } from './config.js';
import { createQueuedRun } from './initialization.js';
import { SUMMARY_CONFIG_OMIT, SUMMARY_OMIT, summaryProjection, toRunSummary, type SummaryRun } from './repository.js';

const run = (overrides: Partial<Run> = {}): Run => ({ ...createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'summary'), ...overrides });

test('toRunSummary drops every heavy collection and the scenario assets', () => {
    const summary = toRunSummary(run({ board: [{ id: 'b1', runId: 'r', authorId: 'alpha', sequence: 1, timestamp: '2026-01-01T00:00:00.000Z', text: 'post' }], reports: [{ agentId: 'alpha', raw: '{}', parsed: null }] }));
    for (const field of SUMMARY_OMIT) assert.equal(field in summary, false, field);
    assert.equal('assets' in summary.config.scenario, false);
    assert.equal(summary.config.label, 'Development fixture');
    assert.equal(summary.designation, 'fixture');
    assert.equal(summary.sourceCompleteness, 'recording');
});

test('the mongo projection is derived from the same constants, so a new heavy field cannot leak', () => {
    const projection = summaryProjection();
    const expected = [...SUMMARY_OMIT.map(field => [field, 0]), ...SUMMARY_CONFIG_OMIT.map(field => [`config.scenario.${field}`, 0])];
    assert.deepEqual(Object.entries(projection).sort(), expected.sort());
    // The pre-WS7 literal, kept as the regression oracle.
    const legacy = { board: 0, artifacts: 0, reports: 0, operations: 0, scenarioState: 0, 'config.scenario.assets': 0 };
    assert.deepEqual(projection, legacy);
});

test('source completeness follows the run status', () => {
    for (const [status, completeness] of [['completed', 'recorded-terminal'], ['cancelled', 'recorded-terminal'], ['failed', 'possibly-incomplete'], ['interrupted', 'possibly-incomplete'], ['running', 'recording'], ['queued', 'recording']] as const)
        assert.equal(toRunSummary(run({ status })).sourceCompleteness, completeness, status);
});

test('a projection-shaped record summarises without its heavy fields present', () => {
    const projected = run();
    const stripped = { ...projected } as Record<string, unknown>;
    for (const field of SUMMARY_OMIT) delete stripped[field];
    assert.equal(toRunSummary(stripped as SummaryRun).id, projected.id);
});
