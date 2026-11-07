import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import type { MongoRepository } from '@sidechannel/persistence/harness/repository';
import type { ResearchRouteHandler } from '@sidechannel/contracts/server/contracts';
import { MongoAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { AnalysisService } from '@sidechannel/domain/analysis/jev-service';
import { createAnalysisRouteHandler } from './jev-routes.js';
import { MongoReviewStore } from '@sidechannel/persistence/analysis/review-repository';
import { createReviewRouteHandler, createReviewService } from './review-routes.js';

/** Canonical JEV API, separate from experiment and oversight routes. */
export async function createJevExtension(source: MongoRepository): Promise<ResearchRouteHandler> {
    const repository = new MongoAnalysisRepository(source.client, source.db); await repository.initialize();
    const reviewStore = new MongoReviewStore(source.db); await reviewStore.initialize();
    return createJevRouteExtension(new AnalysisService(repository, source), createReviewService(repository, reviewStore));
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