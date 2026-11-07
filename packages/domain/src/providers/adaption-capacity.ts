import type { ModelCapacity } from '@sidechannel/contracts/harness/contracts';

const sourceUrl = 'https://docs.adaptionlabs.ai/inference-stacks/models/#configurations';

const capacities: Record<string, number> = {
    'gemma-4-31b-it': 256000, 'glm-5.2': 786432, 'qwen3.5-397b': 131072,
    'gemma-4-26b-a4b-it': 256000, 'qwen3.8-27b': 262144,
    'deepseek-v4-flash': 1048576, 'glm-53-flash': 1048576,
};

/** Serving deployment limits, not upstream model cards or AutoScientist training limits. */
export function adaptionModelCapacity(modelId: string): ModelCapacity | undefined {
    const tokens = Object.hasOwn(capacities, modelId) ? capacities[modelId] : undefined;
    return tokens ? { modelId, tokens, sourceUrl, verifiedAt: '2026-11-07', version: 'adaption-hosted-2026-11-07' } : undefined;
}
