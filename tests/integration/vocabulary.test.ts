import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_RUN_STATUSES, CANCEL_OVERRIDE_RUN_STATUSES, COMPLETE_RUN_STATUSES, INCOMPLETE_RUN_STATUSES, RUN_STATUSES, TERMINAL_RUN_STATUSES, isTerminalRun } from '@sidechannel/contracts/harness/contracts';
import { EVIDENCE_KEY_COERCION, EVIDENCE_KEY_FIELD, EVIDENCE_KINDS } from '@sidechannel/contracts/harness/repository';
import { ACTIVE_JOB_STATUSES, JOB_STATUSES, RETRYABLE_JOB_STATUSES, isActiveJob } from '@sidechannel/contracts/analysis/jev-repository';
import { ACTIVE_MONITOR_STATUSES, MONITOR_EVALUATION_STATUSES, MONITOR_VIEW_STATUSES } from '@sidechannel/contracts/oversight/contracts';

// The contracts package is browser-portable and the WS0 `workspace/imports` rule forbids Node
// built-ins there, so the closed-vocabulary exhaustiveness tests live in the integration suite
// (they only assert table shape; no runtime service is involved).

test('active and terminal run statuses partition the union', () => {
    assert.deepEqual([...ACTIVE_RUN_STATUSES, ...TERMINAL_RUN_STATUSES].sort(), [...RUN_STATUSES].sort());
    assert.equal(new Set([...ACTIVE_RUN_STATUSES, ...TERMINAL_RUN_STATUSES]).size, RUN_STATUSES.length);
    for (const status of RUN_STATUSES) assert.equal(isTerminalRun(status), !ACTIVE_RUN_STATUSES.includes(status), status);
});

test('complete and incomplete run statuses partition the terminal set', () => {
    assert.deepEqual([...COMPLETE_RUN_STATUSES, ...INCOMPLETE_RUN_STATUSES].sort(), [...TERMINAL_RUN_STATUSES].sort());
});

test('the cancel-override set stays the historical literal', () => {
    assert.deepEqual([...CANCEL_OVERRIDE_RUN_STATUSES], ['queued', 'running', 'reporting', 'completed']);
});

test('active and retryable job statuses partition the job vocabulary', () => {
    assert.deepEqual([...ACTIVE_JOB_STATUSES, ...RETRYABLE_JOB_STATUSES].sort(), [...JOB_STATUSES].sort());
    for (const status of JOB_STATUSES) assert.equal(isActiveJob(status), ACTIVE_JOB_STATUSES.includes(status), status);
});

test('active monitor statuses are a strict subset of the evaluation vocabulary', () => {
    assert.equal(new Set([...ACTIVE_MONITOR_STATUSES, 'completed', 'partial', 'failed', 'cancelled']).size, MONITOR_EVALUATION_STATUSES.length);
    for (const status of ACTIVE_MONITOR_STATUSES) assert.ok(MONITOR_EVALUATION_STATUSES.includes(status), status);
    assert.equal(new Set(MONITOR_VIEW_STATUSES).size, MONITOR_VIEW_STATUSES.length);
});

test('every evidence kind has exactly one key field and one coercion', () => {
    assert.deepEqual(Object.keys(EVIDENCE_KEY_FIELD).sort(), [...EVIDENCE_KINDS].sort());
    assert.deepEqual(Object.keys(EVIDENCE_KEY_COERCION).sort(), [...EVIDENCE_KINDS].sort());
    assert.deepEqual(EVIDENCE_KEY_FIELD, { board: 'id', artifacts: 'version', reports: 'agentId' });
    assert.equal(EVIDENCE_KEY_COERCION.artifacts('7'), 7);
    assert.equal(EVIDENCE_KEY_COERCION.board('post-1'), 'post-1');
});
