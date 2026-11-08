import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessEvent, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import type { ModelAdapter, ModelInput, ModelResponse } from '@sidechannel/contracts/harness/server';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { EventSink } from './event-recorder.js';
import { InferenceGateway } from './inference-gateway.js';
import { fixtureScenario } from './scenario.js';

class FakeSink implements EventSink {
    readonly emitted: { type: string; data: unknown; extra?: Partial<NewEvent> }[] = [];
    persisted = 0;
    evidenceFailed = false;
    async emit(type: string, data: unknown, extra?: Partial<NewEvent>) { this.emitted.push({ type, data, extra }); return {} as HarnessEvent; }
    async persist() { this.persisted++; }
    types() { return this.emitted.map(entry => entry.type); }
}

const fixtureRun = (): Run => createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'gateway-test');

class CapturingAdapter implements ModelAdapter {
    readonly inputs: ModelInput[] = [];
    constructor(private readonly respond: (input: ModelInput) => Promise<ModelResponse>) { }
    async complete(input: ModelInput) { this.inputs.push(input); return this.respond(input); }
}

const input = (run: Run): ModelInput => ({ runId: run.id, agentId: 'alpha', threadId: 't', resourceId: 'r', invocationId: `${run.id}:turn:1:step:0`, phase: 'action',
    model: run.config.model, messages: [{ role: 'user', content: 'Continue your scheduled turn.' }], tools: fixtureScenario.tools(run.config, run.config.roles[0]!), timeoutMs: 30_000 });

const gateway = (run: Run, adapter: ModelAdapter, sink: FakeSink, checkpoint = async () => { }) =>
    new InferenceGateway({ runId: run.id, run, adapter, recorder: sink, checkpoint, startedAt: Date.now() });

test('context overflow emits context_accounted then context_limit_exceeded and never calls the adapter', async () => {
    const run = fixtureRun();
    run.config.tokenBudget = { version: 1, unit: 'tokens', maxInputTokens: 800, counting: { method: 'utf8-byte-upper-bound', version: '1', scope: 'messages-and-tool-definitions', reservedTokens: 2048 } };
    run.config.model.settings.maxOutputTokens = 4096;
    run.config.memory.maxPrivateNoteCharacters = 4000;
    const sink = new FakeSink();
    const adapter = new CapturingAdapter(async () => ({ text: 'unused', toolCalls: [] }));
    await assert.rejects(gateway(run, adapter, sink).infer({ ...input(run), messages: [{ role: 'user', content: 'x'.repeat(2000) }] }), /action context budget exceeded \(tokens\); no silent trimming/);
    assert.deepEqual(sink.types(), ['context_accounted', 'context_limit_exceeded']);
    assert.equal((sink.emitted[1]!.data as { phase: string }).phase, 'action');
    assert.equal(adapter.inputs.length, 0);
});

test('success emits request, response and usage, and accumulates only finite numeric usage', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const response: ModelResponse = { text: 'done', toolCalls: [], usage: { inputTokens: 5, outputTokens: 2, stale: Number.NaN } };
    const adapter = new CapturingAdapter(async () => response);
    const result = await gateway(run, adapter, sink).infer(input(run));
    assert.equal(result, response);
    assert.deepEqual(sink.types(), ['context_accounted', 'model_requested', 'model_response', 'model_usage']);
    const usage = sink.emitted[3]!.data as { source: string; usage: Record<string, number> | null; provider: string };
    assert.equal(usage.provider, 'scripted');
    assert.equal(usage.source, 'scripted');
    assert.deepEqual(usage.usage, { inputTokens: 5, outputTokens: 2, stale: Number.NaN });
    assert.deepEqual(run.usage, { inputTokens: 5, outputTokens: 2 });
});

test('usage provenance is unavailable without usage and provider-reported for hosted providers', async () => {
    const bare = fixtureRun();
    const bareSink = new FakeSink();
    await gateway(bare, new CapturingAdapter(async () => ({ text: 'done', toolCalls: [] })), bareSink).infer(input(bare));
    assert.equal((bareSink.emitted[3]!.data as { source: string; usage: unknown }).source, 'unavailable');
    assert.equal((bareSink.emitted[3]!.data as { usage: unknown }).usage, null);

    const hosted = fixtureRun();
    hosted.config.model.provider = 'openai';
    const hostedSink = new FakeSink();
    await gateway(hosted, new CapturingAdapter(async () => ({ text: 'done', toolCalls: [], usage: { inputTokens: 1 } })), hostedSink).infer(input(hosted));
    assert.equal((hostedSink.emitted[3]!.data as { source: string }).source, 'provider-reported');
});

test('an unparseable response fails after model_requested and records no response or usage', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const broken = new CapturingAdapter(async () => ({ text: 1, toolCalls: [] }) as unknown as ModelResponse);
    await assert.rejects(gateway(run, broken, sink).infer(input(run)), /Unparseable model response/);
    assert.deepEqual(sink.types(), ['context_accounted', 'model_requested']);
    assert.deepEqual(run.usage, {});
});

test('the request timeout is clamped to the remaining run duration and to at least 1 ms', async () => {
    const run = fixtureRun();
    run.config.limits.maxDurationMs = 1000;
    const adapter = new CapturingAdapter(async () => ({ text: 'done', toolCalls: [] }));
    const startedAt = Date.now() - 900;
    await new InferenceGateway({ runId: run.id, run, adapter, recorder: new FakeSink(), checkpoint: async () => { }, startedAt }).infer({ ...input(run), timeoutMs: 60_000 });
    assert.ok(adapter.inputs[0]!.timeoutMs >= 1 && adapter.inputs[0]!.timeoutMs <= 100, `clamped to ${adapter.inputs[0]!.timeoutMs}`);
});

test('a hung adapter times out, aborts the signal and rejects with Model request timeout', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const adapter = new CapturingAdapter(() => new Promise<ModelResponse>(() => { }));
    await assert.rejects(gateway(run, adapter, sink, async () => { }).infer({ ...input(run), timeoutMs: 10 }), /Model request timeout/);
    assert.equal(adapter.inputs[0]!.signal!.aborted, true);
    assert.deepEqual(sink.types(), ['context_accounted', 'model_requested']);
});

test('a cancelled boundary check emits nothing and never calls the adapter', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const adapter = new CapturingAdapter(async () => ({ text: 'done', toolCalls: [] }));
    await assert.rejects(gateway(run, adapter, sink, async () => { throw new Error('CANCELLED'); }).infer(input(run)), /CANCELLED/);
    assert.deepEqual(sink.types(), []);
    assert.equal(adapter.inputs.length, 0);
});
