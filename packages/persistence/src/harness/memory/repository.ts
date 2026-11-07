import { randomUUID } from 'node:crypto';
import { assertMatchedPair, assertSameLaunchConfiguration } from '@sidechannel/domain/harness/launch';
import type { HarnessEvent, NewEvent, Run } from '@sidechannel/contracts/harness/contracts';
import type { ResearcherRepository, WorkerStatus } from '@sidechannel/contracts/server/contracts';
import { type Draft, type DraftMetadata, RepositoryConflict, type EventQuery, type RunQuery, type EvidenceKind, type EvidencePage } from '@sidechannel/contracts/harness/repository';
import { toRunSummary } from '@sidechannel/domain/harness/repository';

function eventPhase(event: HarnessEvent): string {
    const declared = (event.data as { phase?: string } | null)?.phase;
    if (declared === 'report' || event.type.startsWith('report') || event.invocationId?.includes(':report:'))
        return 'report';
    return declared ?? 'action';
}

function matchesEvent(event: HarnessEvent, query: EventQuery) { return event.sequence > (query.after ?? 0) && (!query.actor || event.agentId === query.actor) && (!query.type || event.type === query.type) && (!query.phase || eventPhase(event) === query.phase) && (query.from === undefined || event.sequence >= query.from) && (query.to === undefined || event.sequence <= query.to); }

function matchesRun(run: Run, q: RunQuery) { return (!q.status || q.status.split(',').includes(run.status)) && (!q.model || run.config.model.id === q.model) && (!q.condition || run.config.condition.id === q.condition) && (!q.scenario || [run.config.scenario.version, run.config.scenario.datasetId].includes(q.scenario)) && (!q.designation || (run.config.model.provider === 'scripted' ? 'fixture' : run.config.phase) === q.designation); }

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryRepository implements ResearcherRepository {
    protected runs = new Map<string, Run>();
    protected events: HarnessEvent[] = [];
    protected drafts = new Map<string, Draft>();
    private claims = new Set<string>();
    private workerGuard: string | undefined;
    async getRun(id: string) { return clone(this.runs.get(id) ?? null); }
    async getRunByLaunchKey(launchKey: string) { return clone([...this.runs.values()].find(run => run.launchKey === launchKey) ?? null); }
    async listRuns() { return clone([...this.runs.values()].reverse()); }
    async createRun(run: Run) {
        const existing = [...this.runs.values()].find(r => r.launchKey === run.launchKey);
        if (existing)
            { assertSameLaunchConfiguration(existing, run); return clone(existing); }
        if (this.runs.has(run.id))
            throw new Error('Duplicate run ID');
        this.runs.set(run.id, clone(run));
        return clone(run);
    }
    async createPair(runs: Run[]) {
        assertMatchedPair(runs);
        const existing = runs.map(run => [...this.runs.values()].find(r => r.launchKey === run.launchKey));
        if (existing.some(Boolean) && !existing.every(Boolean))
            throw new RepositoryConflict('Incomplete pair');
        if (existing.every(Boolean))
            { existing.forEach((run, i) => assertSameLaunchConfiguration(run!, runs[i]!)); return clone(existing as Run[]); }
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
    async listEvents(id: string, afterSequence = 0, limit = 1000) { return clone(this.events.filter(e => e.runId === id && e.sequence > afterSequence).slice(0, Math.min(limit, 10_000))); }
    async saveDraft(id: string, config: unknown, expectedRevision?: number, metadata: DraftMetadata = {}) { const current = this.drafts.get(id); if (current && expectedRevision !== current.revision || !current && expectedRevision !== undefined && expectedRevision !== 0) throw new RepositoryConflict('Draft changed; reload the current revision before saving'); const draft = { ...current, ...clone(metadata), id, config: clone(config), revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString() }; this.drafts.set(id, draft); return clone(draft); }
    async listDrafts() { return clone([...this.drafts.values()]); }
    async getDraft(id: string) { return clone(this.drafts.get(id) ?? null); }
    async queryRuns(query: RunQuery) { const rows = [...this.runs.values()].reverse().filter(run => matchesRun(run, query)); if (query.order === 'queue') rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.pairPosition ?? 0) - (b.pairPosition ?? 0) || a.id.localeCompare(b.id)); return { items: clone(rows.slice(query.offset, query.offset + query.limit).map(toRunSummary)), total: rows.length }; }
    async getRunSummary(id: string) { const run = this.runs.get(id); return run ? clone(toRunSummary(run)) : null; }
    async getEvidencePage(id: string, kind: EvidenceKind, offset: number, limit: number): Promise<EvidencePage> {
        const run = this.runs.get(id);
        if (!run)
            return { items: [], total: 0 };
        return clone({ items: run[kind].slice(offset, offset + limit), total: run[kind].length, ...(kind === 'reports' ? { reporting: { instructions: run.config.reportInstructions, schemaVersion: run.config.reportSchemaVersion } } : {}) });
    }
    async getEvidenceItem(id: string, kind: EvidenceKind, key: string): Promise<unknown | null> { const rows = this.runs.get(id)?.[kind] ?? []; const field = kind === 'board' ? 'id' : kind === 'artifacts' ? 'version' : 'agentId'; return clone(rows.find(row => String((row as unknown as Record<string, unknown>)[field]) === key) ?? null); }
    async queryEvents(id: string, query: EventQuery) { const offset = query.offset ?? 0; return clone(this.events.filter(event => event.runId === id && matchesEvent(event, query)).slice(offset, offset + (query.limit ?? 200))); }
    async getEvent(runId: string, eventId: string) { return clone(this.events.find(event => event.runId === runId && event.id === eventId) ?? null); }
    async workerStatus(): Promise<WorkerStatus> { return { capacity: 1, available: null, status: this.workerGuard ? 'registered' : 'unknown', ...(this.workerGuard ? { startedAt: this.workerGuard } : {}), note: 'Worker registration has no heartbeat; current availability is unknown.' }; }
    async acquireWorker(owner: string) {
        if (this.workerGuard)
            return false;
        this.workerGuard = owner;
        return true;
    }
    async releaseWorker(owner: string) { if (this.workerGuard === owner) this.workerGuard = undefined; }
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
