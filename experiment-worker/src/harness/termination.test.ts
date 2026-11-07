import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessEvent, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { EventSink } from './event-recorder.js';
import { RunTermination } from './termination.js';

const fixtureRun = (): Run => createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'termination-test');

/** Narrow fake sink: mirrors EventRecorder's latch-and-rethrow contract. */
class FakeSink implements EventSink {
    readonly emitted: { type: string; data: unknown; extra?: Partial<NewEvent> }[] = [];
    persisted = 0;
    evidenceFailed = false;
    failEmit = false;
    failPersist = false;
    async emit(type: string, data: unknown, extra?: Partial<NewEvent>) {
        if (this.failEmit) { this.evidenceFailed = true; throw new Error('evidence unavailable'); }
        this.emitted.push({ type, data, extra });
        return {} as HarnessEvent;
    }
    async persist() { if (this.failPersist) throw new Error('run store unavailable'); this.persisted++; }
    types() { return this.emitted.map(entry => entry.type); }
}

test('CANCELLED cancels, latched evidence interrupts, anything else fails with its reason', async () => {
    const cancelled = fixtureRun();
    await new RunTermination({ run: cancelled, recorder: new FakeSink() }).terminate(new Error('CANCELLED'));
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.failureReason, 'CANCELLED');

    const interrupted = fixtureRun();
    const latched = new FakeSink();
    latched.evidenceFailed = true;
    await new RunTermination({ run: interrupted, recorder: latched }).terminate(new Error('Evidence unavailable'));
    assert.equal(interrupted.status, 'interrupted');
    assert.equal(latched.emitted.length, 0);

    const failed = fixtureRun();
    await new RunTermination({ run: failed, recorder: new FakeSink() }).terminate(new Error('Run duration cap exceeded'));
    assert.equal(failed.status, 'failed');
    assert.equal(failed.failureReason, 'Run duration cap exceeded');
});

test('missing reports are emitted for unreported roles only, and only from the reporting phase', async () => {
    const run = fixtureRun();
    run.status = 'reporting';
    run.reports.push({ agentId: run.config.roles[0]!.id, raw: '{}', parsed: null });
    const sink = new FakeSink();
    await new RunTermination({ run, recorder: sink }).terminate(new Error('report context budget exceeded'));
    const missing = sink.emitted.filter(entry => entry.type === 'report_missing');
    assert.equal(missing.length, 1);
    assert.equal(missing[0]!.extra?.agentId, run.config.roles[1]!.id);
    assert.deepEqual(missing[0]!.data, { reason: 'report context budget exceeded', phase: 'report' });

    const actionPhase = fixtureRun();
    actionPhase.status = 'running';
    actionPhase.reports.push({ agentId: actionPhase.config.roles[0]!.id, raw: '{}', parsed: null });
    const none = new FakeSink();
    await new RunTermination({ run: actionPhase, recorder: none }).terminate(new Error('Scenario storage unavailable'));
    assert.equal(none.emitted.filter(entry => entry.type === 'report_missing').length, 0);
});

test('an active turn is closed with cancelled/error and every status emits run_terminated', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const termination = new RunTermination({ run, recorder: sink });
    termination.activeTurn = true;
    await termination.terminate(new Error('CANCELLED'));
    assert.deepEqual(sink.types(), ['turn_ended', 'run_terminated']);
    assert.deepEqual(sink.emitted[0]!.data, { reason: 'cancelled', error: 'CANCELLED' });
    assert.deepEqual(sink.emitted[1]!.data, { status: 'cancelled', reason: 'CANCELLED' });

    const idle = fixtureRun();
    const idleSink = new FakeSink();
    await new RunTermination({ run: idle, recorder: idleSink }).terminate(new Error('Scenario storage unavailable'));
    assert.deepEqual(idleSink.types(), ['run_terminated']);
    assert.deepEqual(idleSink.emitted[0]!.data, { status: 'failed', reason: 'Scenario storage unavailable' });
});

test('emission and persistence failures during termination never change the decided status', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    sink.failEmit = true;
    sink.failPersist = true;
    await new RunTermination({ run, recorder: sink }).terminate(new Error('Model request timeout'));
    assert.equal(run.status, 'interrupted');
    assert.equal(run.failureReason, 'Model request timeout');
    assert.equal(run.activeAgentId, undefined);
    assert.equal(sink.persisted, 0);
});
