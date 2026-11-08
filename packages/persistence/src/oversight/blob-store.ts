import { hash } from '@sidechannel/domain/analysis/store';
import { previewPartKey, type ResearchStore } from '@sidechannel/contracts/analysis/store';
import type { BlobManifest, BlobStore } from '@sidechannel/contracts/oversight/blob-store';

/** 250 000 characters stays far below Mongo's 16 MiB document limit for UTF-16 text. */
const CHUNK = 250_000;

/**
 * Parts plus a small manifest. Row shape, chunk size and content hash are the historical frozen
 * preview format: changing any of them invalidates previews written before this refactor.
 */
export class ResearchBlobStore implements BlobStore {
    constructor(private readonly store: ResearchStore) {}

    async putBlob(blob: { id: string; createdAt: string; text: string }): Promise<BlobManifest> {
        const partCount = Math.ceil(blob.text.length / CHUNK);
        for (let index = 0; index < partCount; index++)
            await this.store.insert('monitor_preview_parts', { id: previewPartKey(blob.id, index), revision: 1,
                createdAt: blob.createdAt, text: blob.text.slice(index * CHUNK, (index + 1) * CHUNK) });
        const manifest: BlobManifest = { id: blob.id, createdAt: blob.createdAt, partCount, contentHash: hash(blob.text) };
        await this.store.insert('monitor_previews', { ...manifest, revision: 1 });
        return manifest;
    }

    async getBlob(id: string) {
        const manifest = await this.store.get<BlobManifest & { revision: number }>('monitor_previews', id);
        if (!manifest) return null;
        const parts: string[] = [];
        let complete = true;
        for (let index = 0; index < manifest.partCount; index++) {
            const part = await this.store.get<{ id: string; revision: number; createdAt: string; text: string }>('monitor_preview_parts', previewPartKey(id, index));
            if (!part) complete = false;
            else parts.push(part.text);
        }
        return { manifest, text: parts.join(''), complete };
    }
}
