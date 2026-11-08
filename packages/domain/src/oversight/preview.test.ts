import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { MonitorStore } from '@sidechannel/contracts/oversight/blob-store';
import type { Page, ResearchRecord } from '@sidechannel/contracts/analysis/store';
import type { MonitorPreview } from '@sidechannel/contracts/oversight/contracts';
import { defaultMonitorDefinition } from './definition.js';
import { getMonitorPreview } from './preview.js';

const jsonHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const preview = (): MonitorPreview => ({ schemaVersion: 1, revision: 1, id: 'preview-1', createdAt: '2026-01-01T00:00:00.000Z',
    definition: defaultMonitorDefinition(), settings: { model: { provider: 'test', id: 'model', settings: {} }, maxInputChars: 1000,
        contextWindowTokens: 1000, outputAllowanceTokens: 128, timeoutMs: 1000 }, runs: [], hash: 'preview-hash' });

/** Only the blob port is exercised; every record read throws to prove previews never touch records. */
function store(entries: Map<string, { text: string; contentHash: string }>, complete = true): MonitorStore {
    const unused = async (): Promise<never> => { throw new Error('records must not be read for a frozen preview'); };
    return {
        async getBlob(id: string) {
            const entry = entries.get(id);
            return entry ? { manifest: { id, createdAt: '2026-01-01T00:00:00.000Z', partCount: 1, contentHash: entry.contentHash }, text: entry.text, complete } : null;
        },
        async putBlob() { return { id: 'unused', createdAt: 'unused', partCount: 1, contentHash: 'unused' }; },
        async get<T extends ResearchRecord>(): Promise<T | null> { return unused(); },
        async insert<T extends ResearchRecord>(): Promise<boolean> { return unused(); },
        async replace<T extends ResearchRecord>(): Promise<boolean> { return unused(); },
        async page<T extends ResearchRecord>(): Promise<Page<T>> { return unused(); },
        async claim(): Promise<boolean> { return unused(); },
        async renew(): Promise<boolean> { return unused(); },
        async release(): Promise<void> { return unused(); },
    };
}

test('a frozen preview round-trips through the blob port and verifies its content hash', async () => {
    const value = preview(), text = JSON.stringify(value);
    const entries = new Map([['preview-1', { text, contentHash: jsonHash(text) }]]);
    assert.deepEqual(await getMonitorPreview(store(entries), 'preview-1'), value);
    assert.equal(await getMonitorPreview(store(entries), 'missing'), null);
});

test('tampered or absent preview parts fail integrity validation', async () => {
    const value = preview(), text = JSON.stringify(value);
    const entries = new Map([['preview-1', { text: text + 'tampered', contentHash: jsonHash(text) }]]);
    await assert.rejects(getMonitorPreview(store(entries), 'preview-1'), /integrity check failed/);
    await assert.rejects(getMonitorPreview(store(entries, false), 'preview-1'), /part is missing/);
});
