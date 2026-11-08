import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanonicalStep } from '@sidechannel/contracts/analysis/evidence-contracts';
import { resolveAnalysisConfiguration } from '@sidechannel/domain/analysis/configuration';
import { buildWindows } from '@sidechannel/domain/analysis/windows';
import { CALIBRATED_TOKENS_PER_BYTE, DEFAULT_TOKEN_ESTIMATOR_VERSION, estimateTokens, preflightQuestions, preflightWindow, serializeWindow, TOKEN_ESTIMATOR_VERSIONS } from '@sidechannel/domain/analysis/serialization';

// Nine questions of roughly the production size (about 1.1 KiB of instructions each).
const questions = () => Array.from({ length: 9 }, (_, i) => ({ codeId: `c${i}`, instructions: 'q'.repeat(1_100), criteria: { true: 'yes', false: 'no' } }));

test('estimator versions are explicit, frozen, and both remain readable', () => {
    assert.deepEqual([...TOKEN_ESTIMATOR_VERSIONS], ['utf8-bytes-conservative-v1', 'utf8-bytes-calibrated-v1']);
    assert.equal(DEFAULT_TOKEN_ESTIMATOR_VERSION, 'utf8-bytes-calibrated-v1');
    const text = 'x'.repeat(1000) + '🧪';
    assert.equal(estimateTokens(text, 'utf8-bytes-conservative-v1'), 1004);
    assert.equal(estimateTokens(text, 'utf8-bytes-calibrated-v1'), Math.ceil(1004 * CALIBRATED_TOKENS_PER_BYTE));
    assert.equal(estimateTokens(text), estimateTokens(text, DEFAULT_TOKEN_ESTIMATOR_VERSION));
    assert.ok(estimateTokens('🧪') >= 1);
    assert.throws(() => estimateTokens(text, 'utf8-v1'), /Unsupported token estimator/);
});

test('configuration defaults to the calibrated estimator and still accepts the legacy one', () => {
    assert.equal(resolveAnalysisConfiguration().inputLimits.estimatorVersion, 'utf8-bytes-calibrated-v1');
    assert.equal(resolveAnalysisConfiguration({ inputLimits: { estimatorVersion: 'utf8-bytes-conservative-v1' } }).inputLimits.estimatorVersion, 'utf8-bytes-conservative-v1');
    assert.throws(() => resolveAnalysisConfiguration({ inputLimits: { estimatorVersion: 'utf8-bytes-generous-v9' } }), /Unsupported token estimator/);
});

test('a window the conservative estimator rejected fits under the calibrated one at default limits', () => {
    // Production analysis-19c2dcd9 marked four size-4 windows oversized at 29,017 to 30,876 state bytes,
    // while provider usage for its scored windows stayed near 0.46 tokens per state byte.
    const state = 'w'.repeat(30_876);
    const conservative = resolveAnalysisConfiguration({ inputLimits: { estimatorVersion: 'utf8-bytes-conservative-v1' } }).inputLimits;
    const calibrated = resolveAnalysisConfiguration().inputLimits;
    const rejected = preflightQuestions(state, questions(), conservative);
    assert.equal(rejected.oversized, true);
    assert.equal(rejected.budget.estimatorVersion, 'utf8-bytes-conservative-v1');
    assert.equal(rejected.budget.estimatedTokens, 30_876);
    const accepted = preflightQuestions(state, questions(), calibrated);
    assert.equal(accepted.oversized, false);
    assert.equal(accepted.budget.estimatorVersion, 'utf8-bytes-calibrated-v1');
    assert.equal(accepted.budget.estimatedTokens, Math.ceil(30_876 * CALIBRATED_TOKENS_PER_BYTE));
    assert.equal(accepted.batches.flat().length, 9);
    // The calibrated estimator still refuses what cannot fit: about 52,000 state bytes plus one question exceeds the 30,000 effective tokens.
    assert.equal(preflightQuestions('w'.repeat(52_000), questions(), calibrated).oversized, true);
});

test('serialized windows record the estimator they were prepared with and preflight refuses a mismatch', () => {
    const step: CanonicalStep = { id: 's-1', ordinal: 1, phase: 'action', agentId: 'alpha', invocationId: 'i-1', eventIds: ['e-1'], sequenceStart: 1, sequenceEnd: 1, closed: true, incomplete: false, diagnostics: [], assistantText: 'hello', toolCalls: [], sideEffects: [] };
    const config = resolveAnalysisConfiguration();
    const window = buildWindows([step], { size: 1, stride: 1 })[0]!;
    const calibrated = serializeWindow(window, [step], config.evidence, '', 'utf8-bytes-calibrated-v1');
    const conservative = serializeWindow(window, [step], config.evidence, '', 'utf8-bytes-conservative-v1');
    // The estimator never changes the evidence, only the number attached to it.
    assert.equal(calibrated.state, conservative.state);
    assert.equal(calibrated.hash, conservative.hash);
    assert.equal(conservative.estimatedTokens, conservative.bytes);
    assert.equal(calibrated.estimatedTokens, Math.ceil(calibrated.bytes * CALIBRATED_TOKENS_PER_BYTE));
    assert.equal(serializeWindow(window, [step], config.evidence).estimatorVersion, DEFAULT_TOKEN_ESTIMATOR_VERSION);
    assert.throws(() => serializeWindow(window, [step], config.evidence, '', 'nope'), /Unsupported token estimator/);
    assert.throws(() => preflightWindow(conservative, questions(), config.inputLimits), /estimated with utf8-bytes-conservative-v1/);
});
