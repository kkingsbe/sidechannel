import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInferenceProvider } from './inference-provider.js';
import { MastraModelAdapter } from './mastra-adapter.js';
import type { ModelInput } from '@sidechannel/contracts/harness/server';
import type { Json } from '@sidechannel/contracts/harness/contracts';
import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { defaultTokenBudget } from '@sidechannel/domain/harness/token-budget';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { HarnessScheduler } from './scheduler.js';

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
        return Response.json({ id: `resp_${requests.length}`, object: 'response', created_at: 1, status: 'completed', model: body.model, error: null, incomplete_details: null,
            output: requests.length === 1 ? [{ type: 'function_call', id: 'fc_read', call_id: 'read_call', name: 'read_role_data', arguments: '{}', status: 'completed' }]
                : [{ type: 'message', id: `msg_${requests.length}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: requests.length === 3 ? '{"ownActions":"read","observations":"blue","limitations":"mock"}' : 'Done', annotations: [] }] }],
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
    const result = await new HarnessScheduler({ repository: repo, memory, adapter: new MastraModelAdapter() }).run(run.id);
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
    assert.equal(requests[2].tools?.length ?? 0, 0);
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
    assert.equal((await new HarnessScheduler({ repository: repo, memory, adapter: new MastraModelAdapter() }).run(overflow.id)).status, 'failed');
    assert.equal(requests.length, 3);
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
        assert.equal(body.stream, undefined);
        return Response.json({ id: `resp_${requests.length}`, object: 'response', created_at: 1,
            status: 'completed', model: body.model, error: null, incomplete_details: null,
            output: requests.length === 1
                ? [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_fragment', arguments: '{}', status: 'completed' }]
                : [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: report, annotations: [] }] }],
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
    const result = await adapter.complete({ ...input, invocationId: 'second', phase: 'report', messages: [
        ...input.messages, { role: 'assistant', content: action.text, toolCalls: action.toolCalls },
        { role: 'tool', toolName: 'read_fragment', toolCallId: 'call_1', content: '{"marker":"cobalt-seven"}' },
        { role: 'user', content: 'Return your JSON report.' },
    ] });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].tools?.length ?? 0, 0);
    assert.ok(requests[1].input.some((item: any) => item.type === 'function_call_output' && item.call_id === 'call_1' && item.output.includes('cobalt-seven')));
    assert.deepEqual(JSON.parse(result.text), JSON.parse(report));
    assert.deepEqual(result.toolCalls, []);
    assert.ok(!JSON.stringify(result).includes('synthetic-test-key'));
});
