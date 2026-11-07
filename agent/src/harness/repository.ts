import { randomUUID } from 'node:crypto';
import { MongoClient, type Db, type Document } from 'mongodb';
import type { ExperimentConfig, HarnessEvent, NewEvent, Repository, Run } from './contracts.js';
export interface Draft {
    id: string;
    config: ExperimentConfig;
    updatedAt: string;
}
const clone = <T>(value: T): T => structuredClone(value);
const clean = <T>(value: Document | null): T | null => {
    if (!value)
        return null;
    const { _id, owner, ...rest } = value;
    return rest as T;
};
export class InMemoryRepository implements Repository {
    protected runs = new Map<string, Run>();
    protected events: HarnessEvent[] = [];
    protected drafts = new Map<string, Draft>();
    private claims = new Set<string>();
    async getRun(id: string) { return clone(this.runs.get(id) ?? null); }
    async listRuns() { return clone([...this.runs.values()].reverse()); }
    async createRun(run: Run) {
        const existing = [...this.runs.values()].find(r => r.launchKey === run.launchKey);
        if (existing)
            return clone(existing);
        if (this.runs.has(run.id))
            throw new Error('Duplicate run ID');
        this.runs.set(run.id, clone(run));
        return clone(run);
    }
    async createPair(runs: Run[]) {
        const existing = runs.map(run => [...this.runs.values()].find(r => r.launchKey === run.launchKey));
        if (existing.some(Boolean) && !existing.every(Boolean))
            throw new Error('Incomplete pair');
        if (existing.every(Boolean))
            return clone(existing as Run[]);
        return Promise.all(runs.map(run => this.createRun(run)));
    }
    async saveRun(run: Run) {
        const current = this.runs.get(run.id);
        if (!current)
            throw new Error('Run not found');
        const next = clone(run);
        next.config = current.config;
        next.configHash = current.configHash;
        next.launchKey = current.launchKey;
        next.createdAt = current.createdAt;
        if (current.cancelRequested) {
            next.cancelRequested = true;
            if (['queued', 'running', 'reporting', 'completed'].includes(next.status))
                next.status = 'stopping';
        }
        this.runs.set(run.id, next);
    }
    async claimRun(id: string, _workerId: string) {
        const run = this.runs.get(id);
        if (!run || run.status !== 'queued' || this.claims.has(id))
            return false;
        this.claims.add(id);
        run.status = 'running';
        return true;
    }
    async appendEvent(event: NewEvent) {
        const record: HarnessEvent = { ...clone(event), schemaVersion: 1, id: randomUUID(), timestamp: new Date().toISOString(), sequence: this.events.filter(e => e.runId === event.runId).length + 1 };
        this.events.push(record);
        return clone(record);
    }
    async listEvents(id: string, afterSequence = 0, limit = 1000) { return clone(this.events.filter(e => e.runId === id && e.sequence > afterSequence).slice(0, limit)); }
    async saveDraft(id: string, config: ExperimentConfig) { const draft = { id, config: clone(config), updatedAt: new Date().toISOString() }; this.drafts.set(id, draft); return clone(draft); }
    async listDrafts() { return clone([...this.drafts.values()]); }
    async getDraft(id: string) { return clone(this.drafts.get(id) ?? null); }
    async requestCancel(id: string) {
        const run = this.runs.get(id);
        if (run && ['queued', 'running', 'reporting', 'stopping'].includes(run.status)) {
            run.cancelRequested = true;
            run.status = run.status === 'queued' ? 'cancelled' : 'stopping';
            run.updatedAt = new Date().toISOString();
        }
        return clone(run ?? null);
    }
}
export class MongoRepository implements Repository {
    constructor(readonly client: MongoClient, readonly db: Db) { }
    static async connect(uri: string, database = 'sidechannel') {
        const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
        await client.connect();
        const repository = new MongoRepository(client, client.db(database));
        await repository.initialize();
        return repository;
    }
    async initialize() {
        await Promise.all([
            this.db.collection('runs').createIndex({ id: 1 }, { unique: true }),
            this.db.collection('runs').createIndex({ launchKey: 1 }, { unique: true }),
            this.db.collection('runs').createIndex({ status: 1, createdAt: 1 }),
            this.db.collection('events').createIndex({ id: 1 }, { unique: true }),
            this.db.collection('events').createIndex({ runId: 1, sequence: 1 }, { unique: true }),
            this.db.collection('events').createIndex({ runId: 1, agentId: 1, turn: 1 }),
            this.db.collection('operations').createIndex({ runId: 1, operationId: 1 }, { unique: true }),
            this.db.collection('drafts').createIndex({ id: 1 }, { unique: true }),
            this.db.collection('counters').createIndex({ runId: 1 }, { unique: true }),
            this.db.collection('worker_guard').createIndex({ key: 1 }, { unique: true }),
        ]);
    }
    async close() { await this.client.close(); }
    async getRun(id: string) { return clean<Run>(await this.db.collection('runs').findOne({ id })); }
    async listRuns() { return (await this.db.collection('runs').find().sort({ createdAt: -1 }).toArray()).map(row => clean<Run>(row)!); }
    async createRun(run: Run) {
        try {
            await this.db.collection('runs').insertOne(clone(run));
        }
        catch (error) {
            if ((error as {
                code?: number;
            }).code !== 11000)
                throw error;
        }
        const result = clean<Run>(await this.db.collection('runs').findOne({ launchKey: run.launchKey }));
        if (!result)
            throw new Error('Conflicting run identity');
        return result;
    }
    async createPair(runs: Run[]) {
        const session = this.client.startSession();
        try {
            await session.withTransaction(async () => {
                for (const run of runs)
                    await this.db.collection('runs').updateOne({ launchKey: run.launchKey }, { $setOnInsert: clone(run) }, { upsert: true, session });
            });
            const result = await Promise.all(runs.map(run => this.db.collection('runs').findOne({ launchKey: run.launchKey })));
            return result.map(row => clean<Run>(row)!);
        }
        finally {
            await session.endSession();
        }
    }
    async saveRun(run: Run) {
        const { config, configHash, id, launchKey, createdAt, ...mutable } = clone(run);
        // Each mutation has a stable unique identity. Existing values are immutable.
        for (const [operationId, operation] of Object.entries(run.operations)) {
            await this.db.collection('operations').updateOne({ runId: id, operationId }, { $setOnInsert: { runId: id, operationId, ...operation } }, { upsert: true });
        }
        const result = await this.db.collection('runs').updateOne({ id }, [{ $set: {
                    ...Object.fromEntries(Object.entries(mutable).map(([key, value]) => [key, { $literal: value }])),
                    cancelRequested: { $or: ['$cancelRequested', { $literal: Boolean(run.cancelRequested) }] },
                    status: { $cond: [{ $and: ['$cancelRequested', { $literal: ['queued', 'running', 'reporting', 'completed'].includes(run.status) }] }, 'stopping', { $literal: run.status }] },
                } }]);
        if (!result.matchedCount)
            throw new Error('Run not found');
    }
    async claimRun(id: string, workerId: string) {
        const result = await this.db.collection('runs').updateOne({ id, status: 'queued', owner: { $exists: false } }, { $set: { owner: workerId, status: 'running', updatedAt: new Date().toISOString() } });
        return result.modifiedCount === 1;
    }
    async appendEvent(event: NewEvent) {
        const counter = await this.db.collection('counters').findOneAndUpdate({ runId: event.runId }, { $inc: { sequence: 1 } }, { upsert: true, returnDocument: 'after' });
        const record: HarnessEvent = { ...event, schemaVersion: 1, id: randomUUID(), timestamp: new Date().toISOString(), sequence: counter!.sequence as number };
        await this.db.collection('events').insertOne(clone(record));
        return record;
    }
    async listEvents(runId: string, afterSequence = 0, limit = 1000) { return (await this.db.collection('events').find({ runId, sequence: { $gt: afterSequence } }).sort({ sequence: 1 }).limit(Math.min(limit, 10000)).toArray()).map(row => clean<HarnessEvent>(row)!); }
    async saveDraft(id: string, config: ExperimentConfig) { const draft = { id, config, updatedAt: new Date().toISOString() }; await this.db.collection('drafts').updateOne({ id }, { $set: draft }, { upsert: true }); return draft; }
    async listDrafts() { return (await this.db.collection('drafts').find().toArray()).map(row => clean<Draft>(row)!); }
    async getDraft(id: string) { return clean<Draft>(await this.db.collection('drafts').findOne({ id })); }
    async requestCancel(id: string) {
        await this.db.collection('runs').updateOne({ id, status: { $in: ['queued', 'running', 'reporting', 'stopping'] } }, [{ $set: { cancelRequested: true, status: { $cond: [{ $eq: ['$status', 'queued'] }, 'cancelled', 'stopping'] }, updatedAt: new Date().toISOString() } }]);
        return this.getRun(id);
    }
    async acquireWorker(owner: string) {
        try {
            await this.db.collection('worker_guard').insertOne({ key: 'single-worker', owner, startedAt: new Date().toISOString() });
            return true;
        }
        catch (error) {
            if ((error as {
                code?: number;
            }).code === 11000)
                return false;
            throw error;
        }
    }
    async releaseWorker(owner: string) { await this.db.collection('worker_guard').deleteOne({ key: 'single-worker', owner }); }
}
