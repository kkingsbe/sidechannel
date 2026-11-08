import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';

export function createWorkspaceRouter(options: { demoMode?: boolean }): ResearchRouteHandler {
    return async ({ method, path }) => method === 'GET' && path === '/workspace' ? { status: 200, data: { mode: options.demoMode ? 'demo' : 'research' } } : null;
}
