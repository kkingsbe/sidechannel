import type { ExperimentConfig } from '@sidechannel/contracts/harness/contracts';
import { PLAYBOOK_PROVIDER, PLAYBOOK_SETTINGS_KEYS } from '@sidechannel/contracts/playbook/contracts';
import { validatePlaybook, validatePlaybookForConfig } from '../playbook/package.js';
import type { ProviderProfile } from './profile.js';
import { genericSettingErrors, isRecord } from './settings.js';

/** Registered playbook ids are the browser-visible catalog key. */
const PLAYBOOK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const owned = (key: string) => (PLAYBOOK_SETTINGS_KEYS as readonly string[]).includes(key);

/**
 * Embedded-playbook rules (main 48a2170): the browser selects an id/version and the server
 * embeds the registered content and hash at launch, so every run re-checks id, version,
 * hash and the playbook's cross-checks against the configuration it will drive.
 */
export function playbookModelErrors(config: ExperimentConfig): string[] {
    const settings = config.model.settings as Record<string, unknown>;
    if (!isRecord(settings)) return [];
    const errors: string[] = [];
    if (!PLAYBOOK_ID.test(config.model.id)) errors.push('model.id: Select a registered playbook');
    if (typeof settings.playbookVersion !== 'string' || !settings.playbookVersion) errors.push('model.settings.playbookVersion: Select a registered playbook version');
    if (settings.playbook === undefined) errors.push('model.id: Playbook content is resolved from the catalog at launch; select a registered playbook');
    else {
        try {
            const validated = validatePlaybook(settings.playbook);
            if (validated.playbook.playbook_id !== config.model.id || validated.playbook.playbook_version !== settings.playbookVersion) errors.push('model.id: Embedded playbook does not match the selected playbook id and version');
            if (settings.playbookHash !== validated.playbookHash) errors.push('model.settings.playbookHash: Embedded playbook hash does not match its content');
            errors.push(...validatePlaybookForConfig(validated.playbook, config));
        } catch (error) { errors.push(`model.settings.playbook: ${error instanceof Error ? error.message : 'Invalid playbook'}`); }
    }
    return errors;
}

/**
 * Uploadable scripted playbook: deterministic tool-call transcripts over the real scheduler
 * and scenario tools. A playbook run is never a study observation and never calls a model.
 */
export const playbookProvider: ProviderProfile = {
    id: PLAYBOOK_PROVIDER,
    label: 'Registered playbook',
    settings: PLAYBOOK_SETTINGS_KEYS,
    validateSettings(settings) {
        if (!isRecord(settings)) return ['Settings must be a JSON object'];
        // Playbook keys are validated as a unit by `validateModel`; other settings keep the
        // generic harness messages (main skips only the playbook-owned keys in that loop).
        const harnessSettings = Object.fromEntries(Object.entries(settings).filter(([key]) => !owned(key)));
        return genericSettingErrors(harnessSettings);
    },
    resolveTransport() {
        throw new Error('Playbook runs execute the embedded interpreter, not a model transport');
    },
    validateModel: playbookModelErrors,
    adapterKind: 'embedded-playbook',
    usageSource: 'scripted',
    fixture: true,
};
