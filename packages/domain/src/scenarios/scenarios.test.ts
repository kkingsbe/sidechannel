import test from 'node:test';
import assert from 'node:assert/strict';
import { HEALTHCARE_ARTIFACT_VERSION, HEALTHCARE_ROLES, HEALTHCARE_SCENARIO_VERSION } from '@sidechannel/contracts/healthcare/contracts';
import { defaultFixtureConfiguration, validateConfiguration } from '../harness/config.js';
import { EVIDENCE_TABS, SCENARIOS, installedScenarioVersions, scenarioCatalog, scenarioDescriptor } from './index.js';

test('installed scenarios are exactly the fixture and healthcare descriptors', () => {
    assert.deepEqual(Object.keys(SCENARIOS).sort(), [HEALTHCARE_SCENARIO_VERSION, 'fixture-v1'].sort());
    assert.deepEqual(installedScenarioVersions().sort(), Object.keys(SCENARIOS).sort());
    assert.equal(scenarioDescriptor('fixture-v1')?.fixture, true);
    assert.equal(scenarioDescriptor(HEALTHCARE_SCENARIO_VERSION)?.fixture, false);
    assert.equal(scenarioDescriptor('not-installed'), undefined);
    assert.equal(scenarioDescriptor('fixture-v1')?.scenario.initialize(defaultFixtureConfiguration()) !== undefined, true);
});

test('scenario catalog exposes presentation metadata with mutable arrays for JSON transport', () => {
    const [fixture, healthcare] = scenarioCatalog();
    assert.deepEqual(fixture, {
        version: 'fixture-v1', label: 'Synthetic fixture', fixture: true, artifactSchemaVersion: '1',
        presentation: { title: 'Synthetic fixture', tabs: [...EVIDENCE_TABS], hasDatasetPreset: false },
    });
    assert.deepEqual(healthcare, {
        version: HEALTHCARE_SCENARIO_VERSION, label: 'Healthcare', fixture: false, artifactSchemaVersion: HEALTHCARE_ARTIFACT_VERSION,
        presentation: { title: 'Healthcare approved collaboration', tabs: [...EVIDENCE_TABS, 'results'], hasDatasetPreset: true },
    });
    assert.equal(Array.isArray(healthcare!.presentation.tabs), true);
    assert.notEqual(healthcare!.presentation.tabs, scenarioDescriptor(HEALTHCARE_SCENARIO_VERSION)!.presentation.tabs);
});

test('fixture descriptor adds no scenario-specific validation and ships the shared tool list', () => {
    const fixture = scenarioDescriptor('fixture-v1')!;
    assert.deepEqual(fixture.validateConfiguration(defaultFixtureConfiguration()), []);
    assert.deepEqual([...fixture.toolNames], ['list_agents', 'post_board', 'read_board', 'update_working_memory', 'read_role_data', 'update_artifact', 'read_artifact', 'end_turn']);
    assert.equal(fixture.scriptedDriverId, undefined);
});

test('healthcare descriptor carries the five canonical configuration rules and the scripted driver id', () => {
    const healthcare = scenarioDescriptor(HEALTHCARE_SCENARIO_VERSION)!;
    assert.equal(healthcare.scriptedDriverId, HEALTHCARE_SCENARIO_VERSION);
    assert.deepEqual([...healthcare.toolNames], ['list_agents', 'post_board', 'read_board', 'update_working_memory', 'read_role_data', 'read_legacy_archive', 'request_access', 'rank_cases', 'read_artifact', 'update_artifact', 'end_turn']);
    const config = defaultFixtureConfiguration();
    config.scenario = { ...config.scenario, version: HEALTHCARE_SCENARIO_VERSION, datasetId: 'fixture10-s101-points', datasetVersion: '0.3', assets: { untrusted: true } };
    config.artifactSchemaVersion = HEALTHCARE_ARTIFACT_VERSION;
    config.model = { provider: 'adaption', id: 'gemma-4-31b-it', settings: { maxOutputTokens: 4096 } };
    config.tokenBudget = undefined;
    config.memory.maxPrivateNoteCharacters = 32000;
    const errors = healthcare.validateConfiguration(config);
    // The shipped fixture roles already use a subset of the healthcare tool list: the role
    // rule reports only the canonical-roster mismatch here, exactly as before WS4.
    assert.ok(errors.includes('roles: Healthcare requires exactly the five canonical roles'), errors.join('; '));
    assert.ok(!errors.includes('roles: Invalid healthcare tool configuration for alpha'), errors.join('; '));
    const driftedRoles = { ...config, roles: config.roles.map(role => role.id === 'alpha' ? { ...role, allowedTools: ['read_role_data'] } : role) };
    assert.ok(healthcare.validateConfiguration(driftedRoles).includes('roles: Invalid healthcare tool configuration for alpha'));
    assert.ok(errors.includes('scenario.assets: Invalid healthcare assets'), errors.join('; '));
    assert.ok(!errors.includes('model.id: Select the healthcare scripted driver'));
    assert.ok(!errors.includes('model.provider: Healthcare supports scripted development or Adaption'));
    assert.ok(validateConfiguration(config).errors.includes('roles: Healthcare requires exactly the five canonical roles'));
});

test('healthcare configuration validation rejects non-healthcare providers and scripted id drift', () => {
    const healthcare = scenarioDescriptor(HEALTHCARE_SCENARIO_VERSION)!;
    const base = defaultFixtureConfiguration();
    base.scenario = { ...base.scenario, version: HEALTHCARE_SCENARIO_VERSION };
    base.artifactSchemaVersion = HEALTHCARE_ARTIFACT_VERSION;
    base.roles = HEALTHCARE_ROLES.map(id => ({ id, instructions: `You are ${id}.`, allowedTools: [...healthcare.toolNames] }));
    const scripted = { ...base, model: { provider: 'scripted', id: 'fixture-v1', settings: {} } };
    assert.deepEqual(healthcare.validateConfiguration(scripted).filter(message => message.startsWith('model.')), ['model.id: Select the healthcare scripted driver']);
    const other = { ...base, model: { provider: 'openai', id: 'gpt', settings: {} } };
    assert.deepEqual(healthcare.validateConfiguration(other).filter(message => message.startsWith('model.')), ['model.provider: Healthcare supports scripted development or Adaption']);
});
