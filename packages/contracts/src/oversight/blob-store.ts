import type { ResearchStore } from '../analysis/store.js';

export interface BlobManifest { id: string; createdAt: string; partCount: number; contentHash: string }

/**
 * Immutable blob storage for documents that exceed a single store document's size limit.
 * The adapter owns the part layout; callers own integrity policy.
 */
export interface BlobStore {
    /** Stores `text` under `id` and publishes the manifest last. Identical content is accepted unchanged. */
    putBlob(blob: { id: string; createdAt: string; text: string }): Promise<BlobManifest>;
    /** Returns `null` when no manifest exists; `complete: false` when any part is absent. */
    getBlob(id: string): Promise<{ manifest: BlobManifest; text: string; complete: boolean } | null>;
}

/** Oversight documents that need both research records and frozen blob storage. */
export type MonitorStore = ResearchStore & BlobStore;
