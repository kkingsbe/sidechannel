import test from 'node:test';
import assert from 'node:assert/strict';
import { MastraModelAdapter, proposalTools, createMongoMemory } from './mastra-adapter.js';
import type { ModelInput } from '@sidechannel/contracts/harness/server';
import { openTraceRuntime, NO_TRACE_RUNTIME } from '../mastra/index.js';

/** The adapter streams, so scripted models express their result as doStream chunks (derived from a generate-style result). */
function streamed(generate: (options: any) => Promise<any> | any) {
    return async (options: any) => {
        const result = await generate(options);
        const chunks: any[] = [{ type: 'stream-start', warnings: result.warnings ?? [] }];
        for (const part of result.content) {
            if (part.type === 'text')
                chunks.push({ type: 'text-start', id: 'text-0' }, { type: 'text-delta', id: 'text-0', delta: part.text }, { type: 'text-end', id: 'text-0' });
            else
                chunks.push(part);
        }
        chunks.push({ type: 'finish', finishReason: result.finishReason, usage: result.usage });
        return { request: result.request, stream: new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } }) };
    };
}

test('actual Mastra Agent returns ordered memory and batch proposals without execution or a second step', async () => {
    let requests = 0;
    let received: any;
    const model: any = { specificationVersion: 'v2', provider: 'fixture', modelId: 'scripted-v2', supportedUrls: {},
        doStream: streamed(async (options: any) => {
            requests++;
            received = options;
            return { content: Array.from({ length: 5 }, (_, i) => ({ type: 'tool-call', toolCallId: `call-${i}`,
                    toolName: i === 0 || i === 3 ? 'update_working_memory' : i === 4 ? 'unknown_tool' : 'end_turn', input: JSON.stringify(i === 0 ? { notes: 'private' } : {}) })),
                warnings: [], finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, request: { body: JSON.stringify(options) } };
        }) };
    const input: ModelInput = { runId: 'r', agentId: 'a', threadId: 't', resourceId: 'p', invocationId: 'i', phase: 'action',
        model: { provider: 'fixture', id: 'scripted-v2', settings: {} }, timeoutMs: 10000,
        messages: [{ role: 'user', content: 'Continue.' }], tools: [
            { name: 'update_working_memory', description: 'Update private notes', parameters: { type: 'object', properties: { notes: { type: 'string' } }, required: ['notes'] } },
            { name: 'end_turn', description: 'Yield', parameters: { type: 'object', properties: {} } },
        ] };
    for (const tool of Object.values(proposalTools(input.tools)))
        assert.equal(tool.execute, undefined);
    const result = await new MastraModelAdapter(NO_TRACE_RUNTIME, model).complete(input);
    assert.equal(requests, 1);
    assert.deepEqual(result.toolCalls.map(call => call.id), ['call-0', 'call-1', 'call-2', 'call-3', 'call-4']);
    assert.equal(result.toolCalls[0].name, 'update_working_memory');
    assert.deepEqual(result.toolCalls[3].arguments, {}); // identifiable invalid arguments remain chargeable
    assert.equal(result.toolCalls[4].name, 'unknown_tool');
    assert.equal(result.usage?.totalTokens, 30);
    assert.deepEqual(received.tools.map((tool: any) => tool.name), ['update_working_memory', 'end_turn']);
    assert.ok(result.raw);
    const followup = { ...input, invocationId: 'followup', messages: [
            ...input.messages,
            { role: 'assistant' as const, content: '<working_memory>do not auto apply</working_memory>', toolCalls: result.toolCalls },
            ...result.toolCalls.map(call => ({ role: 'tool' as const, content: JSON.stringify({ ok: false, reason: 'unexecuted fixture' }), toolCallId: call.id, toolName: call.name })),
            { role: 'user' as const, content: 'Continue.' },
        ] };
    await new MastraModelAdapter(NO_TRACE_RUNTIME, model).complete(followup);
    assert.equal(requests, 2);
    assert.equal(received.prompt.filter((message: any) => message.role === 'tool').flatMap((message: any) => message.content).length, 5);
    assert.match(JSON.stringify(received.prompt), /do not auto apply/);
    assert.deepEqual(received.tools.map((tool: any) => tool.name), ['update_working_memory', 'end_turn']);
    await assert.rejects(new MastraModelAdapter(NO_TRACE_RUNTIME, model).complete({ ...input, model: { ...input.model, settings: { unsupportedControl: true } } }), /Unsupported model setting/);
});

test('native Mastra trace and usage persist through Mongo exporter', { skip: !process.env.TEST_MONGODB_URI }, async () => {
    const trace = openTraceRuntime(process.env.TEST_MONGODB_URI!, 'sidechannel_adapter_trace_test');
    const model: any = { specificationVersion: 'v2', provider: 'fixture', modelId: 'text-v2', supportedUrls: {},
        doStream: streamed(async () => ({ content: [{ type: 'text', text: 'fixture response' }], finishReason: 'stop', warnings: [],
            usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } })) };
    try {
        const input: ModelInput = { runId: crypto.randomUUID(), agentId: 'trace-agent', threadId: 'unused', resourceId: 'unused',
            invocationId: crypto.randomUUID(), phase: 'report', model: { provider: 'fixture', id: 'text-v2', settings: {} },
            messages: [{ role: 'user', content: 'Synthetic trace proof' }], tools: [], timeoutMs: 10000 };
        const result = await new MastraModelAdapter(trace, model).complete(input);
        assert.ok(result.trace?.traceId);
        assert.ok(result.trace?.spanId);
        await trace.flush();
        const store = await trace.storage.getStore('observability');
        const storedTrace = await store!.getTrace({ traceId: result.trace!.traceId! });
        assert.ok(storedTrace?.spans.find(span => span.spanId === result.trace!.spanId)?.endedAt);
        assert.ok(storedTrace?.spans.some(span => {
            const usage = span.attributes?.usage as { inputTokens?: number; outputTokens?: number } | undefined;
            return usage?.inputTokens === 4 && usage?.outputTokens === 2;
        }));
        // The scheduler constructs a fresh Agent for every step of the same role.
        // Its stable registration ID must not leave later instances without tracing.
        const second = await new MastraModelAdapter(trace, model).complete({ ...input, invocationId: crypto.randomUUID() });
        assert.ok(second.trace?.traceId);
        assert.notEqual(second.trace?.traceId, result.trace?.traceId);
        const secondTrace = await store!.getTrace({ traceId: second.trace!.traceId! });
        assert.ok(secondTrace?.spans.find(span => span.spanId === second.trace!.spanId)?.endedAt);
        // Simulate a flush that resolves while the backend has no completed trace.
        const getTrace = store!.getTrace.bind(store);
        store!.getTrace = async () => null;
        try {
            await assert.rejects(trace.verify(result.trace!.traceId, result.trace!.spanId), /not durably completed/);
        }
        finally {
            store!.getTrace = getTrace;
        }
    }
    finally {
        await trace.close();
    }
});

test('Mongo Mastra Memory round-trips notes and lossless history across fresh adapter instances', { skip: !process.env.TEST_MONGODB_URI }, async () => {
    const run = `adapter-${crypto.randomUUID()}`;
    const first = createMongoMemory(process.env.TEST_MONGODB_URI!, 'sidechannel_adapter_test');
    const snapshot = { version: 1, notes: 'private notes', messages: [
            { role: 'system' as const, content: 'policy' },
            { role: 'user' as const, content: '<working_memory>literal text</working_memory>' },
            { role: 'assistant' as const, content: '', toolCalls: [{ id: 'memory-call', name: 'update_working_memory', arguments: { notes: 'private notes' } }] },
            { role: 'tool' as const, toolCallId: 'memory-call', toolName: 'update_working_memory', content: '{"ok":true}' },
        ] };
    try {
        await first.save(run, 'a', snapshot);
        await first.save(run, 'a', snapshot);
    }
    finally {
        await first.storage.close();
    }
    const second = createMongoMemory(process.env.TEST_MONGODB_URI!, 'sidechannel_adapter_test');
    try {
        assert.deepEqual(await second.load(run, 'a'), snapshot);
        assert.equal((await second.load(run, 'b')).version, 0);
        assert.equal((await second.load(`${run}-fresh`, 'a')).version, 0);
    }
    finally {
        await second.storage.close();
    }
});

/** Scripted AI SDK v2 model whose only transport is doStream; doGenerate fails loudly so non-streamed use is caught. */
function streamModel(parts: (() => any[]) | Error) {
    const calls = { stream: 0, generate: 0 };
    const model: any = { specificationVersion: 'v2', provider: 'fixture', modelId: 'stream-v2', supportedUrls: {},
        doGenerate: async () => { calls.generate++; throw new Error('doGenerate must not be called'); },
        doStream: async (options: any) => {
            calls.stream++;
            if (parts instanceof Error)
                throw parts;
            const chunks = parts();
            return { request: { body: JSON.stringify(options) }, stream: new ReadableStream({
                    start(controller) {
                        for (const chunk of chunks)
                            controller.enqueue(chunk);
                        controller.close();
                    } }) };
        } };
    return { model, calls };
}
const streamInput: ModelInput = { runId: 'r', agentId: 'a', threadId: 't', resourceId: 'p', invocationId: 'i', phase: 'action',
    model: { provider: 'fixture', id: 'stream-v2', settings: {} }, timeoutMs: 10000,
    messages: [{ role: 'user', content: 'Continue.' }], tools: [{ name: 'end_turn', description: 'Yield', parameters: { type: 'object', properties: {} } }] };

test('adapter streams the model call: doStream is used, doGenerate never, and the response is assembled from chunks', async () => {
    const { model, calls } = streamModel(() => [
        { type: 'stream-start', warnings: [] }, { type: 'response-metadata', id: 'resp', modelId: 'stream-v2', timestamp: new Date(0) },
        { type: 'text-start', id: 't1' }, { type: 'text-delta', id: 't1', delta: 'Hel' }, { type: 'text-delta', id: 't1', delta: 'lo' }, { type: 'text-end', id: 't1' },
        { type: 'tool-call', toolCallId: 'call-1', toolName: 'end_turn', input: '{}' },
        { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 } },
    ]);
    const result = await new MastraModelAdapter(NO_TRACE_RUNTIME, model).complete(streamInput);
    assert.equal(calls.stream, 1);
    assert.equal(calls.generate, 0);
    assert.equal(result.text, 'Hello');
    assert.deepEqual(result.toolCalls, [{ id: 'call-1', name: 'end_turn', arguments: {} }]);
    assert.equal(result.usage?.totalTokens, 7);
    assert.equal(result.trace?.runId, 'i');
    assert.equal((result.raw as any).finishReason, 'tool-calls');
});

test('adapter rejects when the stream errors or the model request fails, instead of returning an empty response', async () => {
    const midStream = streamModel(() => [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'partial' }, { type: 'error', error: new Error('upstream stream failed') }]);
    await assert.rejects(new MastraModelAdapter(NO_TRACE_RUNTIME, midStream.model).complete(streamInput), /upstream stream failed/);
    const failedRequest = streamModel(new Error('Gateway Time-out'));
    await assert.rejects(new MastraModelAdapter(NO_TRACE_RUNTIME, failedRequest.model).complete(streamInput), /Gateway Time-out/);
});

test('adapter rejects when the caller aborts or the timeout elapses mid-stream', async () => {
    const hanging: any = { specificationVersion: 'v2', provider: 'fixture', modelId: 'hang-v2', supportedUrls: {},
        doStream: async (options: any) => ({ stream: new ReadableStream({
                start(controller) {
                    controller.enqueue({ type: 'stream-start', warnings: [] });
                    options.abortSignal?.addEventListener('abort', () => controller.error(options.abortSignal.reason));
                } }) }) };
    const controller = new AbortController();
    const pending = new MastraModelAdapter(NO_TRACE_RUNTIME, hanging).complete({ ...streamInput, signal: controller.signal });
    setTimeout(() => controller.abort(new Error('caller aborted')), 50);
    await assert.rejects(pending);
    await assert.rejects(new MastraModelAdapter(NO_TRACE_RUNTIME, hanging).complete({ ...streamInput, timeoutMs: 50 }));
});
