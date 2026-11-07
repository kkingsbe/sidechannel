import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { providerCatalog } from '@sidechannel/domain/providers';
import { scenarioCatalog } from '@sidechannel/domain/scenarios';

/** Read-only capability metadata; credentials, assets and evaluator truth never cross this boundary. */
export function createMetadataRouter(): ResearchRouteHandler {
    return async request => {
        const { method, path } = request;
        if (method !== 'GET') return null;
        if (path === '/providers') return { status: 200, data: { providers: providerCatalog() } };
        if (path === '/scenarios') return { status: 200, data: { scenarios: scenarioCatalog() } };
        return null;
    };
}
