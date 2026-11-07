import test from 'node:test';
import assert from 'node:assert/strict';
import type { Page, ResearchRecord, ResearchStore } from '@sidechannel/contracts/analysis/store';
import type { MonitorEvaluation } from '@sidechannel/contracts/oversight/contracts';
import { cancelMonitor } from './cancel.js';

const job = (revision: number): MonitorEvaluation => ({ schemaVersion: 1, id: 'monitor-1', revision,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', idempotencyKey: 'key', previewId: 'preview-1',
    previewHash: 'hash', definition: { id: 'definition:1', schemaVersion: 1, revision: 1, createdAt: '2026-01-01T00:00:00.000Z', questions: 'q', outcomes: [] },
    settings: { model: { provider: 'test', id: 'model', settings: {} }, maxInputChars: 1000, contextWindowTokens: 1000, outputAllowanceTokens: 128, timeoutMs: 1000 },
    runIds: [], status: 'queued', cancelRequested: false, results: [] });

/** replace() answers per attempt; the CAS loop must give up after the eighth false. */
function store(outcomes: boolean[], current = job(1)): { store: ResearchStore; attempts: () => number } {
    let attempts = 0;
    const unused = async (): Promise<never> => { throw new Error('unused'); };
    const value: ResearchStore = {
        async get<T extends ResearchRecord>(): Promise<T | null> { return JSON.parse(JSON.stringify(current)) as T; },
        async insert<T extends ResearchRecord>(): Promise<boolean> { return unused(); },
        async replace<T extends ResearchRecord>(): Promise<boolean> { attempts++; return outcomes[Math.min(attempts - 1, outcomes.length - 1)]!; },
        async page<T extends ResearchRecord>(): Promise<Page<T>> { return unused(); },
        async claim(): Promise<boolean> { return unused(); },
        async renew(): Promise<boolean> { return unused(); },
        async release(): Promise<void> { return unused(); },
    };
    return { store: value, attempts: () => attempts };
}

test('cancelling retries the revision CAS and publishes the next revision', async () => {
    const fake = store([false, false, false, true]);
    const next = await cancelMonitor(fake.store, 'monitor-1');
    assert.equal(next.cancelRequested, true);
    assert.equal(next.revision, 2);
    assert.equal(fake.attempts(), 4);
});

test('cancelling gives up after eight optimistic attempts with the documented conflict', async () => {
    const fake = store(Array.from({ length: 8 }, () => false));
    await assert.rejects(cancelMonitor(fake.store, 'monitor-1'), /Evaluation changed while cancelling/);
    assert.equal(fake.attempts(), 8);
});
