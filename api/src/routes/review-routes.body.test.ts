import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { MemoryReviewStore } from '@sidechannel/persistence/analysis/review-repository';
import { AnalysisService } from '@sidechannel/domain/analysis/jev-service';
import { createResearcherServer } from '../server/index.js';
import { createJevRouteExtension } from './jev-extension.js';
import { createReviewService } from './review-routes.js';

test('review bodies are capped at 1 MB while core and Jev bodies keep 2 MB', async () => {
    const source = new InMemoryRepository(), repository = new InMemoryAnalysisRepository();
    const service = new AnalysisService(repository, source), reviews = createReviewService(repository, new MemoryReviewStore());
    const server = createResearcherServer(source, { extensionHandlers: [createJevRouteExtension(service, reviews)] });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const post = (path: string, body: string) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    try {
        const review = await post('/jev/analyses/missing/reviews', JSON.stringify({ note: 'x'.repeat(1_100_000) }));
        assert.equal(review.status, 413);
        assert.match(await review.text(), /exceeds 1 MB/);
        const core = await post('/drafts', JSON.stringify({ id: 'd', config: { note: 'x'.repeat(2_100_000) } }));
        assert.equal(core.status, 413);
        assert.match(await core.text(), /exceeds 2 MB/);
        const jev = await post('/jev/codebooks', JSON.stringify({ name: 'x'.repeat(2_100_000) }));
        assert.equal(jev.status, 413);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
