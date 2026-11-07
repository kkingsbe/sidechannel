import type { Agent } from '@mastra/core/agent';
import type { ExperimentConfig } from './contracts.js';

export const adaptionBaseUrl = 'https://api.prod.adaptionlabs.ai/api/v1';

/** Resolve transport/auth separately from the frozen, credential-free run configuration. */
export function resolveInferenceProvider(config: ExperimentConfig['model'], env: NodeJS.ProcessEnv = process.env): {
    model: ConstructorParameters<typeof Agent>[0]['model'];
    providerOptions: unknown;
} {
    if (config.provider !== 'adaption')
        return { model: `${config.provider}/${config.id}`, providerOptions: config.settings.providerOptions };
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(config.id))
        throw new Error('Adaption requires a direct hosted model ID, not a stack or harness');
    // These are the sampling controls verified against Adaption's Responses API.
    // Fail before inference rather than silently dropping requested experiment settings.
    for (const name of Object.keys(config.settings))
        if (!['maxOutputTokens', 'temperature'].includes(name))
            throw new Error(`Unsupported Adaption model setting: ${name}; use maxOutputTokens and temperature`);
    const apiKey = env.ADAPTION_API_KEY?.trim();
    if (!apiKey)
        throw new Error('Missing ADAPTION_API_KEY in the backend environment');
    return {
        model: { providerId: 'adaption', modelId: config.id, url: adaptionBaseUrl, apiKey, api: 'responses' },
        // History is owned by Sidechannel. Direct models have no stack agentic memory.
        providerOptions: { openai: { store: false } },
    };
}
