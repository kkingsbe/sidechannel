import type { Db } from 'mongodb';
import type { Comparison, ComparisonStore } from '@sidechannel/contracts/analysis/aggregation';
import { AnalysisConflict, AnalysisValidation, type Page, type PageOptions } from '@sidechannel/contracts/analysis/jev-repository';

const copy = <T>(v: T): T => structuredClone(v);

const size = (p: PageOptions = {}) => { const n = p.limit ?? 100; if (!Number.isSafeInteger(n) || n < 1 || n > 500) throw new AnalysisValidation('Page limit must be an integer from 1 to 500'); return n; };

const bounded = (v: unknown) => { if (Buffer.byteLength(JSON.stringify(v)) > 1024 * 1024) throw new AnalysisValidation('Comparison exceeds 1 MiB; compare fewer analyses'); };

/** Comparisons are immutable and ordered by ID, newest-first ordering is the caller's concern (IDs are opaque). */
export class InMemoryComparisonStore implements ComparisonStore {
    private rows = new Map<string, Comparison>();
    async putComparison(comparison: Comparison) {
        bounded(comparison);
        if (this.rows.has(comparison.id)) throw new AnalysisConflict('Comparison already exists');
        this.rows.set(comparison.id, copy(comparison));
    }
    async getComparison(id: string) { return copy(this.rows.get(id) ?? null); }
    async listComparisons(filter: { runId?: string } = {}, p: PageOptions = {}): Promise<Page<Comparison>> {
        const n = size(p), rows = [...this.rows.values()].filter(c => (!filter.runId || c.runIds.includes(filter.runId)) && (!p.after || c.id > p.after)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, n + 1);
        return copy({ items: rows.slice(0, n), nextCursor: rows.length > n ? rows[n - 1]!.id : null });
    }
}

export class MongoComparisonStore implements ComparisonStore {
    constructor(private db: Db) {}
    private get collection() { return this.db.collection<Comparison>('analysis_comparisons'); }
    async initialize() { await Promise.all([this.collection.createIndex({ id: 1 }, { unique: true }), this.collection.createIndex({ runIds: 1, id: 1 })]); }
    async putComparison(comparison: Comparison) {
        bounded(comparison);
        try { await this.collection.insertOne(copy(comparison)); }
        catch (error) { if ((error as { code?: number }).code === 11000) throw new AnalysisConflict('Comparison already exists'); throw error; }
    }
    async getComparison(id: string) { return await this.collection.findOne({ id }, { projection: { _id: 0 } }) as Comparison | null; }
    async listComparisons(filter: { runId?: string } = {}, p: PageOptions = {}): Promise<Page<Comparison>> {
        const n = size(p), rows = await this.collection.find({ ...(filter.runId ? { runIds: filter.runId } : {}), ...(p.after ? { id: { $gt: p.after } } : {}) }, { projection: { _id: 0 } }).sort({ id: 1 }).limit(n + 1).toArray() as Comparison[];
        return { items: rows.slice(0, n), nextCursor: rows.length > n ? rows[n - 1]!.id : null };
    }
}
