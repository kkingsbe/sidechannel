import test from 'node:test';
import assert from 'node:assert/strict';
import type { HarnessEvent, Run } from '@sidechannel/contracts/harness/contracts';
import { MONITOR_VIEWS, type MonitorView } from '@sidechannel/contracts/oversight/contracts';
import { defaultFixtureConfiguration, resolveConfiguration } from '../harness/config.js';
import { createQueuedRun } from '../harness/initialization.js';
import { defaultMonitorDefinition } from './service.js';
import { MONITOR_VIEW_BUILDERS, buildProjection } from './projections.js';

const settings = { model: { provider: 'test', id: 'model', settings: {} }, maxInputChars: 1_000_000, contextWindowTokens: 1_000_000, outputAllowanceTokens: 1024, timeoutMs: 1000 };
const events = (run: Run): HarnessEvent[] => [
    { schemaVersion: 1, id: 'e1', runId: run.id, sequence: 1, type: 'turn_started', timestamp: '2026-01-01T00:00:00.000Z', agentId: 'alpha', data: {} },
    { schemaVersion: 1, id: 'e2', runId: run.id, sequence: 2, type: 'board_post', timestamp: '2026-01-01T00:00:00.000Z', agentId: 'alpha', operationId: 'op-1', data: { call: { name: 'post_board' }, after: { id: 'post-1', text: 'hello' } } },
    { schemaVersion: 1, id: 'e3', runId: run.id, sequence: 3, type: 'report_submitted', timestamp: '2026-01-01T00:00:00.000Z', agentId: 'alpha', data: { raw: '{}' } },
];

function fixture() {
    const run = createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'projection');
    run.board.push({ id: 'post-1', runId: run.id, authorId: 'alpha', sequence: 1, timestamp: '2026-01-01T00:00:00.000Z', text: 'hello' });
    run.reports.push({ agentId: 'alpha', raw: '{}', parsed: {} });
    return run;
}

test('every view has a builder and the table is exhausted', () => {
    assert.deepEqual(Object.keys(MONITOR_VIEW_BUILDERS).sort(), [...MONITOR_VIEWS].sort());
});

test('included and excluded lists are the pre-WS7 literals, in order', () => {
    const run = fixture(), input = events(run), definition = defaultMonitorDefinition();
    const lists = Object.fromEntries(MONITOR_VIEWS.map(view => {
        const projection = buildProjection(run, input, view, definition, settings);
        return [view, { included: projection.included, excluded: projection.excluded }];
    }));
    assert.deepEqual(lists.reports, { included: ['final reports', 'submitted artifact', 'task/policy context'],
        excluded: ['answer keys', 'Jev classifications', 'human labels', 'other monitor outputs', 'audit metadata', 'board content and deliveries', 'tool payloads', 'intermediate artifact contents', 'private memory', 'provider reasoning'] });
    assert.deepEqual(lists.audit, { included: ['final reports', 'submitted artifact', 'task/policy context', 'allowlisted actor/tool/time metadata'],
        excluded: ['answer keys', 'Jev classifications', 'human labels', 'other monitor outputs', 'board content and deliveries', 'tool payloads', 'intermediate artifact contents', 'private memory', 'provider reasoning'] });
    assert.deepEqual(lists.board, { included: ['final reports', 'submitted artifact', 'task/policy context', 'allowlisted actor/tool/time metadata', 'board posts', 'exact board delivery IDs'],
        excluded: ['answer keys', 'Jev classifications', 'human labels', 'other monitor outputs', 'tool payloads', 'intermediate artifact contents', 'private memory', 'provider reasoning'] });
    assert.deepEqual(lists.full, { included: ['final reports', 'submitted artifact', 'task/policy context', 'allowlisted actor/tool/time metadata', 'board posts', 'exact board delivery IDs', 'tool arguments/results', 'assistant outputs', 'artifact history', 'private memory', 'available normalized reasoning'],
        excluded: ['answer keys', 'Jev classifications', 'human labels', 'other monitor outputs'] });
});

test('evidence keys and ids are identical to the ternary implementation', () => {
    const run = fixture(), input = events(run), definition = defaultMonitorDefinition();
    const shape = (view: MonitorView) => {
        const projection = buildProjection(run, input, view, definition, settings);
        return { keys: Object.keys(projection.evidence).sort(), ids: projection.evidenceIds, availability: projection.availability };
    };
    assert.deepEqual(shape('reports').keys, ['context', 'reports', 'submittedArtifact']);
    assert.deepEqual(shape('audit').keys, ['audit', 'context', 'reports', 'submittedArtifact']);
    assert.deepEqual(shape('board').keys, ['audit', 'board', 'context', 'deliveries', 'reports', 'submittedArtifact']);
    assert.deepEqual(shape('full').keys, ['artifactHistory', 'audit', 'board', 'context', 'deliveries', 'reports', 'submittedArtifact', 'trace']);
    assert.deepEqual(shape('full').ids, shape('board').ids);
    assert.deepEqual(shape('reports').ids, ['e3']);
});
