import assert from 'node:assert/strict';
import test from 'node:test';
import { PLAYBOOK_FORMAT_VERSION, type Playbook } from '@sidechannel/contracts/playbook/contracts';
import { defaultFixtureConfiguration, validateConfiguration } from '../harness/config.js';
import { canonicalPlaybookJson, playbookCatalogItem, playbookRounds, validatePlaybook, validatePlaybookForConfig } from './package.js';

const turn = (...names: string[]) => ({ steps: [{ calls: names.map(name => ({ name })) }] });
const report = { ownActions: 'Scripted.', observations: 'None.', limitations: 'Playbook fixture.' };
const sample = (): Playbook => ({ format_version: PLAYBOOK_FORMAT_VERSION, playbook_id: 'fixture-compliant', playbook_version: '1', display_name: 'Fixture compliant', scenario_version: 'fixture-v1', roles: { alpha: { turns: [turn('read_role_data', 'end_turn'), turn('read_board', 'end_turn')], report }, beta: { turns: [turn('read_role_data', 'end_turn')], default_turn: turn('end_turn'), report } } });

test('validatePlaybook accepts the sample, hashes canonical bytes and rejects structural problems', () => {
    const validated = validatePlaybook(sample());
    assert.match(validated.playbookHash, /^[a-f0-9]{64}$/);
    assert.equal(validated.playbookBytes, canonicalPlaybookJson(validated.playbook));
    assert.equal(validatePlaybook(JSON.parse(JSON.stringify({ ...sample(), roles: { beta: sample().roles.beta, alpha: sample().roles.alpha } }))).playbookHash, validated.playbookHash, 'key order does not change the hash');
    assert.throws(() => validatePlaybook({ ...sample(), format_version: 'other' }), /format_version/);
    assert.throws(() => validatePlaybook({ ...sample(), playbook_id: 'Not Valid' }), /playbook_id/);
    assert.throws(() => validatePlaybook({ ...sample(), roles: {} }), /roles must not be empty/);
    assert.throws(() => validatePlaybook({ ...sample(), roles: { alpha: { turns: [], report: { ownActions: '', observations: 'x', limitations: 'x' } } } }), /ownActions/);
    assert.throws(() => validatePlaybook({ ...sample(), roles: { alpha: { turns: [{ steps: [{ calls: [{ name: 'Bad-Name' }] }] }], report } } }), /name/);
    assert.throws(() => validatePlaybook({ ...sample(), extra: true }), /extra/);
    assert.throws(() => validatePlaybook({ ...sample(), roles: { alpha: { turns: [{ steps: [{ calls: [{ name: 'post_board', arguments: { text: Number.POSITIVE_INFINITY } }] }] }], report } } }), /arguments/);
});

test('catalog item and rounds summarize the playbook', () => {
    const validated = validatePlaybook({ ...sample(), description: 'Smoke', dataset_id: 'two-fragments' });
    assert.equal(playbookRounds(validated.playbook), 2);
    assert.deepEqual(playbookCatalogItem(validated, '2026-11-07T00:00:00.000Z'), { playbookId: 'fixture-compliant', playbookVersion: '1', displayName: 'Fixture compliant', description: 'Smoke', scenarioVersion: 'fixture-v1', datasetId: 'two-fragments', roles: ['alpha', 'beta'], rounds: 2, playbookHash: validated.playbookHash, registeredAt: '2026-11-07T00:00:00.000Z' });
});

test('cross-checks against the run configuration', () => {
    const config = defaultFixtureConfiguration();
    assert.deepEqual(validatePlaybookForConfig(sample(), config), []);
    assert.match(validatePlaybookForConfig(sample(), { ...config, phase: 'study' }).join('\n'), /^phase: /m);
    assert.match(validatePlaybookForConfig({ ...sample(), scenario_version: 'healthcare-points-v0.3' }, config).join('\n'), /targets scenario/);
    assert.match(validatePlaybookForConfig({ ...sample(), dataset_id: 'other' }, config).join('\n'), /targets dataset/);
    assert.match(validatePlaybookForConfig({ ...sample(), roles: { alpha: sample().roles.alpha } }, config).join('\n'), /roles \[alpha\] must match/);
    assert.match(validatePlaybookForConfig(sample(), { ...config, scheduler: { ...config.scheduler, rounds: 1 } }).join('\n'), /scripts 2 turns but the scheduler runs 1 rounds/);
    assert.match(validatePlaybookForConfig(sample(), { ...config, limits: { ...config.limits, maxModelStepsPerTurn: 0 } }).join('\n'), /steps but limits.maxModelStepsPerTurn/);
});

test('configuration validator wires the playbook provider end to end', () => {
    const validated = validatePlaybook(sample());
    const config = defaultFixtureConfiguration();
    config.model = { provider: 'playbook', id: 'fixture-compliant', settings: { playbookVersion: '1', playbook: validated.playbook as never, playbookHash: validated.playbookHash } };
    assert.deepEqual(validateConfiguration(config), { valid: true, errors: [] });
    const missing = structuredClone(config); delete (missing.model.settings as Record<string, unknown>).playbook;
    assert.match(validateConfiguration(missing).errors.join('\n'), /model\.id: Playbook content is resolved/);
    const tampered = structuredClone(config); tampered.model.settings.playbookHash = '0'.repeat(64);
    assert.match(validateConfiguration(tampered).errors.join('\n'), /playbookHash/);
    const renamed = structuredClone(config); renamed.model.id = 'other-id';
    assert.match(validateConfiguration(renamed).errors.join('\n'), /does not match the selected playbook/);
    const study = structuredClone(config); study.phase = 'study';
    assert.match(validateConfiguration(study).errors.join('\n'), /^phase: /m);
    const budgeted = structuredClone(config); budgeted.tokenBudget = { version: 1, unit: 'tokens', maxInputTokens: 120000, counting: { method: 'utf8-byte-upper-bound', version: '1', scope: 'messages-and-tool-definitions', reservedTokens: 2048 } }; budgeted.model.settings.maxOutputTokens = 4096; budgeted.memory.maxPrivateNoteCharacters = 32000;
    assert.deepEqual(validateConfiguration(budgeted), { valid: true, errors: [] }, 'token-budget runs need no verified capacity for playbooks');
    const scripted = defaultFixtureConfiguration(); scripted.model.settings.playbook = validated.playbook as never;
    assert.match(validateConfiguration(scripted).errors.join('\n'), /Unsupported model setting playbook/);
});
