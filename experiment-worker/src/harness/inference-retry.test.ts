import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HarnessEvent, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import type { ModelAdapter, ModelInput, ModelResponse } from '@sidechannel/contracts/harness/server';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { EventSink } from './event-recorder.js';
import { InferenceGateway } from './inference-gateway.js';
import { DEFAULT_RETRY_POLICY, inferenceRetryPolicy, retryDelayMs, transientModelFailure, type RetryPolicy } from './inference-retry.js';
import { fixtureScenario } from './scenario.js';

class FakeSink implements EventSink {
    readonly emitted: { type: string; data: unknown; extra?: Partial<NewEvent> }[] = [];
    evidenceFailed = false;
    constructor(private readonly failOn?: { type: string; error: unknown }) { }
    async emit(type: string, data: unknown, extra?: Partial<NewEvent>) {
        if (this.failOn?.type === type) throw this.failOn.error;
        this.emitted.push({ type, data, extra });
        return {} as HarnessEvent;
    }
    async persist() { }
    types() { return this.emitted.map(entry => entry.type); }
}

/** An AI SDK `APICallError`-shaped failure. */
const apiError = (statusCode: number, headers: Record<string, string> = {}) =>
    Object.assign(new Error(`HTTP ${statusCode} from provider`), { name: 'AI_APICallError', statusCode, responseHeaders: headers, isRetryable: statusCode === 429 || statusCode >= 500 });

class SequenceAdapter implements ModelAdapter {
    calls = 0;
    constructor(private readonly outcomes: (ModelResponse | Error)[]) { }
    async complete(_input: ModelInput) {
        const outcome = this.outcomes[Math.min(this.calls++, this.outcomes.length - 1)]!;
        if (outcome instanceof Error) throw outcome;
        return outcome;
    }
}

const ok: ModelResponse = { text: 'done', toolCalls: [] };
const fixtureRun = (): Run => createQueuedRun(resolveConfiguration(defaultFixtureConfiguration()), 'retry-test');
const input = (run: Run): ModelInput => ({ runId: run.id, agentId: 'alpha', threadId: 't', resourceId: 'r', invocationId: `${run.id}:turn:1:step:0`, phase: 'action',
    model: run.config.model, messages: [{ role: 'user', content: 'Continue your scheduled turn.' }], tools: fixtureScenario.tools(run.config, run.config.roles[0]!), timeoutMs: 30_000 });

function policy(maxAttempts = 5): RetryPolicy & { slept: number[] } {
    const slept: number[] = [];
    return { ...DEFAULT_RETRY_POLICY, maxAttempts, random: () => 0, slept, sleep: async ms => { slept.push(ms); } };
}

const gateway = (run: Run, adapter: ModelAdapter, sink: EventSink, retry: RetryPolicy, options: { checkpoint?: () => Promise<void>; startedAt?: number } = {}) =>
    new InferenceGateway({ runId: run.id, run, adapter, recorder: sink, checkpoint: options.checkpoint ?? (async () => { }), startedAt: options.startedAt ?? Date.now(), retry });

test('a rate-limited request is logged as model_retry, waits at least Retry-After and then succeeds', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const retry = policy();
    const adapter = new SequenceAdapter([apiError(429, { 'retry-after': '7' }), apiError(503), ok]);
    assert.equal(await gateway(run, adapter, sink, retry).infer(input(run)), ok);
    assert.equal(adapter.calls, 3);
    assert.deepEqual(sink.types(), ['context_accounted', 'model_requested', 'model_retry', 'model_retry', 'model_response', 'model_usage']);
    const [first, second] = sink.emitted.filter(entry => entry.type === 'model_retry');
    assert.deepEqual(first!.data, { phase: 'action', provider: 'scripted', attempt: 1, nextAttempt: 2, maxAttempts: 5, delayMs: 7_000, reason: 'HTTP 429 from provider', statusCode: 429, retryAfterMs: 7_000 });
    assert.equal(first!.extra?.invocationId, `${run.id}:turn:1:step:0`);
    assert.equal((second!.data as { delayMs: number }).delayMs, 4_000, 'exponential backoff on the second attempt');
    assert.deepEqual(retry.slept, [7_000, 4_000]);
});

test('retries stop at maxAttempts and the original provider error is thrown', async () => {
    const run = fixtureRun();
    const sink = new FakeSink();
    const error = apiError(429);
    const adapter = new SequenceAdapter([error]);
    await assert.rejects(gateway(run, adapter, sink, policy(3)).infer(input(run)), thrown => thrown === error);
    assert.equal(adapter.calls, 3);
    assert.equal(sink.types().filter(type => type === 'model_retry').length, 2);
});

test('request errors, the run timeout and malformed responses are never retried', async () => {
    for (const failure of [apiError(400), apiError(401), apiError(422)]) {
        const run = fixtureRun();
        const adapter = new SequenceAdapter([failure, ok]);
        await assert.rejects(gateway(run, adapter, new FakeSink(), policy()).infer(input(run)), /HTTP 4/);
        assert.equal(adapter.calls, 1);
    }
    const run = fixtureRun();
    const hung: ModelAdapter = { complete: () => new Promise(() => { }) };
    const sink = new FakeSink();
    await assert.rejects(gateway(run, hung, sink, policy()).infer({ ...input(run), timeoutMs: 10 }), /Model request timeout/);
    assert.ok(!sink.types().includes('model_retry'));
    const malformed = new SequenceAdapter([{ text: 1, toolCalls: [] } as unknown as ModelResponse, ok]);
    await assert.rejects(gateway(fixtureRun(), malformed, new FakeSink(), policy()).infer(input(fixtureRun())), /Unparseable/);
    assert.equal(malformed.calls, 1);
});

test('an evidence-store failure after the response is never mistaken for a provider failure', async () => {
    const run = fixtureRun();
    const storeDown = Object.assign(new Error('connection reset'), { cause: Object.assign(new Error('socket'), { code: 'ECONNRESET' }) });
    const sink = new FakeSink({ type: 'model_response', error: storeDown });
    const adapter = new SequenceAdapter([ok]);
    await assert.rejects(gateway(run, adapter, sink, policy()).infer(input(run)), thrown => thrown === storeDown);
    assert.equal(adapter.calls, 1, 'the model is not called again');
});

test('a retry that would overrun the run duration cap is not attempted, and cancellation stops retrying', async () => {
    const run = fixtureRun();
    run.config.limits.maxDurationMs = 5_000;
    const adapter = new SequenceAdapter([apiError(429, { 'retry-after': '30' }), ok]);
    await assert.rejects(gateway(run, adapter, new FakeSink(), policy()).infer(input(run)), /HTTP 429/);
    assert.equal(adapter.calls, 1);

    const cancelled = fixtureRun();
    let checks = 0;
    const checkpoint = async () => { if (++checks > 1) throw new Error('CANCELLED'); };
    const again = new SequenceAdapter([apiError(503), ok]);
    const sink = new FakeSink();
    await assert.rejects(gateway(cancelled, again, sink, policy(), { checkpoint }).infer(input(cancelled)), /CANCELLED/);
    assert.equal(again.calls, 1, 'the checkpoint after the wait stops the retry');
    assert.deepEqual(sink.types(), ['context_accounted', 'model_requested', 'model_retry']);
});

test('transient classification follows wrapped errors and network codes but not aborts', () => {
    assert.equal(transientModelFailure(Object.assign(new Error('retries exhausted'), { name: 'AI_RetryError', lastError: apiError(502) }))?.statusCode, 502);
    assert.equal(transientModelFailure(Object.assign(new Error('wrapped'), { cause: apiError(529) }))?.statusCode, 529);
    assert.match(transientModelFailure(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) }))!.reason, /UND_ERR_SOCKET/);
    assert.equal(transientModelFailure(new TypeError('fetch failed'))?.reason, 'fetch failed');
    assert.equal(transientModelFailure(Object.assign(new Error('aborted'), { name: 'AbortError' })), undefined);
    assert.equal(transientModelFailure(new Error('Model request timeout')), undefined);
    assert.equal(transientModelFailure(apiError(404)), undefined);
    assert.equal(transientModelFailure('string failure'), undefined);
    assert.equal(transientModelFailure(apiError(429, { 'retry-after-ms': '1500' }))?.retryAfterMs, 1_500);
    const future = new Date(Date.now() + 10_000).toUTCString();
    assert.ok((transientModelFailure(apiError(429, { 'retry-after': future }))?.retryAfterMs ?? 0) > 8_000);
});

test('backoff doubles with bounded jitter and caps at the maximum delay', () => {
    const fixed = { ...DEFAULT_RETRY_POLICY, random: () => 0 };
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(attempt => retryDelayMs(fixed, attempt)), [2_000, 4_000, 8_000, 16_000, 32_000, 60_000]);
    assert.equal(retryDelayMs({ ...DEFAULT_RETRY_POLICY, random: () => 0.999 }, 1), 2_500);
    assert.equal(retryDelayMs(fixed, 1, 90_000), 60_000, 'Retry-After is capped at the maximum delay');
});

test('INFERENCE_MAX_ATTEMPTS defaults to five and rejects values outside 1-10', () => {
    assert.equal(inferenceRetryPolicy({}).maxAttempts, 5);
    assert.equal(inferenceRetryPolicy({ INFERENCE_MAX_ATTEMPTS: '1' }).maxAttempts, 1);
    for (const bad of ['0', '11', '1.5', 'x'])
        assert.throws(() => inferenceRetryPolicy({ INFERENCE_MAX_ATTEMPTS: bad }), /INFERENCE_MAX_ATTEMPTS/);
});
