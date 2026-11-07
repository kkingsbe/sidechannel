import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
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
        const incomingPath = request.path.startsWith('/api/') ? request.path : '/api' + request.path;
        if (!incomingPath.startsWith('/api/jev/')) return null;
        const path = '/api/' + incomingPath.slice('/api/jev/'.length), url = new URL(path, 'http://localhost');
        url.search = request.query.toString();
        const req = Object.assign(Readable.from([JSON.stringify(request.body)]), { method: request.method }) as IncomingMessage;
        try {
            if (path === '/api/codebooks' && request.method === 'GET') await service.seedCodebook();
            const exported = path.match(/^\/api\/analyses\/([^/]+)\/export$/);
            if (exported && request.method === 'GET') {
                const id = decodeURIComponent(exported[1]!); await service.getJob(id);
                async function* records() { yield* service.exportAnalysis(id); yield* reviews.export(id); }
                return { status: 200, data: records() };
            }
            const result = await reviewHandler(req, url) ?? await analysisHandler(req, url);
            return result ? { status: result.status, data: result.body } : { status: 404, data: { error: 'Jev route not found' } };
        } catch (error) {
            return { status: typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 400, data: { error: error instanceof Error ? error.message : 'Jev request failed' } };
        }
    };
}