import type { IncomingMessage } from 'node:http';
import type { AnalysisRepository } from '@sidechannel/contracts/analysis/jev-repository';
import { ReviewService } from '@sidechannel/domain/analysis/jev-reviews';
import type { ReviewContext, ReviewListFilter, ReviewQueueFilter } from '@sidechannel/contracts/analysis/jev-reviews';
import type { ReviewStore } from '@sidechannel/contracts/analysis/review-repository';

export async function reviewContext(repository: AnalysisRepository, analysisId: string): Promise<ReviewContext> {
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

export function createReviewService(repository: AnalysisRepository, store: ReviewStore) { return new ReviewService(store, id => reviewContext(repository, id), async (analysisId, windowId) => {
    const window = await repository.getWindow(analysisId, windowId);
    return window ? { id: window.id, eventIds: window.eventIds, stepIds: window.stepIds, probabilities: {} } : null;
}); }

async function body(req: IncomingMessage) {
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of req) { const b = Buffer.from(chunk); bytes += b.length; if (bytes > 1_000_000) throw new Error('Review request exceeds 1 MB'); chunks.push(b); }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object');
    return parsed as Record<string, unknown>;
}

export function createReviewRouteHandler(service: ReviewService, repository: AnalysisRepository) {
    return async (req: IncomingMessage, url: URL) => {
        const match = url.pathname.match(/^\/api\/analyses\/([^/]+)\/(reviews|review-batches)(?:\/([^/]+))?$/);
        if (!match) return null;
        try {
            const id = decodeURIComponent(match[1]!), op = match[2]!, batchId = match[3] && decodeURIComponent(match[3]);
            if (!await repository.getJob(id)) return { status: 404, body: { error: 'Analysis not found' } };
            const after = url.searchParams.get('after') ?? undefined, limit = Number(url.searchParams.get('limit') ?? 100);
            if (op === 'reviews' && !batchId) {
                if (req.method === 'GET') {
                    const filter: ReviewListFilter = {};
                    for (const key of ['windowId', 'reviewer', 'subjectId', 'codeId'] as const) if (url.searchParams.has(key)) filter[key] = url.searchParams.get(key)!;
                    if (url.searchParams.has('scope')) filter.scope = url.searchParams.get('scope') as ReviewListFilter['scope'];
                    if (url.searchParams.has('latest')) { const value = url.searchParams.get('latest'); if (value !== 'true' && value !== 'false') throw new Error('latest must be true or false'); filter.latest = value === 'true'; }
                    return { status: 200, body: await service.list(id, after, limit, filter) };
                }
                if (req.method === 'POST') return { status: 201, body: await service.save(id, await body(req)) };
            }
            if (op === 'review-batches') {
                if (req.method === 'GET') return { status: 200, body: batchId ? await service.getBatch(id, batchId, { after, limit, reviewer: url.searchParams.get('reviewer') || undefined,
                    filter: (url.searchParams.get('filter') ?? 'all') as ReviewQueueFilter }) : await service.listBatches(id, after, limit) };
                if (req.method === 'POST' && !batchId) return { status: 201, body: await service.createBatch(id, await body(req)) };
            }
            return { status: 405, body: { error: 'Method not allowed' } };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Review request failed';
            return { status: /conflict|stale/.test(message) ? 409 : /not found/.test(message) ? 404 : 400, body: { error: message } };
        }
    };
}