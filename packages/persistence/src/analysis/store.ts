import type { Db, Document } from 'mongodb';
import type { ResearchCollection, ResearchRecord, Page, ResearchFilter, ResearchStore } from '@sidechannel/contracts/analysis/store';

export class InMemoryResearchStore implements ResearchStore {
  private collections = new Map<string, Map<string, ResearchRecord>>();
  private leases = new Map<string, { owner: string; until: number }>();
  private rows(collection: ResearchCollection) { let rows = this.collections.get(collection); if (!rows) { rows = new Map(); this.collections.set(collection, rows); } return rows; }
  async get<T extends ResearchRecord>(collection: ResearchCollection, id: string) { return structuredClone(this.rows(collection).get(id) as T ?? null); }
  async insert<T extends ResearchRecord>(collection: ResearchCollection, record: T) { const rows = this.rows(collection); if (rows.has(record.id)) return false; rows.set(record.id, structuredClone(record)); return true; }
  async replace<T extends ResearchRecord>(collection: ResearchCollection, id: string, expectedRevision: number, record: T) { const rows = this.rows(collection); if (rows.get(id)?.revision !== expectedRevision) return false; rows.set(id, structuredClone(record)); return true; }
  async page<T extends ResearchRecord>(collection: ResearchCollection, filter: ResearchFilter = {}, after = '', limit = 50): Promise<Page<T>> { const size = Math.max(1, Math.min(200, limit)); const rows = [...this.rows(collection).values()].filter(row => row.id > after && Object.entries(filter).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, size + 1) as T[]; return { items: structuredClone(rows.slice(0, size)), nextCursor: rows.length > size ? rows[size - 1]!.id : null }; }
  async claim(scope: string, id: string, owner: string, ttlMs: number) { const key = `${scope}:${id}`; const lease = this.leases.get(key); if (lease && lease.until > Date.now()) return false; this.leases.set(key, { owner, until: Date.now() + ttlMs }); return true; }
  async renew(scope: string, id: string, owner: string, ttlMs: number) { const lease = this.leases.get(`${scope}:${id}`); if (!lease || lease.owner !== owner || lease.until <= Date.now()) return false; lease.until = Date.now() + ttlMs; return true; }
  async release(scope: string, id: string, owner: string) { if (this.leases.get(`${scope}:${id}`)?.owner === owner) this.leases.delete(`${scope}:${id}`); }
}

const clean = <T>(row: Document | null): T | null => { if (!row) return null; const { _id, ...rest } = row; return rest as T; };

/** Research collections never share the harness worker guard or mutate source runs. */
export class MongoResearchStore implements ResearchStore {
  constructor(readonly db: Db) {}
  private collection(name: ResearchCollection) { if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Invalid research collection'); return this.db.collection(`research_${name}`); }
  async initialize() { await this.db.collection('research_leases').createIndex({ expiresAt: 1 }); }
  async get<T extends ResearchRecord>(collection: ResearchCollection, id: string) { return clean<T>(await this.collection(collection).findOne({ _id: id as unknown as Document['_id'] })); }
  async insert<T extends ResearchRecord>(collection: ResearchCollection, record: T) { try { await this.collection(collection).insertOne({ ...record, _id: record.id as unknown as Document['_id'] }); return true; } catch (error) { if ((error as { code?: number }).code === 11000) return false; throw error; } }
  async replace<T extends ResearchRecord>(collection: ResearchCollection, id: string, expectedRevision: number, record: T) { const result = await this.collection(collection).replaceOne({ _id: id as unknown as Document['_id'], revision: expectedRevision }, { ...record, _id: id as unknown as Document['_id'] }); return result.matchedCount === 1; }
  async page<T extends ResearchRecord>(collection: ResearchCollection, filter: ResearchFilter = {}, after = '', limit = 50): Promise<Page<T>> { const size = Math.max(1, Math.min(200, limit)); const rows = await this.collection(collection).find({ ...filter, id: { $gt: after } }).sort({ id: 1 }).limit(size + 1).toArray(); return { items: rows.slice(0, size).map(row => clean<T>(row)!), nextCursor: rows.length > size ? String(rows[size - 1]!.id) : null }; }
  async claim(scope: string, id: string, owner: string, ttlMs: number) { const leases = this.db.collection('research_leases'); const key = `${scope}:${id}`; try { const result = await leases.updateOne({ _id: key as unknown as Document['_id'], $or: [{ expiresAt: { $lte: new Date() } }, { expiresAt: { $exists: false } }] }, { $set: { owner, expiresAt: new Date(Date.now() + ttlMs) } }, { upsert: true }); return Boolean(result.modifiedCount || result.upsertedCount); } catch (error) { if ((error as { code?: number }).code === 11000) return false; throw error; } }
  async renew(scope: string, id: string, owner: string, ttlMs: number) { const result = await this.db.collection('research_leases').updateOne({ _id: `${scope}:${id}` as unknown as Document['_id'], owner, expiresAt: { $gt: new Date() } }, { $set: { expiresAt: new Date(Date.now() + ttlMs) } }); return result.modifiedCount === 1; }
  async release(scope: string, id: string, owner: string) { await this.db.collection('research_leases').deleteOne({ _id: `${scope}:${id}` as unknown as Document['_id'], owner }); }
}
