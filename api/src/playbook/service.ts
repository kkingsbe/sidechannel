import { PLAYBOOK_PROVIDER } from '@sidechannel/contracts/playbook/contracts';
import type { PlaybookCatalog } from '@sidechannel/contracts/playbook/repository';

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Launch-time playbook resolution: the HTTP surface lives in `server/routers/playbook.ts`. */
export class PlaybookService {
    constructor(readonly catalog: PlaybookCatalog) { }
    /** Ignore browser-supplied content and hash; the registered playbook is embedded from the immutable catalog. */
    async resolveConfiguration(input: unknown): Promise<unknown> {
        if (!isRecord(input) || !isRecord(input.model) || input.model.provider !== PLAYBOOK_PROVIDER) return input;
        const config = structuredClone(input), model = config.model as Record<string, unknown>, settings = isRecord(model.settings) ? model.settings : (model.settings = {}) as Record<string, unknown>;
        const version = settings.playbookVersion; if (typeof version !== 'string' || !version) throw new Error('model.settings.playbookVersion: Select a registered playbook version');
        const validated = typeof model.id === 'string' ? await this.catalog.get(model.id, version) : null; if (!validated) throw new Error('model.id: Select a registered playbook');
        settings.playbook = validated.playbook; settings.playbookHash = validated.playbookHash;
        return config;
    }
}
