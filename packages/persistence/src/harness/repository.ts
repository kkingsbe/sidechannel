import { randomUUID } from 'node:crypto';
import { MongoClient, type Db, type Document } from 'mongodb';
import { isDeepStrictEqual } from 'node:util';
import { assertPairEquivalent } from '@sidechannel/domain/harness/config';
import type { HarnessEvent, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import type { Repository } from '@sidechannel/contracts/harness/server';
import { type Draft, type DraftMetadata, RepositoryConflict, type EventQuery, type RunQuery, type EvidenceKind, type EvidencePage } from '@sidechannel/contracts/harness/repository';
import { summarizeRun } from '@sidechannel/domain/harness/repository';

function assertSameLaunch(existing: Run, requested: Run) {
    if (!isDeepStrictEqual(existing.config, requested.config) || !isDeepStrictEqual(existing.sourceDraft ?? undefined, requested.sourceDraft) || (existing.pairId ?? undefined) !== requested.pairId || (existing.pairingSeed ?? undefined) !== requested.pairingSeed || (existing.pairPosition ?? undefined) !== requested.pairPosition)
        throw new RepositoryConflict('Idempotency key already belongs to a different launch configuration');
}

function assertPair(runs: Run[]) {
    if (runs.length !== 2 || !runs[0]!.pairId || runs[0]!.pairId !== runs[1]!.pairId || runs[0]!.launchKey === runs[1]!.launchKey || runs[0]!.id === runs[1]!.id || new Set(runs.map(r => r.config.condition.id)).size !== 2 || !runs.every(run => ['reviewed', 'excluded'].includes(run.config.condition.id)) || runs[0]!.pairingSeed !== runs[1]!.pairingSeed)
        throw new RepositoryConflict('A matched pair requires exactly two distinct conditions and one pair identity');
    try { assertPairEquivalent(runs[0]!.config, runs[1]!.config); } catch { throw new RepositoryConflict('Matched configurations differ outside condition'); }
}

function eventPhase(event: HarnessEvent): string { return (event.data as { phase?: string } | null)?.phase ?? (event.type.startsWith('report') || event.invocationId?.includes(':report:') ? 'report' : 'action'); }

function matchesEvent(event: HarnessEvent, query: EventQuery) { return event.sequence > (query.after ?? 0) && (!query.actor || event.agentId === query.actor) && (!query.type || event.type === query.type) && (!query.phase || eventPhase(event) === query.phase) && (query.from === undefined || event.sequence >= query.from) && (query.to === undefined || event.sequence <= query.to); }

function matchesRun(run: Run, q: RunQuery) { return (!q.status || q.status.split(',').includes(run.status)) && (!q.model || run.config.model.id === q.model) && (!q.condition || run.config.condition.id === q.condition) && (!q.scenario || [run.config.scenario.version, run.config.scenario.datasetId].includes(q.scenario)) && (!q.designation || (run.config.model.provider === 'scripted' ? 'fixture' : run.config.phase) === q.designation); }

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
    async getRunByLaunchKey(launchKey: string) { return clone([...this.runs.values()].find(run => run.launchKey === launchKey) ?? null); }
    async listRuns() { return clone([...this.runs.values()].reverse()); }
    async createRun(run: Run) {
        const existing = [...this.runs.values()].find(r => r.launchKey === run.launchKey);
        if (existing)
            { assertSameLaunch(existing, run); return clone(existing); }
        if (this.runs.has(run.id))
            throw new Error('Duplicate run ID');
        this.runs.set(run.id, clone(run));
        return clone(run);
    }
    async createPair(runs: Run[]) {
        assertPair(runs);
        const existing = runs.map(run => [...this.runs.values()].find(r => r.launchKey === run.launchKey));
        if (existing.some(Boolean) && !existing.every(Boolean))
            throw new RepositoryConflict('Incomplete pair');
        if (existing.every(Boolean))
            { existing.forEach((run, i) => assertSameLaunch(run!, runs[i]!)); return clone(existing as Run[]); }
        if (runs.some(run => this.runs.has(run.id))) throw new RepositoryConflict('Conflicting run identity');
        for (const run of runs) this.runs.set(run.id, clone(run));
        return clone(runs);
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
        next.pairId = current.pairId;
        next.pairingSeed = current.pairingSeed;
        next.pairPosition = current.pairPosition;
        next.sourceDraft = current.sourceDraft;
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
    async saveDraft(id: string, config: unknown, expectedRevision?: number, metadata: DraftMetadata = {}) { const current = this.drafts.get(id); if (current && expectedRevision !== current.revision || !current && expectedRevision !== undefined && expectedRevision !== 0) throw new RepositoryConflict('Draft changed; reload the current revision before saving'); const draft = { ...current, ...clone(metadata), id, config: clone(config), revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString() }; this.drafts.set(id, draft); return clone(draft); }
    async listDrafts() { return clone([...this.drafts.values()]); }
    async getDraft(id: string) { return clone(this.drafts.get(id) ?? null); }
    async queryRuns(query: RunQuery) { const rows = [...this.runs.values()].reverse().filter(run => matchesRun(run, query)); if (query.order === 'queue') rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.pairPosition ?? 0) - (b.pairPosition ?? 0) || a.id.localeCompare(b.id)); return { items: clone(rows.slice(query.offset, query.offset + query.limit).map(summarizeRun)), total: rows.length }; }
    async getRunSummary(id: string) { const run = this.runs.get(id); return run ? clone(summarizeRun(run)) : null; }
    async getEvidencePage(id: string, kind: EvidenceKind, offset: number, limit: number): Promise<EvidencePage> { const run = this.runs.get(id)!; return clone({ items: run[kind].slice(offset, offset + limit), total: run[kind].length, ...(kind === 'reports' ? { reporting: { instructions: run.config.reportInstructions, schemaVersion: run.config.reportSchemaVersion } } : {}) }); }
    async getEvidenceItem(id: string, kind: EvidenceKind, key: string): Promise<unknown | null> { const rows = this.runs.get(id)?.[kind] ?? []; const field = kind === 'board' ? 'id' : kind === 'artifacts' ? 'version' : 'agentId'; return clone(rows.find(row => String((row as unknown as Record<string, unknown>)[field]) === key) ?? null); }
    async queryEvents(id: string, query: EventQuery) { const offset = query.offset ?? 0; return clone(this.events.filter(event => event.runId === id && matchesEvent(event, query)).slice(offset, offset + (query.limit ?? 200))); }
    async getEvent(runId: string, eventId: string) { return clone(this.events.find(event => event.runId === runId && event.id === eventId) ?? null); }
    async workerStatus() { return { capacity: 1, available: null, status: 'unknown' }; }
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
        // Legacy editable drafts predate optimistic revisions; migrate once without changing content.
        await this.db.collection('drafts').updateMany({ revision: { $exists: false } }, { $set: { revision: 1 } });
    }
    async close() { await this.client.close(); }
    async getRun(id: string) { return clean<Run>(await this.db.collection('runs').findOne({ id })); }
    async getRunByLaunchKey(launchKey: string) { return clean<Run>(await this.db.collection('runs').findOne({ launchKey })); }
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
        assertSameLaunch(result, run);
        return result;
    }
    async createPair(runs: Run[]) {
        assertPair(runs);
        const session = this.client.startSession();
        try {
            try { await session.withTransaction(async () => {
                const existing = await this.db.collection('runs').find({ launchKey: { $in: runs.map(run => run.launchKey) } }, { session }).toArray();
                if (existing.length && existing.length !== 2) throw new RepositoryConflict('Incomplete pair');
                if (existing.length) { for (const run of runs) assertSameLaunch(clean<Run>(existing.find(row => row.launchKey === run.launchKey)!)!, run); }
                else await this.db.collection('runs').insertMany(clone(runs), { session });
            }); } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
            const result = await Promise.all(runs.map(run => this.db.collection('runs').findOne({ launchKey: run.launchKey })));
            if (result.some(row => !row)) throw new RepositoryConflict('Incomplete or conflicting pair identity');
            const saved = result.map(row => clean<Run>(row)!);
            saved.forEach((run, index) => assertSameLaunch(run, runs[index]!));
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
    async saveDraft(id: string, config: unknown, expectedRevision?: number, metadata: DraftMetadata = {}) {
        const updatedAt = new Date().toISOString();
        if (expectedRevision === undefined || expectedRevision === 0) {
            const draft = { ...metadata, id, config, revision: 1, updatedAt };
            try { await this.db.collection('drafts').insertOne(clone(draft)); return draft; }
            catch (error) { if ((error as { code?: number }).code === 11000) throw new RepositoryConflict('Draft changed; reload the current revision before saving'); throw error; }
        }
        const result = await this.db.collection('drafts').findOneAndUpdate({ id, revision: expectedRevision }, { $set: { ...clone(metadata), config: clone(config), updatedAt }, $inc: { revision: 1 } }, { returnDocument: 'after' });
        if (!result) throw new RepositoryConflict('Draft changed; reload the current revision before saving');
        return clean<Draft>(result)!;
    }
    async listDrafts() { return (await this.db.collection('drafts').find().toArray()).map(row => clean<Draft>(row)!); }
    async getDraft(id: string) { return clean<Draft>(await this.db.collection('drafts').findOne({ id })); }
    async queryRuns(query: RunQuery) {
        const filter: Document = {};
        if (query.status) filter.status = { $in: query.status.split(',') };
        if (query.model) filter['config.model.id'] = query.model;
        if (query.condition) filter['config.condition.id'] = query.condition;
        if (query.scenario) filter.$or = [{ 'config.scenario.version': query.scenario }, { 'config.scenario.datasetId': query.scenario }];
        if (query.designation === 'fixture') filter['config.model.provider'] = 'scripted';
        else if (query.designation) { filter['config.phase'] = query.designation; filter['config.model.provider'] = { $ne: 'scripted' }; }
        const projection = { board: 0, artifacts: 0, reports: 0, operations: 0, scenarioState: 0, 'config.scenario.assets': 0 };
        const [rows, total] = await Promise.all([this.db.collection('runs').find(filter, { projection }).sort(query.order === 'queue' ? { createdAt: 1, pairPosition: 1, id: 1 } : { createdAt: -1, id: 1 }).skip(query.offset).limit(query.limit).toArray(), this.db.collection('runs').countDocuments(filter)]);
        return { items: rows.map(row => summarizeRun(clean<Run>(row)!)), total };
    }
    async getRunSummary(id: string) { const run = clean<Run>(await this.db.collection('runs').findOne({ id }, { projection: { board: 0, artifacts: 0, reports: 0, operations: 0, scenarioState: 0, 'config.scenario.assets': 0 } })); return run ? summarizeRun(run) : null; }
    async getEvidencePage(id: string, kind: EvidenceKind, offset: number, limit: number): Promise<EvidencePage> {
        const [row] = await this.db.collection('runs').aggregate<EvidencePage>([{ $match: { id } }, { $project: { _id: 0, items: { $slice: [`$${kind}`, offset, limit] }, total: { $size: `$${kind}` }, ...(kind === 'reports' ? { reporting: { instructions: '$config.reportInstructions', schemaVersion: '$config.reportSchemaVersion' } } : {}) } }]).toArray();
        return row ?? { items: [], total: 0 };
    }
    async getEvidenceItem(id: string, kind: EvidenceKind, key: string): Promise<unknown | null> {
        const field = kind === 'board' ? 'id' : kind === 'artifacts' ? 'version' : 'agentId', value = kind === 'artifacts' ? Number(key) : key;
        const [row] = await this.db.collection('runs').aggregate<{ item?: unknown }>([{ $match: { id } }, { $project: { _id: 0, item: { $arrayElemAt: [{ $filter: { input: `$${kind}`, as: 'entry', cond: { $eq: [`$$entry.${field}`, { $literal: value }] } } }, 0] } } }]).toArray();
        return row?.item ?? null;
    }
    async queryEvents(runId: string, query: EventQuery) {
        const filter: Document = { runId, sequence: { $gt: query.after ?? 0, ...(query.from === undefined ? {} : { $gte: query.from }), ...(query.to === undefined ? {} : { $lte: query.to }) } };
        if (query.actor) filter.agentId = query.actor;
        if (query.type) filter.type = query.type;
        const reporting = { $or: [{ 'data.phase': 'report' }, { type: /^report/ }, { invocationId: /:report:/ }] };
        if (query.phase === 'report') Object.assign(filter, reporting);
        else if (query.phase === 'action') filter.$nor = [reporting];
        return (await this.db.collection('events').find(filter).sort({ sequence: 1 }).skip(query.offset ?? 0).limit(query.limit ?? 200).toArray()).map(row => clean<HarnessEvent>(row)!);
    }
    async getEvent(runId: string, id: string) { return clean<HarnessEvent>(await this.db.collection('events').findOne({ runId, id })); }
    async workerStatus() { const guard = await this.db.collection('worker_guard').findOne({ key: 'single-worker' }, { projection: { _id: 0, startedAt: 1 } }); return { capacity: 1, available: null, status: guard ? 'registered' : 'unknown', ...(guard ? { startedAt: guard.startedAt } : {}), note: 'Worker registration has no heartbeat; current availability is unknown.' }; }
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