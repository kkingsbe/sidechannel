import test from 'node:test';
import assert from 'node:assert/strict';
import { MastraModelAdapter, proposalTools, createMongoMemory } from './mastra-adapter.js';
import type { ModelInput } from './contracts.js';
import { configureExperimentRuntime, closeExperimentRuntime, flushExperimentTraces, experimentTraceStorage, verifyExperimentTrace } from '../mastra/index.js';
test('actual Mastra Agent returns ordered memory and batch proposals without execution or a second step', async () => {
    let requests = 0;
    let received: any;
    const model: any = { specificationVersion: 'v2', provider: 'fixture', modelId: 'scripted-v2', supportedUrls: {},
        doGenerate: async (options: any) => {
            requests++;
            received = options;
            return { content: Array.from({ length: 5 }, (_, i) => ({ type: 'tool-call', toolCallId: `call-${i}`,
                    toolName: i === 0 || i === 3 ? 'update_working_memory' : i === 4 ? 'unknown_tool' : 'end_turn', input: JSON.stringify(i === 0 ? { notes: 'private' } : {}) })),
                warnings: [], finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, request: { body: JSON.stringify(options) } };
        } };
    const input: ModelInput = { runId: 'r', agentId: 'a', threadId: 't', resourceId: 'p', invocationId: 'i', phase: 'action',
        model: { provider: 'fixture', id: 'scripted-v2', settings: {} }, timeoutMs: 10000,
        messages: [{ role: 'user', content: 'Continue.' }], tools: [
            { name: 'update_working_memory', description: 'Update private notes', parameters: { type: 'object', properties: { notes: { type: 'string' } }, required: ['notes'] } },
            { name: 'end_turn', description: 'Yield', parameters: { type: 'object', properties: {} } },
        ] };
    for (const tool of Object.values(proposalTools(input.tools)))
        assert.equal(tool.execute, undefined);
    const result = await new MastraModelAdapter(model).complete(input);
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
    await new MastraModelAdapter(model).complete(followup);
    assert.equal(requests, 2);
    assert.equal(received.prompt.filter((message: any) => message.role === 'tool').flatMap((message: any) => message.content).length, 5);
    assert.match(JSON.stringify(received.prompt), /do not auto apply/);
    assert.deepEqual(received.tools.map((tool: any) => tool.name), ['update_working_memory', 'end_turn']);
    await assert.rejects(new MastraModelAdapter(model).complete({ ...input, model: { ...input.model, settings: { unsupportedControl: true } } }), /Unsupported model setting/);
});
test('native Mastra trace and usage persist through Mongo exporter', { skip: !process.env.TEST_MONGODB_URI }, async () => {
    configureExperimentRuntime(process.env.TEST_MONGODB_URI!, 'sidechannel_adapter_trace_test');
    const model: any = { specificationVersion: 'v2', provider: 'fixture', modelId: 'text-v2', supportedUrls: {},
        doGenerate: async () => ({ content: [{ type: 'text', text: 'fixture response' }], finishReason: 'stop', warnings: [],
            usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } }) };
    try {
        const input: ModelInput = { runId: crypto.randomUUID(), agentId: 'trace-agent', threadId: 'unused', resourceId: 'unused',
            invocationId: crypto.randomUUID(), phase: 'report', model: { provider: 'fixture', id: 'text-v2', settings: {} },
            messages: [{ role: 'user', content: 'Synthetic trace proof' }], tools: [], timeoutMs: 10000 };
        const result = await new MastraModelAdapter(model).complete(input);
        assert.ok(result.trace?.traceId);
        assert.ok(result.trace?.spanId);
        await flushExperimentTraces();
        const store = await experimentTraceStorage!.getStore('observability');
        const trace = await store!.getTrace({ traceId: result.trace!.traceId! });
        assert.ok(trace?.spans.find(span => span.spanId === result.trace!.spanId)?.endedAt);
        assert.ok(trace?.spans.some(span => {
            const usage = span.attributes?.usage as { inputTokens?: number; outputTokens?: number } | undefined;
            return usage?.inputTokens === 4 && usage?.outputTokens === 2;
        }));
        // The scheduler constructs a fresh Agent for every step of the same role.
        // Its stable registration ID must not leave later instances without tracing.
        const second = await new MastraModelAdapter(model).complete({ ...input, invocationId: crypto.randomUUID() });
        assert.ok(second.trace?.traceId);
        assert.notEqual(second.trace?.traceId, result.trace?.traceId);
        const secondTrace = await store!.getTrace({ traceId: second.trace!.traceId! });
        assert.ok(secondTrace?.spans.find(span => span.spanId === second.trace!.spanId)?.endedAt);
        // Simulate a flush that resolves while the backend has no completed trace.
        const getTrace = store!.getTrace.bind(store);
        store!.getTrace = async () => null;
        try {
            await assert.rejects(verifyExperimentTrace(result.trace!.traceId, result.trace!.spanId), /not durably completed/);
        }
        finally {
            store!.getTrace = getTrace;
        }
    }
    finally {
        await closeExperimentRuntime();
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
