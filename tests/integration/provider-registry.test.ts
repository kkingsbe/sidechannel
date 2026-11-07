import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import type { Scenario, ModelAdapter } from '@sidechannel/contracts/harness/server';
import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { defaultFixtureConfiguration, resolveConfiguration, validateConfiguration } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import { ADAPTION_SETTINGS, GENERIC_SETTINGS, PROVIDERS, providerCatalog, providerProfile } from '@sidechannel/domain/providers';
import { SCENARIOS, scenarioCatalog, scenarioDescriptor, type ScenarioDescriptor } from '@sidechannel/domain/scenarios';
import { createResearcherServer } from '../../api/src/server/index.js';
import { runtimePlugins } from '../../experiment-worker/src/harness/runtime.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Recursive production-source census: no `*.test.ts`, no `dist`, no dashboard. */
function productionSources(): { path: string; text: string }[] {
    const roots = ['packages/domain/src', 'packages/contracts/src', 'api/src', 'experiment-worker/src', 'analysis-worker/src'];
    const files: { path: string; text: string }[] = [];
    const walk = (directory: string) => {
        for (const entry of readdirSync(join(repoRoot, directory), { withFileTypes: true })) {
            const path = `${directory}/${entry.name}`;
            if (entry.isDirectory()) { if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(path); continue; }
            if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
            files.push({ path, text: readFileSync(join(repoRoot, path), 'utf8') });
        }
    };
    for (const root of roots) walk(root);
    return files;
}

test('a test-only provider and scenario flow through validation, launch, runtime selection and catalog', async t => {
    const testScenario: Scenario = {
        initialize: () => ({ initialized: 'test-scenario-v1' }),
        initialArtifact: () => [],
        initialContext: (config, role) => `${role.instructions}\n${config.scenario.task}`,
        tools: () => [],
        execute: () => ({ ok: true }),
        finalize: run => ({ finalized: run.id }),
    };
    const descriptor: ScenarioDescriptor = {
        version: 'test-scenario-v1',
        label: 'Test scenario',
        fixture: true,
        artifactSchemaVersion: 'test-v1',
        toolNames: [],
        scenario: testScenario,
        scriptedDriverId: undefined,
        validateConfiguration: config => config.model.settings.maxOutputTokens === undefined ? ['model.settings.maxOutputTokens: the test scenario requires an output allowance'] : [],
        presentation: { title: 'Test scenario', tabs: ['timeline'], hasDatasetPreset: false },
    };
    PROVIDERS['test-double'] = {
        ...providerProfile('scripted'),
        id: 'test-double',
        label: 'Test double',
        settings: ['maxOutputTokens'],
        validateSettings: settings => Object.keys(settings).every(key => key === 'maxOutputTokens') ? [] : ['Unsupported test-double setting'],
        resolveTransport: (model, _env) => ({ model: `test/${model.id}`, providerOptions: undefined }),
    };
    SCENARIOS['test-scenario-v1'] = descriptor;
    t.after(() => { delete PROVIDERS['test-double']; delete SCENARIOS['test-scenario-v1']; });

    const config: ExperimentConfig = {
        ...defaultFixtureConfiguration(),
        artifactSchemaVersion: 'test-v1',
        model: { provider: 'test-double', id: 'test-driver', settings: { maxOutputTokens: 64 } },
        scenario: { ...defaultFixtureConfiguration().scenario, version: 'test-scenario-v1' },
    };

    // 1. Configuration validation is registry-driven.
    assert.deepEqual(validateConfiguration(config), { valid: true, errors: [] });
    const rejected = { ...config, scenario: { ...config.scenario }, model: { provider: 'test-double', id: 'test-driver', settings: {} } };
    assert.deepEqual(validateConfiguration(rejected).errors.filter(message => message.startsWith('model.settings')), ['model.settings.maxOutputTokens: the test scenario requires an output allowance']);

    // 2. Launch initialises state and artifact from the descriptor's scenario object.
    const run = createQueuedRun(resolveConfiguration(config), 'ocp-proof');
    assert.deepEqual(run.scenarioState, { initialized: 'test-scenario-v1' });
    assert.deepEqual(run.artifacts[0]!.value, []);

    // 3. Runtime selection returns the registered scenario and a scripted adapter for fixture profiles.
    const plugins = runtimePlugins(config);
    assert.equal(plugins.scenario, testScenario);
    assert.equal(typeof (plugins.adapter as ModelAdapter | undefined)?.complete, 'function');

    // 4. Both catalogs publish the registered entries with zero route or server edits.
    const repository = new InMemoryRepository();
    const server = createResearcherServer(repository);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
    const address = server.address(); assert(address && typeof address !== 'string');
    const get = async (path: string) => (await fetch(`http://127.0.0.1:${address.port}/api${path}`)).json();
    const providers = await get('/providers') as { providers: { id: string; settings: string[] }[] };
    assert.deepEqual(providers.providers.find(provider => provider.id === 'test-double')?.settings, ['maxOutputTokens']);
    const scenarios = await get('/scenarios') as { scenarios: { version: string; presentation: { title: string } }[] };
    assert.equal(scenarios.scenarios.find(scenario => scenario.version === 'test-scenario-v1')?.presentation.title, 'Test scenario');
    assert.equal(providerCatalog().some(provider => provider.id === 'test-double'), true);
    assert.equal(scenarioCatalog().some(scenario => scenario.version === 'test-scenario-v1'), true);

    // 5. Nothing outside this test file knows the test provider or scenario exists.
    const sources = productionSources();
    assert.deepEqual(sources.filter(file => file.text.includes('test-double') || file.text.includes('test-scenario-v1')).map(file => file.path), []);
});

test('the provider-settings policy and scenario-version literals do not multiply', () => {
    const sources = productionSources();
    const settingsOwners = sources.filter(file => file.text.includes("'presencePenalty'")).map(file => file.path);
    assert.deepEqual(settingsOwners, ['packages/domain/src/providers/settings.ts'], `settings policy copies: ${settingsOwners.join(', ')}`);
    // Adaption controls are a projection of the generic list, never a second allowlist literal.
    const adaptionLiterals = sources.filter(file => file.text.includes("['maxOutputTokens', 'temperature']")).map(file => file.path);
    assert.deepEqual(adaptionLiterals, [], `adaption settings copies: ${adaptionLiterals.join(', ')}`);
    assert.deepEqual([...ADAPTION_SETTINGS], ['maxOutputTokens', 'temperature']);
    assert.equal(ADAPTION_SETTINGS.every(setting => GENERIC_SETTINGS.includes(setting as never)), true);
    const scenarioOwners = sources.filter(file => file.text.includes('fixture-v1') || file.text.includes('healthcare-points-v0.3')).map(file => relative('.', file.path).replaceAll('\\', '/'));
    assert.deepEqual(scenarioOwners.sort(), [
        'packages/contracts/src/healthcare/contracts.ts',
        'packages/contracts/src/testing.ts',
        'packages/domain/src/scenarios/fixture.ts',
    ], `scenario literal sites: ${scenarioOwners.join(', ')}`);
});

test('the standalone scenario descriptor is the only remaining install-set definition', () => {
    assert.equal(scenarioDescriptor('fixture-v1')?.version, 'fixture-v1');
    assert.deepEqual(Object.keys(SCENARIOS).sort(), ['fixture-v1', 'healthcare-points-v0.3'].sort());
});
