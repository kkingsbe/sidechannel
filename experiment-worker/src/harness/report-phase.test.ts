import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessEvent, MemorySnapshot, NewEvent, Run, ToolCall } from '@sidechannel/contracts/harness/contracts';
import type { ModelInput, ModelResponse, PrivateMemory } from '@sidechannel/contracts/harness/server';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { EventSink } from './event-recorder.js';
import type { Inferencer } from './inference-gateway.js';
import { REPORT_RETRY_PROMPT, ReportPhase } from './report-phase.js';
import { fixtureScenario } from './scenario.js';

class FakeSink implements EventSink {
    readonly emitted: { type: string; data: unknown; extra?: Partial<NewEvent> }[] = [];
    persisted = 0;
    evidenceFailed = false;
    async emit(type: string, data: unknown, extra?: Partial<NewEvent>) { this.emitted.push({ type, data, extra }); return {} as HarnessEvent; }
    async persist() { this.persisted++; }
    types() { return this.emitted.map(entry => entry.type); }
    payloads(type: string) { return this.emitted.filter(entry => entry.type === type).map(entry => entry.data as Record<string, unknown>); }
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

const fixtureRun = (mutateConfig?: (config: ReturnType<typeof defaultFixtureConfiguration>) => void): Run => {
    const config = defaultFixtureConfiguration();
    mutateConfig?.(config);
    return createQueuedRun(resolveConfiguration(config), 'report-test');
};

const reportArgs = { ownActions: 'a', observations: 'b', limitations: 'c' };
const submit = (args: unknown = reportArgs, id = 'report'): ModelResponse => ({ text: 'submitted', toolCalls: [{ id, name: 'submit_report', arguments: args }] });
const withReportCalls = (n: number) => (config: ReturnType<typeof defaultFixtureConfiguration>) => { config.limits.reportCalls = n; };

function phase(run: Run, gateway: Inferencer, sink: FakeSink, checkpoint: () => Promise<void> = async () => { }) {
    return new ReportPhase({ runId: run.id, run, scenario: fixtureScenario, memory: new TestMemory(), gateway, recorder: sink, checkpoint });
}

const call = (id: string, name: string, args: unknown = {}): ToolCall => ({ id, name, arguments: args });

test('the artifact freezes before the first report and the run enters reporting', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    await phase(run, new FakeGateway(() => submit()), sink).run();
    const types = sink.types();
    assert.equal(types[0], 'artifact_frozen');
    assert.ok(types.indexOf('artifact_frozen') < types.indexOf('report_submitted'));
    assert.equal(run.artifacts.at(-1)!.frozen, true);
    assert.equal(run.reports.length, 2);
    assert.equal(sink.persisted, 3);
});

test('report prompts expose only submit_report and only the reporting role private memory', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const gateway = new FakeGateway(() => submit());
    await phase(run, gateway, sink).run();
    assert.equal(gateway.inputs.length, 2);
    for (const input of gateway.inputs) {
        assert.equal(input.phase, 'report');
        assert.deepEqual(input.tools.map(tool => tool.name), ['submit_report']);
        assert.match(input.messages[0]!.content, new RegExp(`notes-${input.agentId}`));
        for (const other of run.config.roles.filter(role => role.id !== input.agentId))
            assert.ok(!input.messages[0]!.content.includes(`notes-${other.id}`));
    }
    assert.deepEqual(gateway.inputs.map(input => input.agentId), run.config.roles.map(role => role.id));
});

test('a valid submit_report call is parsed, recorded with its argument JSON and marked valid', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    await phase(run, new FakeGateway(() => submit()), sink).run();
    assert.deepEqual(run.reports.map(report => report.parsed), [reportArgs, reportArgs]);
    assert.ok(run.reports.every(report => report.raw === JSON.stringify(reportArgs)));
    assert.deepEqual(sink.payloads('report_submitted').map(data => data.invalid), [false, false]);
    assert.deepEqual(sink.payloads('tool_result').map(data => data.disposition), ['executed', 'executed']);
    assert.ok(sink.payloads('tool_result').every(data => (data.result as { ok: boolean }).ok === true));
    assert.deepEqual(sink.emitted.filter(entry => entry.type === 'tool_result').map(entry => entry.extra?.invocationId),
        run.config.roles.map(role => `${run.id}:report:${role.id}:0`));
});

test('an invalid submit_report consumes an attempt, records an invalid result and retries', async () => {
    const run = fixtureRun(withReportCalls(2));
    const sink = new FakeSink();
    const gateway = new FakeGateway(input => input.invocationId.endsWith(':0') ? submit({ ...reportArgs, extra: 'x' }) : submit());
    await phase(run, gateway, sink).run();
    assert.equal(gateway.inputs.length, 4);
    assert.deepEqual(run.reports.map(report => report.parsed), [reportArgs, reportArgs]);
    const invalid = sink.emitted.filter(entry => entry.type === 'tool_result' && (entry.data as { disposition: string }).disposition === 'invalid');
    assert.equal(invalid.length, 2);
    const result = (invalid[0]!.data as { result: { ok: boolean; error: string; disposition: string; details: string } }).result;
    assert.deepEqual([result.ok, result.error, result.disposition], [false, 'Invalid report', 'invalid']);
    assert.equal(typeof result.details, 'string');
    const second = gateway.inputs.filter(input => input.invocationId.endsWith(':1'));
    assert.equal(second.length, 2);
    assert.ok(second.every(input => input.messages.some(message => message.role === 'tool' && message.toolName === 'submit_report' && message.content.includes('Invalid report'))));
    assert.ok(sink.payloads('report_submitted').every(data => data.invalid === false));
});

test('exhausting reportCalls falls back to an invalid report built from the last text and asks once more', async () => {
    const run = fixtureRun(withReportCalls(2));
    const sink = new FakeSink();
    const gateway = new FakeGateway(input => ({ text: `no-tool-${input.invocationId}`, toolCalls: [] }));
    await phase(run, gateway, sink).run();
    assert.equal(gateway.inputs.length, 4);
    assert.ok(run.reports.every(report => report.parsed === null && report.raw.startsWith('no-tool-') && report.raw.endsWith(':1')));
    const submitted = sink.payloads('report_submitted');
    assert.equal(submitted.length, 2);
    assert.ok(submitted.every(data => data.invalid === true && data.parsed === null && (data.toolCalls as unknown[]).length === 0));
    assert.ok(gateway.inputs.some(input => input.messages.at(-1)?.content === REPORT_RETRY_PROMPT));
});

test('non-report tools and duplicate submit_report calls are never executed', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const gateway = new FakeGateway(() => ({ text: '', toolCalls: [call('bad', 'post_board', { text: 'never' }), ...submit(undefined, 'first').toolCalls, ...submit(reportArgs, 'again').toolCalls] }));
    await phase(run, gateway, sink).run();
    assert.equal(run.board.length, 0);
    assert.ok(run.reports.every(report => report.parsed !== null));
    const reasons = sink.emitted.filter(entry => entry.type === 'tool_unexecuted').map(entry => (entry.data as { reason: string }).reason);
    assert.equal(reasons.filter(reason => reason === 'reporting_tools_disabled').length, 2);
    assert.equal(reasons.filter(reason => reason === 'duplicate_report').length, 2);
});

test('a checkpoint failure inside the report phase propagates without emitting run_completed', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    let calls = 0;
    await assert.rejects(phase(run, new FakeGateway(() => submit()), sink, async () => { if (++calls > 1) throw new Error('CANCELLED'); }).run(), /CANCELLED/);
    assert.ok(!sink.types().includes('run_completed'));
    assert.equal(run.status, 'reporting');
});

test('report_missing is never emitted here — termination owns it', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    await phase(run, new FakeGateway(() => { throw new Error('Model request timeout'); }), sink).run().catch(() => { });
    assert.ok(!sink.types().includes('report_missing'));
});
