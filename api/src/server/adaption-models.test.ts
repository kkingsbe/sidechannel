import assert from 'node:assert/strict';
import test from 'node:test';
import { getAdaptionModelCatalog } from './adaption-models.js';
import { createResearcherServer } from './index.js';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { defaultTokenBudget } from '@sidechannel/domain/harness/token-budget';

test('authenticated hosted catalog joins only verified serving metadata; unknown capacity remains unavailable', async () => {
    let called = false;
    const transport = (async (url: string, options: RequestInit) => {
        called = true;
        assert.equal(url, 'https://api.prod.adaptionlabs.ai/api/v1/models?type=hosted');
        assert.equal(new Headers(options.headers).get('authorization'), 'Bearer backend-only');
        return Response.json({ object: 'list', data: [{ id: 'qwen3.5-397b', created: 1, object: 'model', owned_by: 'platform', display_name: 'Qwen' }, { id: 'unknown-new-model', context_length: 999999 }] });
    }) as typeof fetch;
    const catalog = await getAdaptionModelCatalog({ ADAPTION_API_KEY: 'backend-only' }, transport);
    assert.equal(called, true);
    assert.equal(catalog.status, 'available');
    assert.equal(catalog.models[0]!.capacity?.tokens, 131072);
    assert.equal(catalog.models[0]!.displayName, 'Qwen');
    assert.equal(catalog.models[1]!.capacity, null);
    assert.equal(catalog.models[1]!.launchable, false);
    assert.ok(!JSON.stringify(catalog).includes('backend-only'));
});

test('API authenticates discovery and refuses unavailable or spoofed-capacity launches before queueing', async t => {
    const previous = process.env.ADAPTION_API_KEY;
    process.env.ADAPTION_API_KEY = 'backend-private-key';
    t.after(() => { if (previous === undefined) delete process.env.ADAPTION_API_KEY; else process.env.ADAPTION_API_KEY = previous; });
    const nativeFetch = globalThis.fetch;
    let discoveries = 0;
    t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
        if (!String(input).startsWith('https://api.prod.adaptionlabs.ai/')) return nativeFetch(input, init);
        discoveries++;
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer backend-private-key');
        return Response.json({ object: 'list', data: [{ id: 'qwen3.5-397b', created: 1, object: 'model', owned_by: 'platform' }] });
    });
    const repository = new InMemoryRepository();
    const server = createResearcherServer(repository, { token: 'researcher-token' });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api`;
    assert.equal((await nativeFetch(base + '/models/adaption')).status, 401);
    assert.equal(discoveries, 0);
    const headers = { Authorization: 'Bearer researcher-token', 'Content-Type': 'application/json' };
    const catalog = await (await nativeFetch(base + '/models/adaption', { headers })).json() as any;
    assert.equal(catalog.status, 'available');
    assert.ok(!JSON.stringify(catalog).includes('backend-private-key'));
    const config = defaultFixtureConfiguration();
    config.model = { provider: 'adaption', id: 'gemma-4-31b-it', settings: { maxOutputTokens: 4096 } };
    config.tokenBudget = defaultTokenBudget(config.model.id);
    config.memory.maxPrivateNoteCharacters = 32000;
    const unavailable = await nativeFetch(base + '/runs', { method: 'POST', headers, body: JSON.stringify({ config, idempotencyKey: 'unavailable-model' }) });
    assert.equal(unavailable.status, 400);
    assert.match(JSON.stringify(await unavailable.json()), /unavailable to the backend/);
    config.model.id = 'qwen3.5-397b';
    config.tokenBudget = defaultTokenBudget(config.model.id);
    config.tokenBudget.capacity!.tokens = 999999;
    const spoofed = await nativeFetch(base + '/runs', { method: 'POST', headers, body: JSON.stringify({ config, idempotencyKey: 'spoofed-capacity' }) });
    assert.equal(spoofed.status, 400);
    assert.match(JSON.stringify(await spoofed.json()), /verified metadata/);
    assert.equal((await repository.listRuns()).length, 0);
});

test('catalog absence and malformed upstream response return actionable credential-free unavailable state', async () => {
    assert.match((await getAdaptionModelCatalog({})).message!, /backend environment/);
    const transport = (async () => Response.json({ object: 'list', data: [{ id: 'stack:uncontrolled' }] })) as typeof fetch;
    assert.equal((await getAdaptionModelCatalog({ ADAPTION_API_KEY: 'secret' }, transport)).status, 'unavailable');
    const bad = (async () => { throw new Error('secret'); }) as typeof fetch;
    assert.ok(!JSON.stringify(await getAdaptionModelCatalog({ ADAPTION_API_KEY: 'secret' }, bad)).includes('secret'));
});
