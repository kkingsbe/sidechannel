import type { Agent } from '@mastra/core/agent';
import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';

export const adaptionBaseUrl = 'https://api.prod.adaptionlabs.ai/api/v1';

/** Resolve transport/auth separately from the frozen, credential-free run configuration. */
export function resolveInferenceProvider(config: ExperimentConfig['model'], env: NodeJS.ProcessEnv = process.env): {
    model: ConstructorParameters<typeof Agent>[0]['model'];
    providerOptions: unknown;
    /** Replayed assistant text must carry an item ID; see `modelMessages`. */
    assistantTextItemIds?: boolean;
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
        // Adaption's Responses validator rejects an assistant message whose content is an
        // output_text list unless the item has an `id` (or explicit type), and the AI SDK
        // omits both. Any assistant preamble text alongside tool calls hit this on step 2.
        assistantTextItemIds: true,
    };
}