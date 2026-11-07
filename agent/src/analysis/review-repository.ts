import type { Db } from 'mongodb';

export interface ReviewDocument { id: string; collection: 'reviews' | 'batches' | 'members'; partition: string; key: string; value: Record<string, unknown> }
export interface ReviewStore {
    insert(record: ReviewDocument): Promise<void>;
    get(collection: ReviewDocument['collection'], partition: string, key: string): Promise<ReviewDocument | null>;
    page(collection: ReviewDocument['collection'], partition: string, after?: string, limit?: number, selectedOnly?: boolean): Promise<{ items: ReviewDocument[]; nextCursor: string | null }>;
}
export class MemoryReviewStore implements ReviewStore {
    private rows = new Map<string, ReviewDocument>();
    async insert(record: ReviewDocument) {
        const key = JSON.stringify([record.collection, record.partition, record.key]);
        if (this.rows.has(key)) throw new Error('Review revision conflict');
        this.rows.set(key, structuredClone(record));
    }
    async get(collection: ReviewDocument['collection'], partition: string, key: string) { return structuredClone(this.rows.get(JSON.stringify([collection, partition, key])) ?? null); }
    async page(collection: ReviewDocument['collection'], partition: string, after = '', limit = 100, selectedOnly = false) {
        const rows = [...this.rows.values()].filter(r => r.collection === collection && r.partition === partition && r.key > after && (!selectedOnly || r.value.selected === true)).sort((a, b) => a.key < b.key ? -1 : 1).slice(0, limit + 1);
        return { items: structuredClone(rows.slice(0, limit)), nextCursor: rows.length > limit ? rows[limit - 1]!.key : null };
    }
}
export class MongoReviewStore implements ReviewStore {
    constructor(private db: Db) {}
    private collection(kind: ReviewDocument['collection']) { return this.db.collection<ReviewDocument>('analysis_review_' + kind); }
    async initialize() { await Promise.all([
        ...(['reviews', 'batches', 'members'] as const).map(kind => this.collection(kind).createIndex({ partition: 1, key: 1 }, { unique: true })),
        this.collection('members').createIndex({ partition: 1, 'value.selected': 1, key: 1 }),
    ]); }
    async insert(record: ReviewDocument) {
        if (Buffer.byteLength(JSON.stringify(record)) > 1_000_000) throw new Error('Review document exceeds 1 MB');
        try { await this.collection(record.collection).insertOne(structuredClone(record)); }
        catch (error) { if ((error as { code?: number }).code === 11000) throw new Error('Review revision conflict'); throw error; }
    }
    async get(collection: ReviewDocument['collection'], partition: string, key: string) {
        const row = await this.collection(collection).findOne({ partition, key }, { projection: { _id: 0 } });
        return row as ReviewDocument | null;
    }
    async page(collection: ReviewDocument['collection'], partition: string, after = '', limit = 100, selectedOnly = false) {
        const rows = await this.collection(collection).find({ partition, key: { $gt: after }, ...(selectedOnly ? { 'value.selected': true } : {}) }, { projection: { _id: 0 } }).sort({ key: 1 }).limit(limit + 1).toArray();
        return { items: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1]!.key : null };
    }
}
