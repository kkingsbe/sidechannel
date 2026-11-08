import type { Db } from 'mongodb';

/** The only place harness collection names appear. */
export const COLLECTIONS = {
    runs: 'runs',
    events: 'events',
    operations: 'operations',
    drafts: 'drafts',
    counters: 'counters',
    /** Single lease document per database: `{ key: 'single-worker', owner, startedAt, heartbeatAt, capacity }`; `capacity` is the holder's parallel run lanes. */
    workerGuard: 'worker_guard',
} as const;

export interface IndexSpec { collection: string; keys: Record<string, 1 | -1>; unique?: boolean }

export const HARNESS_INDEXES: readonly IndexSpec[] = [
    { collection: COLLECTIONS.runs, keys: { id: 1 }, unique: true },
    { collection: COLLECTIONS.runs, keys: { launchKey: 1 }, unique: true },
    { collection: COLLECTIONS.runs, keys: { status: 1, createdAt: 1 } },
    { collection: COLLECTIONS.events, keys: { id: 1 }, unique: true },
    { collection: COLLECTIONS.events, keys: { runId: 1, sequence: 1 }, unique: true },
    { collection: COLLECTIONS.events, keys: { runId: 1, agentId: 1, turn: 1 } },
    { collection: COLLECTIONS.operations, keys: { runId: 1, operationId: 1 }, unique: true },
    { collection: COLLECTIONS.drafts, keys: { id: 1 }, unique: true },
    { collection: COLLECTIONS.counters, keys: { runId: 1 }, unique: true },
    // First writer wins the lease; takeover is a conditional heartbeatAt update on the same document.
    { collection: COLLECTIONS.workerGuard, keys: { key: 1 }, unique: true },
];

/** Legacy editable drafts predate optimistic revisions; migrate once without changing content. */
export async function migrateLegacyDrafts(db: Db): Promise<void> {
    await db.collection(COLLECTIONS.drafts).updateMany({ revision: { $exists: false } }, { $set: { revision: 1 } });
}

export async function initializeHarnessSchema(db: Db): Promise<void> {
    await Promise.all(HARNESS_INDEXES.map(index =>
        db.collection(index.collection).createIndex(index.keys, index.unique ? { unique: true } : {})));
    await migrateLegacyDrafts(db);
}
