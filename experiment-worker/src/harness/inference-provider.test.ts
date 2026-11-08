import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInferenceProvider } from './inference-provider.js';
import { MastraModelAdapter, modelMessages } from './mastra-adapter.js';
import type { ModelInput } from '@sidechannel/contracts/harness/server';
import type { Json } from '@sidechannel/contracts/harness/contracts';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { defaultTokenBudget } from '@sidechannel/domain/harness/token-budget';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { HarnessScheduler } from './scheduler.js';

/** Replays a completed Responses API JSON body as the SSE stream the adapter now requests (stream: true). */
function sseResponse(body: any): Response {
    const events: any[] = [{ type: 'response.created', response: { id: body.id, created_at: body.created_at, model: body.model } }];
    body.output.forEach((item: any, output_index: number) => {
        if (item.type === 'function_call') {
            events.push({ type: 'response.output_item.added', output_index, item: { ...item, arguments: '' } },
                { type: 'response.function_call_arguments.delta', item_id: item.id, output_index, delta: item.arguments });
        }
        else {
            events.push({ type: 'response.output_item.added', output_index, item: { ...item, content: [] } },
                ...item.content.map((part: any) => ({ type: 'response.output_text.delta', item_id: item.id, output_index, content_index: 0, delta: part.text })));
        }
        events.push({ type: 'response.output_item.done', output_index, item });
    });
    events.push({ type: 'response.completed', response: { ...body, incomplete_details: body.incomplete_details } });
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
}

test('Adaption rejects absent credentials, stack IDs and unverified controls', () => {
    const model = { provider: 'adaption', id: 'gemma-4-31b-it', settings: {} };
    assert.throws(() => resolveInferenceProvider(model, {}), /Missing ADAPTION_API_KEY/);
    assert.throws(() => resolveInferenceProvider({ ...model, id: 'stack:shared' }, {}), /direct hosted model/);
    const unsupported: Record<string, Json>[] = [{ seed: 42 }, { providerOptions: { openai: { store: true } } }];
    for (const settings of unsupported)
        assert.throws(() => resolveInferenceProvider({ ...model, settings }, {}), /Unsupported Adaption model setting/);
    const other = { provider: 'openai', id: 'existing-model', settings: { providerOptions: { openai: { store: false } } } };
    assert.deepEqual(resolveInferenceProvider(other, {}), { model: 'openai/existing-model', providerOptions: other.settings.providerOptions });
});

test('token scheduler sends complete Adaption action/report payload and persists provider usage without paid inference', async t => {
    const previous = process.env.ADAPTION_API_KEY;
    process.env.ADAPTION_API_KEY = 'synthetic-token-key';
    t.after(() => { if (previous === undefined) delete process.env.ADAPTION_API_KEY; else process.env.ADAPTION_API_KEY = previous; });
    const requests: any[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => {
        const body = JSON.parse(options.body);
        requests.push(body);
        return sseResponse({ id: `resp_${requests.length}`, object: 'response', created_at: 1, status: 'completed', model: body.model, error: null, incomplete_details: null,
            output: requests.length === 1 ? [{ type: 'function_call', id: 'fc_read', call_id: 'read_call', name: 'read_role_data', arguments: '{}', status: 'completed' }]
                : requests.length === 3 ? [{ type: 'function_call', id: 'fc_report', call_id: 'report_call', name: 'submit_report', arguments: '{"ownActions":"read","observations":"blue","limitations":"mock"}', status: 'completed' }]
                : [{ type: 'message', id: `msg_${requests.length}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Done', annotations: [] }] }],
            usage: { input_tokens: 9500, output_tokens: 20, total_tokens: 9520, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
    });
    const config = defaultFixtureConfiguration();
    config.model = { provider: 'adaption', id: 'gemma-4-31b-it', settings: { maxOutputTokens: 4096, temperature: 0 } };
    config.tokenBudget = defaultTokenBudget(config.model.id);
    config.memory.maxPrivateNoteCharacters = 4000;
    config.roles = [config.roles[0]!];
    config.roles[0]!.instructions += ' task-padding '.repeat(3000);
    config.scheduler.rounds = 1;
    const repo = new InMemoryRepository();
    const run = createQueuedRun(resolveConfiguration(config), 'mock-token-transport');
    await repo.createRun(run);
    let snapshot = { version: 0, notes: 'private-note-marker', messages: [] as ModelInput['messages'] };
    const memory = { load: async () => structuredClone(snapshot), save: async (_r: string, _a: string, value: typeof snapshot) => { snapshot = structuredClone(value); } };
    const result = await new HarnessScheduler({ runState: repo, events: repo, memory, adapter: new MastraModelAdapter() }).run(run.id);
    assert.equal(result.status, 'completed', result.failureReason ?? '');
    assert.equal(requests.length, 3);
    for (const request of requests) {
        assert.equal(request.max_output_tokens, 4096);
        assert.equal(request.store, false);
        assert.equal(request.previous_response_id, undefined);
        assert.match(JSON.stringify(request.input), /private-note-marker/);
        assert.ok(JSON.stringify(request.input).length > 32000);
    }
    assert.ok(requests[0].tools.some((tool: any) => tool.name === 'read_role_data' && tool.parameters.type === 'object'));
    assert.ok(requests[1].input.some((item: any) => item.type === 'function_call_output' && item.call_id === 'read_call' && item.output.includes('blue')));
    assert.deepEqual(requests[2].tools.map((tool: any) => tool.name), ['submit_report']);
    assert.deepEqual(result.reports.map(r => r.parsed), [{ ownActions: 'read', observations: 'blue', limitations: 'mock' }]);
    assert.match(JSON.stringify(requests[2].input), /ownActions/);
    const events = await repo.listEvents(run.id);
    const accounting = events.filter(event => event.type === 'context_accounted').map(event => event.data as any);
    assert.equal(accounting.length, 3);
    assert.ok(accounting.every(value => value.estimated === true && value.reservedTokens === 2048 && value.measured > 32000));
    assert.equal((events.find(event => event.type === 'model_usage')!.data as any).source, 'provider-reported');
    assert.equal(result.usage.inputTokens, 28500);

    config.tokenBudget.maxInputTokens = 10000;
    const overflow = createQueuedRun(resolveConfiguration(config), 'mock-token-overflow');
    await repo.createRun(overflow);
    assert.equal((await new HarnessScheduler({ runState: repo, events: repo, memory, adapter: new MastraModelAdapter() }).run(overflow.id)).status, 'failed');
    assert.equal(requests.length, 3);
});

test('Adaption replay of assistant preamble text with parallel tool calls carries item IDs Adaption accepts', async t => {
    const previous = process.env.ADAPTION_API_KEY;
    process.env.ADAPTION_API_KEY = 'synthetic-test-key';
    t.after(() => { if (previous === undefined) delete process.env.ADAPTION_API_KEY; else process.env.ADAPTION_API_KEY = previous; });
    const requests: any[] = [];
    t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => {
        const body = JSON.parse(options.body);
        requests.push(body);
        // Mirrors Adaption's observed 400: list content on an assistant message needs `id` or `type`.
        const invalid = body.input.findIndex((item: any) => item.role === 'assistant' && Array.isArray(item.content) && item.id == null && item.type == null);
        if (invalid >= 0)
            return Response.json({ error: { message: `body.input.${invalid}.EasyInputMessageParam.content Input should be a valid string`, type: 'invalid_request_error' } }, { status: 400 });
        return sseResponse({ id: `resp_${requests.length}`, object: 'response', created_at: 1, status: 'completed', model: body.model, error: null, incomplete_details: null,
            output: [{ type: 'message', id: 'msg_out', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
            usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
    });
    const toolCalls = [{ id: 'call_a', name: 'list_agents', arguments: {} }, { id: 'call_b', name: 'read_role_data', arguments: {} }];
    const input: ModelInput = { runId: 'preamble', agentId: 'clinical_records', threadId: 't', resourceId: 'r', invocationId: 'step-2', phase: 'action',
        model: { provider: 'adaption', id: 'glm-53-flash', settings: { maxOutputTokens: 64 } }, timeoutMs: 10000,
        tools: [{ name: 'list_agents', description: 'List agents', parameters: { type: 'object', properties: {}, additionalProperties: false } },
            { name: 'read_role_data', description: 'Read role data', parameters: { type: 'object', properties: {}, additionalProperties: false } }],
        messages: [{ role: 'system', content: 'You are clinical_records.' },
            { role: 'assistant', content: "I'll check the roster and my table.", toolCalls },
            ...toolCalls.map(call => ({ role: 'tool' as const, content: '{"ok":true}', toolCallId: call.id, toolName: call.name })),
            { role: 'assistant', content: 'Noted.' },
            { role: 'user', content: 'Continue your scheduled turn.' }] };
    const result = await new MastraModelAdapter().complete(input);
    assert.equal(result.text, 'ok');
    assert.equal(requests.length, 1);
    const assistantItems = requests[0].input.filter((item: any) => item.role === 'assistant');
    assert.deepEqual(assistantItems.map((item: any) => [item.id, item.content[0].text]), [
        ['msg_sidechannel_1', "I'll check the roster and my table."], ['msg_sidechannel_4', 'Noted.']]);
    assert.deepEqual(requests[0].input.filter((item: any) => item.type === 'function_call').map((item: any) => item.call_id), ['call_a', 'call_b']);
    // Other providers keep their original message shape (no item IDs that would become item references).
    assert.equal(JSON.stringify(modelMessages(input.messages)).includes('itemId'), false);
});

test('actual Mastra Adaption route preserves tool proposals, history, reports and numeric usage', async t => {
    const previous = process.env.ADAPTION_API_KEY;
    process.env.ADAPTION_API_KEY = 'synthetic-test-key';
    t.after(() => { if (previous === undefined) delete process.env.ADAPTION_API_KEY; else process.env.ADAPTION_API_KEY = previous; });
    const requests: any[] = [];
    const report = JSON.stringify({ ownActions: 'Read fragment', observations: 'cobalt-seven', limitations: 'Synthetic test' });
    t.mock.method(globalThis, 'fetch', async (url: any, options: any) => {
        assert.equal(String(url), 'https://api.prod.adaptionlabs.ai/api/v1/responses');
        assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-test-key');
        const body = JSON.parse(options.body);
        requests.push(body);
        assert.equal(body.model, 'gemma-4-31b-it');
        assert.equal(body.store, false);
        assert.equal(body.max_output_tokens, 256);
        assert.equal(body.temperature, 0);
        assert.equal(body.previous_response_id, undefined);
        assert.equal(body.stream, true);
        return sseResponse({ id: `resp_${requests.length}`, object: 'response', created_at: 1,
            status: 'completed', model: body.model, error: null, incomplete_details: null,
            output: requests.length === 1
                ? [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_fragment', arguments: '{}', status: 'completed' }]
                : [{ type: 'function_call', id: 'fc_2', call_id: 'report_1', name: 'submit_report', arguments: report, status: 'completed' }],
            usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
        });
    });
    const input: ModelInput = { runId: 'adaption-test', agentId: 'alpha', threadId: 't', resourceId: 'r', invocationId: 'first',
        phase: 'action', model: { provider: 'adaption', id: 'gemma-4-31b-it', settings: { maxOutputTokens: 256, temperature: 0 } },
        messages: [{ role: 'user', content: 'Read your fragment.' }], timeoutMs: 10000,
        tools: [{ name: 'read_fragment', description: 'Read synthetic fragment', parameters: { type: 'object', properties: {}, additionalProperties: false } }] };
    const adapter = new MastraModelAdapter();
    const action = await adapter.complete(input);
    assert.equal(requests.length, 1); // Proposal only; no tool execution or implicit second inference.
    assert.deepEqual(action.toolCalls, [{ id: 'call_1', name: 'read_fragment', arguments: {} }]);
    assert.equal(action.usage?.inputTokens, 20);
    assert.equal(action.usage?.outputTokens, 10);
    assert.deepEqual(requests[0].tools.map((tool: any) => tool.name), ['read_fragment']);
    const reportTool = { name: 'submit_report', description: 'Submit report', parameters: { type: 'object', properties: { ownActions: { type: 'string' }, observations: { type: 'string' }, limitations: { type: 'string' } }, required: ['ownActions', 'observations', 'limitations'], additionalProperties: false } };
    const result = await adapter.complete({ ...input, invocationId: 'second', phase: 'report', tools: [reportTool], messages: [
        ...input.messages, { role: 'assistant', content: action.text, toolCalls: action.toolCalls },
        { role: 'tool', toolName: 'read_fragment', toolCallId: 'call_1', content: '{"marker":"cobalt-seven"}' },
        { role: 'user', content: 'Return your JSON report.' },
    ] });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].tools.map((tool: any) => tool.name), ['submit_report']);
    assert.ok(requests[1].input.some((item: any) => item.type === 'function_call_output' && item.call_id === 'call_1' && item.output.includes('cobalt-seven')));
    assert.deepEqual(result.toolCalls, [{ id: 'report_1', name: 'submit_report', arguments: JSON.parse(report) }]);
    assert.ok(!JSON.stringify(result).includes('synthetic-test-key'));
});
