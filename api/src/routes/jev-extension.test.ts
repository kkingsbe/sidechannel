import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryAnalysisRepository } from '@sidechannel/persistence/analysis/jev-repository';
import { MemoryReviewStore } from '@sidechannel/persistence/analysis/review-repository';
import { InMemoryRepository } from '@sidechannel/persistence/harness/repository';
import { createJevExtension } from './jev-extension.js';

test('the JEV extension is composed from injected ports and never constructs a Mongo adapter', async () => {
    const analysis = new InMemoryAnalysisRepository();
    const reviews = new MemoryReviewStore();
    const source = new InMemoryRepository();
    const handler = createJevExtension(analysis, reviews, source);
    const response = await handler({ method: 'GET', path: '/jev/codebooks', query: new URLSearchParams(), body: {} });
    assert.equal(response?.status, 200);
    assert.equal((response?.data as { items: unknown[] }).items.length, 1); // the seeded tentative default
});
