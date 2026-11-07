import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFixtureConfiguration } from '../harness/config.js';
import { ADAPTION_SETTINGS, GENERIC_SETTINGS, genericSettingErrors } from './settings.js';
import { HOSTED_POLICIES, PROVIDERS, hostedPolicy, providerCatalog, providerProfile, usageSource } from './index.js';

test('the generic sampling-control list is defined once and shared by every generic profile', () => {
    assert.deepEqual([...GENERIC_SETTINGS], ['maxOutputTokens', 'temperature', 'topP', 'topK', 'presencePenalty', 'frequencyPenalty', 'seed']);
    // Identity, not deep equality: a second literal list would be a different array.
    assert.equal(providerProfile('openai').settings, GENERIC_SETTINGS);
    assert.equal(providerProfile('scripted').settings, GENERIC_SETTINGS);
    assert.equal(providerProfile('unknown-provider').settings, GENERIC_SETTINGS);
    assert.notEqual(providerProfile('adaption').settings, GENERIC_SETTINGS);
});

test('catalog lists selectable providers in display order and marks fixtures', () => {
    assert.deepEqual(providerCatalog(), [
        { id: 'scripted', label: 'Scripted driver', settings: [...GENERIC_SETTINGS], fixture: true },
        { id: 'adaption', label: 'Adaption hosted', settings: [...ADAPTION_SETTINGS], fixture: false },
    ]);
    assert.equal(providerProfile('adaption').fixture, false);
    assert.equal(providerProfile('adaption').credentialEnv, 'ADAPTION_API_KEY');
    assert.equal(providerProfile('adaption').usageSource, 'provider-reported');
    assert.equal(providerProfile('scripted').usageSource, 'scripted');
    assert.equal(usageSource('adaption'), 'provider-reported');
    assert.equal(Object.keys(PROVIDERS).sort().join(','), 'adaption,generic,scripted');
});

test('generic settings validation keeps the historical messages and accepts provider passthrough', () => {
    const errors = genericSettingErrors({ providerOptions: { openai: { store: false } }, stopSequences: ['END'], maxOutputTokens: 4096, temperature: 0, topP: 1, topK: 1, presencePenalty: 0, frequencyPenalty: 0, seed: -3 });
    assert.deepEqual(errors, []);
    assert.deepEqual(genericSettingErrors({ unknownControl: 1 }), ['Unsupported model setting unknownControl']);
    assert.deepEqual(genericSettingErrors({ temperature: 'hot' }), ['temperature must be finite']);
    assert.deepEqual(genericSettingErrors({ maxOutputTokens: 1.5 }), ['maxOutputTokens must be positive integer']);
    assert.deepEqual(genericSettingErrors({ topK: 0 }), ['topK must be positive integer']);
    assert.deepEqual(genericSettingErrors({ seed: 1.5 }), ['provider seed must be integer']);
    assert.deepEqual(genericSettingErrors({ temperature: 3 }), ['temperature outside supported range']);
    assert.deepEqual(genericSettingErrors({ topP: 2 }), ['topP outside supported range']);
    assert.deepEqual(genericSettingErrors({ providerOptions: 1 }), ['providerOptions must be an object']);
    assert.deepEqual(genericSettingErrors({ stopSequences: [1] }), ['stopSequences must be strings']);
});

test('adaption settings validation reports the generic value error as well as the unsupported control', () => {
    const adaption = providerProfile('adaption');
    assert.deepEqual(adaption.validateSettings({ maxOutputTokens: 4096, temperature: 0 }), []);
    assert.deepEqual(adaption.validateSettings({ seed: 42 }), ['Unsupported Adaption model setting seed']);
    assert.deepEqual(adaption.validateSettings({ seed: 1.5 }), ['provider seed must be integer', 'Unsupported Adaption model setting seed']);
    assert.deepEqual(adaption.validateSettings({ providerOptions: { openai: { store: false } } }), ['Unsupported Adaption model setting providerOptions']);
    assert.deepEqual(adaption.validateSettings({ stopped: true }), ['Unsupported model setting stopped', 'Unsupported Adaption model setting stopped']);
});

test('adaption transport resolution keeps the historical failure messages and payload', () => {
    const model = { provider: 'adaption', id: 'gemma-4-31b-it', settings: {} };
    const adaption = providerProfile('adaption');
    assert.throws(() => adaption.resolveTransport(model, {}), /Missing ADAPTION_API_KEY in the backend environment/);
    assert.throws(() => adaption.resolveTransport({ ...model, id: 'stack:shared' }, {}), /Adaption requires a direct hosted model ID, not a stack or harness/);
    assert.throws(() => adaption.resolveTransport({ ...model, settings: { seed: 42 } }, {}), /Unsupported Adaption model setting: seed; use maxOutputTokens and temperature/);
    assert.deepEqual(adaption.resolveTransport(model, { ADAPTION_API_KEY: ' backend-only ' }), {
        model: { providerId: 'adaption', modelId: 'gemma-4-31b-it', url: 'https://api.prod.adaptionlabs.ai/api/v1', apiKey: 'backend-only', api: 'responses' },
        providerOptions: { openai: { store: false } },
    });
    const generic = providerProfile('openai').resolveTransport({ provider: 'openai', id: 'existing-model', settings: { providerOptions: { openai: { store: false } } } }, {});
    assert.deepEqual(generic, { model: 'openai/existing-model', providerOptions: { openai: { store: false } } });
});

test('hosted-model policy owns the capacity, model-id and settings rules for adaption only', () => {
    assert.deepEqual(Object.keys(HOSTED_POLICIES), ['adaption']);
    assert.equal(hostedPolicy('openai'), undefined);
    const policy = hostedPolicy('adaption')!;
    assert.equal(policy.capacityFor('qwen3.5-397b')?.tokens, 131072);
    assert.equal(policy.capacityFor('unverified-new-deployment'), undefined);
    assert.equal(policy.capacityFor('constructor'), undefined);
    assert.deepEqual(policy.modelIdErrors('gemma-4-31b-it'), []);
    assert.deepEqual(policy.modelIdErrors('stack:shared'), ['model.id must be a direct hosted Adaption model ID']);
    assert.deepEqual(policy.unsupportedSettings({ maxOutputTokens: 4096 }), []);
    assert.deepEqual(policy.unsupportedSettings({ maxOutputTokens: 4096, seed: 1 }), ['Unsupported Adaption model setting seed']);
});

test('the registry still validates the shipped fixture configuration unchanged', async () => {
    const { validateConfiguration } = await import('../harness/config.js');
    assert.deepEqual(validateConfiguration(defaultFixtureConfiguration()), { valid: true, errors: [] });
});
