import type { ModelCapacity } from '@sidechannel/contracts/harness/contracts';
import type { HostedModelPolicy, ProviderProfile } from './profile.js';
import { ADAPTION_SETTINGS, genericSettingErrors, isRecord } from './settings.js';
import { adaptionModelCapacity } from './adaption-capacity.js';

export const adaptionBaseUrl = 'https://api.prod.adaptionlabs.ai/api/v1';
export const ADAPTION_MODEL_ENDPOINT = 'https://api.prod.adaptionlabs.ai/api/v1/models?type=hosted';
export const ADAPTION_CREDENTIAL_ENV = 'ADAPTION_API_KEY';

/** Hosted deployments are addressed by direct model IDs; stacks and harness IDs are not supported. */
export const ADAPTION_MODEL_ID = /^[a-z0-9][a-z0-9._-]*$/i;

/** Settings this transport does not implement, in the historical wording. */
export function unsupportedAdaptionSettings(settings: Record<string, unknown>): string[] {
    return Object.keys(settings)
        .filter(key => !ADAPTION_SETTINGS.includes(key as never))
        .map(key => `Unsupported Adaption model setting ${key}`);
}

export function validateAdaptionModelId(modelId: string): string[] {
    return ADAPTION_MODEL_ID.test(modelId) ? [] : ['model.id must be a direct hosted Adaption model ID'];
}

export const adaptionProvider: ProviderProfile = {
    id: 'adaption',
    label: 'Adaption hosted',
    settings: ADAPTION_SETTINGS,
    validateSettings(settings) {
        if (!isRecord(settings)) return ['Settings must be a JSON object'];
        // Generic value errors are reported alongside the unsupported-control error so a
        // doubly-wrong setting keeps producing both messages, exactly as before WS4.
        return [...genericSettingErrors(settings), ...unsupportedAdaptionSettings(settings)];
    },
    resolveTransport(model, env) {
        if (!ADAPTION_MODEL_ID.test(model.id))
            throw new Error('Adaption requires a direct hosted model ID, not a stack or harness');
        // Fail before inference rather than silently dropping requested experiment settings.
        for (const name of Object.keys(model.settings))
            if (!ADAPTION_SETTINGS.includes(name as never))
                throw new Error(`Unsupported Adaption model setting: ${name}; use maxOutputTokens and temperature`);
        const apiKey = env[ADAPTION_CREDENTIAL_ENV]?.trim();
        if (!apiKey)
            throw new Error(`Missing ${ADAPTION_CREDENTIAL_ENV} in the backend environment`);
        return {
            model: { providerId: 'adaption', modelId: model.id, url: adaptionBaseUrl, apiKey, api: 'responses' },
            // History is owned by Sidechannel. Direct models have no stack agentic memory.
            providerOptions: { openai: { store: false } },
        };
    },
    credentialEnv: ADAPTION_CREDENTIAL_ENV,
    usageSource: 'provider-reported',
    fixture: false,
};

export const adaptionHostedPolicy: HostedModelPolicy = {
    capacityFor(modelId: string): ModelCapacity | undefined { return adaptionModelCapacity(modelId); },
    unsupportedSettings: unsupportedAdaptionSettings,
    modelIdErrors: validateAdaptionModelId,
};
