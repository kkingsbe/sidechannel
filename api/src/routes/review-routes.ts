import type { AnalysisRepository } from '@sidechannel/contracts/analysis/jev-repository';
import { AnalysisNotFound, AnalysisValidation } from '@sidechannel/contracts/analysis/jev-repository';
import { ReviewService } from '@sidechannel/domain/analysis/jev-reviews';
import type { ReviewContext, ReviewListFilter, ReviewQueueFilter } from '@sidechannel/contracts/analysis/jev-reviews';
import type { ReviewStore } from '@sidechannel/contracts/analysis/review-repository';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { iteratePages } from '@sidechannel/domain/pagination';
import { HttpError } from '../server/errors.js';

/** Review bodies stay bounded at 1 MB; core and Jev routes keep the 2 MB default. */
export const REVIEW_BODY_LIMIT = 1_000_000;

export async function reviewContext(repository: Pick<AnalysisRepository, 'getJob' | 'listWindows' | 'listResults'>, analysisId: string): Promise<ReviewContext> {
    const job = await repository.getJob(analysisId);
    if (!job) throw new AnalysisNotFound('Analysis not found');
    const windows: ReviewContext['windows'] = [];
    for await (const window of iteratePages(options => repository.listWindows(analysisId, options), 500)) {
        windows.push({ id: window.id, eventIds: window.eventIds, stepIds: window.stepIds, probabilities: {} });
        if (windows.length > 100000) throw new AnalysisValidation('Review selection supports at most 100000 windows; narrow the analysis range');
    }
    const byId = new Map(windows.map(window => [window.id, window]));
    for await (const result of iteratePages(options => repository.listResults(analysisId, options), 500)) {
        // Probe repeats never feed batch selection (v2 spec section 6); actor-scoped codes keep their highest actor score.
        if (result.probe) continue;
        const window = byId.get(result.windowId); if (!window) continue;
        const prior = window.probabilities[result.codeId];
        window.probabilities[result.codeId] = result.actorId && prior != null && result.probability != null ? Math.max(prior, result.probability) : result.probability;
    }
    return { analysisId, runId: job.runId, definitionRevision: job.manifest.codebook.id, evidenceRevision: job.manifest.source.evidenceHash, codeIds: job.manifest.codebook.definitions.filter(d => d.enabled && !d.archived).map(d => d.id), windows };
}

export function createReviewService(repository: Pick<AnalysisRepository, 'getJob' | 'getWindow' | 'listWindows' | 'listResults'>, store: ReviewStore) { return new ReviewService(store, id => reviewContext(repository, id), async (analysisId, windowId) => {
    const window = await repository.getWindow(analysisId, windowId);
    return window ? { id: window.id, eventIds: window.eventIds, stepIds: window.stepIds, probabilities: {} } : null;
}); }

export function createReviewRouteHandler(service: ReviewService, repository: Pick<AnalysisRepository, 'getJob'>): ResearchRouteHandler {
    return async request => {
        const { method, path, query } = request;
        const match = path.match(/^\/analyses\/([^/]+)\/(reviews|review-batches)(?:\/([^/]+))?$/);
        if (!match) return null;
        // Before this refactor every non-GET body was parsed before routing, so size and syntax
        // errors outrank existence errors. Read the body first to keep that precedence.
        const payload = method === 'POST' ? await request.body(REVIEW_BODY_LIMIT) : undefined;
        const id = decodeURIComponent(match[1]!), op = match[2]!, batchId = match[3] && decodeURIComponent(match[3]);
        if (!await repository.getJob(id)) throw new AnalysisNotFound('Analysis not found');
        const after = query.get('after') ?? undefined, limit = Number(query.get('limit') ?? 100);
        if (op === 'reviews' && !batchId) {
            if (method === 'GET') {
                const filter: ReviewListFilter = {};
                for (const key of ['windowId', 'reviewer', 'subjectId', 'codeId'] as const) if (query.has(key)) filter[key] = query.get(key)!;
                if (query.has('scope')) filter.scope = query.get('scope') as ReviewListFilter['scope'];
                if (query.has('latest')) { const value = query.get('latest'); if (value !== 'true' && value !== 'false') throw new AnalysisValidation('latest must be true or false'); filter.latest = value === 'true'; }
                return { status: 200, data: await service.list(id, after, limit, filter) };
            }
            if (method === 'POST') return { status: 201, data: await service.save(id, payload!) };
        }
        if (op === 'review-batches') {
            if (method === 'GET') return { status: 200, data: batchId ? await service.getBatch(id, batchId, { after, limit, reviewer: query.get('reviewer') || undefined, filter: (query.get('filter') ?? 'all') as ReviewQueueFilter }) : await service.listBatches(id, after, limit) };
            if (method === 'POST' && !batchId) return { status: 201, data: await service.createBatch(id, payload!) };
        }
        throw new HttpError(405, 'Method not allowed');
    };
}
