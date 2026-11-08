import { randomUUID } from 'node:crypto';
import type { Db } from 'mongodb';
import type { ReviewDocument, ReviewQuery, MemberQuery, ReviewKind, ReviewRow, ReviewStore } from '@sidechannel/contracts/analysis/review-repository';

export class MemoryReviewStore implements ReviewStore {
    private rows = new Map<string, ReviewDocument>();
    private identity(kind: ReviewKind, partition: string, key: string) { return JSON.stringify([kind, partition, key]); }
    async insert<T>(kind: ReviewKind, partition: string, key: string, value: T) {
        const identity = this.identity(kind, partition, key);
        if (this.rows.has(identity)) throw new Error('Review revision conflict');
        this.rows.set(identity, structuredClone({ id: randomUUID(), collection: kind, partition, key, value }));
    }
    async get<T>(kind: ReviewKind, partition: string, key: string) { return structuredClone(this.rows.get(this.identity(kind, partition, key)) ?? null) as ReviewRow<T> | null; }
    async page<T>(kind: ReviewKind, partition: string, after = '', limit = 100, selectedOnly = false, members: MemberQuery = {}) {
        const rows = [...this.rows.values()].filter(r => r.collection === kind && r.partition === partition && r.key > after && (!selectedOnly || (r.value as { selected?: boolean }).selected === true)
            && (!members.includeWindowIds || members.includeWindowIds.includes(String((r.value as { windowId?: string }).windowId)))
            && (!members.excludeWindowIds || !members.excludeWindowIds.includes(String((r.value as { windowId?: string }).windowId)))).sort((a, b) => a.key < b.key ? -1 : 1).slice(0, limit + 1);
        return { items: structuredClone(rows.slice(0, limit)) as ReviewRow<T>[], nextCursor: rows.length > limit ? rows[limit - 1]!.key : null };
    }
    async queryReviews<T>(partition: string, query: ReviewQuery, after = '', limit = 100) {
        const value = (row: ReviewDocument) => row.value as Record<string, unknown>;
        let rows = [...this.rows.values()].filter(row => row.collection === 'reviews' && row.partition === partition
            && (!query.windowId || value(row).scope === 'window' && value(row).subjectId === query.windowId || value(row).scope === 'event' && query.eventIds?.includes(String(value(row).subjectId)))
            && Object.entries(query).filter(([key]) => !['windowId', 'eventIds', 'latest'].includes(key)).every(([key, expected]) => expected === undefined || value(row)[key] === expected));
        if (query.latest) {
            const latest = new Map<string, ReviewDocument>();
            for (const row of rows) { const identity = JSON.stringify(['scope', 'subjectId', 'codeId', 'definitionRevision', 'evidenceRevision', 'reviewer'].map(key => value(row)[key])); const prior = (latest.get(identity)?.value as Record<string, unknown> | undefined)?.revision; if (Number(prior ?? 0) < Number(value(row).revision)) latest.set(identity, row); }
            rows = [...latest.values()];
        }
        rows = rows.filter(row => row.key > after).sort((a, b) => a.key < b.key ? -1 : 1).slice(0, limit + 1);
        return { items: structuredClone(rows.slice(0, limit)) as ReviewRow<T>[], nextCursor: rows.length > limit ? rows[limit - 1]!.key : null };
    }
}

export class MongoReviewStore implements ReviewStore {
    constructor(private db: Db) {}
    private collection(kind: ReviewKind) { return this.db.collection<ReviewDocument>('analysis_review_' + kind); }
    async initialize() { await Promise.all([
        ...(['reviews', 'batches', 'members'] as const).map(kind => this.collection(kind).createIndex({ partition: 1, key: 1 }, { unique: true })),
        this.collection('members').createIndex({ partition: 1, 'value.selected': 1, key: 1 }),
        this.collection('reviews').createIndex({ partition: 1, 'value.subjectId': 1, 'value.reviewer': 1, key: 1 }),
        this.collection('reviews').createIndex({ partition: 1, 'value.reviewer': 1, 'value.scope': 1, 'value.codeId': 1, 'value.revision': -1 }),
    ]); }
    async insert<T>(kind: ReviewKind, partition: string, key: string, value: T) {
        // Mint the identity before the bound check so the bound still measures the stored document.
        const document = { id: randomUUID(), collection: kind, partition, key, value };
        if (Buffer.byteLength(JSON.stringify(document)) > 1_000_000) throw new Error('Review document exceeds 1 MB');
        try { await this.collection(kind).insertOne(structuredClone(document)); }
        catch (error) { if ((error as { code?: number }).code === 11000) throw new Error('Review revision conflict'); throw error; }
    }
    async get<T>(kind: ReviewKind, partition: string, key: string) {
        const row = await this.collection(kind).findOne({ partition, key }, { projection: { _id: 0 } });
        return row as ReviewRow<T> | null;
    }
    async page<T>(kind: ReviewKind, partition: string, after = '', limit = 100, selectedOnly = false, members: MemberQuery = {}) {
        const rows = await this.collection(kind).find({ partition, key: { $gt: after }, ...(selectedOnly ? { 'value.selected': true } : {}),
            ...(members.includeWindowIds || members.excludeWindowIds ? { 'value.windowId': { ...(members.includeWindowIds ? { $in: members.includeWindowIds } : {}), ...(members.excludeWindowIds ? { $nin: members.excludeWindowIds } : {}) } } : {}) }, { projection: { _id: 0 } }).sort({ key: 1 }).limit(limit + 1).toArray();
        return { items: rows.slice(0, limit) as ReviewRow<T>[], nextCursor: rows.length > limit ? rows[limit - 1]!.key : null };
    }
    async queryReviews<T>(partition: string, query: ReviewQuery, after = '', limit = 100) {
        const match: Record<string, unknown> = { partition };
        for (const key of ['reviewer', 'subjectId', 'scope', 'codeId', 'definitionRevision', 'evidenceRevision'] as const) if (query[key] !== undefined) match['value.' + key] = query[key];
        if (query.windowId) match.$or = [{ 'value.scope': 'window', 'value.subjectId': query.windowId }, { 'value.scope': 'event', 'value.subjectId': { $in: query.eventIds ?? [] } }];
        const stages: Record<string, unknown>[] = [{ $match: match }];
        if (query.latest) stages.push({ $sort: { 'value.revision': -1 } }, { $group: { _id: Object.fromEntries(['scope', 'subjectId', 'codeId', 'definitionRevision', 'evidenceRevision', 'reviewer'].map(key => [key, '$value.' + key])), document: { $first: '$$ROOT' } } }, { $replaceRoot: { newRoot: '$document' } });
        stages.push({ $match: { key: { $gt: after } } }, { $sort: { key: 1 } }, { $limit: limit + 1 }, { $project: { _id: 0 } });
        const rows = await this.collection('reviews').aggregate<ReviewDocument>(stages, { allowDiskUse: true }).toArray();
        return { items: rows.slice(0, limit) as ReviewRow<T>[], nextCursor: rows.length > limit ? rows[limit - 1]!.key : null };
    }
}
