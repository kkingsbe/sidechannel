import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import type { ProviderCatalogResponse, ProviderMetadata, ScenarioCatalogResponse, ScenarioMetadata } from '@sidechannel/contracts/server/metadata';
import { providerCatalog } from '@sidechannel/domain/providers';
import { scenarioCatalog } from '@sidechannel/domain/scenarios';
import { createResearcherServer } from './index.js';

async function app() {
    const repository = new InMemoryRepository();
    const server = createResearcherServer(repository);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert(address && typeof address !== 'string');
    const get = async (path: string) => { const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
    return { get, close: async () => { const closed = new Promise<void>(resolve => server.close(() => resolve())); server.closeAllConnections(); await closed; } };
}

test('provider and scenario metadata endpoints publish both registries', async () => {
    const client = await app(); try {
        const providers = await client.get('/providers') as ProviderCatalogResponse;
        assert.deepEqual(providers, { providers: providerCatalog() });
        assert.deepEqual(providers.providers.map(provider => provider.id), ['scripted', 'adaption']);
        assert.deepEqual(providers.providers.map(provider => provider.fixture), [true, false]);
        const scenarios = await client.get('/scenarios') as ScenarioCatalogResponse;
        assert.deepEqual(scenarios, { scenarios: scenarioCatalog() });
        assert.deepEqual(scenarios.scenarios.map(scenario => scenario.version).sort(), ['fixture-v1', 'healthcare-points-v0.3'].sort());
        assert.deepEqual(scenarios.scenarios.find(scenario => scenario.fixture)!.presentation.tabs.includes('results'), false);
        assert.deepEqual(scenarios.scenarios.find(scenario => !scenario.fixture)!.presentation.tabs.includes('results'), true);
    } finally { await client.close(); }
});

test('metadata payloads are credential-free and JSON-round-trip without loss', async () => {
    const client = await app(); try {
        const text = JSON.stringify(await client.get('/providers')) + JSON.stringify(await client.get('/scenarios'));
        for (const forbidden of ['ADAPTION_API_KEY', 'apiKey', 'protected_flags', 'assets', 'truth']) assert.equal(text.includes(forbidden), false, forbidden);
        assert.deepEqual(JSON.parse(JSON.stringify(await client.get('/scenarios'))).scenarios[0].presentation.tabs.length > 0, true);
    } finally { await client.close(); }
});

test('domain catalog shapes are assignable to the browser-safe contract types', () => {
    const providers: ProviderMetadata[] = providerCatalog();
    const scenarios: ScenarioMetadata[] = scenarioCatalog();
    assert.ok(providers.length > 0 && scenarios.length > 0);
});
