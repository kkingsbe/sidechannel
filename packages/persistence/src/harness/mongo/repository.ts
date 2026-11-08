import { randomUUID } from 'node:crypto';
import { MongoClient, type Db, type Document } from 'mongodb';
import { assertMatchedPair, assertSameLaunchConfiguration } from '@sidechannel/domain/harness/launch';
import type { HarnessEvent, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import { ACTIVE_RUN_STATUSES, CANCEL_OVERRIDE_RUN_STATUSES, TERMINAL_RUN_STATUSES } from '@sidechannel/contracts/harness/contracts';
import type { ResearcherRepository, WorkerStatus } from '@sidechannel/contracts/server/contracts';
import type { RunLifecycleResult } from '@sidechannel/contracts/harness/run-lifecycle';
import { type Draft, type DraftMetadata, RepositoryConflict, type EventQuery, type RunQuery, EVIDENCE_KEY_COERCION, EVIDENCE_KEY_FIELD, type EvidenceKind, type EvidencePage, type TurnSummary } from '@sidechannel/contracts/harness/repository';
import type { WorkerGuard, WorkerLeaseRecord } from '@sidechannel/contracts/harness/server';
import { DEFAULT_WORKER_LEASE_MS } from '@sidechannel/contracts/harness/server';
import { summaryProjection, toRunSummary, workerStatusOf, type SummaryRun } from '@sidechannel/domain/harness/repository';
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
        const { config, configHash, id, launchKey, createdAt, pairId, pairingSeed, pairPosition, sourceDraft, archivedAt, ...mutable } = clone(run);
        // Each mutation has a stable unique identity. Existing values are immutable.
        for (const [operationId, operation] of Object.entries(run.operations)) {
            await this.db.collection(COLLECTIONS.operations).updateOne({ runId: id, operationId }, { $setOnInsert: { runId: id, operationId, ...operation } }, { upsert: true });
        }
        const result = await this.db.collection(COLLECTIONS.runs).updateOne({ id }, [{ $set: {
                    ...Object.fromEntries(Object.entries(mutable).map(([key, value]) => [key, { $literal: value }])),
                    cancelRequested: { $or: ['$cancelRequested', { $literal: Boolean(run.cancelRequested) }] },
                    status: { $cond: [{ $and: ['$cancelRequested', { $literal: CANCEL_OVERRIDE_RUN_STATUSES.includes(run.status) }] }, 'stopping', { $literal: run.status }] },
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
        if (query.archived !== 'include') filter.archivedAt = { $exists: query.archived === 'only' };
        if (query.status) filter.status = { $in: query.status.split(',') };
        if (query.model) filter['config.model.id'] = query.model;
        if (query.condition) filter['config.condition.id'] = query.condition;
        if (query.scenario) filter.$or = [{ 'config.scenario.version': query.scenario }, { 'config.scenario.datasetId': query.scenario }];
        if (query.designation === 'fixture') filter['config.model.provider'] = 'scripted';
        else if (query.designation) { filter['config.phase'] = query.designation; filter['config.model.provider'] = { $ne: 'scripted' }; }
        const projection = summaryProjection();
        const [rows, total] = await Promise.all([this.db.collection(COLLECTIONS.runs).find(filter, { projection }).sort(query.order === 'queue' ? { createdAt: 1, pairPosition: 1, id: 1 } : { createdAt: -1, id: 1 }).skip(query.offset).limit(query.limit).toArray(), this.db.collection(COLLECTIONS.runs).countDocuments(filter)]);
        return { items: rows.map(row => toRunSummary(clean<SummaryRun>(row)!)), total };
    }
    async getRunSummary(id: string) { const run = clean<SummaryRun>(await this.db.collection(COLLECTIONS.runs).findOne({ id }, { projection: summaryProjection() })); return run ? toRunSummary(run) : null; }
    async getEvidencePage(id: string, kind: EvidenceKind, offset: number, limit: number): Promise<EvidencePage> {
        const [row] = await this.db.collection(COLLECTIONS.runs).aggregate<EvidencePage>([{ $match: { id } }, { $project: { _id: 0, items: { $slice: [`$${kind}`, offset, limit] }, total: { $size: `$${kind}` }, ...(kind === 'reports' ? { reporting: { instructions: '$config.reportInstructions', schemaVersion: '$config.reportSchemaVersion' } } : {}) } }]).toArray();
        return row ?? { items: [], total: 0 };
    }
    async getEvidenceItem(id: string, kind: EvidenceKind, key: string): Promise<unknown | null> {
        const field = EVIDENCE_KEY_FIELD[kind], value = EVIDENCE_KEY_COERCION[kind](key);
        const [row] = await this.db.collection(COLLECTIONS.runs).aggregate<{ item?: unknown }>([{ $match: { id } }, { $project: { _id: 0, item: { $arrayElemAt: [{ $filter: { input: `$${kind}`, as: 'entry', cond: { $eq: [`$$entry.${field}`, { $literal: value }] } } }, 0] } } }]).toArray();
        return row?.item ?? null;
    }
    async queryEvents(runId: string, query: EventQuery) {
        const filter: Document = { runId, sequence: { $gt: query.after ?? 0, ...(query.before === undefined ? {} : { $lt: query.before }), ...(query.from === undefined ? {} : { $gte: query.from }), ...(query.to === undefined ? {} : { $lte: query.to }) } };
        if (query.actor) filter.agentId = query.actor;
        if (query.type) filter.type = query.type;
        const reporting = { $or: [{ 'data.phase': 'report' }, { type: /^report/ }, { invocationId: /:report:/ }] };
        if (query.phase === 'report') Object.assign(filter, reporting);
        else if (query.phase === 'action') filter.$nor = [reporting];
        return (await this.db.collection(COLLECTIONS.events).find(filter).sort({ sequence: query.order === 'desc' ? -1 : 1 }).skip(query.offset ?? 0).limit(query.limit ?? 200).toArray()).map(row => clean<HarnessEvent>(row)!);
    }
    async getEvent(runId: string, id: string) { return clean<HarnessEvent>(await this.db.collection(COLLECTIONS.events).findOne({ runId, id })); }
    async listTurns(runId: string): Promise<TurnSummary[]> {
        const rows = await this.db.collection(COLLECTIONS.events).aggregate<{ _id: { agentId: string; round?: number | null; turn: number }; firstSequence: number; lastSequence: number; eventCount: number; calls: (string | null)[]; failures: number }>([
            { $match: { runId, agentId: { $nin: [null, ''] }, turn: { $gt: 0 } } },
            { $group: {
                _id: { agentId: '$agentId', round: '$round', turn: '$turn' },
                firstSequence: { $min: '$sequence' },
                lastSequence: { $max: '$sequence' },
                eventCount: { $sum: 1 },
                calls: { $addToSet: { $cond: [{ $eq: ['$type', 'model_requested'] }, { $ifNull: ['$invocationId', null] }, null] } },
                failures: { $sum: { $cond: [{ $regexMatch: { input: '$type', regex: 'denied|error|fail' } }, 1, 0] } },
            } },
            { $sort: { firstSequence: 1 } },
        ]).toArray();
        return rows.map(({ _id, calls, ...counts }) => ({ agentId: _id.agentId, ...(_id.round == null ? {} : { round: _id.round }), turn: _id.turn, ...counts, modelCalls: calls.filter(call => call !== null).length }));
    }
    /** Wake-up hint from a change stream. On a standalone server the stream errors and callers fall back to polling. */
    subscribeEvents(runId: string, onAppend: () => void) {
        const stream = this.db.collection(COLLECTIONS.events).watch([{ $match: { operationType: 'insert', 'fullDocument.runId': runId } }]);
        stream.on('change', () => onAppend());
        stream.on('error', () => { /* the consumer's poll interval keeps delivering events */ });
        return () => { void stream.close().catch(() => undefined); };
    }
    /** The current lease with its heartbeat age measured on the database clock; `ageMs` is null for a lease that never heartbeated. */
    async workerLease(): Promise<WorkerLeaseRecord | null> {
        const [row] = await this.db.collection(COLLECTIONS.workerGuard).aggregate([
            { $match: { key: 'single-worker' } },
            { $project: { _id: 0, owner: 1, startedAt: 1, heartbeatAt: 1, capacity: 1, ageMs: { $cond: [{ $eq: [{ $type: '$heartbeatAt' }, 'date'] }, { $subtract: ['$$NOW', '$heartbeatAt'] }, null] } } },
        ]).toArray();
        if (!row)
            return null;
        return { owner: row.owner, ...(row.startedAt ? { startedAt: row.startedAt } : {}), ...(row.heartbeatAt instanceof Date ? { heartbeatAt: row.heartbeatAt.toISOString() } : {}), ageMs: row.ageMs ?? null, ...(typeof row.capacity === 'number' ? { capacity: row.capacity } : {}) };
    }
    async workerStatus(leaseMs = DEFAULT_WORKER_LEASE_MS): Promise<WorkerStatus> { return workerStatusOf(await this.workerLease(), leaseMs); }
    async setRunArchived(id: string, archivedAt: string | null): Promise<RunLifecycleResult> {
        const runs = this.db.collection(COLLECTIONS.runs);
        const result = archivedAt === null ? await runs.updateOne({ id }, { $unset: { archivedAt: '' } }) : await runs.updateOne({ id, status: { $in: [...TERMINAL_RUN_STATUSES] } }, { $set: { archivedAt } });
        if (result.matchedCount) return 'ok';
        return await runs.countDocuments({ id }) ? 'not-terminal' : 'not-found';
    }
    /** One transaction: the run row is removed only while terminal, and its events, sequence counter and operations go with it. */
    async deleteRun(id: string): Promise<RunLifecycleResult> {
        const session = this.client.startSession();
        let result: RunLifecycleResult = 'not-found';
        try {
            await session.withTransaction(async () => {
                const removed = await this.db.collection(COLLECTIONS.runs).deleteOne({ id, status: { $in: [...TERMINAL_RUN_STATUSES] } }, { session });
                if (!removed.deletedCount) { result = await this.db.collection(COLLECTIONS.runs).countDocuments({ id }, { session }) ? 'not-terminal' : 'not-found'; return; }
                for (const name of [COLLECTIONS.events, COLLECTIONS.counters, COLLECTIONS.operations]) await this.db.collection(name).deleteMany({ runId: id }, { session });
                result = 'ok';
            });
        }
        finally { await session.endSession(); }
        return result;
    }
    async requestCancel(id: string) {
        await this.db.collection(COLLECTIONS.runs).updateOne({ id, status: { $in: [...ACTIVE_RUN_STATUSES] } }, [{ $set: { cancelRequested: true, status: { $cond: [{ $eq: ['$status', 'queued'] }, 'cancelled', 'stopping'] }, updatedAt: new Date().toISOString() } }]);
        return this.getRun(id);
    }
    /**
     * Takes the single-worker lease when it is free or its holder stopped heartbeating for `leaseMs`
     * (measured on the database clock). A lease without `heartbeatAt` predates heartbeats and is stale.
     */
    async acquireWorker(owner: string, leaseMs = DEFAULT_WORKER_LEASE_MS, capacity?: number) {
        const guard = this.db.collection(COLLECTIONS.workerGuard);
        const lanes = capacity === undefined ? {} : { capacity };
        try {
            await guard.insertOne({ key: 'single-worker', owner, startedAt: new Date().toISOString(), heartbeatAt: new Date(), ...lanes });
            await guard.updateOne({ key: 'single-worker', owner }, [{ $set: { heartbeatAt: '$$NOW' } }]); // use the database clock
            return true;
        }
        catch (error) {
            if ((error as {
                code?: number;
            }).code !== 11000)
                throw error;
        }
        // Held: take it over only if its heartbeat expired. The single-document update is atomic, so
        // of several workers racing for one stale lease exactly one matches.
        const takeover = await guard.updateOne(
            { key: 'single-worker', $expr: { $not: [{ $gt: ['$heartbeatAt', { $subtract: ['$$NOW', leaseMs] }] }] } },
            [{ $set: { owner: { $literal: owner }, startedAt: { $literal: new Date().toISOString() }, heartbeatAt: '$$NOW', capacity: { $literal: capacity ?? null } } }]);
        return takeover.modifiedCount === 1;
    }
    /** Renews the lease; false means another worker took it over and this one must stop. */
    async heartbeatWorker(owner: string) {
        const result = await this.db.collection(COLLECTIONS.workerGuard).updateOne({ key: 'single-worker', owner }, [{ $set: { heartbeatAt: '$$NOW' } }]);
        return result.matchedCount === 1;
    }
    async releaseWorker(owner: string) { await this.db.collection(COLLECTIONS.workerGuard).deleteOne({ key: 'single-worker', owner }); }
}
