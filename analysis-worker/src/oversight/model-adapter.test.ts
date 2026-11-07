import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelInput } from '@sidechannel/contracts/harness/server';
import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import { providerProfile } from '@sidechannel/domain/providers';
import { MonitorModelAdapter } from './model-adapter.js';

const resolveInferenceProvider = (model: ExperimentConfig['model'], env: NodeJS.ProcessEnv) => providerProfile(model.provider).resolveTransport(model, env);

test('monitor Mastra transport makes one stateless inference per view with exact controls and usage', async () => {
    const requests: any[] = [];
    const model: any = { specificationVersion: 'v2', provider: 'fixture', modelId: 'monitor-fixture', supportedUrls: {},
        async doGenerate(options: any) {
            requests.push(options);
            return { content: [{ type: 'text', text: '{"judgments":[]}' }], warnings: [], finishReason: 'stop',
                usage: { inputTokens: 13, outputTokens: 7, totalTokens: 20 } };
        } };
    const adapter = new MonitorModelAdapter(model);
    const input: ModelInput = { runId: 'evaluation', agentId: 'monitor-board', invocationId: 'evaluation:run:board',
        threadId: 'unused-thread', resourceId: 'unused-resource', phase: 'report',
        model: { provider: 'fixture', id: 'monitor-fixture', settings: { temperature: 0.2, maxOutputTokens: 321 } },
        timeoutMs: 10000, tools: [], messages: [{ role: 'system', content: 'Independent monitor instructions' },
            { role: 'user', content: 'Only this projection' }] };
    const first = await adapter.complete(input);
    const second = await adapter.complete({ ...input, invocationId: 'evaluation:run:reports',
        messages: [{ role: 'user', content: 'Another isolated projection' }] });
    assert.equal(requests.length, 2);
    assert.equal(first.text, '{"judgments":[]}');
    assert.equal(first.usage?.inputTokens, 13);
    assert.equal(first.usage?.outputTokens, 7);
    assert.equal(second.toolCalls.length, 0);
    assert.equal(requests[0].temperature, 0.2);
    assert.equal(requests[0].maxOutputTokens, 321);
    assert.equal(requests[0].tools?.length ?? 0, 0);
    assert.equal(requests[1].tools?.length ?? 0, 0);
    assert.ok(!JSON.stringify(requests[1].prompt).includes('Only this projection'));
    assert.ok(!JSON.stringify(requests).includes('working_memory'));
    await assert.rejects(adapter.complete({ ...input, model: { ...input.model, settings: { unsupported: true } } }), /Unsupported model setting/);
    assert.equal(requests.length, 2);
});

test('monitor provider retains direct Adaption transport, credentials, and supported settings', () => {
    const resolved = resolveInferenceProvider({ provider: 'adaption', id: 'hosted-model',
        settings: { temperature: 0.1, maxOutputTokens: 321 } }, { ADAPTION_API_KEY: '  synthetic-key  ' });
    assert.deepEqual(resolved, { model: { providerId: 'adaption', modelId: 'hosted-model',
        url: 'https://api.prod.adaptionlabs.ai/api/v1', apiKey: 'synthetic-key', api: 'responses' },
        providerOptions: { openai: { store: false } } });
    assert.throws(() => resolveInferenceProvider({ provider: 'adaption', id: 'hosted-model', settings: { seed: 1 } },
        { ADAPTION_API_KEY: 'synthetic-key' }), /Unsupported Adaption model setting/);
});
