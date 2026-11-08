import type { ExperimentConfig, ModelCapacity, TokenBudget } from '@sidechannel/contracts/harness/contracts';
import type { ModelInput } from '@sidechannel/contracts/harness/server';
import { adaptionModelCapacity } from '../providers/adaption-capacity.js';
import { hostedPolicy, providerProfile } from '../providers/index.js';

export { adaptionModelCapacity } from '../providers/adaption-capacity.js';

export function defaultTokenBudget(modelId?: string): TokenBudget {
    const capacity = modelId ? adaptionModelCapacity(modelId) : undefined;
    return { version: 1, unit: 'tokens', maxInputTokens: 120000, ...(capacity ? { capacity } : {}),
        counting: { method: 'utf8-byte-upper-bound', version: '1', scope: 'messages-and-tool-definitions', reservedTokens: 2048 } };
}

export function validateTokenBudget(config: ExperimentConfig): string[] {
    const budget = config.tokenBudget;
    if (budget === undefined) return [];
    const errors: string[] = [];
    if (!budget || budget.version !== 1 || budget.unit !== 'tokens') return ['tokenBudget requires version 1 and explicit tokens unit'];
    if (!Number.isSafeInteger(budget.maxInputTokens) || budget.maxInputTokens < 1) errors.push('tokenBudget.maxInputTokens must be a positive integer');
    const counting = budget.counting;
    if (!counting || counting.method !== 'utf8-byte-upper-bound' || counting.version !== '1' || counting.scope !== 'messages-and-tool-definitions') errors.push('tokenBudget.counting must use the supported versioned estimator');
    if (!Number.isSafeInteger(counting?.reservedTokens) || counting.reservedTokens < 2048) errors.push('tokenBudget.counting.reservedTokens must be an integer of at least 2048 for unmeasured provider framing');
    if (!Number.isSafeInteger(config.model.settings.maxOutputTokens) || Number(config.model.settings.maxOutputTokens) < 1) errors.push('model.settings.maxOutputTokens must be a positive integer for token runs');
    if (!Number.isSafeInteger(config.memory.maxPrivateNoteCharacters) || Number(config.memory.maxPrivateNoteCharacters) < 1) errors.push('memory.maxPrivateNoteCharacters must be a positive integer for token runs');
    const policy = hostedPolicy(config.model.provider);
    if (policy) {
        const expected = policy.capacityFor(config.model.id);
        if (!expected) errors.push('tokenBudget.capacity is unverified for this hosted deployment; select a documented model or update the verified serving catalog');
        else if (!budget.capacity || (Object.keys(expected) as (keyof ModelCapacity)[]).some(key => budget.capacity![key] !== expected[key])) errors.push('tokenBudget.capacity must match verified metadata for the selected Adaption model; reselect the model');
        errors.push(...policy.modelIdErrors(config.model.id));
        errors.push(...policy.unsupportedSettings(config.model.settings));
    } else if (providerProfile(config.model.provider).adapterKind === 'mastra') errors.push('tokenBudget.capacity verification is currently supported for Adaption hosted models only');
    const capacity = budget.capacity;
    if (capacity && (!Number.isSafeInteger(capacity.tokens) || capacity.tokens < 1)) errors.push('tokenBudget.capacity.tokens must be a positive integer');
    // The input limit covers the measured payload; reserved framing is counted once, separately.
    if (capacity && budget.maxInputTokens + Number(config.model.settings.maxOutputTokens) + Number(counting?.reservedTokens) > capacity.tokens) errors.push('tokenBudget.maxInputTokens plus output allowance and reserved framing exceeds model context capacity');
    return errors;
}

/**
 * Conservative estimate, NOT a model tokenizer. One token per UTF-8 byte of the
 * complete logical messages/tools JSON (including call arguments and tool results).
 * JSON escaping increases the estimate. Provider chat templates are unmeasured and
 * covered by separate reservedTokens; no framing is counted twice. No history trim.
 */
export function measureModelInput(input: ModelInput, config: ExperimentConfig) {
    if (!config.tokenBudget) {
        const characters = JSON.stringify(input.messages).length;
        return { unit: 'characters' as const, method: 'legacy-serialized-messages', measured: characters, limit: config.memory.contextBudget,
            reservedTokens: 0, exceeds: characters > config.memory.contextBudget };
    }
    const { counting, maxInputTokens } = config.tokenBudget;
    const estimatedTokens = new TextEncoder().encode(JSON.stringify({ messages: input.messages, tools: input.tools })).length;
    return { unit: 'tokens' as const, method: counting.method, version: counting.version, scope: counting.scope,
        estimated: true, measured: estimatedTokens, limit: maxInputTokens, reservedTokens: counting.reservedTokens,
        maxOutputTokens: config.model.settings.maxOutputTokens, capacity: config.tokenBudget.capacity,
        exceeds: estimatedTokens > maxInputTokens };
}
