import type { PlaybookCatalog } from '@sidechannel/contracts/playbook/repository';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { validatePlaybook } from '@sidechannel/domain/playbook/package';

/**
 * Immutable playbook registry: list, register and fetch by id+version.
 * Statuses and payloads are byte-identical to the pre-remediation HTTP surface.
 */
export function createPlaybookRouter(catalog: PlaybookCatalog): ResearchRouteHandler {
    return async ({ method, path, query, body }) => {
        if (path === '/playbooks') {
            if (method === 'GET') return { status: 200, data: await catalog.list() };
            if (method !== 'POST') return null;
            let validated; try { validated = validatePlaybook(await body()); } catch (error) { return { status: 400, data: { error: error instanceof Error ? error.message : 'Invalid playbook' } }; }
            try { return { status: 201, data: await catalog.register(validated) }; } catch (error) { return { status: 409, data: { error: error instanceof Error ? error.message : 'Playbook conflict' } }; }
        }
        const match = path.match(/^\/playbooks\/([^/]+)$/);
        if (method === 'GET' && match) {
            const id = decodeURIComponent(match[1]!), version = query.get('version'); if (!version) return { status: 400, data: { error: 'version query parameter is required' } };
            const validated = await catalog.get(id, version), item = validated && (await catalog.list()).find(row => row.playbookId === id && row.playbookVersion === version);
            return validated && item ? { status: 200, data: { item, playbook: validated.playbook } } : { status: 404, data: { error: 'Playbook not registered' } };
        }
        return null;
    };
}
