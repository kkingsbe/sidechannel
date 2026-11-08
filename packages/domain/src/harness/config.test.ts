import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultFixtureConfiguration, validateConfiguration } from './config.js';
import { createHealthcarePreset } from '../healthcare/preset.js';
import { validatePlaybook } from '../playbook/package.js';
import { PLAYBOOK_FORMAT_VERSION } from '@sidechannel/contracts/playbook/contracts';

test('the fixture configuration is report-schema v2 and its report rules are the 0d96464 rules', () => {
    const config = defaultFixtureConfiguration();
    assert.equal(config.reportSchemaVersion, '2');
    assert.equal(config.limits.reportCalls, 1);
    assert.match(config.reportInstructions, /submit_report tool exactly once/);
    assert.deepEqual(validateConfiguration(config), { valid: true, errors: [] });
});

test('reportSchemaVersion 1 and out-of-range reportCalls fail with the historical messages', () => {
    const old = defaultFixtureConfiguration();
    old.reportSchemaVersion = '1';
    const result = validateConfiguration(old);
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('reportSchemaVersion must be "2" (report submission is a submit_report tool call); recreate the draft from a preset'), result.errors.join('; '));
    for (const n of [0, 6, 1.5]) {
        const bad = defaultFixtureConfiguration();
        bad.limits.reportCalls = n;
        assert.ok(validateConfiguration(bad).errors.includes('reportCalls must be an integer from 1 to 5'), `reportCalls ${n}`);
    }
    const max = defaultFixtureConfiguration();
    max.limits.reportCalls = 5;
    assert.equal(validateConfiguration(max).valid, true);
});

test('the healthcare preset defaults to a 16,384-token output allowance and two report calls', () => {
    const preset = createHealthcarePreset({ public: {}, roles: {} } as never);
    assert.equal(preset.model.settings.maxOutputTokens, 16384);
    assert.equal(preset.limits.reportCalls, 2);
    assert.equal(preset.reportSchemaVersion, '2');
    assert.match(preset.reportInstructions, /submit_report tool exactly once/);
    // Real datasets supply the assets the healthcare descriptor validates; the preset numbers
    // above are the 0d96464/19648a2 defaults and are covered end to end by healthcare.test.ts.
});

test('the embedded-playbook provider is a first-class registry profile', () => {
    const playbook = validatePlaybook({ format_version: PLAYBOOK_FORMAT_VERSION, playbook_id: 'fixture-playbook', playbook_version: '1', display_name: 'Fixture', scenario_version: 'fixture-v1', roles: { alpha: { turns: [{ steps: [{ calls: [{ name: 'end_turn' }] }] }], report: { ownActions: 'none', observations: 'none', limitations: 'none' } }, beta: { turns: [{ steps: [{ calls: [{ name: 'end_turn' }] }] }], report: { ownActions: 'none', observations: 'none', limitations: 'none' } } } });
    const config = defaultFixtureConfiguration();
    config.model = { provider: 'playbook', id: 'fixture-playbook', settings: { playbookVersion: '1', playbook: playbook.playbook as never, playbookHash: playbook.playbookHash } };
    assert.deepEqual(validateConfiguration(config), { valid: true, errors: [] });
    const tampered = structuredClone(config);
    tampered.model.settings.playbookHash = '0'.repeat(64);
    assert.match(validateConfiguration(tampered).errors.join('\n'), /playbookHash/);
});


