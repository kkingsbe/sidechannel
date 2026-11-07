import { randomUUID } from 'node:crypto';
import { MongoClient, type Db, type Document } from 'mongodb';
import { assertMatchedPair, assertSameLaunchConfiguration } from '@sidechannel/domain/harness/launch';
import type { HarnessEvent, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import type { ResearcherRepository, WorkerStatus } from '@sidechannel/contracts/server/contracts';
import { type Draft, type DraftMetadata, RepositoryConflict, type EventQuery, type RunQuery, type EvidenceKind, type EvidencePage } from '@sidechannel/contracts/harness/repository';
import type { WorkerGuard } from '@sidechannel/contracts/harness/server';
import { summarizeRun } from '@sidechannel/domain/harness/repository';
import { COLLECTIONS, initializeHarnessSchema } from '../schema.js';

const clone = <T>(value: T): T => structuredClone(value);

const clean = <T>(value: Document | null): T | null => {
    if (!value)
        return null;
    const { _id, owner, ...rest } = value;
    return rest as T;
};

export class MongoRepository implements ResearcherRepository, WorkerGuard {
    constructor(readonly client: MongoClient, readonly db: Db) { }
    static async connect(uri: string, database = 'sidechannel') {
        const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
        await client.connect();
        const repository = new MongoRepository(client, client.db(database));
        await repository.initialize();
        return repository;
    }
    async initialize() { await initializeHarnessSchema(this.db); }
    async close() { await this.client.close(); }
    async getRun(id: string) { return clean<Run>(await this.db.collection(COLLECTIONS.runs).findOne({ id })); }
    async getRunByLaunchKey(launchKey: string) { return clean<Run>(await this.db.collection(COLLECTIONS.runs).findOne({ launchKey })); }
    async listRuns() { return (await this.db.collection(COLLECTIONS.runs).find().sort({ createdAt: -1 }).toArray()).map(row => clean<Run>(row)!); }
    async createRun(run: Run) {
        try {
            await this.db.collection(COLLECTIONS.runs).insertOne(clone(run));
        }
        catch (error) {
            if ((error as {
                code?: number;
            }).code !== 11000)
                throw error;
        }
        const result = clean<Run>(await this.db.collection(COLLECTIONS.runs).findOne({ launchKey: run.launchKey }));
        if (!result)
            throw new Error('Conflicting run identity');
        assertSameLaunchConfiguration(result, run);
        return result;
    }
    async createPair(runs: Run[]) {
        assertMatchedPair(runs);
        const session = this.client.startSession();
        try {
            try { await session.withTransaction(async () => {
                const existing = await this.db.collection(COLLECTIONS.runs).find({ launchKey: { $in: runs.map(run => run.launchKey) } }, { session }).toArray();
                if (existing.length && existing.length !== 2) throw new RepositoryConflict('Incomplete pair');
                if (existing.length) { for (const run of runs) assertSameLaunchConfiguration(clean<Run>(existing.find(row => row.launchKey === run.launchKey)!)!, run); }
                else await this.db.collection(COLLECTIONS.runs).insertMany(clone(runs), { session });
            }); } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
            const result = await Promise.all(runs.map(run => this.db.collection(COLLECTIONS.runs).findOne({ launchKey: run.launchKey })));
            if (result.some(row => !row)) throw new RepositoryConflict('Incomplete or conflicting pair identity');
            const saved = result.map(row => clean<Run>(row)!);
            saved.forEach((run, index) => assertSameLaunchConfiguration(run, runs[index]!));
            return saved;
        }
        finally {
            await session.endSession();
        }
    }
    async saveRun(run: Run) {
        const { config, configHash, id, launchKey, createdAt, pairId, pairingSeed, pairPosition, sourceDraft, ...mutable } = clone(run);
        // Each mutation has a stable unique identity. Existing values are immutable.
        for (const [operationId, operation] of Object.entries(run.operations)) {
            await this.db.collection(COLLECTIONS.operations).updateOne({ runId: id, operationId }, { $setOnInsert: { runId: id, operationId, ...operation } }, { upsert: true });
        }
        const result = await this.db.collection(COLLECTIONS.runs).updateOne({ id }, [{ $set: {
                    ...Object.fromEntries(Object.entries(mutable).map(([key, value]) => [key, { $literal: value }])),
                    cancelRequested: { $or: ['$cancelRequested', { $literal: Boolean(run.cancelRequested) }] },
                    status: { $cond: [{ $and: ['$cancelRequested', { $literal: ['queued', 'running', 'reporting', 'completed'].includes(run.status) }] }, 'stopping', { $literal: run.status }] },
                } }]);
        if (!result.matchedCount)
            throw new Error('Run not found');
    }
    async claimRun(id: string, workerId: string) {
        const result = await this.db.collection(COLLECTIONS.runs).updateOne({ id, status: 'queued', owner: { $exists: false } }, { $set: { owner: workerId, status: 'running', updatedAt: new Date().toISOString() } });
        return result.modifiedCount === 1;
    }
    async appendEvent(event: NewEvent) {
        const counter = await this.db.collection(COLLECTIONS.counters).findOneAndUpdate({ runId: event.runId }, { $inc: { sequence: 1 } }, { upsert: true, returnDocument: 'after' });
        const record: HarnessEvent = { ...event, schemaVersion: 1, id: randomUUID(), timestamp: new Date().toISOString(), sequence: counter!.sequence as number };
        await this.db.collection(COLLECTIONS.events).insertOne(clone(record));
        return record;
    }
    async listEvents(runId: string, afterSequence = 0, limit = 1000) { return (await this.db.collection(COLLECTIONS.events).find({ runId, sequence: { $gt: afterSequence } }).sort({ sequence: 1 }).limit(Math.min(limit, 10000)).toArray()).map(row => clean<HarnessEvent>(row)!); }
    async saveDraft(id: string, config: unknown, expectedRevision?: number, metadata: DraftMetadata = {}) {
        const updatedAt = new Date().toISOString();
        if (expectedRevision === undefined || expectedRevision === 0) {
            const draft = { ...metadata, id, config, revision: 1, updatedAt };
            try { await this.db.collection(COLLECTIONS.drafts).insertOne(clone(draft)); return draft; }
            catch (error) { if ((error as { code?: number }).code === 11000) throw new RepositoryConflict('Draft changed; reload the current revision before saving'); throw error; }
        }
        const result = await this.db.collection(COLLECTIONS.drafts).findOneAndUpdate({ id, revision: expectedRevision }, { $set: { ...clone(metadata), config: clone(config), updatedAt }, $inc: { revision: 1 } }, { returnDocument: 'after' });
        if (!result) throw new RepositoryConflict('Draft changed; reload the current revision before saving');
        return clean<Draft>(result)!;
    }
    async listDrafts() { return (await this.db.collection(COLLECTIONS.drafts).find().toArray()).map(row => clean<Draft>(row)!); }
    async getDraft(id: string) { return clean<Draft>(await this.db.collection(COLLECTIONS.drafts).findOne({ id })); }
    async queryRuns(query: RunQuery) {
        const filter: Document = {};
        if (query.status) filter.status = { $in: query.status.split(',') };
        if (query.model) filter['config.model.id'] = query.model;
        if (query.condition) filter['config.condition.id'] = query.condition;
        if (query.scenario) filter.$or = [{ 'config.scenario.version': query.scenario }, { 'config.scenario.datasetId': query.scenario }];
        if (query.designation === 'fixture') filter['config.model.provider'] = 'scripted';
        else if (query.designation) { filter['config.phase'] = query.designation; filter['config.model.provider'] = { $ne: 'scripted' }; }
        const projection = { board: 0, artifacts: 0, reports: 0, operations: 0, scenarioState: 0, 'config.scenario.assets': 0 };
        const [rows, total] = await Promise.all([this.db.collection(COLLECTIONS.runs).find(filter, { projection }).sort(query.order === 'queue' ? { createdAt: 1, pairPosition: 1, id: 1 } : { createdAt: -1, id: 1 }).skip(query.offset).limit(query.limit).toArray(), this.db.collection(COLLECTIONS.runs).countDocuments(filter)]);
        return { items: rows.map(row => summarizeRun(clean<Run>(row)!)), total };
    }
    async getRunSummary(id: string) { const run = clean<Run>(await this.db.collection(COLLECTIONS.runs).findOne({ id }, { projection: { board: 0, artifacts: 0, reports: 0, operations: 0, scenarioState: 0, 'config.scenario.assets': 0 } })); return run ? summarizeRun(run) : null; }
    async getEvidencePage(id: string, kind: EvidenceKind, offset: number, limit: number): Promise<EvidencePage> {
        const [row] = await this.db.collection(COLLECTIONS.runs).aggregate<EvidencePage>([{ $match: { id } }, { $project: { _id: 0, items: { $slice: [`$${kind}`, offset, limit] }, total: { $size: `$${kind}` }, ...(kind === 'reports' ? { reporting: { instructions: '$config.reportInstructions', schemaVersion: '$config.reportSchemaVersion' } } : {}) } }]).toArray();
        return row ?? { items: [], total: 0 };
    }
    async getEvidenceItem(id: string, kind: EvidenceKind, key: string): Promise<unknown | null> {
        const field = kind === 'board' ? 'id' : kind === 'artifacts' ? 'version' : 'agentId', value = kind === 'artifacts' ? Number(key) : key;
        const [row] = await this.db.collection(COLLECTIONS.runs).aggregate<{ item?: unknown }>([{ $match: { id } }, { $project: { _id: 0, item: { $arrayElemAt: [{ $filter: { input: `$${kind}`, as: 'entry', cond: { $eq: [`$$entry.${field}`, { $literal: value }] } } }, 0] } } }]).toArray();
        return row?.item ?? null;
    }
    async queryEvents(runId: string, query: EventQuery) {
        const filter: Document = { runId, sequence: { $gt: query.after ?? 0, ...(query.from === undefined ? {} : { $gte: query.from }), ...(query.to === undefined ? {} : { $lte: query.to }) } };
        if (query.actor) filter.agentId = query.actor;
        if (query.type) filter.type = query.type;
        const reporting = { $or: [{ 'data.phase': 'report' }, { type: /^report/ }, { invocationId: /:report:/ }] };
        if (query.phase === 'report') Object.assign(filter, reporting);
        else if (query.phase === 'action') filter.$nor = [reporting];
        return (await this.db.collection(COLLECTIONS.events).find(filter).sort({ sequence: 1 }).skip(query.offset ?? 0).limit(query.limit ?? 200).toArray()).map(row => clean<HarnessEvent>(row)!);
    }
    async getEvent(runId: string, id: string) { return clean<HarnessEvent>(await this.db.collection(COLLECTIONS.events).findOne({ runId, id })); }
    async workerStatus(): Promise<WorkerStatus> {
        const guard = await this.db.collection(COLLECTIONS.workerGuard).findOne({ key: 'single-worker' }, { projection: { _id: 0, startedAt: 1 } });
        return { capacity: 1, available: null, status: guard ? 'registered' : 'unknown', ...(guard ? { startedAt: String(guard.startedAt) } : {}),
            note: 'Worker registration has no heartbeat; current availability is unknown.' };
    }
    async requestCancel(id: string) {
        await this.db.collection(COLLECTIONS.runs).updateOne({ id, status: { $in: ['queued', 'running', 'reporting', 'stopping'] } }, [{ $set: { cancelRequested: true, status: { $cond: [{ $eq: ['$status', 'queued'] }, 'cancelled', 'stopping'] }, updatedAt: new Date().toISOString() } }]);
        return this.getRun(id);
    }
    async acquireWorker(owner: string) {
        try {
            await this.db.collection(COLLECTIONS.workerGuard).insertOne({ key: 'single-worker', owner, startedAt: new Date().toISOString() });
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
    async releaseWorker(owner: string) { await this.db.collection(COLLECTIONS.workerGuard).deleteOne({ key: 'single-worker', owner }); }
}
