import type { ExperimentConfig, ModelCapacity } from '@sidechannel/contracts/harness/contracts';

/**
 * Provider-neutral transport description. The generic branch is the Mastra-style
 * `"<provider>/<model>"` string; the hosted branch is the explicit Responses-API
 * object. Domain owns this shape so services can stay free of provider SDK types.
 */
export type TransportModel = string | { providerId: string; modelId: string; url: string; apiKey: string; api: 'responses' };

export interface ResolvedTransport {
    model: TransportModel;
    providerOptions: unknown;
    /**
     * Responses-API replay needs a stable item ID on assistant text messages when the
     * history contains text alongside tool calls. Only the hosted Adaption transport sets it.
     */
    assistantTextItemIds?: boolean;
}

/**
 * How the worker builds the model adapter for a provider. Data-only registry extension
 * (conventions §3.3): adding a provider must not add a provider-name branch in the worker.
 *  - `mastra`: a real model through the Mastra adapter (`resolveTransport`).
 *  - `scripted`: the installed scripted driver for the selected scenario.
 *  - `embedded-playbook`: the registered playbook interpreter over the run's own content.
 */
export type AdapterKind = 'mastra' | 'scripted' | 'embedded-playbook';

export interface ProviderProfile {
    readonly id: string;
    readonly label: string;
    /** Supported sampling controls, in display order. */
    readonly settings: readonly string[];
    /** Returns human-readable validation errors; empty means valid. */
    validateSettings(settings: Record<string, unknown>): string[];
    resolveTransport(model: ExperimentConfig['model'], env: NodeJS.ProcessEnv): ResolvedTransport;
    /** Provider rules that need the whole configuration (e.g. embedded playbook cross-checks). */
    validateModel?(config: ExperimentConfig): string[];
    /** Adapter the worker builds for this provider; replaces provider-name branches. */
    readonly adapterKind: AdapterKind;
    readonly credentialEnv?: string;
    readonly usageSource: 'scripted' | 'provider-reported';
    readonly fixture: boolean;
}

/**
 * Rules that only apply to providers serving a verified hosted deployment catalog.
 * Kept next to the profile so provider-specific policy never leaks into call sites.
 */
export interface HostedModelPolicy {
    capacityFor(modelId: string): ModelCapacity | undefined;
    /** Controls this transport does not implement, reported as unsupported settings. */
    unsupportedSettings(settings: Record<string, unknown>): string[];
    /** Identifier constraints for hosted deployments (direct model IDs, not stacks). */
    modelIdErrors(modelId: string): string[];
}
