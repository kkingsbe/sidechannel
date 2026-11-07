import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldErrors } from '@sidechannel/contracts/server/config-schema';

test('configuration validation preserves explicit scenario, role, schema and token field paths', () => {
    const messages = ['scenario.version: Scenario runtime is not installed', 'roles: Healthcare requires exactly the five canonical roles',
        'artifactSchemaVersion: Unsupported healthcare artifact schema', 'tokenBudget.capacity must match verified metadata',
        'tokenBudget.maxInputTokens must be a positive integer', 'memory.maxPrivateNoteCharacters must be a positive integer',
        'model.settings.maxOutputTokens must be a positive integer', 'reportInstructions is required'];
    assert.deepEqual(fieldErrors(messages).map(issue => issue.path), ['scenario.version', 'roles', 'artifactSchemaVersion', 'tokenBudget.capacity', 'tokenBudget.maxInputTokens', 'memory.maxPrivateNoteCharacters', 'model.settings.maxOutputTokens', 'reportInstructions']);
    assert.deepEqual(fieldErrors(messages).map(issue => issue.message), messages);
});

test('legacy validation mappings remain available and unknown prose does not invent a field', () => {
    assert.deepEqual(fieldErrors(['rounds must be a positive integer', 'Default page exceeds maximum', 'Unsupported model setting topK', 'Invalid configuration', 'modeling is unsupported']).map(issue => issue.path), ['scheduler.rounds', 'board.defaultPageSize', 'model.settings', '', '']);
});
