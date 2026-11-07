import { createHash } from 'node:crypto';
import { MongoClient, type Db, type Document, type ClientSession } from 'mongodb';
import type { Codebook, CodebookRevision } from '@sidechannel/contracts/analysis/evidence-contracts';
import { type JobStatus, type JobCounters, type JobUsage, type AnalysisJob, type WindowRecord, type AnalysisResult, type AnalysisAttempt, type PageOptions, type Page, AnalysisConflict, AnalysisNotFound, AnalysisValidation, type Lease, type AnalysisRepository } from '@sidechannel/contracts/analysis/jev-repository';

const copy = <T>(v: T): T => structuredClone(v);

const bounded = (v: unknown) => { if (Buffer.byteLength(JSON.stringify(v)) > 1024 * 1024) throw new AnalysisValidation('Metadata document exceeds 1 MiB; choose smaller windows or a smaller codebook'); };

const size = (p: PageOptions = {}) => { const n = p.limit ?? 100; if (!Number.isSafeInteger(n) || n < 1 || n > 500) throw new AnalysisValidation('Page limit must be an integer from 1 to 500'); return n; };

const pageOf = <T extends { id: string }>(rows: T[], p: PageOptions = {}): Page<T> => { const n = size(p), selected = rows.sort((a, b) => a.id.localeCompare(b.id)).filter(x => !p.after || x.id > p.after).slice(0, n + 1); return copy({ items: selected.slice(0, n), nextCursor: selected.length > n ? selected[n - 1]!.id : null }); };

const digest = (s: string) => createHash('sha256').update(s).digest('hex');

function chunksOf(text: string): string[] { const parts: string[] = []; for (let start = 0; start < text.length;) { let end = Math.min(text.length, start + 65536); const last = text.charCodeAt(end - 1); if (end < text.length && last >= 0xd800 && last <= 0xdbff) end++; parts.push(text.slice(start, end)); start = end; } return parts.length ? parts : ['']; }

const live = (j: AnalysisJob | undefined, l: Lease) => Boolean(j?.lease?.owner === l.owner && j.lease.fence === l.fence && j.status === 'running' && j.lease.expiresAt > new Date().toISOString());

export class InMemoryAnalysisRepository implements AnalysisRepository {
    private books = new Map<string, Codebook>(); private revisions = new Map<string, CodebookRevision>();
    private jobs = new Map<string, AnalysisJob>(); private windows = new Map<string, WindowRecord>();
    private results = new Map<string, AnalysisResult>(); private attempts = new Map<string, AnalysisAttempt>(); private artifacts = new Map<string, string>();
    async listCodebooks(p?: PageOptions) { return pageOf([...this.books.values()], p); }
    async getCodebook(id: string) { return copy(this.books.get(id) ?? null); }
    async getRevision(id: string, revisionId: string) { const r = this.revisions.get(revisionId); return copy(r?.codebookId === id ? r : null); }
    async listRevisions(codebookId: string, p?: PageOptions) { return pageOf([...this.revisions.values()].filter(r => r.codebookId === codebookId), p); }
    async saveCodebook(book: Codebook, revision: CodebookRevision, expectedRevision?: string) {
        bounded(revision); const current = this.books.get(book.id);
        if ((current?.currentRevisionId) !== expectedRevision) throw new AnalysisConflict('Codebook revision changed');
        if (this.revisions.has(revision.id)) throw new AnalysisConflict('Revision already exists');
        this.revisions.set(revision.id, copy(revision)); this.books.set(book.id, copy(book));
    }
    async reserveJob(job: AnalysisJob) {
        bounded(job); const existing = [...this.jobs.values()].find(j => j.runId === job.runId && j.idempotencyKey === job.idempotencyKey);
        if (existing) { if (existing.launchHash !== job.launchHash) throw new AnalysisConflict('Idempotency key already used with different configuration'); return { job: copy(existing), created: false }; }
        this.jobs.set(job.id, copy(job)); return { job: copy(job), created: true };
    }
    async getJob(id: string) { return copy(this.jobs.get(id) ?? null); }
    async listJobs(runId: string, p?: PageOptions) { return pageOf([...this.jobs.values()].filter(j => j.runId === runId), p); }
    async listAllJobs(p?: PageOptions) { return pageOf([...this.jobs.values()], p); }
    async putWindow(w: WindowRecord) { bounded(w); const key = w.jobId + ':' + w.id; if (!this.windows.has(key)) this.windows.set(key, copy(w)); }
    async getWindow(jobId: string, id: string) { return copy(this.windows.get(jobId + ':' + id) ?? null); }
    async listWindows(jobId: string, p?: PageOptions) { return pageOf([...this.windows.values()].filter(w => w.jobId === jobId), p); }
    async putArtifact(id: string, value: unknown) { const s = JSON.stringify(value); if (this.artifacts.has(id) && this.artifacts.get(id) !== s) throw new AnalysisConflict('Artifact is immutable'); this.artifacts.set(id, s); }
    async readArtifact<T>(id: string): Promise<T> { const s = this.artifacts.get(id); if (s === undefined) throw new AnalysisNotFound('Artifact not found'); return JSON.parse(s) as T; }
    async *artifactChunks(id: string) { const text = this.artifacts.get(id); if (text === undefined) throw new AnalysisNotFound('Artifact not found'); const chunks = chunksOf(text); for (let index = 0; index < chunks.length; index++) yield { index, text: chunks[index]! }; }
    async claim(owner: string, now: string, leaseMs: number) {
        const j = [...this.jobs.values()].find(j => j.ready && ((j.status === 'queued' && !j.cancelRequested) || (j.status === 'running' && j.lease!.expiresAt <= now)));
        if (!j) return null; j.status = 'running'; j.fence++; j.lease = { owner, fence: j.fence, expiresAt: new Date(Date.parse(now) + leaseMs).toISOString() }; j.updatedAt = now;
        return { job: copy(j), lease: { jobId: j.id, owner, fence: j.fence } };
    }
    async heartbeat(l: Lease, now: string, leaseMs: number) { const j = this.jobs.get(l.jobId); if (!live(j, l)) return false; j!.lease!.expiresAt = new Date(Date.parse(now) + leaseMs).toISOString(); return true; }
    async updateCounters(l: Lease, counters: JobCounters, usage?: JobUsage) { const j = this.jobs.get(l.jobId); if (!live(j, l)) return false; j!.counters = copy(counters); if (usage) j!.usage = copy(usage); return true; }
    async updateWindow(l: Lease, id: string, patch: Partial<Pick<WindowRecord, 'status' | 'diagnostics'>>) { if (!live(this.jobs.get(l.jobId), l)) return false; const window = this.windows.get(l.jobId + ':' + id); if (window) Object.assign(window, copy(patch)); return true; }
    async startAttempt(l: Lease, a: AnalysisAttempt) { bounded(a); if (!live(this.jobs.get(l.jobId), l)) return false; this.attempts.set(a.id, copy(a)); return true; }
    async finishAttempt(l: Lease, a: AnalysisAttempt, results: AnalysisResult[]) { bounded(a); if (!live(this.jobs.get(l.jobId), l)) return false; this.attempts.set(a.id, copy(a)); for (const r of results) { const key = r.jobId + ':' + r.windowId + ':' + r.codeId; if (!this.results.has(key)) this.results.set(key, copy(r)); } return true; }
    async listResults(jobId: string, p: PageOptions = {}) { return pageOf([...this.results.values()].filter(r => r.jobId === jobId && (!p.windowId || r.windowId === p.windowId)), p); }
    async resultsForWindows(jobId: string, ids: string[]) { if (ids.length > 500) throw new AnalysisValidation('Window result join is limited to 500 windows'); const selected = new Set(ids); return copy([...this.results.values()].filter(r => r.jobId === jobId && selected.has(r.windowId)).slice(0, 50_000)); }
    async listAttempts(jobId: string, p: PageOptions = {}) { return pageOf([...this.attempts.values()].filter(a => a.jobId === jobId && (!p.windowId || a.windowId === p.windowId)), p); }
    async finishJob(l: Lease, status: JobStatus, counters: JobCounters, error?: string, usage?: JobUsage) { const j = this.jobs.get(l.jobId); if (!live(j, l)) return false; j!.status = j!.cancelRequested ? 'cancelled' : status; j!.counters = copy(counters); j!.updatedAt = new Date().toISOString(); if (usage) j!.usage = copy(usage); if (error) j!.error = error; delete j!.lease; return true; }
    async cancel(id: string) { const j = this.jobs.get(id); if (j && ['preparing', 'queued', 'running'].includes(j.status)) { j.cancelRequested = true; if (j.status !== 'running') j.status = 'cancelled'; } return this.getJob(id); }
    async retry(id: string) { const j = this.jobs.get(id); if (j) { if (['preparing', 'queued', 'running'].includes(j.status)) throw new AnalysisConflict('Job is still active'); j.status = 'queued'; j.cancelRequested = false; delete j.lease; } return this.getJob(id); }
}

const clean = <T>(d: Document | null): T | null => { if (!d) return null; const { _id, ...rest } = d; return rest as T; };

export class MongoAnalysisRepository implements AnalysisRepository {
    constructor(readonly client: MongoClient, readonly db: Db) {}
    async initialize() {
        await Promise.all([
            this.db.collection('codebooks').createIndex({ id: 1 }, { unique: true }), this.db.collection('codebook_revisions').createIndex({ id: 1 }, { unique: true }),
            this.db.collection('codebook_revisions').createIndex({ codebookId: 1, id: 1 }),
            this.db.collection('analysis_jobs').createIndex({ id: 1 }, { unique: true }), this.db.collection('analysis_jobs').createIndex({ runId: 1, idempotencyKey: 1 }, { unique: true }),
            this.db.collection('analysis_jobs').createIndex({ ready: 1, status: 1, 'lease.expiresAt': 1, createdAt: 1 }), this.db.collection('analysis_jobs').createIndex({ runId: 1, id: 1 }),
            this.db.collection('analysis_windows').createIndex({ jobId: 1, id: 1 }, { unique: true }),
            this.db.collection('analysis_results').createIndex({ jobId: 1, windowId: 1, codeId: 1 }, { unique: true }), this.db.collection('analysis_results').createIndex({ jobId: 1, id: 1 }),
            this.db.collection('analysis_attempts').createIndex({ id: 1 }, { unique: true }), this.db.collection('analysis_attempts').createIndex({ jobId: 1, id: 1 }),
            this.db.collection('analysis_attempts').createIndex({ jobId: 1, windowId: 1, id: 1 }),
            this.db.collection('analysis_artifacts').createIndex({ id: 1, index: 1 }, { unique: true }),
        ]);
    }
    private async page<T>(collection: string, filter: Document, p: PageOptions = {}): Promise<Page<T>> { const n = size(p); const rows = await this.db.collection(collection).find({ ...filter, ...(p.after ? { id: { $gt: p.after } } : {}) }).sort({ id: 1 }).limit(n + 1).toArray(); return { items: rows.slice(0, n).map(r => clean<T>(r)!), nextCursor: rows.length > n ? rows[n - 1]!.id as string : null }; }
    async listCodebooks(p?: PageOptions) { return this.page<Codebook>('codebooks', {}, p); }
    async getCodebook(id: string) { return clean<Codebook>(await this.db.collection('codebooks').findOne({ id })); }
    async getRevision(codebookId: string, id: string) { return clean<CodebookRevision>(await this.db.collection('codebook_revisions').findOne({ id, codebookId })); }
    async listRevisions(codebookId: string, p?: PageOptions) { return this.page<CodebookRevision>('codebook_revisions', { codebookId }, p); }
    async saveCodebook(book: Codebook, revision: CodebookRevision, expectedRevision?: string) {
        bounded(revision); const session = this.client.startSession();
        try { await session.withTransaction(async () => {
            if (expectedRevision) { const r = await this.db.collection('codebooks').replaceOne({ id: book.id, currentRevisionId: expectedRevision }, copy(book), { session }); if (!r.matchedCount) throw new AnalysisConflict('Codebook revision changed'); }
            else await this.db.collection('codebooks').insertOne(copy(book), { session });
            await this.db.collection('codebook_revisions').insertOne(copy(revision), { session });
        }); } catch (e) { if ((e as { code?: number }).code === 11000) throw new AnalysisConflict('Codebook revision changed'); throw e; } finally { await session.endSession(); }
    }
    async reserveJob(job: AnalysisJob) {
        bounded(job); try { await this.db.collection('analysis_jobs').insertOne(copy(job)); return { job, created: true }; }
        catch (e) { if ((e as { code?: number }).code !== 11000) throw e; const existing = clean<AnalysisJob>(await this.db.collection('analysis_jobs').findOne({ runId: job.runId, idempotencyKey: job.idempotencyKey })); if (!existing || existing.launchHash !== job.launchHash) throw new AnalysisConflict('Idempotency key already used with different configuration'); return { job: existing, created: false }; }
    }
    async getJob(id: string) { return clean<AnalysisJob>(await this.db.collection('analysis_jobs').findOne({ id })); }
    async listJobs(runId: string, p?: PageOptions) { return this.page<AnalysisJob>('analysis_jobs', { runId }, p); }
    async listAllJobs(p?: PageOptions) { return this.page<AnalysisJob>('analysis_jobs', {}, p); }
    async putWindow(w: WindowRecord) { bounded(w); await this.db.collection('analysis_windows').updateOne({ jobId: w.jobId, id: w.id }, { $setOnInsert: copy(w) }, { upsert: true }); }
    async getWindow(jobId: string, id: string) { return clean<WindowRecord>(await this.db.collection('analysis_windows').findOne({ jobId, id })); }
    async listWindows(jobId: string, p?: PageOptions) { return this.page<WindowRecord>('analysis_windows', { jobId }, p); }
    async putArtifact(id: string, value: unknown) {
        const serialized = JSON.stringify(value), hash = digest(serialized), chunks = chunksOf(serialized), count = chunks.length;
        for (let index = 0; index < count; index++) { const text = chunks[index]!; const r = await this.db.collection('analysis_artifacts').findOneAndUpdate({ id, index }, { $setOnInsert: { id, index, text, hash, count } }, { upsert: true, returnDocument: 'after' }); if (r?.hash !== hash) throw new AnalysisConflict('Artifact is immutable'); }
    }
    async *artifactChunks(id: string) { let expected = 0, count = 0; for await (const row of this.db.collection('analysis_artifacts').find({ id }).sort({ index: 1 }).batchSize(8)) { if (row.index !== expected++) throw new AnalysisConflict('Incomplete artifact'); count = row.count as number; yield { index: row.index as number, text: row.text as string }; } if (!expected) throw new AnalysisNotFound('Artifact not found'); if (expected !== count) throw new AnalysisConflict('Incomplete artifact'); }
    async readArtifact<T>(id: string): Promise<T> { const chunks: string[] = []; for await (const c of this.artifactChunks(id)) chunks.push(c.text); const text = chunks.join(''); const header = await this.db.collection('analysis_artifacts').findOne({ id, index: 0 }); if (digest(text) !== header?.hash) throw new AnalysisConflict('Artifact integrity check failed'); return JSON.parse(text) as T; }
    async claim(owner: string, now: string, leaseMs: number) { const j = clean<AnalysisJob>(await this.db.collection('analysis_jobs').findOneAndUpdate({ ready: true, $or: [{ status: 'queued', cancelRequested: false }, { status: 'running', 'lease.expiresAt': { $lte: now } }] }, [{ $set: { status: 'running', fence: { $add: ['$fence', 1] }, lease: { owner: { $literal: owner }, fence: { $add: ['$fence', 1] }, expiresAt: new Date(Date.parse(now) + leaseMs).toISOString() }, updatedAt: now } }], { sort: { createdAt: 1 }, returnDocument: 'after' })); return j ? { job: j, lease: { jobId: j.id, owner, fence: j.fence } } : null; }
    private guard(l: Lease) { return { id: l.jobId, status: 'running', 'lease.owner': l.owner, 'lease.fence': l.fence, 'lease.expiresAt': { $gt: new Date().toISOString() } }; }
    async heartbeat(l: Lease, now: string, leaseMs: number) { return (await this.db.collection('analysis_jobs').updateOne(this.guard(l), { $set: { 'lease.expiresAt': new Date(Date.parse(now) + leaseMs).toISOString(), updatedAt: now } })).matchedCount === 1; }
    async updateCounters(l: Lease, counters: JobCounters, usage?: JobUsage) { return (await this.db.collection('analysis_jobs').updateOne(this.guard(l), { $set: { counters, ...(usage ? { usage } : {}) } })).matchedCount === 1; }
    private async fenced(l: Lease, action: (session: ClientSession) => Promise<void>) { const session = this.client.startSession(); let success = false; try { await session.withTransaction(async () => { success = false; const guard = await this.db.collection('analysis_jobs').updateOne(this.guard(l), { $set: { updatedAt: new Date().toISOString() }, $inc: { mutationRevision: 1 } }, { session }); if (!guard.matchedCount) return; await action(session); success = true; }); return success; } finally { await session.endSession(); } }
    async updateWindow(l: Lease, id: string, patch: Partial<Pick<WindowRecord, 'status' | 'diagnostics'>>) { return this.fenced(l, async session => { await this.db.collection('analysis_windows').updateOne({ jobId: l.jobId, id }, { $set: copy(patch) }, { session }); }); }
    async startAttempt(l: Lease, a: AnalysisAttempt) { bounded(a); return this.fenced(l, async session => { await this.db.collection('analysis_attempts').insertOne(copy(a), { session }); }); }
    async finishAttempt(l: Lease, a: AnalysisAttempt, results: AnalysisResult[]) { bounded(a); return this.fenced(l, async session => { await this.db.collection('analysis_attempts').replaceOne({ id: a.id, jobId: l.jobId }, copy(a), { session }); for (const r of results) await this.db.collection('analysis_results').updateOne({ jobId: r.jobId, windowId: r.windowId, codeId: r.codeId }, { $setOnInsert: copy(r) }, { upsert: true, session }); }); }
    async listResults(jobId: string, p: PageOptions = {}) { return this.page<AnalysisResult>('analysis_results', { jobId, ...(p.windowId ? { windowId: p.windowId } : {}) }, p); }
    async resultsForWindows(jobId: string, ids: string[]) { if (ids.length > 500) throw new AnalysisValidation('Window result join is limited to 500 windows'); return (await this.db.collection('analysis_results').find({ jobId, windowId: { $in: ids } }).limit(50000).toArray()).map(row => clean<AnalysisResult>(row)!); }
    async listAttempts(jobId: string, p: PageOptions = {}) { return this.page<AnalysisAttempt>('analysis_attempts', { jobId, ...(p.windowId ? { windowId: p.windowId } : {}) }, p); }
    async finishJob(l: Lease, status: JobStatus, counters: JobCounters, error?: string, usage?: JobUsage) { return (await this.db.collection('analysis_jobs').updateOne(this.guard(l), [{ $set: { status: { $cond: ['$cancelRequested', 'cancelled', { $literal: status }] }, counters: { $literal: counters }, ...(usage ? { usage: { $literal: usage } } : {}), ...(error ? { error: { $literal: error } } : {}), updatedAt: new Date().toISOString() } }, { $unset: 'lease' }])).matchedCount === 1; }
    async cancel(id: string) { await this.db.collection('analysis_jobs').updateOne({ id, status: { $in: ['preparing', 'queued', 'running'] } }, [{ $set: { cancelRequested: true, status: { $cond: [{ $eq: ['$status', 'running'] }, 'running', 'cancelled'] } } }]); return this.getJob(id); }
    async retry(id: string) { const r = await this.db.collection('analysis_jobs').updateOne({ id, ready: true, status: { $in: ['completed', 'partial', 'failed', 'cancelled'] } }, { $set: { status: 'queued', cancelRequested: false }, $unset: { lease: '' } }); const job = await this.getJob(id); if (job && !r.matchedCount) throw new AnalysisConflict('Job is still active'); return job; }
}