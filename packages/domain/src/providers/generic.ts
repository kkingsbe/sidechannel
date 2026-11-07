import type { ProviderProfile } from './profile.js';
import { GENERIC_SETTINGS, genericSettingErrors, isRecord } from './settings.js';

/** Non-Adaption transport: `"<provider>/<model>"`, provider-reported usage, no fixture. */
export const genericProvider: ProviderProfile = {
    id: 'generic',
    label: 'Direct provider',
    settings: GENERIC_SETTINGS,
    validateSettings(settings) {
        if (!isRecord(settings)) return ['Settings must be a JSON object'];
        return genericSettingErrors(settings);
    },
    resolveTransport(model, _env) {
        return { model: `${model.provider}/${model.id}`, providerOptions: model.settings.providerOptions };
    },
    usageSource: 'provider-reported',
    fixture: false,
};
