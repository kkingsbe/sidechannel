import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessEvent, MemorySnapshot, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import type { ModelInput, ModelResponse, PrivateMemory } from '@sidechannel/contracts/harness/server';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { EventSink } from './event-recorder.js';
import type { Inferencer } from './inference-gateway.js';
import { ReportPhase } from './report-phase.js';
import { fixtureScenario } from './scenario.js';

class FakeSink implements EventSink {
    readonly emitted: { type: string; data: unknown; extra?: Partial<NewEvent> }[] = [];
    persisted = 0;
    evidenceFailed = false;
    async emit(type: string, data: unknown, extra?: Partial<NewEvent>) { this.emitted.push({ type, data, extra }); return {} as HarnessEvent; }
    async persist() { this.persisted++; }
    types() { return this.emitted.map(entry => entry.type); }
}

class TestMemory implements PrivateMemory {
    values = new Map<string, MemorySnapshot>();
    async load(runId: string, agentId: string) { return structuredClone(this.values.get(`${runId}/${agentId}`) ?? { version: 0, notes: `notes-${agentId}`, messages: [] }); }
    async save(runId: string, agentId: string, value: MemorySnapshot) { this.values.set(`${runId}/${agentId}`, structuredClone(value)); }
}

class FakeGateway implements Inferencer {
    readonly inputs: ModelInput[] = [];
    constructor(private readonly respond: (input: ModelInput) => ModelResponse) { }
    async infer(input: ModelInput) { this.inputs.push(input); return this.respond(input); }
}

const fixtureRun = (): Run => createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'report-test');

function phase(run: Run, gateway: Inferencer, sink: FakeSink, checkpoint: () => Promise<void> = async () => { }) {
    return new ReportPhase({ runId: run.id, run, scenario: fixtureScenario, memory: new TestMemory(), gateway, recorder: sink, checkpoint });
}

const validReport = (input: ModelInput) => ({ text: JSON.stringify({ ownActions: `did-${input.agentId}`, observations: 'seen', limitations: 'none' }), toolCalls: [] });

test('the artifact freezes before the first report and the run enters reporting', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    await phase(run, new FakeGateway(validReport), sink).run();
    const types = sink.types();
    assert.equal(types[0], 'artifact_frozen');
    assert.ok(types.indexOf('artifact_frozen') < types.indexOf('report_submitted'));
    assert.equal(run.artifacts.at(-1)!.frozen, true);
    assert.equal(run.reports.length, 2);
    assert.equal(sink.persisted, 3);
});

test('report prompts send no tools and use only the reporting role private memory', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const gateway = new FakeGateway(validReport);
    await phase(run, gateway, sink).run();
    assert.equal(gateway.inputs.length, 2);
    for (const input of gateway.inputs) {
        assert.equal(input.phase, 'report');
        assert.deepEqual(input.tools, []);
        assert.match(input.messages[0]!.content, new RegExp(`notes-${input.agentId}`));
        assert.ok(!input.messages[0]!.content.includes('did-'));
    }
    assert.deepEqual(gateway.inputs.map(input => input.agentId), run.config.roles.map(role => role.id));
});

test('a valid three-string report is parsed and marked valid', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    await phase(run, new FakeGateway(validReport), sink).run();
    assert.deepEqual(run.reports.map(report => report.parsed === null), [false, false]);
    assert.deepEqual(sink.emitted.filter(entry => entry.type === 'report_submitted').map(entry => (entry.data as { invalid: boolean }).invalid), [false, false]);
});

test('invalid reports keep the raw text and are recorded as invalid, never repaired', async () => {
    const cases = [
        'not json',
        JSON.stringify({ ownActions: 'a', observations: 'b' }),
        JSON.stringify({ ownActions: 'a', observations: 'b', limitations: 'c', extra: 'd' }),
        JSON.stringify({ ownActions: 1, observations: 'b', limitations: 'c' }),
        JSON.stringify(['a', 'b', 'c']),
        'null',
    ];
    for (const text of cases) {
        const run = fixtureRun();
        const sink = new FakeSink();
        await phase(run, new FakeGateway(() => ({ text, toolCalls: [] })), sink).run();
        assert.deepEqual(run.reports.map(report => report.parsed), [null, null]);
        assert.ok(run.reports.every(report => report.raw === text));
    }
});

test('reporting tool proposals are recorded and never executed', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const gateway = new FakeGateway(input => ({ text: JSON.stringify({ ownActions: 'a', observations: 'b', limitations: 'c' }), toolCalls: [{ id: 'forbidden', name: 'post_board', arguments: { text: 'never' } }] }));
    await phase(run, gateway, sink).run();
    assert.equal(run.board.length, 0);
    const requested = sink.emitted.filter(entry => entry.type === 'tool_requested');
    const unexecuted = sink.emitted.filter(entry => entry.type === 'tool_unexecuted');
    assert.equal(requested.length, 2);
    assert.equal(unexecuted.length, 2);
    assert.deepEqual(requested[0]!.data, { call: { id: 'forbidden', name: 'post_board', arguments: { text: 'never' } }, index: 0, phase: 'report' });
    assert.deepEqual(unexecuted[0]!.data, { call: { id: 'forbidden', name: 'post_board', arguments: { text: 'never' } }, reason: 'reporting_tools_disabled', phase: 'report' });
    assert.equal(unexecuted[0]!.extra!.operationId, `${run.id}:report:${run.config.roles[0]!.id}:0:call:forbidden`);
});

test('a checkpoint failure inside the report phase propagates without emitting run_completed', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    let calls = 0;
    await assert.rejects(phase(run, new FakeGateway(validReport), sink, async () => { if (++calls > 1) throw new Error('CANCELLED'); }).run(), /CANCELLED/);
    assert.ok(!sink.types().includes('run_completed'));
    assert.equal(run.status, 'reporting');
});

test('report_missing is never emitted here — termination owns it', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    await phase(run, new FakeGateway(() => { throw new Error('Model request timeout'); }), sink).run().catch(() => { });
    assert.ok(!sink.types().includes('report_missing'));
});
