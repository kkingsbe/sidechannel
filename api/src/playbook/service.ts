import { PLAYBOOK_PROVIDER } from '@sidechannel/contracts/playbook/contracts';
import type { PlaybookCatalog } from '@sidechannel/contracts/playbook/repository';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { validatePlaybook } from '@sidechannel/domain/playbook/package';

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

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
    routes(): ResearchRouteHandler {
        return async ({ method, path, query, body }) => {
            if (path === '/playbooks') {
                if (method === 'GET') return { status: 200, data: await this.catalog.list() };
                if (method !== 'POST') return null;
                let validated; try { validated = validatePlaybook(body); } catch (error) { return { status: 400, data: { error: error instanceof Error ? error.message : 'Invalid playbook' } }; }
                try { return { status: 201, data: await this.catalog.register(validated) }; } catch (error) { return { status: 409, data: { error: error instanceof Error ? error.message : 'Playbook conflict' } }; }
            }
            const match = path.match(/^\/playbooks\/([^/]+)$/);
            if (method === 'GET' && match) {
                const id = decodeURIComponent(match[1]!), version = query.get('version'); if (!version) return { status: 400, data: { error: 'version query parameter is required' } };
                const validated = await this.catalog.get(id, version), item = validated && (await this.catalog.list()).find(row => row.playbookId === id && row.playbookVersion === version);
                return validated && item ? { status: 200, data: { item, playbook: validated.playbook } } : { status: 404, data: { error: 'Playbook not registered' } };
            }
            return null;
        };
    }
}
