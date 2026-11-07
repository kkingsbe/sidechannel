import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { InMemoryHealthcareCatalog } from '@sidechannel/persistence/healthcare/catalog';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import { defaultFixtureConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { createHealthcarePreset } from '@sidechannel/domain/healthcare/preset';
import { resolveHealthcareConfiguration } from './resolver.js';
import { healthcareRouteHandler } from './routes.js';
import { freezeHealthcareReference } from './provenance.js';
import { loadHealthcarePackage } from './bootstrap.js';

const fixturePath = fileURLToPath(new URL('../../../data/healthcare/points-out/fixture10-s101-points/', import.meta.url));

async function catalog() {
    const store = new InMemoryHealthcareCatalog();
    const fixture = await loadHealthcarePackage(fixturePath);
    const item = await store.register(fixture);
    return { store, fixture, item };
}

const presetFor = (fixture: Awaited<ReturnType<typeof catalog>>['fixture'], item: Awaited<ReturnType<typeof catalog>>['item']) =>
    createHealthcarePreset(fixture.assets, { datasetId: item.datasetId, datasetVersion: item.datasetVersion, datasetSeed: 101 });

test('the resolver replaces untrusted assets and seed from the registered dataset', async () => {
    const { store, fixture, item } = await catalog();
    const config = presetFor(fixture, item);
    config.scenario.assets = { untrusted: true };
    config.scenario.datasetSeed = -1;
    const resolved = await resolveHealthcareConfiguration(store, config) as ExperimentConfig;
    assert.deepEqual(resolved.scenario.assets, fixture.assets);
    assert.equal(resolved.scenario.datasetSeed, 101);
    assert.equal(await resolveHealthcareConfiguration(store, 'not-an-object'), 'not-an-object');
});

test('unknown datasets fail with the documented field message', async () => {
    const { store, fixture, item } = await catalog();
    const config = presetFor(fixture, item);
    await assert.rejects(resolveHealthcareConfiguration(store, { ...config, scenario: { ...config.scenario, datasetId: 'missing' } }),
        /scenario.datasetId: Select a fully registered healthcare dataset/);
});

test('the route adapter answers datasets, preset and provenance without any rules', async () => {
    const { store, fixture, item } = await catalog();
    const handler = healthcareRouteHandler(store, new InMemoryRepository());
    const list = await handler({ method: 'GET', path: '/datasets', query: new URLSearchParams(), body: async () => ({}) });
    assert.equal(list!.status, 200);
    const preset = await handler({ method: 'GET', path: `/datasets/${item.datasetId}/preset`, query: new URLSearchParams({ version: item.datasetVersion }), body: async () => ({}) });
    assert.equal(preset!.status, 200);
    const provenance = await handler({ method: 'GET', path: `/datasets/${item.datasetId}/provenance`, query: new URLSearchParams({ version: item.datasetVersion }), body: async () => ({}) });
    assert.deepEqual(provenance!.data, (await store.runtime(item.datasetId, item.datasetVersion))!.manifest);
    assert.equal((await handler({ method: 'GET', path: '/datasets/missing/preset', query: new URLSearchParams(), body: async () => ({}) }))!.status, 404);
    assert.equal((await handler({ method: 'GET', path: '/runs/missing/evaluation', query: new URLSearchParams(), body: async () => ({}) }))!.status, 404);
    assert.equal(fixture.packageHash.length, 64);
});

test('freezing records the dataset identity for healthcare runs and skips other scenarios', async () => {
    const { store, fixture, item } = await catalog();
    const run = createQueuedRun(presetFor(fixture, item), 'run-1');
    await freezeHealthcareReference(store, run);
    assert.equal((await store.getReference(run.id))!.truthHash, fixture.truthHash);
    const fixtureRun = createQueuedRun(defaultFixtureConfiguration(), 'run-2');
    await freezeHealthcareReference(store, fixtureRun);
    assert.equal(await store.getReference('run-2'), null);
});

test('healthcare rules live only in the domain configuration validator', async () => {
    const directory = new URL('.', import.meta.url);
    for (const file of ['service.ts', 'resolver.ts', 'routes.ts', 'provenance.ts', 'bootstrap.ts']) {
        const source = await readFile(new URL(file, directory), 'utf8');
        for (const rule of ['HEALTHCARE_ROLES', 'five canonical roles', 'read_legacy_archive', 'rank_cases', 'request_access', 'artifactSchemaVersion:'])
            assert.ok(!source.includes(rule), `${file} restates the healthcare rule ${rule}`);
    }
    const domain = await readFile(new URL('../../../packages/domain/src/harness/config.ts', directory), 'utf8');
    assert.match(domain, /roles: Healthcare requires exactly the five canonical roles/);
    assert.match(domain, /artifactSchemaVersion: Unsupported healthcare artifact schema/);
    assert.match(domain, /model.provider: Healthcare supports scripted development or Adaption/);
});
