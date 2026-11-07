import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { MonitorStore } from '@sidechannel/contracts/oversight/blob-store';

export interface BlobStoreHarness {
    name: string;
    fixture(): Promise<{ store: MonitorStore; dispose(): Promise<void> }>;
}

const sha256 = (text: string) => createHash('sha256').update(JSON.stringify(text)).digest('hex');
const CHUNK = 250_000;

export function blobStoreContract(harness: BlobStoreHarness): void {
    test(`${harness.name}: blobs round-trip losslessly with a manifest and content hash`, async (t) => {
        const { store, dispose } = await harness.fixture();
        t.after(dispose);
        const id = 'blob-1', createdAt = '2026-01-01T00:00:00.000Z', text = JSON.stringify({ value: 'x'.repeat(600_000) });
        const manifest = await store.putBlob({ id, createdAt, text });
        assert.equal(manifest.partCount, Math.ceil(text.length / CHUNK));
        assert.equal(manifest.contentHash, sha256(text));
        const blob = await store.getBlob(id);
        assert.equal(blob!.text, text);
        assert.equal(blob!.complete, true);
        assert.equal(blob!.manifest.contentHash, manifest.contentHash);
        assert.equal(await store.getBlob('missing'), null);
    });

    test(`${harness.name}: parts are addressed by index and existence is separate from content`, async (t) => {
        const { store, dispose } = await harness.fixture();
        t.after(dispose);
        const text = JSON.stringify({ value: 'y'.repeat(300_000) });
        const manifest = await store.putBlob({ id: 'blob-2', createdAt: '2026-01-01T00:00:00.000Z', text });
        assert.equal(manifest.partCount, 2);
        const page = await store.page<{ id: string; text: string; revision: number; createdAt: string }>('monitor_preview_parts', {}, '', 50);
        const owned = page.items.filter(part => part.id.startsWith('blob-2:')).sort((left, right) => left.id.localeCompare(right.id));
        assert.deepEqual(owned.map(part => part.id), ['blob-2:0', 'blob-2:1']);
        assert.equal(owned.every(part => part.text.length <= CHUNK), true);
        // Existence, not content, is what the adapter reports: an overwritten part still exists, so the
        // domain's content-hash check is what rejects tampered text (packages/domain/src/oversight/preview.ts).
        const second = owned[1]!;
        assert.equal(await store.replace('monitor_preview_parts', second.id, second.revision, { ...second, revision: second.revision + 1, text: 'tampered' }), true);
        const blob = await store.getBlob('blob-2');
        assert.equal(blob!.complete, true);
        assert.equal(blob!.manifest.contentHash, manifest.contentHash);
        assert.notEqual(blob!.text, text);
    });

    test(`${harness.name}: re-putting identical content is accepted and a changed blob cannot overwrite parts`, async (t) => {
        const { store, dispose } = await harness.fixture();
        t.after(dispose);
        const blob = { id: 'blob-4', createdAt: '2026-01-01T00:00:00.000Z', text: JSON.stringify({ value: 'stable' }) };
        const first = await store.putBlob(blob);
        assert.deepEqual(await store.putBlob(blob), first);
        assert.equal((await store.getBlob('blob-4'))!.text, blob.text);
        const changed = await store.putBlob({ ...blob, text: JSON.stringify({ value: 'changed' }) });
        const stored = await store.getBlob('blob-4');
        assert.equal(stored!.text, blob.text);
        assert.notEqual(stored!.manifest.contentHash, changed.contentHash);
    });
}
