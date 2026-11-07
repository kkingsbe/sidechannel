import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultFixtureConfiguration, validateConfiguration } from './config.js';
import { adaptionModelCapacity, defaultTokenBudget, measureModelInput } from './token-budget.js';
import type { ModelInput } from '@sidechannel/contracts/harness/server';

test('token configurations opt in without reinterpreting legacy characters; verify capacity, framing and explicit output allowance', () => {
    const c = defaultFixtureConfiguration();
    assert.equal(c.tokenBudget, undefined);
    c.tokenBudget = defaultTokenBudget('qwen3.5-397b');
    c.memory.maxPrivateNoteCharacters = 4000;
    c.model = { provider: 'adaption', id: 'qwen3.5-397b', settings: { maxOutputTokens: 4096 } };
    assert.equal(validateConfiguration(c).valid, true);
    c.tokenBudget.maxInputTokens = 130000;
    assert.match(validateConfiguration(c).errors.join(';'), /exceeds model context capacity/);
    c.tokenBudget.maxInputTokens = 120000;
    c.tokenBudget.capacity!.tokens = 999999;
    assert.match(validateConfiguration(c).errors.join(';'), /verified metadata/);
    c.tokenBudget = defaultTokenBudget();
    c.model.id = 'unverified-new-deployment';
    assert.match(validateConfiguration(c).errors.join(';'), /unverified/);
    assert.equal(adaptionModelCapacity('unverified-new-deployment'), undefined);
    assert.equal(adaptionModelCapacity('constructor'), undefined);
    c.model.id = 'qwen3.5-397b';
    c.tokenBudget = defaultTokenBudget(c.model.id);
    c.tokenBudget.counting.reservedTokens = 0;
    assert.match(validateConfiguration(c).errors.join(';'), /reservedTokens/);
    c.tokenBudget = defaultTokenBudget(c.model.id);
    c.model.settings.maxOutputTokens = 1.5;
    assert.match(validateConfiguration(c).errors.join(';'), /maxOutputTokens/);
});

test('complete logical messages, notes, schemas, arguments and results affect labeled conservative estimate', () => {
    const c = defaultFixtureConfiguration();
    c.tokenBudget = defaultTokenBudget();
    const input: ModelInput = { runId: 'r', agentId: 'a', threadId: 't', resourceId: 's', invocationId: 'i', phase: 'action', model: c.model,
        messages: [{ role: 'system', content: 'Private notes: ' + 'n'.repeat(33000) }], tools: [], timeoutMs: 1000 };
    const base = measureModelInput(input, c);
    assert.equal(base.unit, 'tokens');
    assert.equal(base.exceeds, false);
    assert.equal(base.estimated, true);
    input.tools.push({ name: 'large_tool', description: 'd'.repeat(1000), parameters: { type: 'object' } });
    assert.ok(measureModelInput(input, c).measured > base.measured + 1000);
    input.messages.push({ role: 'assistant', content: '', toolCalls: [{ id: 'x', name: 'large_tool', arguments: { text: 'a'.repeat(1000) } }] }, { role: 'tool', content: 'result'.repeat(1000), toolCallId: 'x' });
    assert.ok(measureModelInput(input, c).measured > base.measured + 7000);
    delete c.tokenBudget;
    const legacy = measureModelInput(input, c);
    assert.equal(legacy.unit, 'characters');
    assert.equal(legacy.exceeds, true);
});
