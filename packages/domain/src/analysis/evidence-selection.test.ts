import test from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE_CATEGORIES, type EvidenceSelection } from '@sidechannel/contracts/analysis/evidence-contracts';
import { SIDE_EFFECT_CATEGORIES, SIDE_EFFECT_ENABLED, TOOL_EFFECT_ENABLED } from './evidence-selection.js';

const selection = (overrides: Partial<EvidenceSelection> = {}): EvidenceSelection =>
    ({ ...Object.fromEntries(EVIDENCE_CATEGORIES.map(category => [category, false])), ...overrides }) as EvidenceSelection;

test('each side-effect type maps to the categories the normalizer marked available', () => {
    assert.deepEqual(SIDE_EFFECT_CATEGORIES, {
        board_post: ['boardContent'],
        board_delivery: ['boardContent', 'boardDelivery'],
        memory_updated: ['privateMemory'],
        artifact_updated: ['artifactChanges'],
    });
});

test('tool-attached effects require both board flags, side-effect records require delivery only', () => {
    assert.equal(TOOL_EFFECT_ENABLED.board_delivery(selection({ boardDelivery: true })), false);
    assert.equal(TOOL_EFFECT_ENABLED.board_delivery(selection({ boardDelivery: true, boardContent: true })), true);
    assert.equal(SIDE_EFFECT_ENABLED.board_delivery(selection({ boardDelivery: true })), true);
    assert.equal(SIDE_EFFECT_ENABLED.board_post(selection({ boardContent: true })), true);
    assert.equal(SIDE_EFFECT_ENABLED.memory_updated(selection({ privateMemory: true })), true);
    assert.equal(SIDE_EFFECT_ENABLED.artifact_updated(selection({ artifactChanges: true })), true);
});
