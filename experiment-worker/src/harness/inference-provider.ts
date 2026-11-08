import type { Agent } from '@mastra/core/agent';
import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import { providerProfile } from '@sidechannel/domain/providers';

export { adaptionBaseUrl } from '@sidechannel/domain/providers';

/**
 * Service-local edge only: Mastra narrows the transport type, so the cast stays here.
 * The provider policy itself lives in `@sidechannel/domain/providers`, including the
 * `assistantTextItemIds` replay flag for the hosted Responses transport.
 */
export function resolveInferenceProvider(config: ExperimentConfig['model'], env: NodeJS.ProcessEnv = process.env): {
    model: ConstructorParameters<typeof Agent>[0]['model'];
    providerOptions: unknown;
    /** Replayed assistant text must carry an item ID; see `modelMessages`. */
    assistantTextItemIds?: boolean;
} {
    const resolved = providerProfile(config.provider).resolveTransport(config, env);
    return {
        model: resolved.model as ConstructorParameters<typeof Agent>[0]['model'],
        providerOptions: resolved.providerOptions,
        ...(resolved.assistantTextItemIds ? { assistantTextItemIds: resolved.assistantTextItemIds } : {}),
    };
}
