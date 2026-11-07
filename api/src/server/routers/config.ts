import { defaultFixtureConfiguration, resolveConfiguration } from '@sidechannel/domain/harness/config';
import { configurationSchema } from '@sidechannel/contracts/server/config-schema';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import type { ConfigurationPipeline } from '../configuration.js';

export function createConfigRouter(pipeline: ConfigurationPipeline): ResearchRouteHandler {
    return async request => {
        const { method, path } = request;
        if (method === 'GET' && path === '/config/default') return { status: 200, data: defaultFixtureConfiguration() };
        if (method === 'GET' && path === '/config/schema') return { status: 200, data: configurationSchema };
        if (method === 'POST' && path === '/config/validate') {
            const { config, validation } = await pipeline.prepare((await request.body()).config);
            return { status: 200, data: { ...validation, ...(validation.valid ? { config: resolveConfiguration(config) } : {}) } };
        }
        return null;
    };
}
