import type { EventLog, RunQueue, RunStateStore, WorkerGuard } from '../harness/server.js';
import type { HarnessEvent, Run } from '../harness/contracts.js';
import type { Draft, DraftMetadata, EventQuery, EvidenceKind, EvidencePage, RunQuery, RunSummary } from '../harness/repository.js';

/**
 * Single-worker lease state as reported to the dashboard.
 * - `active`: a worker holds the lease and its heartbeat is current.
 * - `stale`: a lease exists but its heartbeat expired (or it predates heartbeats); the next worker takes it over.
 * - `stopped`: no worker holds the lease.
 * - `registered`/`unknown`: adapters that cannot observe heartbeats (test doubles, early boot).
 */
export interface WorkerStatus {
    capacity: number;
    available: boolean;
    status: 'active' | 'stale' | 'stopped' | 'registered' | 'unknown';
    heartbeatAt?: string;
    startedAt?: string;
    note?: string;
}

/** Run listing and summary projections consumed by the dashboard's read model. */
export interface RunQueries {
    queryRuns(query: RunQuery): Promise<{ items: RunSummary[]; total: number }>;
    getRunSummary(id: string): Promise<RunSummary | null>;
    getRunByLaunchKey(launchKey: string): Promise<Run | null>;
}

/** Editable launch drafts with optimistic revisions. */
export interface DraftStore {
    saveDraft(id: string, config: unknown, expectedRevision?: number, metadata?: DraftMetadata): Promise<Draft>;
    listDrafts(): Promise<Draft[]>;
    getDraft(id: string): Promise<Draft | null>;
}

/** Read-only evidence surface: events, summaries and paginated projections. */
export interface EvidenceReader {
    queryEvents(id: string, query: EventQuery): Promise<HarnessEvent[]>;
    getEvent(runId: string, eventId: string): Promise<HarnessEvent | null>;
    getRunSummary(id: string): Promise<RunSummary | null>;
    getEvidencePage(id: string, kind: EvidenceKind, offset: number, limit: number): Promise<EvidencePage>;
    getEvidenceItem(id: string, kind: EvidenceKind, key: string): Promise<unknown | null>;
}

/** Single-worker registration state; the guard itself is on the harness `WorkerGuard` port. */
export interface WorkerSupervisor {
    workerStatus(): Promise<WorkerStatus>;
}

/**
 * Composition of the researcher capability slices for the API composition root and contract suites.
 * Consumers that need one capability take that slice (or a `Pick` of it); nothing needs the whole port.
 */
export interface ResearcherRepository extends RunStateStore, EventLog, RunQueue, WorkerGuard, RunQueries, DraftStore, EvidenceReader, WorkerSupervisor {
}

export interface ResearchRouteRequest {
    method: string;
    /** Path below `/api`, e.g. `/runs/:id/export`; never includes the `/api` prefix. */
    path: string;
    query: URLSearchParams;
    /** Reads and parses the JSON object body once, enforcing `limit` bytes (default 2 MB). The first limit wins. */
    body(limit?: number): Promise<Record<string, unknown>>;
}

export interface ResearchRouteResult { status: number; data: unknown; headers?: Record<string, string> }

export type ResearchRouteHandler = (request: ResearchRouteRequest) => Promise<ResearchRouteResult | null>;
