import type { AnalysisRepository } from '@sidechannel/contracts/analysis/jev-repository';
import type { ReviewStore } from '@sidechannel/contracts/analysis/review-repository';
import type { Repository } from '@sidechannel/contracts/harness/server';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { AnalysisService } from '@sidechannel/domain/analysis/jev-service';
import { createAnalysisRouteHandler } from './jev-routes.js';
import { createReviewRouteHandler, createReviewService } from './review-routes.js';

/** Canonical JEV API. Repositories arrive fully initialized from the composition root. */
export function createJevExtension(repository: AnalysisRepository, reviews: ReviewStore, source: Pick<Repository, 'getRun' | 'listEvents'>): ResearchRouteHandler {
    return createJevRouteExtension(new AnalysisService(repository, source), createReviewService(repository, reviews));
}

export function createJevRouteExtension(service: AnalysisService, reviews: ReturnType<typeof createReviewService>): ResearchRouteHandler {
    const analysisHandler = createAnalysisRouteHandler(service), reviewHandler = createReviewRouteHandler(reviews, service.repository);
    return async request => {
        if (!request.path.startsWith('/jev/')) return null;
        const forwarded = { ...request, path: request.path.slice('/jev'.length) };
        if (forwarded.path === '/codebooks' && request.method === 'GET') await service.seedCodebook();
        const exported = forwarded.path.match(/^\/analyses\/([^/]+)\/export$/);
        if (exported && request.method === 'GET') {
            const id = decodeURIComponent(exported[1]!); await service.getJob(id);
            async function* records() { yield* service.exportAnalysis(id); yield* reviews.export(id); }
            return { status: 200, data: records() };
        }
        return await reviewHandler(forwarded) ?? await analysisHandler(forwarded) ?? { status: 404, data: { error: 'Jev route not found' } };
    };
}
