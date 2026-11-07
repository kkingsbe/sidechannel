import type { AnalysisRepository } from '@sidechannel/contracts/analysis/jev-repository';
import { ReviewService } from '@sidechannel/domain/analysis/jev-reviews';
import type { ReviewContext, ReviewListFilter, ReviewQueueFilter } from '@sidechannel/contracts/analysis/jev-reviews';
import type { ReviewStore } from '@sidechannel/contracts/analysis/review-repository';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';

/** Review bodies stay bounded at 1 MB; core and Jev routes keep the 2 MB default. */
export const REVIEW_BODY_LIMIT = 1_000_000;

export async function reviewContext(repository: Pick<AnalysisRepository, 'getJob' | 'listWindows' | 'listResults'>, analysisId: string): Promise<ReviewContext> {
    const job = await repository.getJob(analysisId);
    if (!job) throw new Error('Analysis not found');
    const windows: ReviewContext['windows'] = [];
    let after: string | undefined;
    do {
        const page = await repository.listWindows(analysisId, { after, limit: 500 });
        windows.push(...page.items.map(w => ({ id: w.id, eventIds: w.eventIds, stepIds: w.stepIds, probabilities: {} })));
        if (windows.length > 100000) throw new Error('Review selection supports at most 100000 windows; narrow the analysis range');
        after = page.nextCursor ?? undefined;
    } while (after);
    const byId = new Map(windows.map(w => [w.id, w]));
    after = undefined;
    do {
        const page = await repository.listResults(analysisId, { after, limit: 500 });
        for (const result of page.items) { const window = byId.get(result.windowId); if (window) window.probabilities[result.codeId] = result.probability; }
        after = page.nextCursor ?? undefined;
    } while (after);
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
        try {
            const id = decodeURIComponent(match[1]!), op = match[2]!, batchId = match[3] && decodeURIComponent(match[3]);
            if (!await repository.getJob(id)) return { status: 404, data: { error: 'Analysis not found' } };
            const after = query.get('after') ?? undefined, limit = Number(query.get('limit') ?? 100);
            if (op === 'reviews' && !batchId) {
                if (method === 'GET') {
                    const filter: ReviewListFilter = {};
                    for (const key of ['windowId', 'reviewer', 'subjectId', 'codeId'] as const) if (query.has(key)) filter[key] = query.get(key)!;
                    if (query.has('scope')) filter.scope = query.get('scope') as ReviewListFilter['scope'];
                    if (query.has('latest')) { const value = query.get('latest'); if (value !== 'true' && value !== 'false') throw new Error('latest must be true or false'); filter.latest = value === 'true'; }
                    return { status: 200, data: await service.list(id, after, limit, filter) };
                }
                if (method === 'POST') return { status: 201, data: await service.save(id, payload!) };
            }
            if (op === 'review-batches') {
                if (method === 'GET') return { status: 200, data: batchId ? await service.getBatch(id, batchId, { after, limit, reviewer: query.get('reviewer') || undefined, filter: (query.get('filter') ?? 'all') as ReviewQueueFilter }) : await service.listBatches(id, after, limit) };
                if (method === 'POST' && !batchId) return { status: 201, data: await service.createBatch(id, payload!) };
            }
            return { status: 405, data: { error: 'Method not allowed' } };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Review request failed';
            return { status: /conflict|stale/.test(message) ? 409 : /not found/.test(message) ? 404 : 400, data: { error: message } };
        }
    };
}
