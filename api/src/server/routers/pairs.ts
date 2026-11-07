import { isDeepStrictEqual } from 'node:util';
import { resolvePair, seededOrder } from '@sidechannel/domain/harness/config';
import { createQueuedRun } from '@sidechannel/domain/harness/initialization';
import type { ResearcherRepository, ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import type { ConfigurationPipeline } from '../configuration.js';
import type { createLaunchService } from '../launch.js';
import { HttpError } from '../errors.js';
import { cursor, idempotencyKey } from '../http.js';

export interface PairRoutesContext {
    repository: Pick<ResearcherRepository, 'listRuns' | 'getRunSummary' | 'createPair'>;
    pipeline: ConfigurationPipeline;
    launch: ReturnType<typeof createLaunchService>;
}

const PAIR = /^\/pairs\/([^/]+)$/;

/** Deep key-path differences; the pair comparison reports them and refuses to call them matched. */
export function differences(left: unknown, right: unknown, path = ''): string[] {
    if (isDeepStrictEqual(left, right)) return [];
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) return [path];
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => differences((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], path ? `${path}.${key}` : key));
}

export function createPairsRouter({ repository, pipeline, launch }: PairRoutesContext): ResearchRouteHandler {
    return async request => {
        const { method, path } = request;
        if (path === '/pairs' && method === 'POST') {
            const input = await request.body(), key = idempotencyKey(input.idempotencyKey), { config, validation } = await pipeline.prepare(input.config);
            if (!validation.valid) return { status: 400, data: { error: validation.errors.join('; '), ...validation } };
            const sourceDraft = await launch.sourceDraft(input, key + ':0', config), source = sourceDraft ? { sourceDraft } : {};
            const configs = resolvePair(config), pairingSeed = cursor(String(input.pairingSeed ?? 42), 42), pairId = 'pair-' + key;
            const runs = seededOrder(['0', '1'], pairingSeed).map((index, pairPosition) => ({ ...createQueuedRun(configs[Number(index)]!, key + ':' + index, pairId), pairingSeed, pairPosition, ...source }));
            return { status: 202, data: await repository.createPair(await Promise.all(runs.map(run => launch.freezeReference(run)))) };
        }
        const pair = path.match(PAIR);
        if (!pair || method !== 'GET') return null;
        const pairId = decodeURIComponent(pair[1]!), runs = (await repository.listRuns()).filter(run => run.pairId === pairId);
        if (!runs.length) throw new HttpError(404, 'Pair not found');
        const configurationDifferences = runs.length === 2 ? differences(runs[0]!.config, runs[1]!.config) : [];
        return { status: 200, data: { pairId, runs: await Promise.all(runs.map(run => repository.getRunSummary(run.id))), configurationDifferences, matched: runs.length === 2 && configurationDifferences.every(path => path.startsWith('condition.')) } };
    };
}
